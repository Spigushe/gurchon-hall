"""Catalogue de cartes — l'identité, indépendante de la langue.

Niveau 1 du modèle (cf. rapport de Lot 1) :

* `Card` est **une carte logique** telle que publiée par le VEKN : un nom, un
  type, un clan, un texte de règles. Importée du JSON krcg
  (`static.krcg.org/data/v5/vtes.json`, licence MIT), jamais saisie à la main.
  Elle ne porte pas de langue : c'est l'« identité de carte indépendante de la
  langue » du §6.
* `CardTranslation` porte les libellés localisés (le `nom_fr` du §6), nourris
  par le champ `i18n` de krcg — aujourd'hui **fr et es sur 428 cartes**
  seulement, celles des sets imprimés dans ces langues. L'absence de ligne
  vaut « pas de traduction connue » et l'affichage retombe sur le nom anglais.
* La possession, elle, se joue un cran plus bas, dans `app.models.collection`
  (`CardCopy`), qui porte la langue des exemplaires (CLAUDE.md §11 point 4).

Clé naturelle : `vekn_id` (le champ `id` de krcg, identique à l'identifiant
VEKN). Le nom ne suffit pas — plusieurs cartes le partagent (vampires de
groupes différents, versions *advanced*, homonymes crypt/library).
"""

from datetime import date

