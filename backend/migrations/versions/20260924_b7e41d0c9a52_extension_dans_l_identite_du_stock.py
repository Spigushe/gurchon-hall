"""Extension dans l'identité du stock

Lot 4, passe B : l'identité d'une entrée de collection devient carte × langue ×
extension (décisions D1 et D2 de `docs/lot4-plan-inventaire.md`).

* `card_copy` — `card_set_id` entre dans la clé primaire
  (`card_id`, `language_code`, `card_set_id`) ; clé étrangère composite
  (`card_id`, `card_set_id`) vers `card_printing`, adossée à l'unicité
  `uq_card_printing_card_id_card_set_id` qui existe depuis la révision
  initiale : la base refuse un exemplaire rangé dans une extension où la carte
  n'a pas été imprimée. Les clés étrangères vers `card` et `language` restent.
* `deck_card` — `card_set_id` entre dans la clé primaire, la clé étrangère
  vers `card_copy` passe à trois colonnes, et l'index
  `ix_deck_card_card_id_language_code` devient
  `ix_deck_card_card_id_language_code_card_set_id`.
* `deleted_deck_card` — `card_set_id` entre dans la clé primaire, avec une
  clé étrangère vers `card_set` (pas vers `card_copy` : une decklist figée ne
  réserve rien).
* `card_set.is_placeholder` — marqueur de l'extension tampon de l'import
  (D2b), booléen NOT NULL, `false` par défaut ; les extensions existantes
  valent `false`.
* `sync_operation.card_set_id` — entier nullable : le journal de `/sync` garde
  l'extension de l'entrée touchée, pour rendre à l'identique le verdict d'un
  rejeu (`SyncResourceRef.card_set_id`). Les lignes antérieures restent à
  NULL ; ce n'est pas une conversion.

**Aucune conversion de données** (décision D3) : la révision vérifie que
`card_copy`, `deck_card` et `deleted_deck_card` sont vides et s'arrête sur un
message explicite sinon, à la montée comme à la descente. Choix de pilote : sur
barrins-project, il y aura des données à reprendre.

Les trois tables étant vides, elles sont supprimées puis recréées plutôt que
modifiées en mode batch : le DDL obtenu est déterministe (la recréation du mode
batch recopie les contraintes dans un ordre qui varie d'un processus à
l'autre), et aucune clé primaire n'a à être « modifiée ». Ordre imposé par les
références : `deck_card` (qui pointe `card_copy`) disparaît avant et renaît
après `card_copy`. Les clés étrangères sont de toute façon coupées pendant la
migration puis vérifiées (`migrations/env.py`, `foreign_key_check`).

Les deux ajouts de colonnes passent par un `ALTER TABLE` simple
(`recreate='never'`). La révision ne se rejoue pas hors ligne (`--sql`) : la
garde D3 lit la base.

Revision ID: b7e41d0c9a52
Revises: 6c9a178b7a1d
Create Date: 2026-09-24 14:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# Identifiants de révision utilisés par Alembic.
revision: str = 'b7e41d0c9a52'
down_revision: str | Sequence[str] | None = '6c9a178b7a1d'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

GUARDED_TABLES = ('card_copy', 'deck_card', 'deleted_deck_card')


def _require_empty_collection(direction: str) -> None:
    """Refuse de migrer si la collection ou une decklist contient des lignes.

    Lève une `RuntimeError` avant toute modification : la transaction de la
    migration est annulée et la base reste à sa révision de départ.
    """
    bind = op.get_bind()
    counts = {
        table: bind.execute(sa.text(f'SELECT COUNT(*) FROM {table}')).scalar_one()
        for table in GUARDED_TABLES
    }
    filled = {table: count for table, count in counts.items() if count}
    if filled:
        detail = ', '.join(f'{table} ({count} lignes)' for table, count in filled.items())
        raise RuntimeError(
            f"Migration b7e41d0c9a52 ({direction}) interrompue : elle ne convertit "
            f"aucune donnée et exige que card_copy, deck_card et deleted_deck_card "
            f"soient vides (décision D3 du Lot 4, docs/lot4-plan-inventaire.md). "
            f"Tables non vides : {detail}. Videz-les (ou repartez d'une base "
            f"neuve) avant de relancer."
        )


def _drop_collection_tables() -> None:
    """Supprime les trois tables, `deck_card` avant `card_copy` qu'elle pointe."""
    op.drop_table('deck_card')  # emporte son index
    op.drop_table('deleted_deck_card')
    op.drop_table('card_copy')


