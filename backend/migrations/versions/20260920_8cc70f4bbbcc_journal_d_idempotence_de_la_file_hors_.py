"""Journal d'idempotence de la file hors ligne

Ouvre le Lot 3 côté base : une seule table, `sync_operation`, où `POST /sync`
inscrit le verdict rendu sur chaque opération rejouée depuis la file du client
(cf. `app.models.sync`).

Trois particularités, toutes voulues :

* **aucune clé étrangère.** Un journal décrit ce qui s'est passé, pas ce qui
  existe. `deck_id`, `card_id`, `language_code` et `bundle_id` sont des
  identifiants inertes : ils ne retiennent rien et survivent à la disparition
  de ce qu'ils désignent ;
* **un index unique partiel** sur `client_ref`, restreint aux lignes
  `applied` : une référence tirée par le client ne désigne qu'un objet créé,
  mais une création refusée ne doit pas condamner la référence — le client
  corrige et rejoue avec une autre clé d'idempotence ;
* **deux `CHECK`** qui figent la forme d'un verdict : un refus porte toujours
  son motif, une réussite jamais ; et une opération appliquée a forcément
  touché une ressource.

La révision ne touche à aucune table existante : pas de mode batch, donc pas de
recopie, et rien à craindre pour la composition des decks. Elle se rejoue aussi
hors ligne (`upgrade 8cc70f4bbbcc --sql` depuis la révision précédente), à la
différence des deux révisions du Lot 2.

Revision ID: 8cc70f4bbbcc
Revises: 5dc50e3c1701
Create Date: 2026-09-20 16:10:50.114490

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# Identifiants de révision utilisés par Alembic.
revision: str = '8cc70f4bbbcc'
down_revision: str | Sequence[str] | None = '5dc50e3c1701'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Condition de l'index unique partiel : seules les créations **appliquées**
# réservent une référence client.
APPLIED_CLIENT_REF = sa.text("client_ref IS NOT NULL AND status = 'applied'")


def upgrade() -> None:
    op.create_table(
        'sync_operation',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('operation_id', sa.String(length=36), nullable=False),
        sa.Column('batch_id', sa.String(length=36), nullable=False),
        sa.Column(
            'operation_type',
            sa.Enum(
                'stock.upsert',
                'stock.delete',
                'deck.create',
                'deck.update',
                'deck.delete',
                'deck_card.upsert',
                'deck_card.delete',
                'bundle.deposit',
                name='sync_operation_type',
                native_enum=False,
                create_constraint=True,
            ),
            nullable=False,
        ),
        sa.Column('request_hash', sa.String(length=64), nullable=False),
        sa.Column(
            'status',
            sa.Enum(
                'applied',
                'rejected',
                name='sync_operation_status',
                native_enum=False,
                create_constraint=True,
            ),
            nullable=False,
        ),
        sa.Column(
            'error_code',
            sa.Enum(
                'not_found',
                'conflict',
                'invalid',
                'unresolved_client_ref',
                'mismatched_replay',
                name='sync_error_code',
                native_enum=False,
                create_constraint=True,
            ),
            nullable=True,
        ),
        sa.Column('error_message', sa.Text(), nullable=True),
        sa.Column('client_ref', sa.String(length=64), nullable=True),
        sa.Column(
            'resource_kind',
            sa.Enum(
                'card_copy',
                'deck',
                'deck_card',
                'bundle',
                name='sync_resource_kind',
                native_enum=False,
                create_constraint=True,
            ),
            nullable=True,
        ),
        sa.Column('deck_id', sa.Integer(), nullable=True),
        sa.Column('card_id', sa.Integer(), nullable=True),
        sa.Column('language_code', sa.String(length=8), nullable=True),
        sa.Column('bundle_id', sa.Integer(), nullable=True),
        # `UtcDateTime` n'est qu'un `DateTime` assorti d'une conversion côté
        # Python : le DDL est le même, et une migration n'a pas à importer les
        # modèles de l'application (cf. la révision initiale).
        sa.Column('recorded_at', sa.DateTime(), nullable=False),
        sa.Column('processed_at', sa.DateTime(), nullable=False),
        sa.CheckConstraint(
            "(status = 'rejected') = (error_code IS NOT NULL)",
            name=op.f('ck_sync_operation_error_code_iff_rejected'),
        ),
        sa.CheckConstraint(
            "status <> 'applied' OR resource_kind IS NOT NULL",
            name=op.f('ck_sync_operation_resource_kind_when_applied'),
        ),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_sync_operation')),
        sa.UniqueConstraint(
            'operation_id', name=op.f('uq_sync_operation_operation_id')
        ),
    )
    # « Qu'a fait cette synchronisation ? » : la seule lecture du journal qui
    # ne parte pas d'une clé d'idempotence.
    op.create_index(
        'ix_sync_operation_batch_id', 'sync_operation', ['batch_id'], unique=False
    )
    op.create_index(
        'ux_sync_operation_client_ref',
        'sync_operation',
        ['client_ref'],
        unique=True,
        sqlite_where=APPLIED_CLIENT_REF,
        postgresql_where=APPLIED_CLIENT_REF,
    )


def downgrade() -> None:
    # Perte assumée, et sans équivalent dans les révisions précédentes : le
    # journal disparaît avec la table. Une file déjà synchronisée et rejouée
    # après un retour arrière serait donc réappliquée — versements de produits
    # compris. Vider la file côté client avant tout downgrade.
    op.drop_index(
        'ux_sync_operation_client_ref',
        table_name='sync_operation',
        sqlite_where=APPLIED_CLIENT_REF,
        postgresql_where=APPLIED_CLIENT_REF,
    )
    op.drop_index('ix_sync_operation_batch_id', table_name='sync_operation')
    op.drop_table('sync_operation')