from sqlalchemy import (
    CheckConstraint,
    Date,
    Float,
    ForeignKey,
    Index,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base
from app.models.enums import (
    CardCategory,
    CostType,
    DisciplineRequirement,
    PrintOccurrence,
    enum_column,
)
from app.models.reference import (
    Bundle,
    CardSet,
    CardType,
    Clan,
    Discipline,
    Language,
    Sect,
)


class Card(Base):
    """Une carte du catalogue VEKN, hors dimension langue."""

    __tablename__ = "card"
    __table_args__ = (
        Index("ix_card_name", "name"),
        # Un vampire ne se désigne pas par son seul nom : « Theo Bell » existe
        # en G2, en G2 *advanced* et en G6. Le triplet est unique sur les 1785
        # cartes de crypt du catalogue krcg, mais l'index reste **non unique** :
        # un doublon apparu chez krcg doit faire un import bancal, pas un import
        # en échec.
        Index("ix_card_name_group_code_advanced", "name", "group_code", "advanced"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    vekn_id: Mapped[int] = mapped_column(unique=True)
    name: Mapped[str] = mapped_column(String(80))
    category: Mapped[CardCategory] = mapped_column(
        enum_column(CardCategory, "card_category")
    )

    clan_id: Mapped[int | None] = mapped_column(ForeignKey("clan.id"))
    sect_id: Mapped[int | None] = mapped_column(ForeignKey("sect.id"))

    # Crypt.
    capacity: Mapped[int | None] = mapped_column()
    group_code: Mapped[str | None] = mapped_column(String(8))
    advanced: Mapped[bool] = mapped_column(default=False)
    title: Mapped[str | None] = mapped_column(String(30))

    # Library. Une carte n'a qu'un seul coût, d'un seul type. La valeur reste
    # textuelle : 25 cartes coûtent « X », qu'une colonne entière perdrait.
    cost_type: Mapped[CostType | None] = mapped_column(
        enum_column(CostType, "cost_type")
    )
    cost_value: Mapped[str | None] = mapped_column(String(4))
    burn_option: Mapped[bool] = mapped_column(default=False)
    trifle: Mapped[bool] = mapped_column(default=False)
    # Prérequis de clan et de voie, sous forme textuelle : krcg les donne comme
    # listes de noms (au plus deux clans, une voie). Les normaliser coûterait
    # une table de liaison dont rien, dans le suivi de pratique, n'a besoin
    # aujourd'hui.
    clan_requirement: Mapped[str | None] = mapped_column(String(120))
    path_requirement: Mapped[str | None] = mapped_column(String(60))
    # Manière de combiner les disciplines listées dans `discipline_links`
    # (mono / au choix / toutes). Nul pour une carte de crypt ou une carte
    # sans prérequis de discipline.
    discipline_requirement: Mapped[DisciplineRequirement | None] = mapped_column(
        enum_column(DisciplineRequirement, "discipline_requirement")
    )

    # Commun.
    path: Mapped[str | None] = mapped_column(String(60))
    card_text: Mapped[str | None] = mapped_column(Text())
    flavor_text: Mapped[str | None] = mapped_column(Text())
    artist: Mapped[str | None] = mapped_column(String(120))
    banned_on: Mapped[date | None] = mapped_column(Date())
    # Date d'entrée en légalité (champ `legal` de krcg) : avant elle, la carte
    # est imprimée mais pas encore jouable en tournoi. Nulle = aucune
    # information, donc légale. La liste krcg paraissant après la sortie
    # commerciale, une carte toute neuve peut rester nulle un temps.
    legal_from: Mapped[date | None] = mapped_column(Date())
    # Scan de la carte chez krcg : la seule illustration disponible pour les
    # vues collection et deck, et rien d'autre ne permet de la reconstruire.
    image_url: Mapped[str | None] = mapped_column(String(200))

    clan: Mapped[Clan | None] = relationship()
    sect: Mapped[Sect | None] = relationship()
    type_links: Mapped[list[CardTypeLink]] = relationship(
        back_populates="card",
        cascade="all, delete-orphan",
    )
    discipline_links: Mapped[list[CardDisciplineLink]] = relationship(
        back_populates="card",
        cascade="all, delete-orphan",
    )
    printings: Mapped[list[CardPrinting]] = relationship(
        back_populates="card",
        cascade="all, delete-orphan",
    )
    translations: Mapped[list[CardTranslation]] = relationship(
        back_populates="card",
        cascade="all, delete-orphan",
    )
    types: Mapped[list[CardType]] = relationship(
        secondary="card_type_link",
        viewonly=True,
    )
    disciplines: Mapped[list[Discipline]] = relationship(
        secondary="card_discipline_link",
        viewonly=True,
    )


class CardTypeLink(Base):
    """Lien carte ↔ type. Many-to-many : une carte de library peut cumuler
    plusieurs types (« Action Modifier / Combat »)."""

    __tablename__ = "card_type_link"

    card_id: Mapped[int] = mapped_column(
        ForeignKey("card.id", ondelete="CASCADE"),
        primary_key=True,
    )
    card_type_id: Mapped[int] = mapped_column(
        ForeignKey("card_type.id"),
        primary_key=True,
    )

    card: Mapped[Card] = relationship(back_populates="type_links")
    card_type: Mapped[CardType] = relationship()


class CardDisciplineLink(Base):
    """Lien carte ↔ discipline, avec le niveau requis.

    `superior` traduit la casse des codes krcg : « DOM » (supérieur) contre
    « dom » (inférieur). La distinction n'existe que sur les cartes de crypt ;
    les prérequis de library sont toujours en minuscules, donc `superior`
    y vaut faux, et c'est `Card.discipline_requirement` qui dit comment les
    combiner.
    """

    __tablename__ = "card_discipline_link"

    card_id: Mapped[int] = mapped_column(
        ForeignKey("card.id", ondelete="CASCADE"),
        primary_key=True,
    )
    discipline_id: Mapped[int] = mapped_column(
        ForeignKey("discipline.id"),
        primary_key=True,
    )
    superior: Mapped[bool] = mapped_column(default=False)

    card: Mapped[Card] = relationship(back_populates="discipline_links")
    discipline: Mapped[Discipline] = relationship()


class CardPrinting(Base):
    """Présence d'une carte dans une extension.

    Une ligne par couple carte × extension — le catalogue krcg n'en contient
    jamais deux pour le même couple, d'où une unicité qui ne laisse passer
    aucun doublon (l'ancienne clé incluait la rareté, nullable, que SQLite
    considère toujours distincte d'elle-même).

    Le *comment* de cette présence vit dans `occurrences` : une carte peut être
    à la fois « rare en booster » et « en deux exemplaires dans tel précon » de
    la même extension. La collection, elle, ne descend pas à ce niveau : on
    compte les exemplaires par langue, pas par édition.
    """

    __tablename__ = "card_printing"
    __table_args__ = (UniqueConstraint("card_id", "card_set_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    card_id: Mapped[int] = mapped_column(ForeignKey("card.id", ondelete="CASCADE"))
    card_set_id: Mapped[int] = mapped_column(ForeignKey("card_set.id"))
    # Scan de la carte telle qu'imprimée dans cette extension : l'illustration
    # et la mise en page changent d'une édition à l'autre.
    image_url: Mapped[str | None] = mapped_column(String(200))

    card: Mapped[Card] = relationship(back_populates="printings")
    card_set: Mapped[CardSet] = relationship()
    occurrences: Mapped[list[CardPrintingOccurrence]] = relationship(
        back_populates="printing",
        cascade="all, delete-orphan",
    )


class CardPrintingOccurrence(Base):
    """Comment une carte apparaît dans une extension : booster, précon, promo.

    Les colonnes sont mutuellement exclusives selon `occurrence_type`, comme
    dans la source :

    * `rarity` — `frequency` (C, U, R, V…) et `multiplier` (nombre moyen
      d'exemplaires par booster, parfois 0,5) ;
    * `precon` — `bundle` et `copies`, c'est-à-dire **le contenu d'un
      produit** : la liste des lignes d'un bundle donne carte × exemplaires,
      prête à alimenter la collection ;
    * `single` — `released_on`, pour les promos et l'impression à la demande.

    Aucune contrainte d'unicité : la clé naturelle
    (impression, type, produit, fréquence, date) comporte des colonnes
    nullables, que SQLite tient pour toujours distinctes — la contrainte
    serait décorative. Le catalogue n'a de toute façon aucun doublon, et
    l'import réécrit les occurrences d'une impression en bloc.
    """

    __tablename__ = "card_printing_occurrence"
    __table_args__ = (
        CheckConstraint("copies >= 1", name="copies_positive"),
        CheckConstraint("multiplier > 0", name="multiplier_positive"),
        Index("ix_card_printing_occurrence_bundle_id", "bundle_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    card_printing_id: Mapped[int] = mapped_column(
        ForeignKey("card_printing.id", ondelete="CASCADE"),
        index=True,
    )
    occurrence_type: Mapped[PrintOccurrence] = mapped_column(
        enum_column(PrintOccurrence, "print_occurrence")
    )
    # Booster : code de rareté tel que publié. Texte et non énumération, la
    # convention ayant changé au fil de trente ans de produits.
    frequency: Mapped[str | None] = mapped_column(String(4))
    multiplier: Mapped[float | None] = mapped_column(Float())
    bundle_id: Mapped[int | None] = mapped_column(ForeignKey("bundle.id"))
    copies: Mapped[int | None] = mapped_column()
    released_on: Mapped[date | None] = mapped_column(Date())

    printing: Mapped[CardPrinting] = relationship(back_populates="occurrences")
    bundle: Mapped[Bundle | None] = relationship(back_populates="card_occurrences")


class CardTranslation(Base):
    """Libellés localisés d'une carte (le `nom_fr` du §6, normalisé).

    Alimentée par le champ `i18n` de krcg, qui couvre **fr et es sur 428
    cartes** — celles des sets imprimés dans ces langues. La couverture
    grandira au fil des rééditions : l'import du Lot 2 fait des *upserts*, et
    l'absence de ligne signifie « pas de traduction connue », auquel cas le
    nom anglais de `Card` fait foi.
    """

    __tablename__ = "card_translation"

    card_id: Mapped[int] = mapped_column(
        ForeignKey("card.id", ondelete="CASCADE"),
        primary_key=True,
    )
    language_code: Mapped[str] = mapped_column(
        ForeignKey("language.code"),
        primary_key=True,
    )
    name: Mapped[str] = mapped_column(String(120))
    card_text: Mapped[str | None] = mapped_column(Text())
    flavor_text: Mapped[str | None] = mapped_column(Text())
    # Scan de la version localisée, quand il existe (deux tiers des
    # traductions chez krcg) : une carte française ne se reconnaît pas sur
    # l'image anglaise.
    image_url: Mapped[str | None] = mapped_column(String(200))

    card: Mapped[Card] = relationship(back_populates="translations")
    language: Mapped[Language] = relationship()
