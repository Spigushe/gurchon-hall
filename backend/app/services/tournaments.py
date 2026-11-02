"""Tournois : `/tournois` (Lot 7, B2).

Scopé au compte : un tournoi ou un lieu d'un autre compte rend 404, avec le
message d'un identifiant inconnu.

**Mon bilan** (A12) se calcule à chaque lecture, par `vtes_rules.tournament_summary`,
à partir de mes seules participations : GW et VP des préliminaires, rondes jouées,
VP et GW de la finale. Pas de points de tournoi, pas de place à la table.

**Contrôles d'une écriture** (A7, A11, A12), tous sur l'état fusionné :

* 422 : dates, niveau contre politique de deck, règle de finale contre politique,
  classement contre le nombre de joueurs et ma finale ;
* 409 : ce que les parties déjà saisies contredisent (mono-deck, deck de finale
  selon la règle annoncée, nombre de rondes sous une ronde déjà jouée) et la
  suppression d'un tournoi qui contient des parties (A9).
"""

from datetime import date

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.models import Game, Tournament
from app.models.enums import RoundType
from app.schemas.play import (
    TournamentCreate,
    TournamentDetailRead,
    TournamentRead,
    TournamentSummary,
    TournamentUpdate,
)
from app.services import games, refs, vtes_rules
from app.services.errors import ConflictError, InvalidRequestError, NotFoundError
from app.services.persistence import commit_or_conflict, integrity_as_conflict
from app.services.play_checks import (
    Round,
    TournamentState,
    admissible_decks,
    deck_problems,
    load_rounds,
    ranking_problems,
    rounds_by_tournament,
    split,
    state_issues,
    state_of,
)
from app.services.text_search import contains_folded

_WRITE_CONFLICT = "Le tournoi contredit des données existantes."


def _not_found(tournament_id: int) -> NotFoundError:
    return NotFoundError(f"Tournoi {tournament_id} introuvable.")


def _load(db: Session, user_id: int, tournament_id: int) -> Tournament:
    tournament = db.scalar(
        select(Tournament).where(
            Tournament.id == tournament_id, Tournament.user_id == user_id
        )
    )
    if tournament is None:
        raise _not_found(tournament_id)
    return tournament


def summary_of(rounds: list[Round]) -> TournamentSummary:
    """Mon bilan, construit explicitement : `my_summary` n'a pas de valeur par
    défaut, un oubli échoue."""
    preliminaries, final = split(rounds)
    tally = vtes_rules.tournament_summary(
        [r.result for r in preliminaries], None if final is None else final.result
    )
    return TournamentSummary(
        preliminary_game_wins=tally.preliminary_game_wins,
        preliminary_victory_points=tally.preliminary_victory_points,
        rounds_played=tally.rounds_played,
        final_victory_points=tally.final_victory_points,
        final_game_win=tally.final_game_win,
    )


_PLAIN_FIELDS = [
    name for name in TournamentRead.model_fields if name != "my_summary"
]


def _read(tournament: Tournament, rounds: list[Round]) -> TournamentRead:
    return TournamentRead(
        **{name: getattr(tournament, name) for name in _PLAIN_FIELDS},
        my_summary=summary_of(rounds),
    )


def _game_sort_key(game: Game) -> tuple[bool, int, int]:
    return (game.round_type is RoundType.FINAL, game.round_number or 0, game.id)


def list_tournaments(
    db: Session,
    user_id: int,
    *,
    q: str | None = None,
    start_from: date | None = None,
    start_to: date | None = None,
) -> list[TournamentRead]:
    """Tournois du compte, le plus récent d'abord, chacun avec mon bilan.
    `from` et `to` bornent la date de début, incluses."""
    stmt = select(Tournament).where(Tournament.user_id == user_id)
    if q:
        stmt = stmt.where(contains_folded(Tournament.name, q))
    if start_from is not None:
        stmt = stmt.where(Tournament.start_date >= start_from)
    if start_to is not None:
        stmt = stmt.where(Tournament.start_date <= start_to)
    found = list(
        db.scalars(stmt.order_by(Tournament.start_date.desc(), Tournament.id.desc()))
    )
    rounds = rounds_by_tournament(db, user_id, [t.id for t in found])
    return [_read(t, rounds[t.id]) for t in found]


