"""Exigence des cartes de bibliothèque

Douzième révision, seule du lot Chercher (`docs/lot-chercher-plan.md`, A3,
étape A1). Elle ajoute `card.library_requirement`, texte nullable : la recopie
brute de la colonne `Requirement` de `vteslibmeta.csv` (dépôt vtescsv), ce
qu'une carte de bibliothèque exige du vampire qui la joue (« prince,justicar »,
« sabbat,titled », « capacity 5 or more »…). krcg ne publie pas cette donnée ;
l'import la lit dans ce fichier, seconde source à côté de krcg (P15).

**Une colonne brute, aucune table.** Le découpage en sectes exigées, titres
exigés et autres valeurs est une lecture faite par le serveur à chaque sortie
de `GET /cartes` (`vtes_rules.library_requirement`), sur le modèle de
`latest_card_set_id` : la règle « un titre implique sa secte » s'écrit une
fois, côté serveur, et le client ne compare que des listes. Deux tables de
liaison auraient permis des requêtes et des contraintes en base pour des
filtres qui ne tournent que dans le client (P5). Le modèle reste à 25 tables.

La secte des cartes de crypte, dérivée du texte (P13), n'a pas besoin de
migration : la table `sect` et `card.sect_id` existent depuis la révision
initiale.

**`ADD COLUMN`, sans recréer la table.** SQLite ajoute une colonne nullable
sans valeur par défaut en place, sans recopier les lignes : la forme la plus
sûre ici. Recréer `card` à la main, comme R7 et R9 à R11 le font pour leurs
tables, toucherait une table que six clés étrangères visent (stock, decklists
figées, impressions, traductions, liens de types et de disciplines ; les
lignes de deck la visent à travers `card_printing`), pour rien : aucune
contrainte ne change. Le mode batch d'Alembic n'est pas utilisé non plus.

**Aucune donnée n'est convertie** : la colonne naît vide, et c'est le rejeu
de l'import (`scripts/import_catalog.py`) qui la remplit. La montée n'a pas de
garde et **se rend hors ligne** (`upgrade e2a7819dd4a2:8ab23342a26f --sql`).

**Descente** : `ALTER TABLE card DROP COLUMN` (SQLite 3.35 ou plus), sans
garde, hors ligne elle aussi. Elle perd les exigences importées, sciemment :
ce n'est pas une donnée de l'utilisateur mais la copie d'une source publique,
qu'un rejeu de l'import rétablit après une nouvelle montée. Une garde de
vacuité rendrait la descente impossible dès le premier import.

Revision ID: 8ab23342a26f
Revises: e2a7819dd4a2
Create Date: 2026-11-03 15:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# Identifiants de révision utilisés par Alembic.
revision: str = '8ab23342a26f'
down_revision: str | Sequence[str] | None = 'e2a7819dd4a2'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Ajoute `card.library_requirement`, nullable, vide."""
    op.add_column(
        'card', sa.Column('library_requirement', sa.Text(), nullable=True)
    )


def downgrade() -> None:
    """Retire la colonne, et les exigences importées avec elle."""
    op.drop_column('card', 'library_requirement')
