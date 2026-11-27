"""Comptes-rendus de tournoi (lot Compte-rendu, `docs/lot-compte-rendu-plan.md`).

Un compte-rendu par tournoi, généré dans une trame fixe (P1, P2) : ce module ne
connaît aucun texte, seulement l'**instantané** de ce que la trame affiche.

* **Couper une version** (`apply_request`, P5) : appelé par
  `tournaments.update_tournament` quand l'écriture porte `report`, donc aussi par
  `/sync` dans l'ordre de la file. L'instantané se construit depuis la base seule
  (`build_snapshot`) ; il devient une version nouvelle s'il diffère, en JSON
  canonique, de la dernière. Sinon, rien.
* **Lien public** (P8) : un jeton par compte-rendu, au format du Lot 13, créé en
  ligne une fois une version coupée, révoqué par la purge.
* **Lecture publique** (P9) : la dernière version, ou une antérieure si le
  propriétaire l'autorise ; le même 404 pour tout le reste.

**Portée par compte.** Toute fonction du propriétaire prend `user_id`, sans
valeur par défaut ; un tournoi d'un autre compte rend le 404 d'un identifiant
inconnu. Seule la lecture publique n'en prend pas.

Ce module n'importe pas `app.services.tournaments`, qui l'importe.
"""

import json
from collections.abc import Callable

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.models import (
    Card,
    Deck,
    DeckVersion,
    Game,
    Participation,
    Tournament,
    TournamentDeckVersion,
    TournamentReport,
    TournamentReportVersion,
    UserAccount,
)
from app.models.base import utcnow
from app.models.enums import RoundType
from app.schemas.report import (
    REPORT_FORMAT_VERSION,
    MyTournamentReportRead,
    PublicTournamentReportRead,
    ReportDeck,
    ReportDeckCard,
    ReportRound,
    ReportSeat,
    ReportSnapshot,
    ReportSummary,
    ReportTournament,
    ReportVenue,
    TournamentReportRead,
    TournamentReportRequest,
    TournamentReportSettings,
    TournamentReportVersionRead,
    TournamentReportVersionSummary,
)
from app.services import catalog, vtes_rules
from app.services.errors import ConflictError, NotFoundError
from app.services.persistence import commit_or_conflict
from app.services.play_checks import load_rounds, split
from app.services.shares import SHARE_TOKEN_ATTEMPTS, pick_token

REPORT_NOT_FOUND = "Compte-rendu introuvable."
"""Message unique de la lecture publique : jeton inconnu, purgé, ou version que
le lien ne montre pas ne se distinguent pas."""

type TokenPicker = Callable[[], str]


def _report_missing(tournament_id: int) -> NotFoundError:
    return NotFoundError(f"Compte-rendu du tournoi {tournament_id} introuvable.")


def _load_tournament(db: Session, user_id: int, tournament_id: int) -> Tournament:
    tournament = db.scalar(
        select(Tournament).where(
            Tournament.id == tournament_id, Tournament.user_id == user_id
        )
    )
    if tournament is None:
        raise NotFoundError(f"Tournoi {tournament_id} introuvable.")
    return tournament


def find_report(
    db: Session, user_id: int, tournament_id: int
) -> TournamentReport | None:
    """Le compte-rendu d'un tournoi du compte, ou rien."""
    return db.scalar(
        select(TournamentReport)
        .where(
            TournamentReport.user_id == user_id,
            TournamentReport.tournament_id == tournament_id,
        )
        .options(selectinload(TournamentReport.versions))
        .execution_options(populate_existing=True)
    )


def _load_report(db: Session, user_id: int, tournament_id: int) -> TournamentReport:
    _load_tournament(db, user_id, tournament_id)
    report = find_report(db, user_id, tournament_id)
    if report is None:
        raise _report_missing(tournament_id)
    return report


# --------------------------------------------------------------------------
# Instantané
# --------------------------------------------------------------------------


