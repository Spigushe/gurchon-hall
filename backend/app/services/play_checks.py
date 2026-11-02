"""Contrôles d'un tournoi sur plusieurs parties (Lot 7, B2).

Les fonctions pures de `vtes_rules` jugent des valeurs ; ce module les nourrit
avec l'état du compte et, surtout, avec un état **hypothétique** : une écriture
se contrôle sur l'état fusionné, avant tout `flush`, sans quoi les CHECK de R10
répondraient par un 500. L'appelant retire de `load_rounds` la partie qu'il
modifie, y ajoute sa version voulue, et rend le tout à `deck_problems` et
`ranking_problems`.

Ne regarde que **ma** participation à chaque partie (A7, A11, A12) : un deck
prêté à un adversaire (P4) n'entre jamais dans ces contrôles.

Les fonctions rendent des messages ; le choix du code HTTP revient à l'appelant :
une écriture de partie qui contredit le tournoi est un 409 (l'état des données),
un `PATCH` de tournoi dont l'état fusionné se contredit un 422.
"""

from dataclasses import dataclass
from datetime import date

from sqlalchemy import and_, select
from sqlalchemy.orm import Session

from app.models import Deck, Game, Participation, Player, Tournament
from app.models.enums import DeckPolicy, EventTier, FinalDeckRule, RoundType
from app.services import vtes_rules
from app.services.vtes_rules import RoundResult


@dataclass(frozen=True)
class Round:
    """Ma participation à une partie d'un tournoi, ce que les règles regardent."""

    game_id: int | None
    round_type: RoundType
    round_number: int | None
    deck_id: int | None
    victory_points: float | None
    game_win: bool | None

    @property
    def result(self) -> RoundResult:
        return RoundResult(self.deck_id, self.victory_points, self.game_win)


@dataclass(frozen=True)
class TournamentState:
    """Les champs d'un tournoi que les contrôles lisent, copiés : un état
    fusionné se construit sans toucher à l'objet de la session."""

    start_date: date
    end_date: date | None
    deck_policy: DeckPolicy
    event_tier: EventTier
    final_deck_rule: FinalDeckRule | None
    round_count: int | None
    player_count: int | None
    my_ranking: int | None


def state_of(tournament: Tournament) -> TournamentState:
    return TournamentState(
        start_date=tournament.start_date,
        end_date=tournament.end_date,
        deck_policy=tournament.deck_policy,
        event_tier=tournament.event_tier,
        final_deck_rule=tournament.final_deck_rule,
        round_count=tournament.round_count,
        player_count=tournament.player_count,
        my_ranking=tournament.my_ranking,
    )


def rounds_by_tournament(
    db: Session, user_id: int, tournament_ids: list[int]
) -> dict[int, list[Round]]:
    """Mes parties de ces tournois, une requête, groupées par tournoi."""
    grouped: dict[int, list[Round]] = {ident: [] for ident in tournament_ids}
    if not tournament_ids:
        return grouped
    rows = db.execute(
        select(
            Game.tournament_id,
            Game.id,
            Game.round_type,
            Game.round_number,
            Participation.deck_id,
            Participation.victory_points,
            Participation.game_win,
        )
        .join(
            Participation,
            and_(
                Participation.game_id == Game.id,
                Participation.user_id == Game.user_id,
            ),
        )
        .join(
            Player,
            and_(
                Player.id == Participation.player_id,
                Player.user_id == Participation.user_id,
            ),
        )
        .where(
            Game.user_id == user_id,
            Game.tournament_id.in_(tournament_ids),
            Player.is_me.is_(True),
        )
        .order_by(Game.round_number, Game.id)
    ).all()
    for tournament_id, *fields in rows:
        grouped[tournament_id].append(Round(*fields))
    return grouped


def load_rounds(db: Session, user_id: int, tournament_id: int) -> list[Round]:
    return rounds_by_tournament(db, user_id, [tournament_id])[tournament_id]


def split(rounds: list[Round]) -> tuple[list[Round], Round | None]:
    """Préliminaires dans l'ordre des rondes, et la finale s'il y en a une."""
    preliminaries = sorted(
        (r for r in rounds if r.round_type is RoundType.PRELIMINARY),
        key=lambda r: (r.round_number or 0, r.game_id or 0),
    )
    final = next((r for r in rounds if r.round_type is RoundType.FINAL), None)
    return preliminaries, final


def deck_label(deck: Deck) -> str:
    return f"{deck.name}#{deck.discriminator}"


def deck_labels(db: Session, user_id: int, deck_ids: set[int]) -> dict[int, str]:
    """`nom#discriminant` des decks du compte, pour les messages des règles."""
    if not deck_ids:
        return {}
    decks = db.scalars(
        select(Deck).where(Deck.user_id == user_id, Deck.id.in_(deck_ids))
    )
    return {deck.id: deck_label(deck) for deck in decks}


def state_issues(state: TournamentState) -> list[str]:
    """Ce qui contredit l'état d'un tournoi en lui-même (422) : dates, niveau
    contre politique de deck (A11), règle de finale contre politique."""
    return [
        *vtes_rules.date_range_issues(state.start_date, state.end_date),
        *vtes_rules.multi_deck_tier_issues(state.deck_policy, state.event_tier),
        *vtes_rules.final_deck_rule_issues(state.deck_policy, state.final_deck_rule),
    ]


def ranking_problems(state: TournamentState, rounds: list[Round]) -> list[str]:
    """Mon classement saisi contre le nombre de joueurs et ma finale (A12)."""
    _, final = split(rounds)
    return vtes_rules.ranking_issues(
        state.my_ranking,
        state.player_count,
        final is not None,
        None if final is None else final.game_win,
    )


def deck_problems(
    db: Session, user_id: int, state: TournamentState, rounds: list[Round]
) -> list[str]:
    """Mono-deck (A7) ou deck de la finale selon la règle annoncée (A11)."""
    deck_ids = {r.deck_id for r in rounds if r.deck_id is not None}
    if len(deck_ids) < 2 and state.deck_policy is DeckPolicy.MONO:
        return []
    labels = deck_labels(db, user_id, deck_ids)
    if state.deck_policy is DeckPolicy.MONO:
        return vtes_rules.mono_deck_issues((r.deck_id for r in rounds), labels)
    preliminaries, final = split(rounds)
    if final is None:
        return []
    return vtes_rules.final_deck_issues(
        state.final_deck_rule,
        [r.result for r in preliminaries],
        final.deck_id,
        labels,
    )


def admissible_decks(state: TournamentState, rounds: list[Round]) -> list[int] | None:
    """Decks que ma finale peut jouer, triés ; `None` quand rien n'est contrôlable
    (mono-deck compris)."""
    if state.deck_policy is not DeckPolicy.MULTI:
        return None
    preliminaries, _ = split(rounds)
    admissible = vtes_rules.admissible_final_decks(
        state.final_deck_rule, [r.result for r in preliminaries]
    )
    return None if admissible is None else sorted(admissible)
