"""Proxy autorisé au niveau du deck

Ouvre le Lot 4 (passe A) : l'autorisation de jouer des proxies quitte l'entrée
de collection pour le deck. Elle dépend du tournoi auquel le deck est destiné,
pas de la carte ni de l'exemplaire possédé (CLAUDE.md §5, §11).

* `deck.proxy_allowed` — booléen NOT NULL, `false` par défaut, côté ORM comme
  côté base (`server_default`) ;
* `card_copy.proxy_allowed` — supprimé.

**Aucune conversion de données** (décision D3 du Lot 4,
`docs/lot4-plan-inventaire.md`). Hors catalogue, la base de l'unique
utilisateur est vide au moment du lot : plutôt que de porter un code de reprise
jamais exécuté (quel deck hériterait de quel droit de proxy ?), la révision
vérifie que `card_copy`, `deck_card` et `deleted_deck_card` sont vides et
s'arrête sur un message explicite sinon. Le `downgrade` suit la même règle.
Choix de pilote : sur barrins-project, il y aura des données à reprendre.

Pas de recréation de table à la montée : deux `ALTER TABLE` simples, en mode
batch `recreate='never'` (voir `upgrade`). La descente recrée `card_copy` à
l'identique de la révision initiale, ce que sa vacuité permet. La révision ne
se rejoue pas hors ligne (`--sql`) : la vérification de vacuité lit la base.

Revision ID: 6c9a178b7a1d
Revises: 8cc70f4bbbcc
Create Date: 2026-09-24 10:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# Identifiants de révision utilisés par Alembic.
revision: str = '6c9a178b7a1d'
down_revision: str | Sequence[str] | None = '8cc70f4bbbcc'
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
            f"Migration 6c9a178b7a1d ({direction}) interrompue : elle ne convertit "
            f"aucune donnée et exige que card_copy, deck_card et deleted_deck_card "
            f"soient vides (décision D3 du Lot 4, docs/lot4-plan-inventaire.md). "
            f"Tables non vides : {detail}. Videz-les (ou repartez d'une base "
            f"neuve) avant de relancer."
        )


def upgrade() -> None:
    _require_empty_collection('upgrade')

    # `recreate='never'` sur les deux tables : un `ALTER TABLE` simple suffit
    # (`ADD COLUMN` avec défaut, `DROP COLUMN` d'une colonne sans contrainte ni
    # index, SQLite ≥ 3.35), et il est déterministe. La recréation du mode
    # batch, elle, recopie les contraintes dans un ordre qui varie d'un
    # processus à l'autre (itération d'un ensemble) : le DDL obtenu changeait
    # d'une exécution à la suivante.
    with op.batch_alter_table('deck', schema=None, recreate='never') as batch_op:
        batch_op.add_column(
            sa.Column(
                'proxy_allowed',
                sa.Boolean(),
                server_default=sa.false(),
                nullable=False,
            )
        )

    with op.batch_alter_table('card_copy', schema=None, recreate='never') as batch_op:
        batch_op.drop_column('proxy_allowed')


def downgrade() -> None:
    _require_empty_collection('downgrade')

    # Un `ALTER TABLE ADD COLUMN` ne sait ni placer la colonne après
    # `quantity_owned` ni l'ajouter NOT NULL sans défaut. La table étant vide
    # (vérifié ci-dessus), on la recrée telle que la révision initiale la
    # définit, à l'identique : même DDL, mêmes noms de contraintes, même ordre.
    # Les clés étrangères de `deck_card` vers elle sont coupées le temps de la
    # migration (`migrations/env.py`) et vérifiées ensuite.
    op.drop_table('card_copy')
    op.create_table(
        'card_copy',
        sa.Column('card_id', sa.Integer(), nullable=False),
        sa.Column('language_code', sa.String(length=8), nullable=False),
        sa.Column('quantity_owned', sa.Integer(), nullable=False),
        sa.Column('proxy_allowed', sa.Boolean(), nullable=False),
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

    with op.batch_alter_table('deck', schema=None, recreate='never') as batch_op:
        batch_op.drop_column('proxy_allowed')
