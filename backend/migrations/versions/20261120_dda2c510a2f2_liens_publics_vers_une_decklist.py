"""Liens publics vers une decklist

Seizième révision, seule du Lot 13 (`docs/lot13-plan-partage.md`, P1, P3, A2,
étape A1). Elle crée deux tables, sans toucher aux tables existantes :

* `deck_share` — un lien public vers la liste d'un deck, lu sans session par
  son jeton (`GET /listes/{token}`). `id` en `AUTOINCREMENT` (un lien se purge
  physiquement, et un identifiant purgé n'est jamais réattribué, cf. R11) ;
  `user_id` et `deck_id`, sous la clé composite (`deck_id`, `user_id`) vers
  `deck` ; `token`, huit caractères de `[A-Za-z0-9_]` en clair, unique, sous le
  CHECK `ck_deck_share_token_format` ; `kind` (`live` ou `frozen`, CHECK
  `ck_deck_share_deck_share_kind`) ; `show_notes` ; `created_at` ; pour un
  figé, `frozen_name`, `frozen_archetype` (les six archétypes, CHECK
  `ck_deck_share_deck_archetype`), `frozen_notes` et `deck_version_id`, sous
  la clé composite (`deck_version_id`, `deck_id`, `user_id`) vers
  `deck_version`, comme `participation`. Le CHECK
  `ck_deck_share_frozen_fields_match_kind` interdit ces quatre champs à un
  vivant et exige le nom copié d'un figé. Index (`user_id`, `deck_id`) pour
  les liens d'un compte et ceux d'un deck ;
* `deck_share_card` — carte × quantité (≥ 1) de la liste copiée d'un figé,
  clé primaire (`deck_share_id`, `card_id`), clé étrangère vers `card`
  seulement (une liste figée ne réserve rien, comme `deck_version_card`),
  supprimée avec son lien (`ON DELETE CASCADE`).

Le modèle passe à 30 tables et seize révisions.

**Aucune conversion** : deux tables neuves, nées vides. La montée n'a pas de
garde et **se rend hors ligne** (`upgrade c4e8a1f2d7b3:dda2c510a2f2 --sql`).

**Descente** : refusée (`RuntimeError`, avant toute modification, nombre de
liens cité) dès qu'un lien existe : un lien est une saisie de l'utilisateur,
déjà envoyé à des tiers, que rien ne reconstruirait (patron de R14). Sinon,
elle supprime les deux tables. Elle ne se rend donc pas hors ligne, comme
celles de R10, R13 et R14 : sa garde lit la base (écart à A2, qui la voulait
hors ligne aussi).

Seconde révision appliquée à la base de production, après un essai sur une
copie de la base servie, comme R15 (étape F).

Revision ID: dda2c510a2f2
Revises: c4e8a1f2d7b3
Create Date: 2026-11-20 10:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import context, op

# Identifiants de révision utilisés par Alembic.
revision: str = 'dda2c510a2f2'
down_revision: str | Sequence[str] | None = 'c4e8a1f2d7b3'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Ordre de `app.models.enums.DeckArchetype` et `DeckShareKind`, que reproduit
# le texte des CHECK.
ARCHETYPES = ('bleed', 'vote', 'wall', 'toolbox', 'rush', 'combo')
SHARE_KINDS = ('live', 'frozen')

SHARE_INDEX = 'ix_deck_share_user_id_deck_id'


def _enum(name: str, values: Sequence[str]) -> sa.Enum:
    return sa.Enum(*values, name=name, native_enum=False, create_constraint=True)


def _create_deck_share() -> None:
    op.create_table(
        'deck_share',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('deck_id', sa.Integer(), nullable=False),
        sa.Column('token', sa.String(length=8), nullable=False),
        sa.Column('kind', _enum('deck_share_kind', SHARE_KINDS), nullable=False),
        sa.Column(
            'show_notes',
            sa.Boolean(),
            server_default=sa.false(),
            nullable=False,
        ),
        sa.Column(
            'created_at',
            sa.DateTime(),
            server_default=sa.text('(CURRENT_TIMESTAMP)'),
            nullable=False,
        ),
        sa.Column('frozen_name', sa.String(length=120), nullable=True),
        sa.Column(
            'frozen_archetype', _enum('deck_archetype', ARCHETYPES), nullable=True
        ),
        sa.Column('frozen_notes', sa.Text(), nullable=True),
        sa.Column('deck_version_id', sa.Integer(), nullable=True),
        sa.CheckConstraint(
            "length(token) = 8 AND token NOT GLOB '*[^A-Za-z0-9_]*'",
            name=op.f('ck_deck_share_token_format'),
        ),
        sa.CheckConstraint(
            "(kind = 'live' AND frozen_name IS NULL AND frozen_archetype IS NULL "
            "AND frozen_notes IS NULL AND deck_version_id IS NULL) "
            "OR (kind = 'frozen' AND frozen_name IS NOT NULL)",
            name=op.f('ck_deck_share_frozen_fields_match_kind'),
        ),
        sa.ForeignKeyConstraint(
            ['deck_id', 'user_id'],
            ['deck.id', 'deck.user_id'],
            name=op.f('fk_deck_share_deck_id_user_id_deck'),
        ),
        sa.ForeignKeyConstraint(
            ['deck_version_id', 'deck_id', 'user_id'],
            ['deck_version.id', 'deck_version.deck_id', 'deck_version.user_id'],
            name=op.f('fk_deck_share_deck_version_id_deck_id_user_id_deck_version'),
        ),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_deck_share')),
        sa.UniqueConstraint('token', name=op.f('uq_deck_share_token')),
        sqlite_autoincrement=True,
    )
    op.create_index(
        op.f(SHARE_INDEX), 'deck_share', ['user_id', 'deck_id'], unique=False
    )


def _create_deck_share_card() -> None:
    op.create_table(
        'deck_share_card',
        sa.Column('deck_share_id', sa.Integer(), nullable=False),
        sa.Column('card_id', sa.Integer(), nullable=False),
        sa.Column('quantity', sa.Integer(), nullable=False),
        sa.CheckConstraint(
            'quantity >= 1', name=op.f('ck_deck_share_card_quantity_positive')
        ),
        sa.ForeignKeyConstraint(
            ['deck_share_id'],
            ['deck_share.id'],
            name=op.f('fk_deck_share_card_deck_share_id_deck_share'),
            ondelete='CASCADE',
        ),
        sa.ForeignKeyConstraint(
            ['card_id'],
            ['card.id'],
            name=op.f('fk_deck_share_card_card_id_card'),
        ),
        sa.PrimaryKeyConstraint(
            'deck_share_id', 'card_id', name=op.f('pk_deck_share_card')
        ),
    )


def _require_no_share() -> None:
    """Refuse la descente dès qu'un lien existe. Précède toute modification ;
    ne se rend pas hors ligne, puisqu'elle lit la base."""
    if context.is_offline_mode():
        raise RuntimeError(
            'Migration dda2c510a2f2 (downgrade) : ce sens ne se rend pas hors '
            "ligne (`--sql`). Il doit d'abord vérifier qu'aucun lien public "
            "n'existe. Redescendez sur une connexion réelle. La montée, elle, "
            'se rend hors ligne.'
        )
    bind = op.get_bind()
    count = bind.execute(sa.text('SELECT COUNT(*) FROM deck_share')).scalar_one()
    if not count:
        return
    raise RuntimeError(
        'Migration dda2c510a2f2 (downgrade) interrompue avant toute '
        f'modification : {count} lien(s) public(s) vers une decklist. Un lien '
        "est une saisie de l'utilisateur, peut-être déjà envoyé, que rien ne "
        'reconstruirait après une nouvelle montée ; purgez les liens '
        '(`DELETE /moi/partages`) avant de redescendre sous le Lot 13.'
    )


def upgrade() -> None:
    """Crée `deck_share` puis `deck_share_card`, vides."""
    _create_deck_share()
    _create_deck_share_card()


def downgrade() -> None:
    """Supprime les deux tables, refusé s'il existe un lien."""
    _require_no_share()
    op.drop_table('deck_share_card')
    op.drop_index(op.f(SHARE_INDEX), table_name='deck_share')
    op.drop_table('deck_share')
