"""Schémas des joueurs, parties, tournois et participations.

Note sur les date-heures entrantes : `played_at` exige un instant **avec
fuseau** et le convertit en UTC. Une partie saisie hors ligne à 20h à Paris et
synchronisée le lendemain depuis un autre fuseau doit désigner le même instant
qu'au moment de la saisie ; sans fuseau, « 20:00 » est ambigu et la file de
synchronisation du Lot 3 n'a aucun moyen de trancher. Le stockage, lui, est de
l'UTC naïf (cf. `app.models.types.UtcDateTime`).
"""

from datetime import UTC, date, datetime
from typing import Annotated

from pydantic import AfterValidator, Field

from app.models.enums import DeckPolicy, RoundType, TournamentFormat
from app.schemas.base import (
    MAX_DB_INT,
    UNSET,
    ReadModel,
    RequiredText,
    WriteModel,
)


def _to_utc(value: datetime) -> datetime:
    """Refuse un instant sans fuseau, et normalise le reste en UTC."""
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError(
            "un fuseau est obligatoire (ex. 2026-02-01T20:00:00+01:00 ou "
            "2026-02-01T19:00:00Z) : sans lui, l'instant est ambigu."
        )
    return value.astimezone(UTC)


AwareDateTime = Annotated[datetime, AfterValidator(_to_utc)]
"""Date-heure d'entrée : fuseau obligatoire, normalisée en UTC."""


class PlayerRead(ReadModel):
    """Un joueur."""

    id: int
    name: str
    is_me: bool = Field(description="Vrai pour le seul joueur qui est l'utilisateur.")


class PlayerCreate(WriteModel):
    """Création d'un joueur."""

    name: RequiredText = Field(max_length=80)
    is_me: bool = False


class PlayerUpdate(WriteModel):
    """Modification d'un joueur. Aucun champ nullable : les deux colonnes sont
    NOT NULL, donc facultatif ne veut pas dire « effaçable »."""

    name: RequiredText = Field(default=UNSET, max_length=80)
    is_me: bool = UNSET


class ParticipationRead(ReadModel):
    """La place et le résultat d'un joueur sur une partie.

    Pour un adversaire, `deck_id`, `victory_points` et `game_win` restent
    normalement vides : on ne suit que ses propres résultats (CLAUDE.md §11
    point 3).
    """

    id: int
    game_id: int
    player_id: int
    deck_id: int | None = None
    seat: int | None = Field(
        default=None,
        description="Siège à la table, 1 = premier joueur.",
    )
    victory_points: float | None = Field(
        default=None,
        description=(
            "VP marqués. Demi-points possibles (0,5 par survivant en fin de partie)."
        ),
    )
    game_win: bool | None = None
    notes: str | None = None


class ParticipationCreate(WriteModel):
    """Enregistrement d'une participation."""

    player_id: int = Field(ge=1, le=MAX_DB_INT)
    deck_id: int | None = Field(default=None, ge=1, le=MAX_DB_INT)
    seat: int | None = Field(default=None, ge=1, le=MAX_DB_INT)
    victory_points: float | None = Field(default=None, ge=0)
    game_win: bool | None = None
    notes: str | None = None


class ParticipationUpdate(WriteModel):
    """Modification d'une participation."""

    deck_id: int | None = Field(default=None, ge=1, le=MAX_DB_INT)
    seat: int | None = Field(default=None, ge=1, le=MAX_DB_INT)
    victory_points: float | None = Field(default=None, ge=0)
    game_win: bool | None = None
    notes: str | None = None


class GameRead(ReadModel):
    """Une partie."""

    id: int
    played_at: datetime
    venue_id: int | None = None
    tournament_id: int | None = None
    round_number: int | None = None
    round_type: RoundType
    player_count: int
    notes: str | None = None
    created_at: datetime
    updated_at: datetime


class GameDetailRead(GameRead):
    """Une partie avec la table complète."""

    participations: list[ParticipationRead] = []


class GameCreate(WriteModel):
    """Création d'une partie.

    Les participations peuvent être fournies d'un bloc : au club, une partie se
    saisit d'une traite, souvent hors ligne, et la couche de synchronisation a
    tout intérêt à rejouer une seule opération plutôt que six.
    """

    played_at: AwareDateTime = Field(
        description="Instant de la partie, fuseau obligatoire, normalisé en UTC.",
    )
    venue_id: int | None = Field(default=None, ge=1, le=MAX_DB_INT)
    tournament_id: int | None = Field(default=None, ge=1, le=MAX_DB_INT)
    round_number: int | None = Field(default=None, ge=1, le=MAX_DB_INT)
    round_type: RoundType = RoundType.CASUAL
    player_count: int = Field(
        ge=2,
        le=MAX_DB_INT,
        description="4 à 5 joueurs en pratique ; 2 minimum accepté.",
    )
    notes: str | None = None
    participations: list[ParticipationCreate] = []


class GameUpdate(WriteModel):
    """Modification d'une partie (hors participations).

    `played_at`, `round_type` et `player_count` sont facultatifs mais non
    nullables ; le lieu, le tournoi, la ronde et les notes peuvent, eux, être
    remis à `null`.
    """

    played_at: AwareDateTime = UNSET
    venue_id: int | None = Field(default=None, ge=1, le=MAX_DB_INT)
    tournament_id: int | None = Field(default=None, ge=1, le=MAX_DB_INT)
    round_number: int | None = Field(default=None, ge=1, le=MAX_DB_INT)
    round_type: RoundType = UNSET
    player_count: int = Field(default=UNSET, ge=2, le=MAX_DB_INT)
    notes: str | None = None


class TournamentRead(ReadModel):
    """Un tournoi."""

    id: int
    name: str
    start_date: date
    end_date: date | None = None
    venue_id: int | None = None
    deck_policy: DeckPolicy = Field(
        description=(
            "Mono-deck : le même deck sur toutes les rondes. "
            "Multi : deck libre par ronde."
        )
    )
    format: TournamentFormat
    round_count: int | None = None
    my_ranking: int | None = None
    notes: str | None = None
    created_at: datetime
    updated_at: datetime


class TournamentDetailRead(TournamentRead):
    """Un tournoi et ses parties."""

    games: list[GameRead] = []


class TournamentCreate(WriteModel):
    """Création d'un tournoi."""

    name: RequiredText = Field(max_length=120)
    start_date: date
    end_date: date | None = None
    venue_id: int | None = Field(default=None, ge=1, le=MAX_DB_INT)
    deck_policy: DeckPolicy = DeckPolicy.MONO
    format: TournamentFormat = TournamentFormat.CONSTRUCTED
    round_count: int | None = Field(default=None, ge=1, le=MAX_DB_INT)
    my_ranking: int | None = Field(default=None, ge=1, le=MAX_DB_INT)
    notes: str | None = None


class TournamentUpdate(WriteModel):
    """Modification partielle d'un tournoi.

    `name`, `start_date`, `deck_policy` et `format` sont facultatifs mais non
    nullables ; la date de fin, le lieu, le nombre de rondes, le classement et
    les notes acceptent `null`.
    """

    name: RequiredText = Field(default=UNSET, max_length=120)
    start_date: date = UNSET
    end_date: date | None = None
    venue_id: int | None = Field(default=None, ge=1, le=MAX_DB_INT)
    deck_policy: DeckPolicy = UNSET
    format: TournamentFormat = UNSET
    round_count: int | None = Field(default=None, ge=1, le=MAX_DB_INT)
    my_ranking: int | None = Field(default=None, ge=1, le=MAX_DB_INT)
    notes: str | None = None
