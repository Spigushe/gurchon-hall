"""Tables de référence (listes fermées ou semi-fermées) — CLAUDE.md §6.

`Language` mérite une note : l'énumération des langues n'est **pas** figée
(CLAUDE.md §11, point 2 : « FR, ES, EN, ou autre — énumération exacte à
confirmer »). Elle est donc portée par une table de référence alimentée en
données de départ par la migration initiale, et non par un `Enum` Python ou une
contrainte `CHECK` : ajouter une langue reste une simple insertion de ligne.

Constat d'import (JSON krcg, cf. §11 point 1) : le catalogue est publié en
anglais, avec des traductions partielles (fr et es, 428 cartes sur 4149). La
langue n'est donc pas une propriété du catalogue mais de l'exemplaire possédé
(`CardCopy`) et, pour les libellés localisés, de `CardTranslation`.
"""

from datetime import date

from sqlalchemy import (
    CheckConstraint,
    Date,
    ForeignKey,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class Language(Base):
    """Langue d'un exemplaire de carte (EN, FR, ES, … « autre »).

    Liste ouverte : la migration initiale insère EN/FR/ES plus une entrée
    fourre-tout `XX`, et rien n'empêche d'en ajouter d'autres.
    """

    __tablename__ = "language"

    code: Mapped[str] = mapped_column(String(8), primary_key=True)
    label: Mapped[str] = mapped_column(String(50))
    sort_order: Mapped[int] = mapped_column(default=0)


class Clan(Base):
    """Clan VtES (valeur reprise telle quelle du catalogue VEKN)."""

    __tablename__ = "clan"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(60), unique=True)
    abbrev: Mapped[str | None] = mapped_column(String(10))


class Discipline(Base):
    """Discipline VtES.

    `abbrev` correspond au code trois lettres de krcg (« ani », « dom »…),
    dont la casse encode le niveau : minuscule = inférieur, majuscule =
    supérieur. Le niveau est stocké sur le lien carte↔discipline, pas ici.
    """

    __tablename__ = "discipline"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(60), unique=True)
    abbrev: Mapped[str | None] = mapped_column(String(10))


class Sect(Base):
    """Sect (Camarilla, Sabbat, Independent, Anarch, Laibon…).

    [à confirmer] Ni les CSV VEKN ni le JSON krcg n'exposent la sect : pour les
    cartes de crypt elle n'apparaît que dans le texte de carte (« Sabbat. »,
    « Independent: »…). `Card.sect_id` reste donc nullable et devra être
    dérivée ou saisie ; ne pas la traiter comme une donnée d'import fiable.
    """

    __tablename__ = "sect"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(40), unique=True)


class CardType(Base):
    """Type de carte de library (Master, Action, Combat…) ou de crypt.

    Une carte de library peut porter plusieurs types (« Action Modifier /
    Combat ») : le lien est donc un many-to-many (`card_type_link`).
    """

    __tablename__ = "card_type"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(40), unique=True)


class CardSet(Base):
    """Extension / produit dans lequel une carte a été imprimée.

    Alimentée par `expansions.json` de krcg (51 entrées, qui regroupent les
    promos sous « Promo » et « POD »). L'identifiant krcg n'y est **pas**
    unique — « Promo » et « POD » portent tous deux `id = 0` — d'où la clé
    locale `id` et l'unicité sur `abbrev`, qui est le code réellement
    référencé par les impressions.
    """

    __tablename__ = "card_set"

    id: Mapped[int] = mapped_column(primary_key=True)
    abbrev: Mapped[str] = mapped_column(String(30), unique=True)
    full_name: Mapped[str | None] = mapped_column(String(120))
    release_date: Mapped[date | None] = mapped_column(Date())
    company: Mapped[str | None] = mapped_column(String(60))

    bundles: Mapped[list[Bundle]] = relationship(
        back_populates="card_set",
        cascade="all, delete-orphan",
    )


class Bundle(Base):
    """Produit vendu à l'intérieur d'une extension : deck préconstruit, boîte…

    C'est l'unité d'achat. Deux usages la justifient : savoir quel produit
    acheter pour compléter un deck, et verser le contenu d'un produit d'un
    coup dans la collection. Ce contenu se lit sur les occurrences de type
    « precon » (`CardPrintingOccurrence`), qui donnent la carte et le nombre
    d'exemplaires.

    Clé naturelle : (extension, code). Le code **n'est pas unique** d'une
    extension à l'autre — « PV » désigne Ventrue dans trois extensions
    différentes — et il est **vide** pour les 14 extensions dont le précon
    unique n'a pas de code propre. Vide plutôt que nul : la contrainte
    d'unicité reste alors réellement appliquée par SQLite.
    """

    __tablename__ = "bundle"
    __table_args__ = (
        UniqueConstraint("card_set_id", "code"),
        CheckConstraint("size >= 1", name="size_positive"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    card_set_id: Mapped[int] = mapped_column(ForeignKey("card_set.id"))
    code: Mapped[str] = mapped_column(String(10), default="")
    name: Mapped[str | None] = mapped_column(String(60))
    # Nombre de cartes annoncé par le produit. Valeur déclarative : sur 13 des
    # 113 produits, elle ne colle pas exactement à la somme des exemplaires
    # listés. Ne pas s'en servir comme d'un total calculé.
    size: Mapped[int | None] = mapped_column()
    release_date: Mapped[date | None] = mapped_column(Date())

    card_set: Mapped[CardSet] = relationship(back_populates="bundles")
    # Le contenu du produit : une ligne par carte, avec son nombre
    # d'exemplaires (cf. `CardPrintingOccurrence`). Nom de classe en chaîne,
    # résolu par le registre SQLAlchemy : la classe vit dans `catalog`, qui
    # importe ce module — l'annoter sans guillemets créerait un cycle.
    card_occurrences: Mapped[list["CardPrintingOccurrence"]] = relationship(  # noqa: F821, UP037
        back_populates="bundle",
        passive_deletes="all",
    )


class Venue(Base):
    """Lieu de jeu (club, boutique, convention…) — le `Lieu` du §6."""

    __tablename__ = "venue"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120), unique=True)
    city: Mapped[str | None] = mapped_column(String(80))
    notes: Mapped[str | None] = mapped_column(Text())
