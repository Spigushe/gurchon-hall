"""Schémas de la collection et des decks.

Le vocabulaire du contrat suit celui du modèle : une *copie* (`CardCopy`) est
l'ensemble des exemplaires d'une carte dans une langue — c'est ce que la
ressource `/stock` du §7 manipule. Une ligne de deck (`DeckCard`) est une
*allocation* prise sur ces exemplaires.
"""

from datetime import date, datetime
from enum import StrEnum

from pydantic import Field, model_validator

from app.models.enums import DeckStatus
from app.schemas.base import (
    MAX_DB_INT,
    UNSET,
    ReadModel,
    RequiredText,
    WriteModel,
)
from app.schemas.catalog import CardSummary


class DeckListState(StrEnum):
    """Quels decks une liste renvoie.

    Purement contractuel (pas de colonne en face) : l'archivage est une date,
    pas un statut. Les decks supprimés ne sont dans aucun de ces trois cas.
    """

    ACTIVE = "active"
    ARCHIVED = "archived"
    ALL = "all"


class CardCopyRead(ReadModel):
    """Exemplaires possédés d'une carte dans une langue."""

    card_id: int
    language_code: str
    quantity_owned: int = Field(description="Nombre d'exemplaires réellement possédés.")
    proxy_allowed: bool = Field(
        description=(
            "Autorise à jouer cette carte en proxy dans cette langue, sans la "
            "posséder. Une entrée avec 0 exemplaire possédé et le proxy autorisé "
            "est le cas normal d'une carte jouée en proxy."
        )
    )
    notes: str | None = None
    card: CardSummary | None = None


class CardCopyCreate(WriteModel):
    """Déclaration d'une entrée de collection."""

    card_id: int = Field(ge=1, le=MAX_DB_INT)
    # Rogné puis non vide (cf. `RequiredText`) : un exemplaire a toujours une
    # langue d'impression. Sans rognage, « " " » passait la validation puis
    # ressortait en 404 « langue inconnue », là où la saisie est simplement
    # vide — donc 422. La normalisation en majuscules reste au service.
    language_code: RequiredText = Field(max_length=8)
    quantity_owned: int = Field(default=0, ge=0, le=MAX_DB_INT)
    proxy_allowed: bool = False
    notes: str | None = None


class CardCopyUpdate(WriteModel):
    """Modification d'une entrée de collection.

    La carte et la langue forment la clé : elles ne se modifient pas, on crée
    une autre entrée. `quantity_owned` et `proxy_allowed` sont facultatifs mais
    non nullables (colonnes NOT NULL) ; `notes`, lui, accepte `null` pour
    effacer la note.
    """

    quantity_owned: int = Field(default=UNSET, ge=0, le=MAX_DB_INT)
    proxy_allowed: bool = UNSET
    notes: str | None = None


class BundleDeposit(WriteModel):
    """Versement du contenu d'un produit dans la collection.

    Le produit fixe les cartes et leurs exemplaires ; il ne manque que la
    langue de ce qui a été acheté, et le nombre de produits identiques.
    """

    language_code: RequiredText = Field(max_length=8)
    count: int = Field(
        default=1,
        ge=1,
        le=MAX_DB_INT,
        description="Nombre de produits identiques versés d'un coup.",
    )


class DeckCardRead(ReadModel):
    """Une ligne de decklist."""

    card_id: int
    language_code: str
    quantity: int
    proxy_quantity: int = Field(
        description="Part des exemplaires ci-dessus jouée en proxy."
    )
    card: CardSummary | None = None


class DeckCardWrite(WriteModel):
    """Base commune aux écritures de ligne de decklist."""

    quantity: int = Field(ge=1, le=MAX_DB_INT)
    proxy_quantity: int = Field(default=0, ge=0, le=MAX_DB_INT)

    @model_validator(mode="after")
    def _proxy_within_quantity(self) -> DeckCardWrite:
        if self.proxy_quantity > self.quantity:
            raise ValueError(
                "proxy_quantity ne peut pas dépasser quantity : on ne joue pas "
                "plus de proxies que d'exemplaires dans le deck."
            )
        return self


class DeckCardCreate(DeckCardWrite):
    """Ajout d'une carte à un deck.

    La carte doit déjà exister dans la collection pour la langue demandée
    (CLAUDE.md §11 point 2) ; la vérification de disponibilité relève du
    service, la base garantissant déjà l'existence de l'entrée de collection.
    """

    card_id: int = Field(ge=1, le=MAX_DB_INT)
    language_code: RequiredText = Field(max_length=8)


