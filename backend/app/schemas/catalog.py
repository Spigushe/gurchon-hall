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
    """Une carte du catalogue avec tout ce que la recherche filtre.

    Base commune de la ligne de liste (`CardSearchItem`) et de la fiche
    (`CardRead`). Deux familles de champs :

    * les impressions (Lot 4) : ce que le client hors ligne doit connaître pour
      ranger un exemplaire sous une impression réelle sans rappeler l'API, les
      extensions où la carte a été imprimée et celle qu'il faut prendre par
      défaut quand rien ne désigne l'impression (une carte jouée en proxy,
      décision D2a) ;
    * depuis le lot Chercher (A1), ce que les filtres de l'écran Chercher
      lisent dans le miroir local : secte, titre, voie, coût, prérequis,
      disciplines, types, texte anglais, dates de légalité, et l'exigence
      envers le vampire, lue par le serveur (A3).

    Distinct de `CardSummary`, qui reste la vue courte embarquée dans le
    stock, les decks et les produits : ces champs n'y ont pas d'usage.
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
            "ne compte que si elle est la seule. Impression par défaut quand "
            "rien ne désigne laquelle jouer, une carte en proxy par exemple."
        ),
    )


    sect: SectRead | None = Field(
        default=None,
        description=(
            "Secte d'une carte de crypte, dérivée de son texte à l'import "
            "(premier mot, ou second après « Advanced » ; « Imbued » pour un "
            "imbued). Vide pour une carte de bibliothèque, et pour un vampire "
            "dont le texte ne commence pas par une secte connue."
        ),
    )
    title: str | None = Field(
        default=None,
        description=(
            "Titre d'un vampire, tel que krcg l'écrit (« Prince », « Inner "
            "Circle », « 1 Vote »…) : celui de sa face, pas d'un texte fusionné."
        ),
    )
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
    clan_requirement: str | None = Field(
        default=None,
        description=(
            "Clan(s) exigé(s) par la carte, joints par « , » (virgule et "
            "espace) ; aucun nom de clan ne contient de virgule."
        ),
    )
    path_requirement: str | None = None
    discipline_requirement: DisciplineRequirement | None = Field(
        default=None,
        description=(
            "Manière de combiner les disciplines listées : une seule, au choix, "
            "ou toutes ensemble."
        ),
    )
    library_requirement: str | None = Field(
        default=None,
        description=(
            "Exigence envers le vampire qui joue la carte, brute, telle que "
            "`vteslibmeta.csv` (vtescsv) l'écrit : valeurs séparées par une "
            "virgule (« prince,justicar », « sabbat,titled »). Vide quand le "
            "fichier n'a pas de ligne pour la carte. Les quatre champs "
            "`required_*` et `other_requirements` en sont la lecture."
        ),
    )
    required_sects: list[str] = Field(
        default=[],
        description=(
            "Sectes exigées, l'une ou l'autre, noms de la table des sectes "
            "(Camarilla, Sabbat, Laibon, Independent, Anarch, Imbued), celles "
            "qu'un titre exigé implique comprises (un Prince exige la "
            "Camarilla). Une exclusion se lit sur les sectes de vampire : "
            "« non-anarch » exige Camarilla, Sabbat, Laibon ou Independent, et "
            "« non-anarch,prince » la Camarilla. Vide : aucune secte exigée."
        ),
    )
    required_titles: list[str] = Field(
        default=[],
        description=(
            "Titres précis exigés, l'un ou l'autre, écrits comme le titre d'un "
            "vampire (`title`) : « Prince », « Inner Circle », « 1 Vote »…"
        ),
    )
    requires_titled: bool = Field(
        default=False,
        description="Exige un vampire titré, quel que soit son titre.",
    )
    requires_non_titled: bool = Field(
        default=False,
        description="Exige un vampire sans titre.",
    )
    other_requirements: list[str] = Field(
        default=[],
        description=(
            "Le reste de l'exigence, tel qu'écrit dans le fichier : capacité "
            "(« capacity 5 or more »), Gehenna, Black Hand, Seraph, "
            "« non-sterile », « non-red list »… Non filtrable au lot Chercher."
        ),
    )
    card_text: str | None = Field(
        default=None,
        description="Texte anglais de la carte (icônes de discipline « [pot] »).",
    )
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


class CardTranslatedName(ReadModel):
    """Nom d'une carte dans une langue de traduction (lot Chercher, A7)."""

    language_code: str = Field(description="Code de langue, en majuscules.")
    name: str


class CardSearchItem(CardListItem):
    """Une carte dans les résultats de `GET /cartes` (lot Chercher, A7).

    Ajoute les noms traduits, que la recherche locale compare au texte saisi.
    Propre à la liste : la fiche (`CardRead`) porte déjà les traductions
    entières et n'en hérite pas.
    """

    translated_names: list[CardTranslatedName] = Field(
        default=[],
        description=(
            "Noms traduits connus (FR et ES aujourd'hui), triés par code de "
            "langue. Sans le texte ni l'image, qui restent à la fiche."
        ),
    )


class CardRead(CardListItem):
    """Fiche complète d'une carte du catalogue."""

    burn_option: bool = False
    trifle: bool = False
    flavor_text: str | None = None
    artist: str | None = None
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
