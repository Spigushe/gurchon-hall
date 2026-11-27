"""Nom à afficher du compte

Dix-neuvième révision, seconde de la v1.2.2 (`docs/v1.2.2-plan.md`, A9). Elle
ajoute `user_account.display_name` (`VARCHAR(64)`, nullable) : le nom que
l'utilisateur choisit, depuis l'écran Compte, pour signer sa ligne dans un
compte-rendu de tournoi (P4). Ce n'est pas le « Moi » du carnet, qui reste un
joueur renommable du Lot 7, ni le nom d'utilisateur, handle public de
connexion. Le schéma d'entrée rogne la saisie et en fait NULL si elle est vide,
si bien qu'une valeur en base n'est jamais blanche.

**`ADD COLUMN`, sans recréer la table**, sur le patron de R12, R14 et R15 :
SQLite ajoute en place une colonne nullable sans valeur par défaut, sans
recopier les lignes. `user_account` est visée par les clés étrangères de toutes
les données privées : la recréer aurait obligé à les recopier toutes. Aucune
donnée n'est convertie : tout compte existant reste sans nom, et ses
comptes-rendus gardent `@pseudo` (A12). Pas d'index : le serveur ne cherche
jamais un compte par ce champ, et il n'est pas unique. La montée n'a pas de
garde et **se rend hors ligne** (`upgrade e6d2a4b8c1f5:f7a3c9e1b5d2 --sql`).

**Descente** : `ALTER TABLE user_account DROP COLUMN` (SQLite 3.35 ou plus),
refusée (`RuntimeError`, avant toute modification, nombre cité) dès qu'un
compte a un nom à afficher : c'est une saisie de l'utilisateur, qu'aucune
nouvelle montée ne rétablirait, comme le lien VDB de R14. Elle ne se rend donc
pas hors ligne, comme celles de R14 et R18 : sa garde lit la base. Un nom déjà
figé dans une version de compte-rendu (`my_display_name` de l'instantané) ne
dépend pas de la colonne et survit à la descente.

Revision ID: f7a3c9e1b5d2
Revises: e6d2a4b8c1f5
Create Date: 2026-11-27 14:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import context, op

# Identifiants de révision utilisés par Alembic.
revision: str = 'f7a3c9e1b5d2'
down_revision: str | Sequence[str] | None = 'e6d2a4b8c1f5'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _require_no_display_name() -> None:
    """Refuse la descente dès qu'un compte a un nom à afficher. Précède toute
    modification ; ne se rend pas hors ligne, puisqu'elle lit la base."""
    if context.is_offline_mode():
        raise RuntimeError(
            'Migration f7a3c9e1b5d2 (downgrade) : ce sens ne se rend pas hors '
            "ligne (`--sql`). Il doit d'abord vérifier qu'aucun compte n'a de "
            'nom à afficher. Redescendez sur une connexion réelle. La montée, '
            'elle, se rend hors ligne.'
        )
    bind = op.get_bind()
    named = bind.execute(
        sa.text('SELECT COUNT(*) FROM user_account WHERE display_name IS NOT NULL')
    ).scalar_one()
    if not named:
        return
    raise RuntimeError(
        'Migration f7a3c9e1b5d2 (downgrade) interrompue avant toute '
        f'modification : {named} compte(s) ont un nom à afficher. Ce nom est '
        "une saisie de l'utilisateur, que rien ne rétablirait après une "
        'nouvelle montée ; effacez-le depuis l\'écran Compte ou renoncez à '
        'redescendre sous la v1.2.2.'
    )


def upgrade() -> None:
    """Ajoute `user_account.display_name`, nullable, vide partout."""
    op.add_column(
        'user_account',
        sa.Column('display_name', sa.String(length=64), nullable=True),
    )


def downgrade() -> None:
    """Retire la colonne, refusé si un compte a un nom à afficher."""
    _require_no_display_name()
    op.drop_column('user_account', 'display_name')