def get_tournament(
    db: Session, user_id: int, tournament_id: int
) -> TournamentDetailRead:
    """Le tournoi, mon bilan, mes parties (rondes dans l'ordre, finale en
    dernier) et les decks que ma finale peut jouer quand c'est calculable."""
    tournament = _load(db, user_id, tournament_id)
    rounds = load_rounds(db, user_id, tournament_id)
    played = db.scalars(
        select(Game)
        .where(Game.user_id == user_id, Game.tournament_id == tournament_id)
        .options(selectinload(Game.participations))
    ).unique()
    return TournamentDetailRead(
        **_read(tournament, rounds).model_dump(),
        games=[games.to_read(g) for g in sorted(played, key=_game_sort_key)],
        admissible_final_decks=admissible_decks(state_of(tournament), rounds),
    )


def _check_state(state: TournamentState, rounds: list[Round]) -> None:
    """422 : l'état fusionné se contredit lui-même, ou contredit ma finale."""
    issues = [*state_issues(state), *ranking_problems(state, rounds)]
    if issues:
        raise InvalidRequestError(" ".join(issues))


def create_tournament(
    db: Session,
    user_id: int,
    payload: TournamentCreate,
    *,
    allow_client_ref: bool = False,
) -> TournamentRead:
    venue = refs.resolve_venue(
        db, user_id, payload.venue, allow_client_ref=allow_client_ref
    )
    data = payload.model_dump(exclude={"venue"})
    state = TournamentState(
        **{name: data[name] for name in TournamentState.__dataclass_fields__}
    )
    _check_state(state, [])
    tournament = Tournament(
        user_id=user_id, venue_id=None if venue is None else venue.id, **data
    )
    db.add(tournament)
    commit_or_conflict(db, _WRITE_CONFLICT)
    db.refresh(tournament)
    return _read(tournament, [])


def update_tournament(
    db: Session,
    user_id: int,
    tournament_id: int,
    payload: TournamentUpdate,
    *,
    allow_client_ref: bool = False,
) -> TournamentRead:
    """Modification partielle. Les champs nullables envoyés à `null` sont remis à
    zéro ; les autres, omis, ne changent pas."""
    tournament = _load(db, user_id, tournament_id)
    fields = payload.model_fields_set
    changes = {name: getattr(payload, name) for name in fields if name != "venue"}

    venue_id = tournament.venue_id
    if "venue" in fields:
        venue = refs.resolve_venue(
            db, user_id, payload.venue, allow_client_ref=allow_client_ref
        )
        venue_id = None if venue is None else venue.id

    before = state_of(tournament)
    state = TournamentState(
        **{
            name: changes.get(name, getattr(before, name))
            for name in TournamentState.__dataclass_fields__
        }
    )
    rounds = load_rounds(db, user_id, tournament_id)
    _check_state(state, rounds)

    preliminaries, _ = split(rounds)
    last_round = max((r.round_number or 0 for r in preliminaries), default=0)
    if state.round_count is not None and state.round_count < last_round:
        raise ConflictError(
            f"La ronde {last_round} est déjà saisie : le tournoi ne peut pas "
            f"compter moins de {last_round} ronde(s)."
        )
    if fields & {"deck_policy", "final_deck_rule"}:
        problems = deck_problems(db, user_id, state, rounds)
        if problems:
            raise ConflictError(" ".join(problems))

    for name, value in changes.items():
        setattr(tournament, name, value)
    tournament.venue_id = venue_id
    commit_or_conflict(db, _WRITE_CONFLICT)
    db.refresh(tournament)
    return _read(tournament, rounds)


def delete_tournament(db: Session, user_id: int, tournament_id: int) -> None:
    """Refusé tant que le tournoi contient des parties (A9) : on les supprime ou
    on les détache d'abord."""
    tournament = _load(db, user_id, tournament_id)
    count = db.scalar(
        select(func.count(Game.id)).where(
            Game.tournament_id == tournament_id, Game.user_id == user_id
        )
    )
    if count:
        noun = "1 partie" if count == 1 else f"{count} parties"
        raise ConflictError(
            f"Ce tournoi contient {noun} : supprimez-les ou détachez-les du "
            "tournoi d'abord."
        )
    db.delete(tournament)
    with integrity_as_conflict(db, _WRITE_CONFLICT):
        db.commit()

