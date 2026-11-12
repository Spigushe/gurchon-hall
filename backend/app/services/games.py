"""Parties : `/parties` et `/parties/{id}/participations` (Lot 7, B2).

Scopé au compte : la partie, le tournoi, le lieu, le joueur ou le deck d'un
autre compte rend 404, avec le message d'un identifiant inconnu (jamais le 409
d'une clé étrangère composite).

**Un seul service pour écrire une partie.** `create_game` et `update_game` (champs
et table, ensemble ou séparément) font chacun un seul `commit`. Le service de
`game.update` de `/sync` (B3) est le même : le commit relâche le point de
sauvegarde de l'opération, comme pour les services de decks et de stock.

**Résolution, contrôle, puis écriture.** Toutes les références sont résolues
avant la première écriture (`app.services.refs`) ; les règles se contrôlent sur
l'état **fusionné** avant tout `flush`, sans quoi les CHECK de R10 répondraient
par un 500 ; le tournoi se contrôle sur l'état hypothétique où cette partie a
sa nouvelle forme (`app.services.play_checks`).

* 422 : règles de forme de la partie (ronde, table, VP, GW, adversaire avec un
  résultat) ;
* 409 : ce qui contredit des données existantes (ronde ou finale déjà saisie,
  mono-deck, deck de finale, classement, deck supprimé) ;
* 404 : une ressource désignée absente ou d'un autre compte.

**La table se remplace d'un bloc** (A3) : on vide l'ancienne puis on fait un
`flush` avant d'insérer, car réassigner `game.participations` émet les INSERT
avant les DELETE et heurte les unicités (partie, joueur) et (partie, siège).
"""

from dataclasses import dataclass, replace
from datetime import UTC, datetime

from sqlalchemy import and_, select
from sqlalchemy.orm import Session, selectinload

from app.models import Clan, Game, Participation, Player, Tournament
from app.models.base import utcnow
from app.models.enums import DeckArchetype, RoundType
from app.schemas.play import (
    GameCreate,
    GameDetailRead,
    GameRead,
    GameUpdate,
    ParticipationCreate,
    ParticipationRead,
)
from app.services import deck_versions, refs, vtes_rules
from app.services.errors import ConflictError, InvalidRequestError, NotFoundError
from app.services.persistence import commit_or_conflict, integrity_as_conflict
from app.services.play_checks import (
    Round,
    deck_label,
    deck_problems,
    load_rounds,
    ranking_problems,
    state_of,
)

_WRITE_CONFLICT = "La partie contredit des données existantes."
_SLOT_TAKEN = (
    "Cette ronde ou la finale est déjà saisie pour ce tournoi "
    "(sur un autre appareil ?)."
)
_LEAVING = "Retirer cette ronde changerait le deck attendu en finale : "


def _not_found(game_id: int) -> NotFoundError:
    return NotFoundError(f"Partie {game_id} introuvable.")


# --------------------------------------------------------------------------
# Lecture
# --------------------------------------------------------------------------


def _my_line(game: Game) -> Participation:
    me = game.me
    if me is None:
        # Invariant du service (A2), jamais atteint par l'API : on le dit plutôt
        # que de laisser la validation de la réponse échouer sans explication.
        raise RuntimeError(
            f"La partie {game.id} n'a pas de ligne « Moi » : données incohérentes."
        )
    return me


def to_read(game: Game) -> GameRead:
    """Une partie en résumé (forme de liste). Suppose participations, joueurs et
    tournoi chargés d'avance."""
    _my_line(game)
    return GameRead.model_validate(game)


def _table_order(participation: Participation) -> tuple[bool, int, int]:
    seat = participation.seat
    return (seat is None, seat or 0, participation.id)


def to_detail(game: Game) -> GameDetailRead:
    """Une partie et sa table, triée par siège (les sans-siège en dernier)."""
    base = to_read(game)
    table = [
        ParticipationRead.model_validate(p)
        for p in sorted(game.participations, key=_table_order)
    ]
    return GameDetailRead(**base.model_dump(), participations=table)


