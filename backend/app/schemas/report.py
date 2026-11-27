"""Schémas du lot Compte-rendu : comptes-rendus de tournoi
(`docs/lot-compte-rendu-plan.md`, A1, A3).

Un compte-rendu est généré dans une trame fixe à partir du tournoi (P1, P2). Ce
module décrit :

* l'**instantané** d'une version (`ReportSnapshot`) : tout ce que la trame
  affiche, figé par le serveur quand il applique « Mettre à jour le
  compte-rendu » (P5, P6). Il ne dépend plus de la base après coup ;
* la **demande** portée par `tournament.update` (`TournamentReportRequest`) :
  couper une version, régler l'inclusion des notes sur les adversaires, ou
  supprimer le compte-rendu. Elle passe par l'opération existante plutôt que
  par deux types `/sync` nouveaux, qui auraient obligé à recréer le journal
  (amendement de A1) ;
* les lectures du propriétaire, et la lecture publique par jeton (P8, P9),
  sans jamais d'adresse `?v=<n>` : une version se lit par un chemin à part.

Ce module n'importe pas `app.schemas.play`, qui l'importe à son tour.
"""

from datetime import date, datetime
from typing import Literal

from pydantic import Field, model_validator

from app.models.enums import (
    DeckArchetype,
    DeckPolicy,
    EventTier,
    FinalDeckRule,
    RoundType,
    TournamentFormat,
)
from app.schemas.base import ReadModel, WriteModel
from app.schemas.catalog import CardSearchItem

REPORT_FORMAT_VERSION = 1
"""Forme de l'instantané. Une forme nouvelle ne réécrit pas les anciennes
versions : la trame du client sait lire toutes les formes publiées (A3)."""


# --------------------------------------------------------------------------
# Instantané d'une version
# --------------------------------------------------------------------------


class ReportVenue(ReadModel):
    """Le lieu du tournoi : nom et ville, jamais ses notes (P4)."""

    name: str
    city: str | None = None


class ReportTournament(ReadModel):
    """Le tournoi, tel que la trame l'affiche en tête (P3)."""

    name: str
    start_date: date
    end_date: date | None = None
    venue: ReportVenue | None = None
    deck_policy: DeckPolicy
    format: TournamentFormat
    event_tier: EventTier
    final_deck_rule: FinalDeckRule | None = None
    round_count: int | None = None
    player_count: int | None = None
    my_ranking: int | None = None
    notes: str | None = None


class ReportSummary(ReadModel):
    """Mon bilan, celui de `TournamentRead.my_summary` au moment de la version."""

    preliminary_game_wins: int
    preliminary_victory_points: float
    rounds_played: int
    final_victory_points: float | None = None
    final_game_win: bool | None = None


class ReportDeckCard(ReadModel):
    """Une carte d'une liste jouée, avec sa quantité totale."""

    card_id: int
    quantity: int


class ReportDeck(ReadModel):
    """Un de mes decks joué dans le tournoi, avec la liste que la version montre
    (la version du Lot 8 qu'il a dans ce tournoi), copiée. Nom sans
    discriminant, comme sur une page publique du Lot 13."""

    deck_id: int
    name: str
    archetype: DeckArchetype | None = None
    version_number: int | None = Field(
        default=None,
        description="Numéro de la version jouée (Lot 8) ; nul si aucune n'est figée.",
    )
    cards: list[ReportDeckCard] = []


class ReportSeat(ReadModel):
    """Une ligne de la table d'une ronde, dans l'ordre des sièges.

    Ma ligne porte `is_me`, le deck que j'y joue (`deck_id`, qui renvoie à
    `ReportSnapshot.decks`), mes VP et mon GW. Une ligne d'adversaire porte son
    nom (nul pour un joueur non nommé) et son deck : un de mes decks prêté
    (`deck_name`, `deck_archetype`) ou un deck adverse (`clan_name`,
    `deck_archetype`, `deck_name`). Ses notes n'y sont que si le compte-rendu
    les inclut (P4) ; les miennes, que s'il inclut mes notes de table (A8 de
    la v1.2.2, case cochée par défaut).
    """

    seat: int | None = None
    is_me: bool
    player_name: str | None = None
    deck_id: int | None = None
    deck_name: str | None = None
    deck_archetype: DeckArchetype | None = None
    clan_name: str | None = None
    victory_points: float | None = None
    game_win: bool | None = None
    notes: str | None = None


class ReportRound(ReadModel):
    """Une ronde préliminaire ou la finale : sa table et ses notes."""

    round_type: RoundType
    round_number: int | None = None
    played_at: datetime
    player_count: int
    notes: str | None = None
    seats: list[ReportSeat] = []


