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


# Option de table pour les ressources que l'on supprime physiquement et que
# le client désigne par leur identifiant ou par une `client_ref` du journal de
# synchronisation : `player`, `venue`, `tournament`, `game` (Lot 7, R11). Sans
# `AUTOINCREMENT`, SQLite redonne à la ligne suivante l'identifiant de la
# dernière ligne supprimée, et une référence périmée désignerait en silence
# une autre ressource (la `client_ref` de Marc, supprimé, renommerait Julie).
# Avec, un identifiant n'est jamais réattribué : la référence périmée ne
# trouve plus rien et rend `not_found`. Sans effet hors de SQLite. Les tables
# à suppression logique (`deck`) ou jamais désignées par leur identifiant
# (`participation`, remplacée en bloc avec sa partie) n'en ont pas besoin.
# Contrepartie SQLite : la clé primaire est rendue en ligne
# (`id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT`) et perd son nom `pk_…`.
NEVER_REUSE_IDS = {"sqlite_autoincrement": True}


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