def _load(db: Session, user_id: int, game_id: int) -> Game:
    """La partie du compte, rechargée depuis la base avec sa table : sans
    `populate_existing`, une table remplacée dans la même session resterait celle
    qu'elle avait."""
    game = db.scalar(
        select(Game)
        .where(Game.id == game_id, Game.user_id == user_id)
        .options(selectinload(Game.participations))
        .execution_options(populate_existing=True)
    )
    if game is None:
        raise _not_found(game_id)
    return game


def get_game(db: Session, user_id: int, game_id: int) -> GameDetailRead:
    return to_detail(_load(db, user_id, game_id))


def _utc(value: datetime | None, name: str) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        raise InvalidRequestError(
            "Un instant avec fuseau est attendu (« 2026-10-24T20:00:00+02:00 »).",
            loc=("query", name),
        )
    try:
        return value.astimezone(UTC)
    except OverflowError as error:  # 0001-01-01T00:00:00+14:00, par exemple
        raise InvalidRequestError(
            "Instant hors des bornes représentables.", loc=("query", name)
        ) from error


def list_games(
    db: Session,
    user_id: int,
    *,
    tournament_id: int | None = None,
    casual: bool | None = None,
    deck_id: int | None = None,
    venue_id: int | None = None,
    played_from: datetime | None = None,
    played_to: datetime | None = None,
) -> list[GameRead]:
    """Parties du compte, la plus récente d'abord. Bornes `from` et `to`
    incluses, en instants (pas en dates : le fuseau du serveur n'y entre pas).
    `deck_id` ne regarde que **ma** ligne : un deck prêté n'est pas un deck
    joué."""
    played_from = _utc(played_from, "from")
    played_to = _utc(played_to, "to")
    stmt = select(Game).where(Game.user_id == user_id)
    if tournament_id is not None:
        stmt = stmt.where(Game.tournament_id == tournament_id)
    if casual is not None:
        stmt = stmt.where(
            Game.round_type == RoundType.CASUAL
            if casual
            else Game.round_type != RoundType.CASUAL
        )
    if venue_id is not None:
        stmt = stmt.where(Game.venue_id == venue_id)
    if deck_id is not None:
        mine = (
            select(Participation.game_id)
            .join(
                Player,
                and_(
                    Player.id == Participation.player_id,
                    Player.user_id == Participation.user_id,
                ),
            )
            .where(
                Participation.user_id == user_id,
                Participation.deck_id == deck_id,
                Player.is_me.is_(True),
            )
        )
        stmt = stmt.where(Game.id.in_(mine))
    if played_from is not None:
        stmt = stmt.where(Game.played_at >= played_from)
    if played_to is not None:
        stmt = stmt.where(Game.played_at <= played_to)
    stmt = stmt.options(selectinload(Game.participations)).order_by(
        Game.played_at.desc(), Game.id.desc()
    )
    return [to_read(game) for game in db.scalars(stmt).unique()]


# --------------------------------------------------------------------------
# Contrôles
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class Line:
    """Une ligne de table résolue : joueur et deck sont des identifiants du
    compte, vérifiés. Une ligne d'adversaire non nommé n'a pas de joueur (Lot 8,
    P6)."""

    player_id: int | None
    is_me: bool
    deck_id: int | None
    seat: int | None
    victory_points: float | None
    game_win: bool | None
    notes: str | None
    opponent_deck_name: str | None = None
    opponent_deck_archetype: DeckArchetype | None = None
    opponent_clan_id: int | None = None


def _existing_lines(game: Game) -> list[Line]:
    return [
        Line(
            p.player_id,
            p.is_me,
            p.deck_id,
            p.seat,
            p.victory_points,
            p.game_win,
            p.notes,
            p.opponent_deck_name,
            p.opponent_deck_archetype,
            p.opponent_clan_id,
        )
        for p in game.participations
    ]


_OPPONENT_FIELDS = ("opponent_deck_name", "opponent_deck_archetype", "opponent_clan_id")


def _opponent_field_sent(row: ParticipationCreate) -> str | None:
    """Le premier champ adverse renseigné, `None` s'il n'y en a pas."""
    return next((n for n in _OPPONENT_FIELDS if getattr(row, n) is not None), None)


