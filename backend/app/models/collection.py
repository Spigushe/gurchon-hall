"""Collection et decks — le niveau « exemplaire », qui porte la langue.

Trois idées, dans l'ordre où elles s'empilent :

1. `CardCopy` — les exemplaires d'une **carte donnée dans une langue donnée**
   que je possède. C'est le `Stock` du §6 (PK composite carte + langue), enrichi
   du statut proxy de CLAUDE.md §11 point 2 : `quantity_owned` compte ce que je
   possède réellement, `proxy_allowed` autorise à jouer cette carte en proxy
   sans la posséder. Une entrée `quantity_owned = 0, proxy_allowed = True` est
   parfaitement valide : c'est exactement le cas « je joue cette carte en
   proxy ».
2. `Deck` — un deck que je joue.
3. `DeckCard` — l'**allocation** d'exemplaires vers un deck. Sa clé étrangère
   composite pointe `card_copy`, pas `card` : au niveau du schéma, on ne peut
   donc pas mettre dans un deck une carte absente de la collection (§11 point
   2). La langue fait partie de la clé, donc un même deck peut contenir la
   même carte en plusieurs langues (§11 point 4).

Ce que le schéma ne dit **pas**, et qui reste du ressort des services de
validation du Lot 2 (skill `regles-vtes`) : la somme des exemplaires alloués à
travers tous les decks ne doit pas dépasser `quantity_owned + proxies`, et un
deck doit respecter crypt ≥ 12 / library 60–90.
"""

from datetime import date

from sqlalchemy import (
    CheckConstraint,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin
from app.models.catalog import Card
from app.models.enums import DeckStatus, enum_column
from app.models.reference import Language


class CardCopy(Base):
    """Exemplaires possédés d'une carte dans une langue (le stock du §6)."""

    __tablename__ = "card_copy"
    __table_args__ = (
        CheckConstraint("quantity_owned >= 0", name="quantity_owned_positive"),
    )

    card_id: Mapped[int] = mapped_column(ForeignKey("card.id"), primary_key=True)
    language_code: Mapped[str] = mapped_column(
        ForeignKey("language.code"),
        primary_key=True,
    )
    quantity_owned: Mapped[int] = mapped_column(default=0)
    proxy_allowed: Mapped[bool] = mapped_column(default=False)
    notes: Mapped[str | None] = mapped_column(Text())

    card: Mapped[Card] = relationship()
    language: Mapped[Language] = relationship()
    # `passive_deletes="all"` : supprimer une entrée de collection encore
    # allouée à un deck doit être refusé par la base. Sans cette option, l'ORM
    # essaie de passer la clé étrangère de `deck_card` à NULL avant le DELETE
    # — impossible, puisque ces colonnes font partie de sa clé primaire, d'où
    # une erreur interne au lieu d'une violation d'intégrité lisible.
    deck_allocations: Mapped[list[DeckCard]] = relationship(
        back_populates="card_copy",
        passive_deletes="all",
    )


class Deck(Base, TimestampMixin):
    """Un deck construit par le joueur."""

    __tablename__ = "deck"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120), unique=True)
    created_on: Mapped[date | None] = mapped_column()
    status: Mapped[DeckStatus] = mapped_column(
        enum_column(DeckStatus, "deck_status"),
        default=DeckStatus.DRAFT,
    )
    archetype: Mapped[str | None] = mapped_column(String(120))
    notes: Mapped[str | None] = mapped_column(Text())

    cards: Mapped[list[DeckCard]] = relationship(
        back_populates="deck",
        cascade="all, delete-orphan",
    )


class DeckCard(Base):
    """Allocation d'exemplaires de la collection vers un deck.

    `quantity` compte le total d'exemplaires de cette carte dans cette langue
    présents dans le deck ; `proxy_quantity` dit combien, parmi eux, sont des
    proxies (donc non adossés à un exemplaire réellement possédé).
    """

    __tablename__ = "deck_card"
    __table_args__ = (
        ForeignKeyConstraint(
            ["card_id", "language_code"],
            ["card_copy.card_id", "card_copy.language_code"],
        ),
        CheckConstraint("quantity >= 1", name="quantity_positive"),
        CheckConstraint(
            "proxy_quantity >= 0 AND proxy_quantity <= quantity",
            name="proxy_quantity_within_quantity",
        ),
        # « Quels decks consomment cet exemplaire ? » est la requête centrale
        # de la réconciliation stock ↔ decks : la PK commence par `deck_id` et
        # ne la sert pas.
        Index("ix_deck_card_card_id_language_code", "card_id", "language_code"),
    )

    deck_id: Mapped[int] = mapped_column(
        ForeignKey("deck.id", ondelete="CASCADE"),
        primary_key=True,
    )
    card_id: Mapped[int] = mapped_column(primary_key=True)
    language_code: Mapped[str] = mapped_column(String(8), primary_key=True)
    quantity: Mapped[int] = mapped_column(default=1)
    proxy_quantity: Mapped[int] = mapped_column(default=0)

    deck: Mapped[Deck] = relationship(back_populates="cards")
    card_copy: Mapped[CardCopy] = relationship(back_populates="deck_allocations")
    # Raccourci de lecture vers le catalogue. Pas de clé étrangère directe vers
    # `card` : l'intégrité passe déjà par `card_copy`, qui référence la carte.
    card: Mapped[Card] = relationship(
        primaryjoin="DeckCard.card_id == Card.id",
        foreign_keys="DeckCard.card_id",
        viewonly=True,
    )
