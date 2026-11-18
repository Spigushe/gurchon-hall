"""Export complet d'un compte : `GET /moi/export` (Lot 12, P3, A4).

Le fichier sert de **sauvegarde lisible**, pas de format d'échange : rien ne
le réimporte. Il se lit sans la base, d'où trois choix :

* une carte est désignée par son identifiant VEKN et son nom anglais
  (`vekn_id`, `card_name`), une extension par son abréviation
  (`card_set_abbrev`), un clan par son nom ; jamais par un identifiant interne
  du catalogue, qui ne veut rien dire hors de la base ;
* les ressources privées gardent leur identifiant (`id`), parce que le
  fichier s'y réfère d'une section à l'autre : une partie nomme son tournoi
  et son lieu, une ligne de table son joueur et son deck. Ces identifiants ne
  valent que dans le fichier ;
* les versions jouées sont rangées sous leur deck, et la version d'une ligne
  de table se donne par son numéro (`deck_version_number`), celui que l'écran
  affiche (« v2 »).

Contenu (P3) : le compte sans hachage ni session, la collection, les decks
(archivés et supprimés compris, un deck supprimé avec sa liste figée), leurs
versions, les joueurs, les lieux, les tournois (avec la version de chaque deck
joué) et les parties avec leurs tables. Le journal `sync_operation` et les
sessions n'y entrent pas.

`format_version` change si la forme du fichier change d'une façon qu'un
lecteur doit connaître (champ retiré ou renommé) ; un champ ajouté ne la
change pas. `schema_revision` dit à quelle révision Alembic était la base.
"""

from datetime import date, datetime
from typing import Literal

from pydantic import Field

from app.models.enums import (
    DeckArchetype,
    DeckPolicy,
    DeckStatus,
    EventTier,
    FinalDeckRule,
    RoundType,
    TournamentFormat,
    UserRole,
)
from app.schemas.base import ReadModel

ACCOUNT_EXPORT_FORMAT_VERSION = 1

_VEKN_ID = "Identifiant VEKN de la carte, stable d'une base à l'autre."
_CARD_NAME = "Nom anglais de la carte, tel que le catalogue le porte."
_CARD_SET_ABBREV = "Abréviation de l'extension de l'impression (« KoT »)."


class ExportedAccount(ReadModel):
    """Le compte, sans identifiant, hachage ni session."""

    email: str
    username: str
    role: UserRole
    created_at: datetime


class ExportedCollectionEntry(ReadModel):
    """Une entrée de collection : carte × langue × extension."""

    vekn_id: int = Field(description=_VEKN_ID)
    card_name: str = Field(description=_CARD_NAME)
    language_code: str
    card_set_abbrev: str = Field(description=_CARD_SET_ABBREV)
    quantity_owned: int
    notes: str | None = None


class ExportedDeckLine(ReadModel):
    """Une ligne de deck. Pour un deck supprimé, une ligne de sa liste figée."""

    vekn_id: int = Field(description=_VEKN_ID)
    card_name: str = Field(description=_CARD_NAME)
    language_code: str
    card_set_abbrev: str = Field(description=_CARD_SET_ABBREV)
    quantity: int
    proxy_quantity: int


class ExportedDeckVersionCard(ReadModel):
    """Une carte d'une version jouée : carte × quantité, sans langue ni
    extension (Lot 8, P1)."""

    vekn_id: int = Field(description=_VEKN_ID)
    card_name: str = Field(description=_CARD_NAME)
    quantity: int


class ExportedDeckVersion(ReadModel):
    """Une version jouée d'un deck, figée au jeu."""

    number: int
    created_at: datetime
    cards: list[ExportedDeckVersionCard] = []


class ExportedDeck(ReadModel):
    """Un deck, archivé et supprimé compris, avec ses lignes et ses versions."""

    id: int = Field(description="Identifiant du deck, valable dans ce fichier.")
    name: str
    discriminator: str
    status: DeckStatus
    archetype: DeckArchetype | None = None
    notes: str | None = None
    proxy_allowed: bool
    created_on: date | None = None
    vdb_deck_id: str | None = None
    archived_at: datetime | None = None
    deleted_at: datetime | None = None
    created_at: datetime
    updated_at: datetime
    cards: list[ExportedDeckLine] = Field(
        default=[],
        description=(
            "Composition du deck ; pour un deck supprimé, sa liste figée à la "
            "suppression."
        ),
    )
    versions: list[ExportedDeckVersion] = Field(
        default=[], description="Versions jouées, par numéro croissant."
    )


class ExportedPlayer(ReadModel):
    """Un joueur du carnet, « Moi » compris."""

    id: int = Field(description="Identifiant du joueur, valable dans ce fichier.")
    name: str
    is_me: bool


class ExportedVenue(ReadModel):
    """Un lieu."""

    id: int = Field(description="Identifiant du lieu, valable dans ce fichier.")
    name: str
    city: str | None = None
    notes: str | None = None


class ExportedTournamentDeckVersion(ReadModel):
    """La version d'un deck dans un tournoi (Lot 8, A9)."""

    deck_id: int
    deck_version_number: int
    frozen_by_game_id: int


class ExportedTournament(ReadModel):
    """Un tournoi, sans bilan : le bilan se recalcule depuis les parties."""

    id: int = Field(description="Identifiant du tournoi, valable dans ce fichier.")
    name: str
    start_date: date
    end_date: date | None = None
    venue_id: int | None = None
    deck_policy: DeckPolicy
    format: TournamentFormat
    event_tier: EventTier
    final_deck_rule: FinalDeckRule | None = None
    round_count: int | None = None
    player_count: int | None = None
    my_ranking: int | None = None
    notes: str | None = None
    created_at: datetime
    updated_at: datetime
    deck_versions: list[ExportedTournamentDeckVersion] = []


class ExportedParticipation(ReadModel):
    """Une ligne de la table d'une partie."""

    player_id: int | None = Field(
        default=None,
        description="Joueur de la ligne ; nul pour un adversaire non nommé.",
    )
    is_me: bool
    seat: int | None = None
    deck_id: int | None = None
    deck_version_number: int | None = None
    victory_points: float | None = None
    game_win: bool | None = None
    opponent_deck_name: str | None = None
    opponent_deck_archetype: DeckArchetype | None = None
    opponent_clan: str | None = Field(
        default=None, description="Nom du clan principal du deck adverse."
    )
    notes: str | None = None


class ExportedGame(ReadModel):
    """Une partie et sa table."""

    id: int = Field(description="Identifiant de la partie, valable dans ce fichier.")
    played_at: datetime
    venue_id: int | None = None
    tournament_id: int | None = None
    round_type: RoundType
    round_number: int | None = None
    player_count: int
    notes: str | None = None
    created_at: datetime
    updated_at: datetime
    participations: list[ExportedParticipation] = []


class AccountExport(ReadModel):
    """Toutes les données d'un compte, lisibles sans la base (P3, A4)."""

    format_version: Literal[1] = Field(
        description=(
            "Version de la forme du fichier ; change si un champ est retiré ou "
            "renommé, pas quand un champ s'ajoute."
        )
    )
    exported_at: datetime = Field(description="Instant de l'export, en UTC.")
    schema_revision: str = Field(
        description="Révision Alembic de la base au moment de l'export."
    )
    account: ExportedAccount
    collection: list[ExportedCollectionEntry] = []
    decks: list[ExportedDeck] = []
    players: list[ExportedPlayer] = []
    venues: list[ExportedVenue] = []
    tournaments: list[ExportedTournament] = []
    games: list[ExportedGame] = []