def _summary(db: Session, user_id: int, tournament_id: int) -> ReportSummary:
    preliminaries, final = split(load_rounds(db, user_id, tournament_id))
    tally = vtes_rules.tournament_summary(
        [r.result for r in preliminaries], None if final is None else final.result
    )
    return ReportSummary(
        preliminary_game_wins=tally.preliminary_game_wins,
        preliminary_victory_points=tally.preliminary_victory_points,
        rounds_played=tally.rounds_played,
        final_victory_points=tally.final_victory_points,
        final_game_win=tally.final_game_win,
    )


def _tournament_part(tournament: Tournament) -> ReportTournament:
    venue = tournament.venue
    return ReportTournament(
        name=tournament.name,
        start_date=tournament.start_date,
        end_date=tournament.end_date,
        venue=None if venue is None else ReportVenue(name=venue.name, city=venue.city),
        deck_policy=tournament.deck_policy,
        format=tournament.format,
        event_tier=tournament.event_tier,
        final_deck_rule=tournament.final_deck_rule,
        round_count=tournament.round_count,
        player_count=tournament.player_count,
        my_ranking=tournament.my_ranking,
        notes=tournament.notes,
    )


def _game_order(game: Game) -> tuple[bool, int, int]:
    return (game.round_type is RoundType.FINAL, game.round_number or 0, game.id)


def _seat_order(line: Participation) -> tuple[bool, int, int]:
    # Sièges dans l'ordre ; une ligne sans siège après, dans l'ordre de saisie.
    return (line.seat is None, line.seat or 0, line.id)


def _seat(
    line: Participation, *, include_my_notes: bool, include_opponent_notes: bool
) -> ReportSeat:
    """Une ligne de la table. Sa note n'y entre que si le réglage de son camp
    l'inclut : ma ligne selon `include_my_notes` (A8 de la v1.2.2, vrai par
    défaut), une ligne d'adversaire selon `include_opponent_notes` (P4)."""
    is_me = line.player is not None and line.player.is_me
    deck: Deck | None = line.deck
    keep_notes = include_my_notes if is_me else include_opponent_notes
    return ReportSeat(
        seat=line.seat,
        is_me=is_me,
        player_name=None if line.player is None or is_me else line.player.name,
        deck_id=deck.id if is_me and deck is not None else None,
        deck_name=deck.name if deck is not None else line.opponent_deck_name,
        deck_archetype=(
            deck.archetype if deck is not None else line.opponent_deck_archetype
        ),
        clan_name=(
            None
            if deck is not None or line.opponent_clan is None
            else line.opponent_clan.name
        ),
        victory_points=line.victory_points if is_me else None,
        game_win=line.game_win if is_me else None,
        notes=line.notes if keep_notes else None,
    )


def _round(
    game: Game, *, include_my_notes: bool, include_opponent_notes: bool
) -> ReportRound:
    return ReportRound(
        round_type=game.round_type,
        round_number=game.round_number,
        played_at=game.played_at,
        player_count=game.player_count,
        notes=game.notes,
        seats=[
            _seat(
                line,
                include_my_notes=include_my_notes,
                include_opponent_notes=include_opponent_notes,
            )
            for line in sorted(game.participations, key=_seat_order)
        ],
    )


def _decks(
    db: Session, user_id: int, tournament_id: int, games: list[Game]
) -> list[ReportDeck]:
    """Mes decks joués, dans l'ordre de leur première ronde, chacun avec la liste
    de sa version dans le tournoi (Lot 8, une par deck), copiée."""
    order: list[Deck] = []
    for game in games:
        for line in game.participations:
            mine = line.player is not None and line.player.is_me
            if mine and line.deck is not None and line.deck not in order:
                order.append(line.deck)
    versions = {
        row.deck_id: row.deck_version_id
        for row in db.scalars(
            select(TournamentDeckVersion).where(
                TournamentDeckVersion.user_id == user_id,
                TournamentDeckVersion.tournament_id == tournament_id,
            )
        )
    }
    loaded = {
        version.id: version
        for version in db.scalars(
            select(DeckVersion)
            .where(DeckVersion.id.in_(set(versions.values())))
            .options(selectinload(DeckVersion.cards))
        )
    }
    decks = []
    for deck in order:
        version = loaded.get(versions.get(deck.id, -1))
        decks.append(
            ReportDeck(
                deck_id=deck.id,
                name=deck.name,
                archetype=deck.archetype,
                version_number=None if version is None else version.number,
                cards=[]
                if version is None
                else [
                    ReportDeckCard(card_id=line.card_id, quantity=line.quantity)
                    for line in sorted(version.cards, key=lambda c: c.card_id)
                ],
            )
        )
    return decks


