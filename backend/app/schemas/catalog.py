"""Schémas du catalogue de cartes.

Le catalogue est **en lecture seule** côté API : il vient de l'import du JSON
krcg (CLAUDE.md §11 point 1). Pas de `CardCreate` ni de `CardUpdate` — si une
carte manque, c'est l'import qu'il faut rejouer, pas une saisie manuelle qui
divergerait de la source.
"""

from datetime import date

from pydantic import Field

from app.models.enums import (
    CardCategory,
    CostType,
    DisciplineRequirement,
    PrintOccurrence,
)
from app.schemas.base import ReadModel
from app.schemas.reference import (
    BundleRead,
    CardSetRead,
    CardTypeRead,
    ClanRead,
    DisciplineRead,
    SectRead,
)


class CardDisciplineRead(ReadModel):
    """Discipline requise par une carte, avec son niveau."""

    discipline: DisciplineRead
    superior: bool = Field(
        description="Niveau supérieur (code en majuscules chez krcg)."
    )


class CardPrintingOccurrenceRead(ReadModel):
    """Comment une carte apparaît dans une extension.

    Les champs renseignés dépendent du type : fréquence et multiplicateur pour
    un booster, produit et exemplaires pour un précon, date pour une promo.
    """

    occurrence_type: PrintOccurrence
    frequency: str | None = Field(
        default=None,
        description="Code de rareté en booster (C, U, R, V…).",
    )
    multiplier: float | None = Field(
        default=None,
        description="Nombre moyen d'exemplaires par booster (0,5 possible).",
    )
    copies: int | None = Field(
        default=None,
        description="Nombre d'exemplaires dans le produit, pour un précon.",
    )
    released_on: date | None = None
    bundle: BundleRead | None = None


class CardPrintingRead(ReadModel):
    """Présence d'une carte dans une extension, et par quels produits."""

    card_set: CardSetRead
    image_url: str | None = Field(
        default=None,
        description="Scan de la carte telle qu'imprimée dans cette extension.",
    )
    occurrences: list[CardPrintingOccurrenceRead] = []


class CardTranslationRead(ReadModel):
    """Libellés localisés d'une carte.

    Distinct de la collection : traduire une carte ne dit rien sur le fait de
    la posséder, et posséder un exemplaire en français ne suppose pas qu'on
    connaisse sa traduction officielle.
    """

    language_code: str
    name: str
    card_text: str | None = None
    flavor_text: str | None = None
    image_url: str | None = Field(
        default=None,
        description="Scan de la version localisée, quand il existe.",
    )


class CardSummary(ReadModel):
    """Vue courte d'une carte, pour les listes et l'autocomplétion."""

    id: int
    vekn_id: int
    name: str
    category: CardCategory
    clan: ClanRead | None = None
    capacity: int | None = None
    group_code: str | None = None
    advanced: bool = False
    image_url: str | None = Field(
        default=None,
        description="Scan de la carte (version anglaise de référence).",
    )


class CardListItem(CardSummary):
    """Une carte dans les résultats de recherche, avec ses impressions (Lot 4).

    Ce que le client hors ligne doit connaître pour ranger un exemplaire sous
    une impression réelle sans rappeler l'API : les extensions où la carte a
    été imprimée, et celle qu'il faut prendre par défaut quand la carte entre
    en collection pour être jouée en proxy (décision D2a).

    Distinct de `CardSummary`, qui reste la vue courte embarquée dans le
    stock, les decks et les produits : ces deux champs n'y ont pas d'usage.
    """

    card_set_ids: list[int] = Field(
        default=[],
        description=(
            "Extensions où la carte a été imprimée (`GET /extensions`), triées "
            "par identifiant. Jamais vide : toute carte a au moins une "
            "impression, au besoin sous l'extension tampon."
        ),
    )
    latest_card_set_id: int = Field(
        description=(
            "Extension de la dernière version de la carte, calculée par le "
            "serveur : date la plus récente parmi les occurrences de "
            "l'impression (à défaut, la date de l'extension) ; à date égale, "
            "une extension datée passe avant une extension sans date, puis la "
            "première abréviation par ordre alphabétique. L'extension tampon "
            "ne compte que si elle est la seule. Impression par défaut d'une "
            "carte ajoutée en collection pour être jouée en proxy."
        ),
    )


class CardRead(CardListItem):
    """Fiche complète d'une carte du catalogue."""

    sect: SectRead | None = None
    title: str | None = None
    path: str | None = None
    cost_type: CostType | None = Field(
        default=None,
        description="Nature du coût : une carte n'en a jamais qu'un seul.",
    )
    cost_value: str | None = Field(
        default=None,
        description=(
            "Montant du coût. Chaîne et non entier : 25 cartes coûtent « X »."
        ),
    )
    burn_option: bool = False
    trifle: bool = False
    clan_requirement: str | None = Field(
        default=None,
        description="Clan(s) exigé(s) par la carte, séparés par une virgule.",
    )
    path_requirement: str | None = None
    discipline_requirement: DisciplineRequirement | None = Field(
        default=None,
        description=(
            "Manière de combiner les disciplines listées : une seule, au choix, "
            "ou toutes ensemble."
        ),
    )
    card_text: str | None = None
    flavor_text: str | None = None
    artist: str | None = None
    banned_on: date | None = Field(
        default=None,
        description="Date de bannissement publiée par le VEKN, vide sinon.",
    )
    legal_from: date | None = Field(
        default=None,
        description=(
            "Date d'entrée en légalité en tournoi. Vide = aucune information, "
            "donc légale : la liste paraît après la sortie commerciale."
        ),
    )
    types: list[CardTypeRead] = []
    discipline_links: list[CardDisciplineRead] = []
    printings: list[CardPrintingRead] = []
    translations: list[CardTranslationRead] = []


class BundleCardRead(ReadModel):
    """Une ligne du contenu d'un produit : une carte, en n exemplaires."""

    card: CardSummary
    copies: int = Field(ge=1)


class BundleContentRead(BundleRead):
    """Contenu complet d'un produit.

    Réponse d'un futur `GET /bundles/{id}` (Lot 2). Deux usages la motivent :
    savoir quel produit acheter pour compléter un deck, et verser ce contenu
    dans la collection — `cards` a exactement la forme qu'attend une création
    d'entrées de stock (carte + quantité), à laquelle il ne manque que la
    langue de l'exemplaire acheté.

    Le service assemble ces lignes depuis les occurrences de type « precon »
    du produit ; ce n'est pas une relation ORM directe, la carte se trouvant
    un cran plus loin, derrière l'impression.
    """

    cards: list[BundleCardRead] = []
