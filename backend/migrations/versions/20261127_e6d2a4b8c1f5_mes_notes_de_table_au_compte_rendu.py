"""Mes notes de table au compte-rendu

Dix-huitième révision, seule de la v1.2.2 (`docs/v1.2.2-plan.md`, A8). Elle
ajoute `tournament_report.include_my_notes`, booléen non nul, vrai par défaut :
la case « Inclure mes notes de table » des options du compte-rendu. Cochée,
l'instantané porte la note de ma ligne (`participation.notes` du « Moi »),
comme il le faisait sans condition depuis le lot Compte-rendu ; décochée, il
l'omet. Le réglage vit chez le serveur, qui construit l'instantané, comme
`include_opponent_notes`.

**`ADD COLUMN`, sans recréer la table**, sur le patron de R12, R14 et R15 :
SQLite ajoute en place une colonne `NOT NULL` dès qu'elle a une valeur par
défaut, sans recopier les lignes. Aucune donnée n'est convertie : un
compte-rendu existant prend la valeur par défaut, vraie, si bien que sa
prochaine version est identique à ce qu'elle aurait été avant la révision (la
v1.2.2 ne fait couper aucune version d'elle-même). Pas d'index : le serveur ne
cherche jamais un compte-rendu par ce champ. La montée n'a pas de garde et
**se rend hors ligne** (`upgrade b3f1c7a9e2d4:e6d2a4b8c1f5 --sql`).

**Descente** : `ALTER TABLE tournament_report DROP COLUMN` (SQLite 3.35 ou
plus), refusée (`RuntimeError`, avant toute modification, nombre cité) dès
qu'un compte-rendu a la case décochée : c'est la seule valeur qu'elle
perdrait, un choix de l'utilisateur qu'aucune nouvelle montée ne rétablirait.
Elle ne se rend donc pas hors ligne, comme celle de R14 : sa garde lit la
base.

Revision ID: e6d2a4b8c1f5
Revises: b3f1c7a9e2d4
Create Date: 2026-11-27 10:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import context, op

# Identifiants de révision utilisés par Alembic.
revision: str = 'e6d2a4b8c1f5'
down_revision: str | Sequence[str] | None = 'b3f1c7a9e2d4'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _require_my_notes_everywhere() -> None:
    """Refuse la descente dès qu'un compte-rendu exclut mes notes de table.
    Précède toute modification ; ne se rend pas hors ligne, puisqu'elle lit la
    base."""
    if context.is_offline_mode():
        raise RuntimeError(
            'Migration e6d2a4b8c1f5 (downgrade) : ce sens ne se rend pas hors '
            "ligne (`--sql`). Il doit d'abord vérifier qu'aucun compte-rendu "
            "n'exclut les notes de table de son auteur. Redescendez sur une "
            'connexion réelle. La montée, elle, se rend hors ligne.'
        )
    bind = op.get_bind()
    excluded = bind.execute(
        sa.text(
            'SELECT COUNT(*) FROM tournament_report WHERE include_my_notes = 0'
        )
    ).scalar_one()
    if not excluded:
        return
    raise RuntimeError(
        'Migration e6d2a4b8c1f5 (downgrade) interrompue avant toute '
        f'modification : {excluded} compte(s)-rendu(s) excluent les notes de '
        "table de leur auteur. Ce réglage est un choix de l'utilisateur, que "
        'rien ne rétablirait après une nouvelle montée (la case reviendrait '
        'cochée) ; recochez-la ou renoncez à redescendre sous la v1.2.2.'
    )


def upgrade() -> None:
    """Ajoute `tournament_report.include_my_notes`, non nul, vrai par défaut."""
    op.add_column(
        'tournament_report',
        sa.Column(
            'include_my_notes',
            sa.Boolean(),
            server_default=sa.true(),
            nullable=False,
        ),
    )


def downgrade() -> None:
    """Retire la colonne, refusé si un compte-rendu a la case décochée."""
    _require_my_notes_everywhere()
    op.drop_column('tournament_report', 'include_my_notes')