def _resolve_deck_of(
    db: Session,
    user_id: int,
    row: ParticipationCreate,
    where: tuple,
    allow_client_ref: bool,
    kept_decks: set[int],
) -> int | None:
    """Le deck de la ligne. Un deck supprimé n'est refusé que s'il n'était pas déjà
    joué par l'ancienne table, sur n'importe quelle ligne (A8, précisions B1) :
    sans cela, une table qui garde un ancien deck ne pourrait plus être corrigée."""
    if row.deck is None:
        return None
    deck = refs.resolve_deck(
        db, user_id, row.deck, allow_client_ref=allow_client_ref, loc=(*where, "deck")
    )
    if deck.deleted_at is not None and deck.id not in kept_decks:
        raise ConflictError(
            f"Le deck {deck_label(deck)} est supprimé : il ne peut plus "
            "être joué ni prêté."
        )
    return deck.id


def _check_clan(db: Session, clan_id: int | None) -> None:
    if clan_id is not None and db.get(Clan, clan_id) is None:
        raise NotFoundError(f"Clan {clan_id} introuvable.")


def _refuse_misplaced(
    row: ParticipationCreate,
    player: Player | None,
    is_me: bool,
    deck_id: int | None,
    where: tuple,
) -> None:
    """Ce que la place de la ligne interdit : VP et GW d'un adversaire, deck
    adverse sur ma ligne ou sur une ligne qui joue un de mes decks, ligne sans
    joueur qui ne dit rien (P5, P6)."""
    if not is_me and (row.victory_points is not None or row.game_win is not None):
        name = "Adversaire non nommé" if player is None else player.name
        raise InvalidRequestError(
            f"{name} : on ne suit ni les VP ni le Game Win d'un "
            "adversaire, seulement les miens.",
            loc=(*where, "victory_points"),
        )
    sent = _opponent_field_sent(row)
    if sent is not None and (is_me or deck_id is not None):
        raise InvalidRequestError(
            "Le deck adverse ne se décrit que sur un adversaire qui ne joue "
            "pas un de mes decks : ma ligne et un deck prêté le connaissent déjà.",
            loc=(*where, sent),
        )
    if player is None and row.seat is None and deck_id is None and sent is None:
        raise InvalidRequestError(
            "Un adversaire non nommé porte un siège, un deck prêté ou la "
            "description de son deck (des notes seules ne disent rien).",
            loc=(*where, "player"),
        )


def _resolve_row(
    db: Session,
    user_id: int,
    row: ParticipationCreate,
    index: int,
    allow_client_ref: bool,
    kept_decks: set[int],
) -> Line:
    where = ("body", "participations", index)
    player = None
    if row.player is not None:
        player = refs.resolve_player(
            db,
            user_id,
            row.player,
            allow_client_ref=allow_client_ref,
            loc=(*where, "player"),
        )
    deck_id = _resolve_deck_of(db, user_id, row, where, allow_client_ref, kept_decks)
    _check_clan(db, row.opponent_clan_id)
    is_me = player is not None and player.is_me
    _refuse_misplaced(row, player, is_me, deck_id, where)
    return Line(
        None if player is None else player.id,
        is_me,
        deck_id,
        row.seat,
        row.victory_points,
        row.game_win,
        row.notes,
        row.opponent_deck_name,
        row.opponent_deck_archetype,
        row.opponent_clan_id,
    )


def _resolve_table(
    db: Session,
    user_id: int,
    table: list[ParticipationCreate],
    *,
    allow_client_ref: bool,
    kept_decks: set[int],
) -> list[Line]:
    """Résout joueurs et decks de la table, avant toute écriture.

    `kept_decks` : les decks que la table actuelle joue déjà."""
    return [
        _resolve_row(db, user_id, row, index, allow_client_ref, kept_decks)
        for index, row in enumerate(table)
    ]


def _check_table(player_count: int, lines: list[Line]) -> list[Line]:
    """Table, VP et GW sur l'état fusionné (A2, A4, A5, A13) ; rend les lignes
    avec le GW à enregistrer sur la mienne."""
    issues = vtes_rules.table_issues(
        player_count,
        (vtes_rules.TableLine(line.player_id, line.is_me, line.seat) for line in lines),
    )
    mine = [line for line in lines if line.is_me]
    if len(mine) == 1:
        me = mine[0]
        issues += vtes_rules.vp_issues(player_count, me.victory_points)
        issues += vtes_rules.game_win_issues(
            player_count, me.victory_points, me.game_win
        )
    if issues:
        raise InvalidRequestError(" ".join(issues), loc=("body", "participations"))
    return [
        _with_game_win(line, player_count) if line.is_me else line for line in lines
    ]


