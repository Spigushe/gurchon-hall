"""Collection et decks — le niveau « exemplaire », qui porte la langue.

Trois idées, dans l'ordre où elles s'empilent :

1. `CardCopy` — les exemplaires d'une **carte donnée, dans une langue donnée,
   issus d'une extension donnée** que je possède. C'est le `Stock` du §6 (PK
   composite carte + langue + extension depuis le Lot 4, décision D1) :
   `quantity_owned` compte ce que je possède réellement. Une entrée à 0
   exemplaire est parfaitement valide : c'est ainsi qu'une carte jouée
   uniquement en proxy entre en collection (CLAUDE.md §11 point 2). Le couple
   (carte, extension) doit être une impression réelle du catalogue : une clé
   étrangère composite vers `card_printing` l'impose (décision D2).
2. `Deck` — un deck que je joue. Il porte `proxy_allowed` (Lot 4) :
   l'autorisation de jouer des proxies dépend du tournoi visé, pas de la carte
   ni de l'entrée de collection.
3. `DeckCard` — l'**allocation** d'exemplaires vers un deck. Sa clé étrangère
   composite pointe `card_copy`, pas `card` : au niveau du schéma, on ne peut
   donc pas mettre dans un deck une carte absente de la collection (§11 point
   2). La langue et l'extension font partie de la clé, donc un même deck peut
   contenir la même carte en plusieurs langues (§11 point 4) et en plusieurs
   impressions (Lot 4).
4. `DeletedDeckCard` — la decklist **figée** d'un deck supprimé. Mêmes colonnes
   que `DeckCard`, mais sans lien vers la collection : un deck supprimé ne
   réserve plus rien, et l'entrée de stock qu'il utilisait redevient
   supprimable.

Ce que le schéma ne dit **pas**, et qui reste du ressort des services de
validation du Lot 2 (skill `regles-vtes`) : la somme des exemplaires alloués à
travers tous les decks ne doit pas dépasser `quantity_owned + proxies`, et un
deck doit respecter crypt ≥ 12 / library 60–90.
"""

from datetime import date, datetime

