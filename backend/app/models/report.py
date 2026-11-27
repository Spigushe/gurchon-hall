"""Comptes-rendus de tournoi (lot Compte-rendu, `docs/lot-compte-rendu-plan.md`).

Un compte-rendu par tournoi, au plus. Il est généré dans une trame fixe à
partir de ce que l'outil sait du tournoi (P1, P2) ; ce qu'on y écrit, ce sont
les notes du tournoi et des parties, qui vivent dans leurs tables. Il n'a donc
aucun texte propre : seulement des réglages et des versions.

* `tournament_report` — le compte-rendu d'un tournoi : ses réglages (notes sur
  les adversaires incluses ou non, P4 ; mes notes de table incluses ou non,
  cochées par défaut, v1.2.2 A8 ; versions antérieures visibles par le lien ou
  non, P9) et le jeton de son lien public, nul tant qu'il n'est pas
  partagé ou après une purge (P8). Jeton au format du Lot 13, en clair.
* `tournament_report_version` — une version figée, numérotée (v1, v2…), qui
  porte l'**instantané** de tout ce que le compte-rendu affiche (P6, A3), en
  JSON canonique : la comparer à la précédente est une égalité de texte, et
  rien de ce qu'elle montre ne dépend de l'état de la base après coup (une
  partie supprimée reste dans la version qui la montrait, P10).

**Propriétaire.** `tournament_report` porte `user_id`, sous la clé composite
(`tournament_id`, `user_id`) vers `tournament` : un compte-rendu désigne un
tournoi de son compte. Une version se lit par son compte-rendu et n'a pas de
`user_id`, comme `deck_share_card`.

Le tournoi ne se supprime pas tant qu'il a un compte-rendu (P10, au service) ;
supprimer le compte-rendu emporte ses versions (`ON DELETE CASCADE`) et son
lien.
"""

from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    ForeignKey,
    ForeignKeyConstraint,
    String,
    Text,
    UniqueConstraint,
    false,
    func,
    true,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import NEVER_REUSE_IDS, Base, utcnow
from app.models.play import Tournament
from app.models.share import SHARE_TOKEN_LENGTH
from app.models.types import UtcDateTime

# Même forme que le jeton d'un lien de decklist (Lot 13, P3), quand il existe.
_TOKEN_FORMAT = (
    f"token IS NULL OR (length(token) = {SHARE_TOKEN_LENGTH} "
    "AND token NOT GLOB '*[^A-Za-z0-9_]*')"
)


class TournamentReport(Base):
    """Le compte-rendu d'un tournoi : réglages, lien, versions.

    Identifiant jamais réattribué (`AUTOINCREMENT`, cf. R11) : un compte-rendu
    se supprime physiquement.
    """

    __tablename__ = "tournament_report"
    __table_args__ = (
        ForeignKeyConstraint(
            ["tournament_id", "user_id"], ["tournament.id", "tournament.user_id"]
        ),
        UniqueConstraint("tournament_id"),
        CheckConstraint(_TOKEN_FORMAT, name="token_format"),
        NEVER_REUSE_IDS,
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    # Pas de clé étrangère simple vers `user_account` : la composite vers
    # `tournament` l'implique, comme pour `deck_share`.
    user_id: Mapped[int] = mapped_column(index=True)
    tournament_id: Mapped[int] = mapped_column()
    token: Mapped[str | None] = mapped_column(
        String(SHARE_TOKEN_LENGTH), unique=True
    )
    include_opponent_notes: Mapped[bool] = mapped_column(
        default=False, server_default=false()
    )
    # Ma note de table (`participation.notes` de ma ligne) au compte-rendu,
    # cochée par défaut (v1.2.2, A8, R18).
    include_my_notes: Mapped[bool] = mapped_column(
        default=True, server_default=true()
    )
    show_previous_versions: Mapped[bool] = mapped_column(
        default=False, server_default=false()
    )
    created_at: Mapped[datetime] = mapped_column(
        UtcDateTime(), default=utcnow, server_default=func.now()
    )

    tournament: Mapped[Tournament] = relationship(
        primaryjoin=(
            "and_(TournamentReport.tournament_id == Tournament.id, "
            "TournamentReport.user_id == Tournament.user_id)"
        ),
        foreign_keys="TournamentReport.tournament_id",
    )
    versions: Mapped[list[TournamentReportVersion]] = relationship(
        back_populates="report",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="TournamentReportVersion.number",
    )


class TournamentReportVersion(Base):
    """Une version figée d'un compte-rendu : son numéro, sa date et
    l'instantané qu'elle montre, en JSON canonique (clés triées)."""

    __tablename__ = "tournament_report_version"
    __table_args__ = (
        UniqueConstraint("report_id", "number"),
        CheckConstraint("number >= 1", name="number_positive"),
        NEVER_REUSE_IDS,
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    report_id: Mapped[int] = mapped_column(
        ForeignKey("tournament_report.id", ondelete="CASCADE")
    )
    number: Mapped[int] = mapped_column()
    created_at: Mapped[datetime] = mapped_column(
        UtcDateTime(), default=utcnow, server_default=func.now()
    )
    snapshot: Mapped[str] = mapped_column(Text())

    report: Mapped[TournamentReport] = relationship(back_populates="versions")