def _with_game_win(line: Line, player_count: int) -> Line:
    win = vtes_rules.resolved_game_win(
        player_count, line.victory_points, line.game_win
    )
    return replace(line, game_win=win)


def _check_round_slot(
    db: Session,
    user_id: int,
    tournament_id: int,
    round_type: RoundType,
    round_number: int | None,
    game_id: int | None,
) -> None:
    """« Ronde N déjà saisie » et « finale déjà saisie », avant l'écriture : les
    index uniques de R10 sont le dernier filet, pas le message."""
    if round_type is RoundType.CASUAL:
        return
    stmt = select(Game.id).where(
        Game.user_id == user_id,
        Game.tournament_id == tournament_id,
        Game.round_type == round_type,
    )
    if round_type is RoundType.PRELIMINARY:
        stmt = stmt.where(Game.round_number == round_number)
    if game_id is not None:
        stmt = stmt.where(Game.id != game_id)
    if db.scalar(stmt.limit(1)) is None:
        return
    if round_type is RoundType.FINAL:
        raise ConflictError("La finale est déjà saisie pour ce tournoi.")
    raise ConflictError(
        f"La ronde {round_number} est déjà saisie pour ce tournoi "
        "(sur un autre appareil ?)."
    )


def _check_tournament(
    db: Session,
    user_id: int,
    tournament: Tournament,
    game_id: int | None,
    new_round: Round | None,
    context: str = "",
) -> None:
    """Mono-deck, deck de finale et classement du tournoi, dans l'état où la
    partie `game_id` est remplacée par `new_round` (ou retirée si `None`).
    `context` préfixe le message : retirer une ronde ne dit pas, sans lui,
    pourquoi la finale est en cause."""
    current = load_rounds(db, user_id, tournament.id)
    rounds = [r for r in current if r.game_id != game_id]
    if new_round is not None:
        rounds.append(new_round)
    state = state_of(tournament)
    problems = [
        *deck_problems(db, user_id, state, rounds),
        *ranking_problems(state, rounds),
    ]
    if problems:
        raise ConflictError(context + " ".join(problems))


def _round_of(
    game_id: int | None,
    round_type: RoundType,
    round_number: int | None,
    me: Line,
) -> Round:
    return Round(
        game_id, round_type, round_number, me.deck_id, me.victory_points, me.game_win
    )


def _validate(
    db: Session,
    user_id: int,
    game: Game | None,
    *,
    tournament: Tournament | None,
    round_type: RoundType,
    round_number: int | None,
    player_count: int,
    lines: list[Line],
) -> list[Line]:
    """Toutes les règles de l'état fusionné ; rend les lignes à écrire."""
    issues = vtes_rules.round_issues(
        round_type,
        tournament is not None,
        round_number,
        None if tournament is None else tournament.round_count,
    )
    if issues:
        raise InvalidRequestError(" ".join(issues), loc=("body", "round_type"))
    lines = _check_table(player_count, lines)
    game_id = None if game is None else game.id
    if tournament is not None:
        _check_round_slot(
            db, user_id, tournament.id, round_type, round_number, game_id
        )
        me = next(line for line in lines if line.is_me)
        mine = _round_of(game_id, round_type, round_number, me)
        _check_tournament(db, user_id, tournament, game_id, mine)
    old = None if game is None else game.tournament
    if old is not None and (tournament is None or tournament.id != old.id):
        # La partie quitte le tournoi : ce que sa présence tenait ne tient plus.
        _check_tournament(db, user_id, old, game_id, None, _LEAVING)
    return lines


# --------------------------------------------------------------------------
# Écriture
# --------------------------------------------------------------------------


def _add_lines(
    db: Session,
    user_id: int,
    game: Game,
    lines: list[Line],
    versions: dict[int, int],
) -> None:
    for line in lines:
        db.add(
            Participation(
                user_id=user_id,
                game_id=game.id,
                player_id=line.player_id,
                deck_id=line.deck_id,
                deck_version_id=versions.get(line.deck_id),
                seat=line.seat,
                victory_points=line.victory_points,
                game_win=line.game_win,
                opponent_deck_name=line.opponent_deck_name,
                opponent_deck_archetype=line.opponent_deck_archetype,
                opponent_clan_id=line.opponent_clan_id,
                notes=line.notes,
            )
        )
    db.flush()


