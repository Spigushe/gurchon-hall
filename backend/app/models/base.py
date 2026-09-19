"""Base déclarative SQLAlchemy 2.0 et conventions communes.

Toutes les tables du projet héritent de `Base`. La convention de nommage des
contraintes est posée ici : sans elle, SQLite génère des noms anonymes que le
mode batch d'Alembic (recréation de table, cf. skill `migrations-alembic`) ne
sait pas cibler lors d'un `drop_constraint` / `alter_column`.
"""

from datetime import UTC, datetime

from sqlalchemy import MetaData, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from app.models.types import UtcDateTime

NAMING_CONVENTION = {
    "ix": "ix_%(table_name)s_%(column_0_N_name)s",
    "uq": "uq_%(table_name)s_%(column_0_N_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_N_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    """Classe de base de tous les modèles."""

    metadata = MetaData(naming_convention=NAMING_CONVENTION)


def utcnow() -> datetime:
    """Horodatage UTC, utilisé comme valeur par défaut côté Python."""
    return datetime.now(UTC)


class TimestampMixin:
    """Colonnes d'audit `created_at` / `updated_at`.

    Réservé aux entités saisies par l'utilisateur (decks, parties, tournois…).
    Le catalogue de cartes, lui, est un import reproductible : il n'a pas
    besoin d'être horodaté ligne à ligne.

    Comme toutes les colonnes date-heure du modèle, elles sont en UTC naïf
    (cf. `app.models.types.UtcDateTime`) : `utcnow()` produit un instant
    *aware*, que le type convertit avant écriture. `CURRENT_TIMESTAMP`, le
    défaut côté base, est déjà de l'UTC en SQLite — les deux chemins
    concordent donc.
    """

    created_at: Mapped[datetime] = mapped_column(
        UtcDateTime(),
        default=utcnow,
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        UtcDateTime(),
        default=utcnow,
        onupdate=utcnow,
        server_default=func.now(),
    )