class ReportSnapshot(ReadModel):
    """Tout ce que montre une version du compte-rendu (P3, P6, A3)."""

    format_version: int = Field(description="Forme de l'instantané (1).")
    tournament: ReportTournament
    summary: ReportSummary
    decks: list[ReportDeck] = Field(
        default=[],
        description="Mes decks joués, dans l'ordre de leur première ronde.",
    )
    rounds: list[ReportRound] = Field(
        default=[],
        description="Les rondes dans l'ordre, la finale en dernier.",
    )
    my_display_name: str | None = Field(
        default=None,
        description=(
            "Nom à afficher de l'auteur au moment de la version (v1.2.2, A11), "
            "nul s'il n'en avait pas : ma ligne le porte, à défaut `@pseudo`. "
            "Absent d'une version figée avant la v1.2.2, qui se lit avec nul ; "
            "omis du texte canonique quand il est nul, pour qu'un compte sans "
            "nom ne fasse couper aucune version."
        ),
    )


# --------------------------------------------------------------------------
# Demande portée par `tournament.update`
# --------------------------------------------------------------------------


class TournamentReportRequest(WriteModel):
    """Champ `report` de `TournamentUpdate` : ce que le compte-rendu doit faire.

    `update` (« Mettre à jour le compte-rendu ») crée le compte-rendu s'il
    n'existe pas, applique `include_opponent_notes` et `include_my_notes`
    s'ils sont fournis, puis coupe une version si l'instantané diffère de la
    dernière (P5). `delete` supprime le compte-rendu, ses versions et son lien
    (P10). Les deux s'appliquent après les autres champs de la même écriture.
    """

    action: Literal["update", "delete"]
    include_opponent_notes: bool | None = Field(
        default=None,
        description=(
            "Inclure les notes sur les adversaires (P4), avec `update` seulement ; "
            "omis, le réglage ne change pas (faux à la création)."
        ),
    )
    include_my_notes: bool | None = Field(
        default=None,
        description=(
            "Inclure mes notes de table, celles de ma ligne (v1.2.2, A8), avec "
            "`update` seulement ; omis, le réglage ne change pas (vrai à la "
            "création)."
        ),
    )

    @model_validator(mode="after")
    def _notes_only_with_update(self) -> TournamentReportRequest:
        if self.action == "delete":
            for name in ("include_opponent_notes", "include_my_notes"):
                if getattr(self, name) is not None:
                    raise ValueError(f"{name} ne vaut qu'avec action=update.")
        return self


# --------------------------------------------------------------------------
# Lectures du propriétaire
# --------------------------------------------------------------------------


class TournamentReportVersionSummary(ReadModel):
    """Une version, sans son instantané : numéro et date."""

    number: int
    created_at: datetime


class TournamentReportRead(ReadModel):
    """Le compte-rendu d'un tournoi : réglages, lien et versions."""

    tournament_id: int
    include_opponent_notes: bool
    include_my_notes: bool = Field(
        description="Mes notes de table entrent au compte-rendu (v1.2.2, A8)."
    )
    show_previous_versions: bool = Field(
        description="Les versions antérieures se lisent par le lien public (P9)."
    )
    token: str | None = Field(
        default=None,
        description=(
            "Jeton du lien public (`#/compte-rendu/<jeton>`), nul tant que le "
            "compte-rendu n'est pas partagé ou après une purge."
        ),
    )
    created_at: datetime
    versions: list[TournamentReportVersionSummary] = Field(
        default=[], description="Les versions, par numéro croissant."
    )


class TournamentReportVersionRead(ReadModel):
    """Une version et son instantané."""

    number: int
    created_at: datetime
    snapshot: ReportSnapshot


class TournamentReportSettings(WriteModel):
    """Corps de `PATCH /tournois/{id}/compte-rendu` : réglages en ligne (P7)."""

    show_previous_versions: bool


class MyTournamentReportRead(ReadModel):
    """Un compte-rendu du compte, pour l'écran Compte (« Partages »)."""

    tournament_id: int
    tournament_name: str
    start_date: date
    token: str | None = None
    latest_number: int | None = None


# --------------------------------------------------------------------------
# Lecture publique
# --------------------------------------------------------------------------


class PublicTournamentReportRead(ReadModel):
    """Une version d'un compte-rendu lue par son lien, sans session (P8, P9).

    `versions` liste les versions lisibles par le lien : toutes si le
    propriétaire l'autorise, sinon la dernière seule. `cards` porte les faits
    des cartes des listes jouées, sous la forme de `GET /cartes`."""

    author: str
    number: int
    created_at: datetime
    latest_number: int
    versions: list[TournamentReportVersionSummary] = []
    snapshot: ReportSnapshot
    cards: list[CardSearchItem] = []