def _deck_ids(lines: list[Line]) -> set[int]:
    return {line.deck_id for line in lines if line.deck_id is not None}


def create_game(
    db: Session,
    user_id: int,
    payload: GameCreate,
    *,
    allow_client_ref: bool = False,
) -> GameDetailRead:
    """Crée une partie avec sa table, en une transaction."""
    venue = refs.resolve_venue(
        db, user_id, payload.venue, allow_client_ref=allow_client_ref
    )
    tournament = refs.resolve_tournament(
        db, user_id, payload.tournament, allow_client_ref=allow_client_ref
    )
    lines = _resolve_table(
        db,
        user_id,
        payload.participations,
        allow_client_ref=allow_client_ref,
        kept_decks=set(),
    )
    lines = _validate(
        db,
        user_id,
        None,
        tournament=tournament,
        round_type=payload.round_type,
        round_number=payload.round_number,
        player_count=payload.player_count,
        lines=lines,
    )
    tournament_id = None if tournament is None else tournament.id
    game = Game(
        user_id=user_id,
        played_at=payload.played_at,
        venue_id=None if venue is None else venue.id,
        tournament_id=tournament_id,
        round_number=payload.round_number,
        round_type=payload.round_type,
        player_count=payload.player_count,
        notes=payload.notes,
    )
    db.add(game)
    with integrity_as_conflict(db, _SLOT_TAKEN):
        db.flush()
        versions = deck_versions.assign_versions(
            db, user_id, game, tournament_id, _deck_ids(lines), {}
        )
        _add_lines(db, user_id, game, lines, versions)
    commit_or_conflict(db, _WRITE_CONFLICT)
    return get_game(db, user_id, game.id)


def _write_table(
    db: Session,
    user_id: int,
    game: Game,
    table: list[ParticipationCreate] | None,
    lines: list[Line],
    versions: dict[int, int],
) -> None:
    """Écrit la table : remplacée d'un bloc, ou gardée avec les versions décidées."""
    if table is not None:
        with integrity_as_conflict(db, _SLOT_TAKEN):
            game.participations.clear()
            db.flush()
            _add_lines(db, user_id, game, lines, versions)
        return
    for participation in game.participations:
        if participation.deck_id in versions:
            participation.deck_version_id = versions[participation.deck_id]
    # Le GW se rejoue avec la table (un nombre de joueurs qui change peut
    # rendre un GW certain) : on ne touche que ma ligne.
    win = next(line.game_win for line in lines if line.is_me)
    me = _my_line(game)
    if me.game_win != win:
        me.game_win = win


def _resolve_targets(
    db: Session,
    user_id: int,
    game: Game,
    payload: GameUpdate | None,
    allow_client_ref: bool,
) -> tuple[int | None, Tournament | None]:
    """Lieu (identifiant) et tournoi de l'état fusionné ; ce qui n'est pas dans
    la requête reste ce que la partie avait."""
    fields = set() if payload is None else payload.model_fields_set
    venue_id = game.venue_id
    if "venue" in fields:
        venue = refs.resolve_venue(
            db, user_id, payload.venue, allow_client_ref=allow_client_ref
        )
        venue_id = None if venue is None else venue.id
    tournament = game.tournament
    if "tournament" in fields:
        tournament = refs.resolve_tournament(
            db, user_id, payload.tournament, allow_client_ref=allow_client_ref
        )
    return venue_id, tournament


def _apply_fields(
    game: Game,
    changes: dict,
    *,
    venue_id: int | None,
    tournament_id: int | None,
    round_type: RoundType,
    round_number: int | None,
    player_count: int,
) -> None:
    for name in ("played_at", "notes"):
        if name in changes:
            setattr(game, name, changes[name])
    game.venue_id = venue_id
    game.tournament_id = tournament_id
    game.round_number = round_number
    game.round_type = round_type
    game.player_count = player_count


