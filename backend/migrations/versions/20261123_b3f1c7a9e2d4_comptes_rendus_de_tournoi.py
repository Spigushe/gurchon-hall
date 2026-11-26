"""Comptes-rendus de tournoi

Dix-septième révision, seule du lot Compte-rendu
(`docs/lot-compte-rendu-plan.md`, A2). Elle crée deux tables, sans toucher aux
tables existantes :

* `tournament_report` — le compte-rendu d'un tournoi, au plus un par tournoi
  (unicité de `tournament_id`). `id` en `AUTOINCREMENT` (un compte-rendu se
  supprime physiquement, cf. R11) ; `user_id` et `tournament_id`, sous la clé
  composite (`tournament_id`, `user_id`) vers `tournament` ; `token`, nul ou
  huit caractères de `[A-Za-z0-9_]` (forme du Lot 13), unique, sous le CHECK
  `ck_tournament_report_token_format` ; `include_opponent_notes` et
  `show_previous_versions`, faux par défaut ; `created_at`. Index sur
  `user_id` pour les comptes-rendus d'un compte ;
* `tournament_report_version` — une version figée : `report_id` (supprimée
  avec son compte-rendu, `ON DELETE CASCADE`), `number` (≥ 1, unique par
  compte-rendu), `created_at` et `snapshot`, l'instantané en JSON canonique.
  `id` en `AUTOINCREMENT`.

Le modèle passe à 32 tables et dix-sept révisions.

**Aucune conversion** : deux tables neuves, nées vides. Aucun type
d'opération `/sync` nouveau, donc `sync_operation` et ses CHECK ne bougent
pas : le compte-rendu passe par `tournament.update` (champ `report`). La
montée n'a pas de garde et **se rend hors ligne**
(`upgrade dda2c510a2f2:b3f1c7a9e2d4 --sql`).

**Descente** : refusée (`RuntimeError`, avant toute modification, nombre cité)
dès qu'un compte-rendu existe : ses versions figent des notes et des tables
que rien ne reconstruirait (patron de R16). Elle ne se rend donc pas hors
ligne.

Revision ID: b3f1c7a9e2d4
Revises: dda2c510a2f2
Create Date: 2026-11-23 10:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import context, op

# Identifiants de révision utilisés par Alembic.
revision: str = 'b3f1c7a9e2d4'
down_revision: str | Sequence[str] | None = 'dda2c510a2f2'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

REPORT_INDEX = 'ix_tournament_report_user_id'


def _create_tournament_report() -> None:
    op.create_table(
        'tournament_report',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('tournament_id', sa.Integer(), nullable=False),
        sa.Column('token', sa.String(length=8), nullable=True),
        sa.Column(
            'include_opponent_notes',
            sa.Boolean(),
            server_default=sa.false(),
            nullable=False,
        ),
        sa.Column(
            'show_previous_versions',
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
        sa.CheckConstraint(
            "token IS NULL OR (length(token) = 8 "
            "AND token NOT GLOB '*[^A-Za-z0-9_]*')",
            name=op.f('ck_tournament_report_token_format'),
        ),
        sa.ForeignKeyConstraint(
            ['tournament_id', 'user_id'],
            ['tournament.id', 'tournament.user_id'],
            name=op.f('fk_tournament_report_tournament_id_user_id_tournament'),
        ),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_tournament_report')),
        sa.UniqueConstraint(
            'tournament_id', name=op.f('uq_tournament_report_tournament_id')
        ),
        sa.UniqueConstraint('token', name=op.f('uq_tournament_report_token')),
        sqlite_autoincrement=True,
    )
    op.create_index(
        op.f(REPORT_INDEX), 'tournament_report', ['user_id'], unique=False
    )


def _create_tournament_report_version() -> None:
    op.create_table(
        'tournament_report_version',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('report_id', sa.Integer(), nullable=False),
        sa.Column('number', sa.Integer(), nullable=False),
        sa.Column(
            'created_at',
            sa.DateTime(),
            server_default=sa.text('(CURRENT_TIMESTAMP)'),
            nullable=False,
        ),
        sa.Column('snapshot', sa.Text(), nullable=False),
        sa.CheckConstraint(
            'number >= 1', name=op.f('ck_tournament_report_version_number_positive')
        ),
        sa.ForeignKeyConstraint(
            ['report_id'],
            ['tournament_report.id'],
            name=op.f('fk_tournament_report_version_report_id_tournament_report'),
            ondelete='CASCADE',
        ),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_tournament_report_version')),
        sa.UniqueConstraint(
            'report_id',
            'number',
            name=op.f('uq_tournament_report_version_report_id_number'),
        ),
        sqlite_autoincrement=True,
    )


def _require_no_report() -> None:
    """Refuse la descente dès qu'un compte-rendu existe. Précède toute
    modification ; ne se rend pas hors ligne, puisqu'elle lit la base."""
    if context.is_offline_mode():
        raise RuntimeError(
            'Migration b3f1c7a9e2d4 (downgrade) : ce sens ne se rend pas hors '
            "ligne (`--sql`). Il doit d'abord vérifier qu'aucun compte-rendu "
            "n'existe. Redescendez sur une connexion réelle. La montée, elle, "
            'se rend hors ligne.'
        )
    bind = op.get_bind()
    count = bind.execute(
        sa.text('SELECT COUNT(*) FROM tournament_report')
    ).scalar_one()
    if not count:
        return
    raise RuntimeError(
        'Migration b3f1c7a9e2d4 (downgrade) interrompue avant toute '
        f'modification : {count} compte(s)-rendu(s) de tournoi. Leurs versions '
        'figent des notes et des tables que rien ne reconstruirait après une '
        'nouvelle montée ; supprimez les comptes-rendus avant de redescendre '
        'sous le lot Compte-rendu.'
    )


def upgrade() -> None:
    """Crée `tournament_report` puis `tournament_report_version`, vides."""
    _create_tournament_report()
    _create_tournament_report_version()


def downgrade() -> None:
    """Supprime les deux tables, refusé s'il existe un compte-rendu."""
    _require_no_report()
    op.drop_table('tournament_report_version')
    op.drop_index(op.f(REPORT_INDEX), table_name='tournament_report')
    op.drop_table('tournament_report')
