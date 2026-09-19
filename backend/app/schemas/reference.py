"""Schémas des tables de référence."""

from datetime import date

from pydantic import Field

from app.schemas.base import UNSET, ReadModel, WriteModel


class LanguageRead(ReadModel):
    """Une langue d'exemplaire.

    Liste ouverte servie par l'API plutôt que codée en dur dans le front : le
    jeu exact des langues reste à confirmer (CLAUDE.md §11 point 2), et une
    langue ajoutée en base doit apparaître dans l'UI sans redéploiement.
    """

    code: str = Field(description="Code court de la langue (EN, FR, ES, XX…).")
    label: str = Field(description="Libellé affichable.")
    sort_order: int = Field(description="Ordre d'affichage dans les sélecteurs.")


class LanguageCreate(WriteModel):
    """Ajout d'une langue."""

    code: str = Field(min_length=1, max_length=8)
    label: str = Field(min_length=1, max_length=50)
    sort_order: int = 0


class ClanRead(ReadModel):
    """Clan."""

    id: int
    name: str
    abbrev: str | None = None


class DisciplineRead(ReadModel):
    """Discipline."""

    id: int
    name: str
    abbrev: str | None = None


class SectRead(ReadModel):
    """Sect."""

    id: int
    name: str


class CardTypeRead(ReadModel):
    """Type de carte."""

    id: int
    name: str


class CardSetRead(ReadModel):
    """Extension."""

    id: int
    abbrev: str
    full_name: str | None = None
    release_date: date | None = None
    company: str | None = None


class BundleRead(ReadModel):
    """Produit vendu dans une extension (deck préconstruit, boîte…).

    L'unité d'achat : ce qu'on vise pour compléter un deck, et ce qu'on verse
    dans la collection d'un seul geste. `code` peut être vide — 14 extensions
    n'ont qu'un précon, sans code propre.
    """

    id: int
    card_set_id: int
    code: str
    name: str | None = None
    size: int | None = Field(
        default=None,
        description=(
            "Nombre de cartes annoncé par le produit. Déclaratif : ne colle pas "
            "toujours exactement au contenu listé."
        ),
    )
    release_date: date | None = None


class VenueRead(ReadModel):
    """Lieu de jeu."""

    id: int
    name: str
    city: str | None = None
    notes: str | None = None


class VenueCreate(WriteModel):
    """Création d'un lieu."""

    name: str = Field(min_length=1, max_length=120)
    city: str | None = Field(default=None, max_length=80)
    notes: str | None = None


class VenueUpdate(WriteModel):
    """Modification partielle d'un lieu.

    `name` est facultatif mais non nullable : la colonne est NOT NULL, donc
    `{"name": null}` est refusé à l'entrée plutôt qu'au niveau de la base.
    """

    name: str = Field(default=UNSET, min_length=1, max_length=120)
    city: str | None = Field(default=None, max_length=80)
    notes: str | None = None
