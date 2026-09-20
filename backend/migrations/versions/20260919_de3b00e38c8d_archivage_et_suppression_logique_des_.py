"""Archivage et suppression logique des decks

Revision ID: de3b00e38c8d
Revises: a59a3613de12
Create Date: 2026-09-19 17:47:27.672275

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# Identifiants de révision utilisés par Alembic.
revision: str = 'de3b00e38c8d'
down_revision: str | Sequence[str] | None = 'a59a3613de12'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Le nom d'un deck n'est plus unique que parmi les decks non supprimés : la
    # contrainte UNIQUE cède la place à un index partiel, ce qui libère le nom
    # d'un deck supprimé logiquement. Les colonnes sont en `DateTime` simple,
    # comme `created_at` : le type maison `UtcDateTime` n'agit qu'en Python.
    with op.batch_alter_table('deck', schema=None) as batch_op:
        batch_op.add_column(sa.Column('archived_at', sa.DateTime(), nullable=True))
        batch_op.add_column(sa.Column('deleted_at', sa.DateTime(), nullable=True))
        batch_op.drop_constraint(batch_op.f('uq_deck_name'), type_='unique')
        batch_op.create_index('uq_deck_name_not_deleted', ['name'], unique=True, sqlite_where=sa.text('deleted_at IS NULL'), postgresql_where=sa.text('deleted_at IS NULL'))


def downgrade() -> None:
    # Sans suppression logique, deux decks ne peuvent plus porter le même nom.
    # Plutôt que de perdre des données ou d'échouer sur la contrainte, on suffixe
    # d'abord le nom des decks supprimés (leur id garantit l'unicité).
    op.execute(
        "UPDATE deck SET name = name || ' [supprimé ' || id || ']' "
        "WHERE deleted_at IS NOT NULL"
    )
    with op.batch_alter_table('deck', schema=None) as batch_op:
        batch_op.drop_index('uq_deck_name_not_deleted', sqlite_where=sa.text('deleted_at IS NULL'), postgresql_where=sa.text('deleted_at IS NULL'))
        batch_op.create_unique_constraint(batch_op.f('uq_deck_name'), ['name'])
        batch_op.drop_column('deleted_at')
        batch_op.drop_column('archived_at')