def upgrade() -> None:
    _require_empty_collection('upgrade')

    with op.batch_alter_table('card_set', schema=None, recreate='never') as batch_op:
        batch_op.add_column(
            sa.Column(
                'is_placeholder',
                sa.Boolean(),
                server_default=sa.false(),
                nullable=False,
            )
        )

    with op.batch_alter_table(
        'sync_operation', schema=None, recreate='never'
    ) as batch_op:
        batch_op.add_column(sa.Column('card_set_id', sa.Integer(), nullable=True))

    _drop_collection_tables()

    op.create_table(
        'card_copy',
        sa.Column('card_id', sa.Integer(), nullable=False),
        sa.Column('language_code', sa.String(length=8), nullable=False),
        sa.Column('card_set_id', sa.Integer(), nullable=False),
        sa.Column('quantity_owned', sa.Integer(), nullable=False),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.CheckConstraint(
            'quantity_owned >= 0', name=op.f('ck_card_copy_quantity_owned_positive')
        ),
        sa.ForeignKeyConstraint(
            ['card_id'], ['card.id'], name=op.f('fk_card_copy_card_id_card')
        ),
        sa.ForeignKeyConstraint(
            ['card_id', 'card_set_id'],
            ['card_printing.card_id', 'card_printing.card_set_id'],
            name=op.f('fk_card_copy_card_id_card_set_id_card_printing'),
        ),
        sa.ForeignKeyConstraint(
            ['language_code'],
            ['language.code'],
            name=op.f('fk_card_copy_language_code_language'),
        ),
        sa.PrimaryKeyConstraint(
            'card_id', 'language_code', 'card_set_id', name=op.f('pk_card_copy')
        ),
    )

    op.create_table(
        'deck_card',
        sa.Column('deck_id', sa.Integer(), nullable=False),
        sa.Column('card_id', sa.Integer(), nullable=False),
        sa.Column('language_code', sa.String(length=8), nullable=False),
        sa.Column('card_set_id', sa.Integer(), nullable=False),
        sa.Column('quantity', sa.Integer(), nullable=False),
        sa.Column('proxy_quantity', sa.Integer(), nullable=False),
        sa.CheckConstraint(
            'proxy_quantity >= 0 AND proxy_quantity <= quantity',
            name=op.f('ck_deck_card_proxy_quantity_within_quantity'),
        ),
        sa.CheckConstraint('quantity >= 1', name=op.f('ck_deck_card_quantity_positive')),
        sa.ForeignKeyConstraint(
            ['card_id', 'language_code', 'card_set_id'],
            ['card_copy.card_id', 'card_copy.language_code', 'card_copy.card_set_id'],
            name=op.f('fk_deck_card_card_id_language_code_card_set_id_card_copy'),
        ),
        sa.ForeignKeyConstraint(
            ['deck_id'],
            ['deck.id'],
            name=op.f('fk_deck_card_deck_id_deck'),
            ondelete='CASCADE',
        ),
        sa.PrimaryKeyConstraint(
            'deck_id',
            'card_id',
            'language_code',
            'card_set_id',
            name=op.f('pk_deck_card'),
        ),
    )
    op.create_index(
        'ix_deck_card_card_id_language_code_card_set_id',
        'deck_card',
        ['card_id', 'language_code', 'card_set_id'],
        unique=False,
    )

    op.create_table(
        'deleted_deck_card',
        sa.Column('deck_id', sa.Integer(), nullable=False),
        sa.Column('card_id', sa.Integer(), nullable=False),
        sa.Column('language_code', sa.String(length=8), nullable=False),
        sa.Column('card_set_id', sa.Integer(), nullable=False),
        sa.Column('quantity', sa.Integer(), nullable=False),
        sa.Column('proxy_quantity', sa.Integer(), nullable=False),
        sa.CheckConstraint(
            'quantity >= 1', name=op.f('ck_deleted_deck_card_quantity_positive')
        ),
        sa.CheckConstraint(
            'proxy_quantity >= 0 AND proxy_quantity <= quantity',
            name=op.f('ck_deleted_deck_card_proxy_quantity_within_quantity'),
        ),
        sa.ForeignKeyConstraint(
            ['card_id'],
            ['card.id'],
            name=op.f('fk_deleted_deck_card_card_id_card'),
        ),
        sa.ForeignKeyConstraint(
            ['card_set_id'],
            ['card_set.id'],
            name=op.f('fk_deleted_deck_card_card_set_id_card_set'),
        ),
        sa.ForeignKeyConstraint(
            ['deck_id'],
            ['deck.id'],
            name=op.f('fk_deleted_deck_card_deck_id_deck'),
            ondelete='CASCADE',
        ),
        sa.ForeignKeyConstraint(
            ['language_code'],
            ['language.code'],
            name=op.f('fk_deleted_deck_card_language_code_language'),
        ),
        sa.PrimaryKeyConstraint(
            'deck_id',
            'card_id',
            'language_code',
            'card_set_id',
            name=op.f('pk_deleted_deck_card'),
        ),
    )