class DeckCardUpdate(WriteModel):
    """Modification d'une ligne de decklist.

    Le contrôle `proxy_quantity <= quantity` n'est complet que si les deux
    valeurs sont fournies. Sinon la comparaison porterait sur une valeur que
    seule la base connaît : **le service du Lot 2 doit refaire la vérification**
    après fusion avec la ligne existante (la contrainte `CHECK` de `deck_card`
    reste le dernier filet, mais elle produirait un 500 plutôt qu'un 422).
    """

    quantity: int = Field(default=UNSET, ge=1, le=MAX_DB_INT)
    proxy_quantity: int = Field(default=UNSET, ge=0, le=MAX_DB_INT)

    @model_validator(mode="after")
    def _proxy_within_quantity(self) -> DeckCardUpdate:
        provided = self.model_fields_set
        if {"quantity", "proxy_quantity"} <= provided and (
            self.proxy_quantity > self.quantity
        ):
            raise ValueError(
                "proxy_quantity ne peut pas dépasser quantity : on ne joue pas "
                "plus de proxies que d'exemplaires dans le deck."
            )
        return self


class DeckRead(ReadModel):
    """Un deck, sans sa composition."""

    id: int
    name: str
    discriminator: str = Field(
        description=(
            "Quatre chiffres tirés par le serveur, qui distinguent deux decks "
            "de même nom. À afficher collé au nom : « Malkavien 2022#8561 »."
        )
    )
    created_on: date | None = None
    status: DeckStatus
    archetype: str | None = None
    notes: str | None = None
    archived_at: datetime | None = Field(
        default=None,
        description=(
            "Instant d'archivage (UTC), nul si le deck n'est pas archivé. Un deck "
            "archivé sort des listes par défaut et n'est plus modifiable."
        ),
    )
    deleted_at: datetime | None = Field(
        default=None,
        description=(
            "Instant de suppression logique (UTC), nul si le deck n'est pas "
            "supprimé. Un deck supprimé n'apparaît dans aucune liste, reste "
            "lisible par identifiant et n'est plus modifiable."
        ),
    )
    created_at: datetime
    updated_at: datetime


class DeckDetailRead(DeckRead):
    """Un deck avec sa composition."""

    cards: list[DeckCardRead] = []


class DeckCreate(WriteModel):
    """Création d'un deck.

    Pas de discriminant : il est tiré par le serveur, qui garantit son unicité
    au sein du nom. Un client qui l'imposerait entrerait en course avec un
    autre, pour un gain nul.
    """

    name: RequiredText = Field(max_length=120)
    created_on: date | None = None
    status: DeckStatus = DeckStatus.DRAFT
    archetype: str | None = Field(default=None, max_length=120)
    notes: str | None = None


class DeckUpdate(WriteModel):
    """Modification partielle d'un deck.

    `name`, `status` et `archived` sont facultatifs mais non nullables ;
    `created_on`, `archetype` et `notes` acceptent `null` pour effacer la
    valeur. Le discriminant ne se modifie pas : renommer un deck ne change pas
    son identité (le serveur n'en retire un autre que si le nouveau couple est
    déjà pris).
    """

    name: RequiredText = Field(default=UNSET, max_length=120)
    created_on: date | None = None
    status: DeckStatus = UNSET
    archetype: str | None = Field(default=None, max_length=120)
    notes: str | None = None
    archived: bool = Field(
        default=UNSET,
        description=(
            "Range le deck (`true`) ou le sort de l'archive (`false`). Pose ou "
            "efface `archived_at` ; un deck archivé n'est plus modifiable."
        ),
    )


class DeckLegality(ReadModel):
    """Verdict de légalité d'un deck (CLAUDE.md §5).

    Règles vérifiées : crypt ≥ 12 ; crypt sur deux groupes adjacents au plus
    (« Any » neutre) ; library entre 60 et 90 ; aucune carte bannie ; aucune
    carte pas encore légale. Les seuils voyagent dans la réponse pour que le
    front affiche « 58 / 60 » sans les redéfinir de son côté ; `issues` dit, en
    clair, chaque règle enfreinte.

    Le verdict est daté (`evaluated_on`) : bannissements et entrées en légalité
    dépendent du jour où l'on regarde.
    """

    deck_id: int
    evaluated_on: date = Field(
        description="Date à laquelle le verdict a été rendu (bans, légalité)."
    )
    crypt_count: int
    library_count: int
    crypt_minimum: int
    library_minimum: int
    library_maximum: int
    crypt_groups: list[str] = Field(
        default=[],
        description=(
            "Groupes présents dans la crypt, au format des cartes (« G2 »), "
            "sans doublon, triés par numéro, « Any » exclu."
        ),
    )
    banned_cards: list[CardSummary] = Field(
        default=[],
        description=(
            "Cartes du deck bannies à la date d'évaluation. Des cartes entières "
            "et non des noms : « Theo Bell » ne désigne rien sans son groupe."
        ),
    )
    not_yet_legal_cards: list[CardSummary] = Field(
        default=[],
        description=(
            "Cartes dont la date d'entrée en légalité est postérieure à la date "
            "d'évaluation : imprimées, mais pas encore jouables."
        ),
    )
    is_legal: bool
    issues: list[str] = []