from sqlalchemy import (
    CheckConstraint,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    String,
    Text,
    UniqueConstraint,
    false,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin
from app.models.catalog import Card, CardPrinting
from app.models.enums import DeckStatus, enum_column
from app.models.reference import CardSet, Language
from app.models.types import UtcDateTime


class CardCopy(Base):
    """Exemplaires possédés d'une carte, dans une langue, pour une impression.

    Clé : (carte, langue, extension) — décision D1 du Lot 4. Pas de clé
    technique : le client hors ligne désigne une entrée par des valeurs qu'il
    connaît déjà, et les chemins restent lisibles
    (`/stock/{card_id}/{language_code}/{card_set_id}`).

    La clé étrangère composite vers `card_printing` (`card_id`, `card_set_id`),
    adossée à l'unicité `uq_card_printing_card_id_card_set_id`, fait refuser
    par la base un exemplaire rangé dans une extension où la carte n'a pas été
    imprimée (décision D2). C'est un dernier filet : le service vérifie
    l'impression avant d'écrire et rend un 404 lisible. Sans `ondelete` : une
    impression utilisée par le stock ne se supprime pas (l'import ne supprime
    rien, sauf l'impression tampon inutilisée, décision D2c).
    """

    __tablename__ = "card_copy"
    __table_args__ = (
        ForeignKeyConstraint(
            ["card_id", "card_set_id"],
            ["card_printing.card_id", "card_printing.card_set_id"],
        ),
        CheckConstraint("quantity_owned >= 0", name="quantity_owned_positive"),
    )

    card_id: Mapped[int] = mapped_column(ForeignKey("card.id"), primary_key=True)
    language_code: Mapped[str] = mapped_column(
        ForeignKey("language.code"),
        primary_key=True,
    )
    card_set_id: Mapped[int] = mapped_column(primary_key=True)
    quantity_owned: Mapped[int] = mapped_column(default=0)
    notes: Mapped[str | None] = mapped_column(Text())

    card: Mapped[Card] = relationship()
    language: Mapped[Language] = relationship()
    # Raccourcis de lecture : l'impression et son extension. `viewonly`, car
    # `card_id` est déjà écrit par la relation `card` ; les services posent
    # `card_set_id` directement.
    printing: Mapped[CardPrinting] = relationship(
        primaryjoin=(
            "and_(CardCopy.card_id == CardPrinting.card_id, "
            "CardCopy.card_set_id == CardPrinting.card_set_id)"
        ),
        foreign_keys="[CardCopy.card_id, CardCopy.card_set_id]",
        viewonly=True,
    )
    card_set: Mapped[CardSet] = relationship(
        primaryjoin="CardCopy.card_set_id == CardSet.id",
        foreign_keys="CardCopy.card_set_id",
        viewonly=True,
    )
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
    """Un deck construit par le joueur.

    Cycle de vie en deux temps (Lot 2, passe 2), indépendant de `status` :

    * `archived_at` — le deck est rangé : il sort des listes par défaut et n'est
      plus modifiable, mais garde sa composition et ses exemplaires alloués ;
    * `deleted_at` — suppression **logique**, possible seulement depuis
      l'archive : la ligne reste en base (l'historique des parties garde son
      deck) et les exemplaires alloués retournent au stock — la composition,
      elle, migre de `deck_card` vers `deleted_deck_card`, qui la fige sans plus
      rien réserver. Le deck sort de toutes les listes de l'API mais reste
      lisible par son identifiant, en lecture seule, `deleted_at` à l'appui.

    **Nom et discriminant.** Deux decks peuvent porter le même nom : rien
    n'oblige un joueur à inventer un nom neuf à chaque itération d'un même
    archétype. Ce qui les distingue est un discriminant de quatre chiffres,
    tiré par le serveur à la création (« Malkavien 2022#8561 », comme un pseudo
    Discord). Le couple (nom, discriminant) est unique sur **tous** les decks,
    supprimés compris : un deck supprimé garde donc son identité d'affichage,
    et rien ne la réattribue.
    """

    __tablename__ = "deck"
    __table_args__ = (
        UniqueConstraint("name", "discriminator", name="uq_deck_name_discriminator"),
        # Quatre chiffres, zéros initiaux compris, « 0000 » exclu. `GLOB` est
        # propre à SQLite (équivalent Postgres : `discriminator ~ '^[0-9]{4}$'`)
        # ; la contrainte serait à retraduire lors d'un éventuel portage.
        CheckConstraint(
            "discriminator GLOB '[0-9][0-9][0-9][0-9]' "
            "AND discriminator <> '0000'",
            name="discriminator_format",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    # Tiré par le service, jamais fourni par le client, et stable au renommage.
    discriminator: Mapped[str] = mapped_column(String(4))
    created_on: Mapped[date | None] = mapped_column()
    status: Mapped[DeckStatus] = mapped_column(
        enum_column(DeckStatus, "deck_status"),
        default=DeckStatus.DRAFT,
    )
    archetype: Mapped[str | None] = mapped_column(String(120))
    notes: Mapped[str | None] = mapped_column(Text())
    # Autorisation de jouer des proxies dans ce deck, choisie selon le tournoi
    # visé (certains les refusent, d'autres les acceptent). Le nombre de
    # proxies reste porté par chaque ligne (`DeckCard.proxy_quantity`).
    # `server_default` en plus du défaut Python : une ligne insérée hors ORM
    # (migration, SQL à la main) reçoit la même valeur prudente.
    proxy_allowed: Mapped[bool] = mapped_column(
        default=False,
        server_default=false(),
    )
    archived_at: Mapped[datetime | None] = mapped_column(UtcDateTime())
    deleted_at: Mapped[datetime | None] = mapped_column(UtcDateTime())

    cards: Mapped[list[DeckCard]] = relationship(
        back_populates="deck",
        cascade="all, delete-orphan",
    )
    frozen_cards: Mapped[list[DeletedDeckCard]] = relationship(
        back_populates="deck",
        cascade="all, delete-orphan",
    )


class DeckCard(Base):
    """Allocation d'exemplaires de la collection vers un deck.

    `quantity` compte le total d'exemplaires de cette carte, dans cette langue
    et cette impression, présents dans le deck ; `proxy_quantity` dit combien,
    parmi eux, sont des proxies (donc non adossés à un exemplaire réellement
    possédé).
    """

    __tablename__ = "deck_card"
    __table_args__ = (
        ForeignKeyConstraint(
            ["card_id", "language_code", "card_set_id"],
            [
                "card_copy.card_id",
                "card_copy.language_code",
                "card_copy.card_set_id",
            ],
        ),
        CheckConstraint("quantity >= 1", name="quantity_positive"),
        CheckConstraint(
            "proxy_quantity >= 0 AND proxy_quantity <= quantity",
            name="proxy_quantity_within_quantity",
        ),
        # « Quels decks consomment cet exemplaire ? » est la requête centrale
        # de la réconciliation stock ↔ decks : la PK commence par `deck_id` et
        # ne la sert pas. Étendu à l'extension au Lot 4 : l'index couvre la clé
        # entière de `card_copy`, dans l'ordre de sa clé primaire.
        Index(
            "ix_deck_card_card_id_language_code_card_set_id",
            "card_id",
            "language_code",
            "card_set_id",
        ),
    )

    deck_id: Mapped[int] = mapped_column(
        ForeignKey("deck.id", ondelete="CASCADE"),
        primary_key=True,
    )
    card_id: Mapped[int] = mapped_column(primary_key=True)
    language_code: Mapped[str] = mapped_column(String(8), primary_key=True)
    card_set_id: Mapped[int] = mapped_column(primary_key=True)
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


class DeletedDeckCard(Base):
    """Decklist figée d'un deck supprimé.

    À la suppression logique, le service recopie ici les lignes de `deck_card`
    puis efface les vivantes. Deux conséquences voulues :

    * le deck supprimé garde la trace de ce qu'il contenait — utile pour un
      deck qui a servi en tournoi ;
    * il ne référence plus `card_copy`, donc plus aucune entrée de collection
      n'est retenue par un deck que l'API ne montre plus. Les clés étrangères
      vont vers `card`, `language` et `card_set`, qui ne s'effacent pas.

    L'extension (Lot 4) est recopiée de la ligne vivante et fait partie de la
    clé, comme dans `deck_card` : une decklist figée distingue encore deux
    impressions de la même carte dans la même langue. Elle pointe `card_set`
    et non `card_printing` : une decklist figée ne réserve rien, et la seule
    suppression d'impression que l'import s'autorise (l'impression tampon,
    D2c) ne doit pas buter sur un deck supprimé.

    Les colonnes et les `CHECK` reprennent ceux de `deck_card` : une decklist
    figée reste une decklist lisible, pas un cimetière de valeurs douteuses.
    """

    __tablename__ = "deleted_deck_card"
    __table_args__ = (
        CheckConstraint("quantity >= 1", name="quantity_positive"),
        CheckConstraint(
            "proxy_quantity >= 0 AND proxy_quantity <= quantity",
            name="proxy_quantity_within_quantity",
        ),
    )

    deck_id: Mapped[int] = mapped_column(
        ForeignKey("deck.id", ondelete="CASCADE"),
        primary_key=True,
    )
    card_id: Mapped[int] = mapped_column(ForeignKey("card.id"), primary_key=True)
    language_code: Mapped[str] = mapped_column(
        ForeignKey("language.code"),
        primary_key=True,
    )
    card_set_id: Mapped[int] = mapped_column(
        ForeignKey("card_set.id"),
        primary_key=True,
    )
    quantity: Mapped[int] = mapped_column(default=1)
    proxy_quantity: Mapped[int] = mapped_column(default=0)

    deck: Mapped[Deck] = relationship(back_populates="frozen_cards")
    card: Mapped[Card] = relationship()
    language: Mapped[Language] = relationship()