def build_snapshot(
    db: Session,
    user_id: int,
    tournament: Tournament,
    *,
    include_my_notes: bool,
    include_opponent_notes: bool,
) -> ReportSnapshot:
    """L'instantané du tournoi, depuis la base seule (A3), avec les notes de
    table que les deux réglages du compte-rendu incluent."""
    games = sorted(
        db.scalars(
            select(Game)
            .where(Game.user_id == user_id, Game.tournament_id == tournament.id)
            .options(
                selectinload(Game.participations).selectinload(Participation.player),
                selectinload(Game.participations).selectinload(Participation.deck),
                selectinload(Game.participations).selectinload(
                    Participation.opponent_clan
                ),
            )
            .execution_options(populate_existing=True)
        ).unique(),
        key=_game_order,
    )
    return ReportSnapshot(
        format_version=REPORT_FORMAT_VERSION,
        my_display_name=db.scalar(
            select(UserAccount.display_name).where(UserAccount.id == user_id)
        ),
        tournament=_tournament_part(tournament),
        summary=_summary(db, user_id, tournament.id),
        decks=_decks(db, user_id, tournament.id, games),
        rounds=[
            _round(
                game,
                include_my_notes=include_my_notes,
                include_opponent_notes=include_opponent_notes,
            )
            for game in games
        ],
    )


def canonical(snapshot: ReportSnapshot) -> str:
    """JSON canonique : clés triées, sans espaces. Deux versions sont égales si
    et seulement si leurs textes le sont.

    `my_display_name` nul est omis (v1.2.2, A11) : une version figée avant le
    champ ne le porte pas, et un compte toujours sans nom doit produire le même
    texte qu'elle, sans quoi la v1.2.2 couperait une version d'elle-même. Un
    nom posé, lui, change le texte et fait couper la version suivante."""
    data = snapshot.model_dump(mode="json")
    if data.get("my_display_name") is None:
        data.pop("my_display_name", None)
    return json.dumps(
        data,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    )


# --------------------------------------------------------------------------
# Demande portée par `tournament.update`
# --------------------------------------------------------------------------


def _touch(tournament: Tournament) -> None:
    """Avance `updated_at` du tournoi : le miroir relit le tournoi, donc son
    compte-rendu, sur ce seul signal (comme le regel du Lot 8 pour les
    parties)."""
    tournament.updated_at = utcnow()


def _cut_version(
    db: Session, user_id: int, tournament: Tournament, report: TournamentReport
) -> bool:
    text = canonical(
        build_snapshot(
            db,
            user_id,
            tournament,
            include_my_notes=report.include_my_notes,
            include_opponent_notes=report.include_opponent_notes,
        )
    )
    last = report.versions[-1] if report.versions else None
    if last is not None and last.snapshot == text:
        return False
    report.versions.append(
        TournamentReportVersion(
            number=1 if last is None else last.number + 1, snapshot=text
        )
    )
    return True


# Réglages du compte-rendu que porte une demande `update` : omis (None), un
# réglage ne change pas.
_REQUEST_SETTINGS = ("include_opponent_notes", "include_my_notes")


def _apply_settings(
    report: TournamentReport, request: TournamentReportRequest
) -> bool:
    """Pose sur le compte-rendu les réglages fournis ; dit si l'un a changé."""
    changed = False
    for name in _REQUEST_SETTINGS:
        value = getattr(request, name)
        if value is not None and value != getattr(report, name):
            setattr(report, name, value)
            changed = True
    return changed