def update_game(
    db: Session,
    user_id: int,
    game_id: int,
    payload: GameUpdate | None = None,
    table: list[ParticipationCreate] | None = None,
    *,
    allow_client_ref: bool = False,
) -> GameDetailRead:
    """Modifie les champs d'une partie (`payload`), sa table entière (`table`),
    ou les deux d'un seul commit.

    Les champs omis ne changent pas ; `venue`, `tournament`, `round_number` et
    `notes` envoyés à `null` sont remis à zéro. Le contrôle porte toujours sur
    l'état fusionné : changer `player_count` revérifie les VP, le GW et les
    sièges de la table existante, et le tournoi se contrôle comme si la partie
    avait déjà sa nouvelle forme.

    Les versions de deck (Lot 8) se décident sur l'état final : table remplacée,
    partie qui change de tournoi, ou `refreeze_decklists`. Toute autre écriture
    garde les versions de la table.
    """
    game = _load(db, user_id, game_id)
    fields = set() if payload is None else payload.model_fields_set
    changes = {name: getattr(payload, name) for name in fields}
    venue_id, tournament = _resolve_targets(
        db, user_id, game, payload, allow_client_ref
    )
    round_type = changes.get("round_type", game.round_type)
    round_number = changes.get("round_number", game.round_number)
    player_count = changes.get("player_count", game.player_count)

    if table is not None:
        kept = {p.deck_id for p in game.participations if p.deck_id is not None}
        lines = _resolve_table(
            db, user_id, table, allow_client_ref=allow_client_ref, kept_decks=kept
        )
    else:
        lines = _existing_lines(game)
    lines = _validate(
        db,
        user_id,
        game,
        tournament=tournament,
        round_type=round_type,
        round_number=round_number,
        player_count=player_count,
        lines=lines,
    )

    # Aucun refus possible au-delà : on écrit.
    old_tournament_id = game.tournament_id
    new_tournament_id = None if tournament is None else tournament.id
    previous = deck_versions.versions_of(game)
    _apply_fields(
        game,
        changes,
        venue_id=venue_id,
        tournament_id=new_tournament_id,
        round_type=round_type,
        round_number=round_number,
        player_count=player_count,
    )
    refreeze = payload is not None and payload.refreeze_decklists
    decide = table is not None or old_tournament_id != new_tournament_id or refreeze
    with integrity_as_conflict(db, _WRITE_CONFLICT):
        db.flush()
        versions = {}
        if decide:
            versions = deck_versions.assign_versions(
                db,
                user_id,
                game,
                new_tournament_id,
                _deck_ids(lines),
                previous,
                refreeze=refreeze,
            )
        _write_table(db, user_id, game, table, lines, versions)
        db.flush()
        deck_versions.hand_over(
            db,
            user_id,
            game.id,
            {t for t in (old_tournament_id, new_tournament_id) if t is not None},
        )
    # La table se remplace sans toucher à la ligne `game` : l'horodatage est posé
    # à la main, le miroir hors ligne s'en sert pour savoir quelle table relire.
    game.updated_at = utcnow()
    commit_or_conflict(db, _WRITE_CONFLICT)
    return get_game(db, user_id, game_id)


def replace_table(
    db: Session,
    user_id: int,
    game_id: int,
    table: list[ParticipationCreate],
    *,
    allow_client_ref: bool = False,
) -> GameDetailRead:
    """Remplace la table entière d'une partie (A3)."""
    return update_game(
        db, user_id, game_id, None, table, allow_client_ref=allow_client_ref
    )


def delete_game(db: Session, user_id: int, game_id: int) -> None:
    """Supprime une partie et sa table (A9). Retirer une préliminaire peut
    changer le deck que la finale devait jouer : le tournoi se recontrôle. Les
    versions que la partie a figées pour son tournoi passent à la partie suivante
    avant la suppression, la clé étrangère ne cascadant pas."""
    game = _load(db, user_id, game_id)
    if game.tournament is not None:
        _check_tournament(db, user_id, game.tournament, game.id, None, _LEAVING)
        deck_versions.hand_over(
            db, user_id, game.id, {game.tournament.id}, leaving=True
        )
    db.delete(game)
    with integrity_as_conflict(db, _WRITE_CONFLICT):
        db.commit()
