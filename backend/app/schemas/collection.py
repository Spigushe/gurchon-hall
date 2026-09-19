"""Schémas de la collection et des decks.

Le vocabulaire du contrat suit celui du modèle : une *copie* (`CardCopy`) est
l'ensemble des exemplaires d'une carte dans une langue — c'est ce que la
ressource `/stock` du §7 manipule. Une ligne de deck (`DeckCard`) est une
*allocation* prise sur ces exemplaires.
"""

from datetime import date, datetime

from pydantic import Field, model_validator

from app.models.enums import DeckStatus
from app.schemas.base import UNSET, ReadModel, WriteModel
from app.schemas.catalog import CardSummary


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

    card_id: int
    language_code: str = Field(min_length=1, max_length=8)
    quantity_owned: int = Field(default=0, ge=0)
    proxy_allowed: bool = False
    notes: str | None = None


class CardCopyUpdate(WriteModel):
    """Modification d'une entrée de collection.

    La carte et la langue forment la clé : elles ne se modifient pas, on crée
    une autre entrée. `quantity_owned` et `proxy_allowed` sont facultatifs mais
    non nullables (colonnes NOT NULL) ; `notes`, lui, accepte `null` pour
    effacer la note.
    """

    quantity_owned: int = Field(default=UNSET, ge=0)
    proxy_allowed: bool = UNSET
    notes: str | None = None


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

    quantity: int = Field(ge=1)
    proxy_quantity: int = Field(default=0, ge=0)

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

    card_id: int
    language_code: str = Field(min_length=1, max_length=8)


class DeckCardUpdate(WriteModel):
    """Modification d'une ligne de decklist.

    Le contrôle `proxy_quantity <= quantity` n'est complet que si les deux
    valeurs sont fournies. Sinon la comparaison porterait sur une valeur que
    seule la base connaît : **le service du Lot 2 doit refaire la vérification**
    après fusion avec la ligne existante (la contrainte `CHECK` de `deck_card`
    reste le dernier filet, mais elle produirait un 500 plutôt qu'un 422).
    """

    quantity: int = Field(default=UNSET, ge=1)
    proxy_quantity: int = Field(default=UNSET, ge=0)

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
    created_on: date | None = None
    status: DeckStatus
    archetype: str | None = None
    notes: str | None = None
    created_at: datetime
    updated_at: datetime


class DeckDetailRead(DeckRead):
    """Un deck avec sa composition."""

    cards: list[DeckCardRead] = []


class DeckCreate(WriteModel):
    """Création d'un deck."""

    name: str = Field(min_length=1, max_length=120)
    created_on: date | None = None
    status: DeckStatus = DeckStatus.DRAFT
    archetype: str | None = Field(default=None, max_length=120)
    notes: str | None = None


class DeckUpdate(WriteModel):
    """Modification partielle d'un deck.

    `name` et `status` sont facultatifs mais non nullables ; `created_on`,
    `archetype` et `notes` acceptent `null` pour effacer la valeur.
    """

    name: str = Field(default=UNSET, min_length=1, max_length=120)
    created_on: date | None = None
    status: DeckStatus = UNSET
    archetype: str | None = Field(default=None, max_length=120)
    notes: str | None = None


class DeckLegality(ReadModel):
    """Verdict de légalité d'un deck (CLAUDE.md §5 : crypt ≥ 12, library 60–90).

    Schéma de sortie seulement : le calcul est une règle de service, écrite au
    Lot 2 avec la skill `regles-vtes`. Les seuils voyagent dans la réponse pour
    que le front affiche « 58 / 60 » sans les redéfinir de son côté.
    """

    deck_id: int
    crypt_count: int
    library_count: int
    crypt_minimum: int
    library_minimum: int
    library_maximum: int
    is_legal: bool
    issues: list[str] = []