def apply_request(
    db: Session, user_id: int, tournament: Tournament, request: TournamentReportRequest
) -> None:
    """Applique `report` d'une écriture du tournoi, sans commit : l'appelant
    commite le tout dans sa transaction. Les autres champs du tournoi sont déjà
    posés (et envoyés à la base par un `flush`)."""
    report = find_report(db, user_id, tournament.id)
    if request.action == "delete":
        if report is not None:
            db.delete(report)
            _touch(tournament)
        return
    created = report is None
    if report is None:
        # Réglages posés explicitement : `_cut_version` lit l'objet avant tout
        # `flush`, donc avant que la base n'applique ses valeurs par défaut.
        report = TournamentReport(
            user_id=user_id,
            tournament_id=tournament.id,
            include_opponent_notes=False,
            include_my_notes=True,
        )
        db.add(report)
    changed = _apply_settings(report, request) or created
    if _cut_version(db, user_id, tournament, report) or changed:
        _touch(tournament)


def has_report(db: Session, user_id: int, tournament_id: int) -> bool:
    return find_report(db, user_id, tournament_id) is not None


# --------------------------------------------------------------------------
# Lectures du propriétaire
# --------------------------------------------------------------------------


def _version_summaries(versions) -> list[TournamentReportVersionSummary]:
    return [
        TournamentReportVersionSummary(number=v.number, created_at=v.created_at)
        for v in versions
    ]


def to_read(report: TournamentReport) -> TournamentReportRead:
    return TournamentReportRead(
        tournament_id=report.tournament_id,
        include_opponent_notes=report.include_opponent_notes,
        include_my_notes=report.include_my_notes,
        show_previous_versions=report.show_previous_versions,
        token=report.token,
        created_at=report.created_at,
        versions=_version_summaries(report.versions),
    )


def read_for_tournament(
    db: Session, user_id: int, tournament_id: int
) -> TournamentReportRead | None:
    """Le compte-rendu d'un tournoi pour `TournamentDetailRead.report`."""
    report = find_report(db, user_id, tournament_id)
    return None if report is None else to_read(report)


def get_report(db: Session, user_id: int, tournament_id: int) -> TournamentReportRead:
    return to_read(_load_report(db, user_id, tournament_id))


def _version_of(
    report: TournamentReport, number: int
) -> TournamentReportVersion | None:
    return next((v for v in report.versions if v.number == number), None)


def get_version(
    db: Session, user_id: int, tournament_id: int, number: int
) -> TournamentReportVersionRead:
    report = _load_report(db, user_id, tournament_id)
    version = _version_of(report, number)
    if version is None:
        raise NotFoundError(
            f"Version {number} du compte-rendu du tournoi {tournament_id} introuvable."
        )
    return TournamentReportVersionRead(
        number=version.number,
        created_at=version.created_at,
        snapshot=ReportSnapshot.model_validate_json(version.snapshot),
    )


def update_settings(
    db: Session, user_id: int, tournament_id: int, payload: TournamentReportSettings
) -> TournamentReportRead:
    report = _load_report(db, user_id, tournament_id)
    if report.show_previous_versions != payload.show_previous_versions:
        report.show_previous_versions = payload.show_previous_versions
        _touch(report.tournament)
    commit_or_conflict(db, "Le réglage n'a pas pu être enregistré.")
    return get_report(db, user_id, tournament_id)


