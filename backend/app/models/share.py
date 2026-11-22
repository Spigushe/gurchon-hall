"""Liens publics vers une decklist (Lot 13, `docs/lot13-plan-partage.md`).

Un lien se lit sans session, par un jeton opaque de huit caractères
(`GET /listes/{token}`), jamais par l'identifiant du deck, qui est séquentiel.
Deux genres (P1) :

* **vivant** (`live`) — suit le deck : la page montre sa composition au moment
  de la lecture, quantités sommées par carte, langues et extensions
  confondues ;
* **figé** (`frozen`) — montre la liste copiée à la création, dans
  `deck_share_card` (carte × quantité, sur le patron de `deck_version_card`),
  avec le nom, l'archétype et les notes de ce moment (`frozen_*`). Une version
  jouée du Lot 8 se partage en figé ; `deck_version_id` en garde la provenance.

**Propriétaire.** `deck_share` porte `user_id`, et sa clé étrangère composite
(`deck_id`, `user_id`) vers `deck` interdit qu'un lien d'un compte désigne le
deck d'un autre. La ligne d'un deck survit à sa suppression logique : le figé
d'un deck supprimé garde sa clé (P5). La provenance d'un figé passe par une
clé composite (`deck_version_id`, `deck_id`, `user_id`) vers `deck_version`,
comme `participation` : une version **de ce deck**, et de ce compte ; nulle
pour un vivant ou pour un figé pris sur la liste courante (`MATCH SIMPLE`).

**Jeton en clair** (P3) : une decklist n'est pas un secret, et le propriétaire
doit pouvoir recopier son lien plus tard. Huit caractères de
`[A-Za-z0-9_]`, casse comprise ; la forme est tenue par un CHECK, l'unicité
par la base, le tirage par le service (`secrets.choice`, nouvel essai sur
collision).

Ce que le schéma ne dit pas, et qui reste au service : la purge est le seul
moyen de révoquer ; supprimer un deck retire ses vivants et garde ses figés
(P5) ; un vivant ne porte ni copie ni provenance, ce que le CHECK
`frozen_fields_match_kind` impose aussi en base.
"""

from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    String,
    Text,
    false,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import NEVER_REUSE_IDS, Base, utcnow
from app.models.catalog import Card
from app.models.collection import Deck, DeckVersion
from app.models.enums import DeckArchetype, DeckShareKind, enum_column
from app.models.types import UtcDateTime

SHARE_TOKEN_LENGTH = 8
"""Longueur du jeton d'un lien (P3) : 63⁸ jetons possibles."""

SHARE_TOKEN_ALPHABET = (
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_"
)
"""Les 63 caractères du jeton : lettres des deux casses, chiffres et `_` (P3).
`_` plutôt que `-`, qu'une messagerie peut prendre pour un point de coupure."""

# Huit caractères, aucun hors de l'alphabet. `GLOB` est sensible à la casse et
# propre à SQLite, comme le CHECK du discriminant de `deck` (équivalent
# Postgres : `token ~ '^[A-Za-z0-9_]{8}$'`).
_TOKEN_FORMAT = (
    f"length(token) = {SHARE_TOKEN_LENGTH} "
    "AND token NOT GLOB '*[^A-Za-z0-9_]*'"
)

# Un vivant ne porte ni copie ni provenance ; un figé a toujours son nom copié.
_FROZEN_FIELDS_MATCH_KIND = (
    "(kind = 'live' AND frozen_name IS NULL AND frozen_archetype IS NULL "
    "AND frozen_notes IS NULL AND deck_version_id IS NULL) "
    "OR (kind = 'frozen' AND frozen_name IS NOT NULL)"
)


