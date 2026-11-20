"""Appareil et dernière utilisation des sessions

Quinzième révision, seule du Lot 12 (`docs/lot12-plan-consolidation.md`, P1,
P10, A2, étape A1). Elle ajoute deux colonnes nullables à `auth_session` :

* `user_agent` (`VARCHAR(256)`), l'en-tête `User-Agent` de la connexion ou de
  l'inscription qui a ouvert la session, pour que l'écran Compte dise d'où
  vient chaque session (« Chrome sur Android ») ;
* `last_used_at` (date-heure UTC naïve, comme toutes celles du modèle), la
  dernière utilisation notée, que le renouvellement des sessions (A10) écrit
  au plus une fois par jour.

**`ADD COLUMN`, sans recréer la table**, sur le patron de R12 et R14 : SQLite
ajoute une colonne nullable sans valeur par défaut en place, sans recopier
les lignes. Aucune donnée n'est convertie : une session ouverte avant le lot
garde `user_agent` à NULL (« appareil inconnu »), et `last_used_at` à NULL se
lit comme `created_at`. Le CHECK `expires_after_creation` n'est pas touché ;
une échéance repoussée par le renouvellement reste postérieure à la création.
Pas d'index : le serveur ne cherche jamais une session par ces champs.

**Montée et descente se rendent hors ligne**
(`upgrade 5f2b8e9d0c41:c4e8a1f2d7b3 --sql`, et l'inverse). La descente retire
les deux colonnes **sans garde** : l'appareil et la dernière utilisation ne
sont pas des saisies de l'utilisateur, l'une se perd sans dommage et l'autre
se reconstitue à l'usage. Les sessions elles-mêmes restent valides, à leur
échéance du moment.

C'est la première révision appliquée à la base de production (v1.0.0 en
ligne depuis le 2026-11-17) : le playbook sauvegarde la base avant de migrer,
et un essai sur une copie de la base servie précède la mise en production
(étape F).

Revision ID: c4e8a1f2d7b3
Revises: 5f2b8e9d0c41
Create Date: 2026-11-18 10:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# Identifiants de révision utilisés par Alembic.
revision: str = 'c4e8a1f2d7b3'
down_revision: str | Sequence[str] | None = '5f2b8e9d0c41'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Ajoute `auth_session.user_agent` puis `last_used_at`, nullables, vides."""
    op.add_column(
        'auth_session',
        sa.Column('user_agent', sa.String(length=256), nullable=True),
    )
    op.add_column(
        'auth_session',
        sa.Column('last_used_at', sa.DateTime(), nullable=True),
    )


def downgrade() -> None:
    """Retire les deux colonnes, sans garde : rien n'y est une saisie."""
    op.drop_column('auth_session', 'last_used_at')
    op.drop_column('auth_session', 'user_agent')