def downgrade() -> None:
    _require_empty_collection('downgrade')

    _drop_collection_tables()

    # Les trois tables telles que la révision 6c9a178b7a1d les laisse : même
    # DDL, mêmes noms de contraintes, même ordre de colonnes. `card_copy` sans
    # `proxy_allowed` (retiré par 6c9a178b7a1d) ; `deck_card` comme la révision
    # initiale ; `deleted_deck_card` comme 5dc50e3c1701.
    op.create_table(
        'card_copy',
        sa.Column('card_id', sa.Integer(), nullable=False),
        sa.Column('language_code', sa.String(length=8), nullable=False),
        sa.Column('quantity_owned', sa.Integer(), nullable=False),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.CheckConstraint(
            'quantity_owned >= 0', name=op.f('ck_card_copy_quantity_owned_positive')
        ),
        sa.ForeignKeyConstraint(
            ['card_id'], ['card.id'], name=op.f('fk_card_copy_card_id_card')
        ),
        sa.ForeignKeyConstraint(
            ['language_code'],
            ['language.code'],
            name=op.f('fk_card_copy_language_code_language'),
        ),
        sa.PrimaryKeyConstraint(
            'card_id', 'language_code', name=op.f('pk_card_copy')
        ),
    )

    op.create_table(
        'deck_card',
        sa.Column('deck_id', sa.Integer(), nullable=False),
        sa.Column('card_id', sa.Integer(), nullable=False),
        sa.Column('language_code', sa.String(length=8), nullable=False),
        sa.Column('quantity', sa.Integer(), nullable=False),
        sa.Column('proxy_quantity', sa.Integer(), nullable=False),
        sa.CheckConstraint(
            'proxy_quantity >= 0 AND proxy_quantity <= quantity',
            name=op.f('ck_deck_card_proxy_quantity_within_quantity'),
        ),
        sa.CheckConstraint('quantity >= 1', name=op.f('ck_deck_card_quantity_positive')),
        sa.ForeignKeyConstraint(
            ['card_id', 'language_code'],
            ['card_copy.card_id', 'card_copy.language_code'],
            name=op.f('fk_deck_card_card_id_language_code_card_copy'),
        ),
        sa.ForeignKeyConstraint(
            ['deck_id'],
            ['deck.id'],
            name=op.f('fk_deck_card_deck_id_deck'),
            ondelete='CASCADE',
        ),
        sa.PrimaryKeyConstraint(
            'deck_id', 'card_id', 'language_code', name=op.f('pk_deck_card')
        ),
    )
    op.create_index(
        'ix_deck_card_card_id_language_code',
        'deck_card',
        ['card_id', 'language_code'],
        unique=False,
    )

    op.create_table(
        'deleted_deck_card',
        sa.Column('deck_id', sa.Integer(), nullable=False),
        sa.Column('card_id', sa.Integer(), nullable=False),
        sa.Column('language_code', sa.String(length=8), nullable=False),
        sa.Column('quantity', sa.Integer(), nullable=False),
        sa.Column('proxy_quantity', sa.Integer(), nullable=False),
        sa.CheckConstraint(
            'quantity >= 1', name=op.f('ck_deleted_deck_card_quantity_positive')
        ),
        sa.CheckConstraint(
            'proxy_quantity >= 0 AND proxy_quantity <= quantity',
            name=op.f('ck_deleted_deck_card_proxy_quantity_within_quantity'),
        ),
        sa.ForeignKeyConstraint(
            ['card_id'],
            ['card.id'],
            name=op.f('fk_deleted_deck_card_card_id_card'),
        ),
        sa.ForeignKeyConstraint(
            ['deck_id'],
            ['deck.id'],
            name=op.f('fk_deleted_deck_card_deck_id_deck'),
            ondelete='CASCADE',
        ),
        sa.ForeignKeyConstraint(
            ['language_code'],
            ['language.code'],
            name=op.f('fk_deleted_deck_card_language_code_language'),
        ),
        sa.PrimaryKeyConstraint(
            'deck_id', 'card_id', 'language_code', name=op.f('pk_deleted_deck_card')
        ),
    )

    with op.batch_alter_table(
        'sync_operation', schema=None, recreate='never'
    ) as batch_op:
        batch_op.drop_column('card_set_id')

    with op.batch_alter_table('card_set', schema=None, recreate='never') as batch_op:
        batch_op.drop_column('is_placeholder')