class DeckShare(Base):
    """Un lien public vers la liste d'un deck, vivant ou figé (Lot 13).

    Identifiant jamais réattribué (`AUTOINCREMENT`, cf. R11) : un lien se
    purge physiquement, et la purge d'une sélection le désigne par son
    identifiant. Pas de `updated_at` : un lien ne se modifie pas, il se crée
    puis se purge.

    `show_notes` dit si la page publique montre les notes (P2, faux par
    défaut) : celles du deck pour un vivant, `frozen_notes` pour un figé. Le
    nom d'utilisateur, lui, est toujours montré, lu à la consultation.
    """

    __tablename__ = "deck_share"
    __table_args__ = (
        ForeignKeyConstraint(["deck_id", "user_id"], ["deck.id", "deck.user_id"]),
        ForeignKeyConstraint(
            ["deck_version_id", "deck_id", "user_id"],
            ["deck_version.id", "deck_version.deck_id", "deck_version.user_id"],
        ),
        CheckConstraint(_TOKEN_FORMAT, name="token_format"),
        CheckConstraint(_FROZEN_FIELDS_MATCH_KIND, name="frozen_fields_match_kind"),
        # Les liens d'un compte (écran Compte), et ceux d'un deck (feuille de
        # partage), qui filtrent toujours aussi sur le compte.
        Index("ix_deck_share_user_id_deck_id", "user_id", "deck_id"),
        NEVER_REUSE_IDS,
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    # Pas de clé étrangère simple vers `user_account` : la composite vers
    # `deck` l'implique, comme pour `deck_version`.
    user_id: Mapped[int] = mapped_column()
    deck_id: Mapped[int] = mapped_column()
    token: Mapped[str] = mapped_column(String(SHARE_TOKEN_LENGTH), unique=True)
    kind: Mapped[DeckShareKind] = mapped_column(
        enum_column(DeckShareKind, "deck_share_kind")
    )
    show_notes: Mapped[bool] = mapped_column(default=False, server_default=false())
    created_at: Mapped[datetime] = mapped_column(
        UtcDateTime(),
        default=utcnow,
        server_default=func.now(),
    )
    # Copiés à la création d'un figé (P2) : renommer le deck ne change pas la
    # page. Nuls pour un vivant, qui lit le deck.
    frozen_name: Mapped[str | None] = mapped_column(String(120))
    frozen_archetype: Mapped[DeckArchetype | None] = mapped_column(
        enum_column(DeckArchetype, "deck_archetype")
    )
    frozen_notes: Mapped[str | None] = mapped_column(Text())
    # Version jouée d'où vient un figé (P1), nulle sinon.
    deck_version_id: Mapped[int | None] = mapped_column()

    deck: Mapped[Deck] = relationship(
        primaryjoin=(
            "and_(DeckShare.deck_id == Deck.id, DeckShare.user_id == Deck.user_id)"
        ),
        foreign_keys="DeckShare.deck_id",
    )
    deck_version: Mapped[DeckVersion | None] = relationship(
        primaryjoin="DeckShare.deck_version_id == DeckVersion.id",
        foreign_keys="DeckShare.deck_version_id",
        viewonly=True,
    )
    cards: Mapped[list[DeckShareCard]] = relationship(
        back_populates="share",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="DeckShareCard.card_id",
    )


class DeckShareCard(Base):
    """Une carte de la liste copiée d'un lien figé, avec sa quantité totale.

    Clé étrangère vers `card` seulement, comme `deck_version_card` : une liste
    figée ne réserve rien. Supprimée avec son lien (`ON DELETE CASCADE`).
    """

    __tablename__ = "deck_share_card"
    __table_args__ = (CheckConstraint("quantity >= 1", name="quantity_positive"),)

    deck_share_id: Mapped[int] = mapped_column(
        ForeignKey("deck_share.id", ondelete="CASCADE"),
        primary_key=True,
    )
    card_id: Mapped[int] = mapped_column(ForeignKey("card.id"), primary_key=True)
    quantity: Mapped[int] = mapped_column()

    share: Mapped[DeckShare] = relationship(back_populates="cards")
    card: Mapped[Card] = relationship()