def create_link(
    db: Session, user_id: int, tournament_id: int, *, pick: TokenPicker | None = None
) -> TournamentReportRead:
    """Tire le jeton du lien (P8) ; rend le lien existant s'il y en a un. 409
    tant qu'aucune version n'est coupée : le lien montrerait une page vide."""
    report = _load_report(db, user_id, tournament_id)
    if report.token is not None:
        return to_read(report)
    if not report.versions:
        raise ConflictError(
            "Le compte-rendu n'a pas encore de version : mettez-le à jour avant de "
            "le partager."
        )
    draw = pick or pick_token
    for _ in range(SHARE_TOKEN_ATTEMPTS):
        report.token = draw()
        _touch(report.tournament)
        try:
            db.flush()
        except IntegrityError:
            db.rollback()  # jeton déjà pris : un autre tirage
            report = _load_report(db, user_id, tournament_id)
            continue
        commit_or_conflict(db, "Le lien n'a pas pu être enregistré.")
        return get_report(db, user_id, tournament_id)
    raise ConflictError(
        f"Aucun jeton libre n'a pu être tiré après {SHARE_TOKEN_ATTEMPTS} essais : "
        "réessayer."
    )


def revoke_link(db: Session, user_id: int, tournament_id: int) -> TournamentReportRead:
    """Purge le lien (P8) ; sans effet s'il n'y en a pas. Un nouveau partage
    tirera un jeton neuf."""
    report = _load_report(db, user_id, tournament_id)
    if report.token is not None:
        report.token = None
        _touch(report.tournament)
        commit_or_conflict(db, "La purge n'a pas pu être enregistrée.")
    return get_report(db, user_id, tournament_id)


def list_my_reports(db: Session, user_id: int) -> list[MyTournamentReportRead]:
    """Les comptes-rendus du compte, du tournoi le plus récent au plus ancien."""
    reports = db.scalars(
        select(TournamentReport)
        .join(
            Tournament,
            (Tournament.id == TournamentReport.tournament_id)
            & (Tournament.user_id == TournamentReport.user_id),
        )
        .where(TournamentReport.user_id == user_id)
        .options(
            selectinload(TournamentReport.versions),
            selectinload(TournamentReport.tournament),
        )
        .order_by(Tournament.start_date.desc(), Tournament.id.desc())
    )
    return [
        MyTournamentReportRead(
            tournament_id=report.tournament_id,
            tournament_name=report.tournament.name,
            start_date=report.tournament.start_date,
            token=report.token,
            latest_number=report.versions[-1].number if report.versions else None,
        )
        for report in reports
    ]


# --------------------------------------------------------------------------
# Lecture publique
# --------------------------------------------------------------------------


def _snapshot_cards(db: Session, snapshot: ReportSnapshot):
    ids = sorted({card.card_id for deck in snapshot.decks for card in deck.cards})
    if not ids:
        return []
    found = {
        card_id
        for (card_id,) in db.execute(select(Card.id).where(Card.id.in_(ids)))
    }
    known = [card_id for card_id in ids if card_id in found]
    items = catalog.list_cards(db, ids=known, limit=len(known)) if known else []
    return sorted(items, key=lambda item: item.id)


def read_public(
    db: Session, token: str, number: int | None = None
) -> PublicTournamentReportRead:
    """Une version par le lien, sans session (P8, P9). La dernière si `number`
    est omis ; une antérieure seulement si le propriétaire l'autorise. Jeton
    inconnu, purgé, compte-rendu sans version ou version cachée : le même 404."""
    report = db.scalar(
        select(TournamentReport)
        .where(TournamentReport.token == token)
        .options(selectinload(TournamentReport.versions))
    )
    if report is None or not report.versions:
        raise NotFoundError(REPORT_NOT_FOUND)
    latest = report.versions[-1]
    wanted = latest if number is None else _version_of(report, number)
    if wanted is None or (wanted is not latest and not report.show_previous_versions):
        raise NotFoundError(REPORT_NOT_FOUND)
    visible = report.versions if report.show_previous_versions else [latest]
    snapshot = ReportSnapshot.model_validate_json(wanted.snapshot)
    author = db.scalar(
        select(UserAccount.username).where(UserAccount.id == report.user_id)
    )
    return PublicTournamentReportRead(
        author=author,
        number=wanted.number,
        created_at=wanted.created_at,
        latest_number=latest.number,
        versions=_version_summaries(visible),
        snapshot=snapshot,
        cards=_snapshot_cards(db, snapshot),
    )
