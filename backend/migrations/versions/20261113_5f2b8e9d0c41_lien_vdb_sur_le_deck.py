"""Lien VDB sur le deck

Quatorzième révision, seule du Lot 9 (`docs/lot9-plan-import-vdb.md`, A6,
étape A1). Elle ajoute `deck.vdb_deck_id`, texte nullable de 64 caractères au
plus : l'identifiant du deck VDB dont un deck a été importé par son adresse
(`vdb.im/decks/<id>`). Le deck garde ce lien pour se **mettre à jour depuis
VDB** (P7, P8) ; l'adresse se reconstruit à partir de lui.

**Ni index, ni unicité, ni CHECK.** Le serveur ne cherche jamais un deck par
ce champ (le client le retrouve dans son miroir), et deux decks liés au même
deck VDB restent possibles, saisis sur deux appareils hors ligne. Le motif de
l'identifiant (lettres, chiffres, `:`, `-`, `_`) est vérifié par le schéma
d'écriture, seul chemin d'entrée, comme les bornes de texte du reste du
contrat ; un CHECK obligerait à recréer `deck`, visée par quatre clés
étrangères.

**`ADD COLUMN`, sans recréer la table**, sur le patron de R12 : SQLite ajoute
une colonne nullable sans valeur par défaut en place, sans recopier les
lignes. Aucune donnée n'est convertie, la colonne naît vide. La montée n'a pas
de garde et **se rend hors ligne** (`upgrade ac6cda5ad252:5f2b8e9d0c41 --sql`).

**Descente** : `ALTER TABLE deck DROP COLUMN` (SQLite 3.35 ou plus), refusée
(`RuntimeError`, avant toute modification, decks cités) dès qu'un deck porte
un lien. Contrairement à l'exigence de R12, qu'un rejeu de l'import
rétablissait, le lien est une donnée de l'utilisateur : rien ne le
reconstruirait. Elle ne se rend donc pas hors ligne, comme celles de R10 et
R13 : sa garde lit la base.

Revision ID: 5f2b8e9d0c41
Revises: ac6cda5ad252
Create Date: 2026-11-13 15:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import context, op

# Identifiants de révision utilisés par Alembic.
revision: str = '5f2b8e9d0c41'
down_revision: str | Sequence[str] | None = 'ac6cda5ad252'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Au plus autant de decks cités dans le message de refus : le nombre total est
# toujours donné.
LISTED_DECKS = 10


def _require_no_linked_deck() -> None:
    """Refuse la descente dès qu'un deck est lié à VDB. Précède toute
    modification ; ne se rend pas hors ligne, puisqu'elle lit la base."""
    if context.is_offline_mode():
        raise RuntimeError(
            'Migration 5f2b8e9d0c41 (downgrade) : ce sens ne se rend pas hors '
            "ligne (`--sql`). Il doit d'abord vérifier qu'aucun deck n'est lié "
            'à VDB. Redescendez sur une connexion réelle. La montée, elle, se '
            'rend hors ligne.'
        )
    bind = op.get_bind()
    linked = bind.execute(
        sa.text(
            'SELECT id, name, discriminator, vdb_deck_id FROM deck'
            ' WHERE vdb_deck_id IS NOT NULL ORDER BY id'
        )
    ).all()
    if not linked:
        return
    listed = ', '.join(
        f'{name}#{discriminator} (deck {deck_id}, VDB {vdb_deck_id})'
        for deck_id, name, discriminator, vdb_deck_id in linked[:LISTED_DECKS]
    )
    more = len(linked) - LISTED_DECKS
    if more > 0:
        listed += f', et {more} de plus'
    raise RuntimeError(
        'Migration 5f2b8e9d0c41 (downgrade) interrompue avant toute '
        f'modification : {len(linked)} deck(s) lié(s) à VDB : {listed}. Le '
        "lien est une donnée de l'utilisateur, que rien ne reconstruirait "
        'après une nouvelle montée ; on ne redescend pas sous le Lot 9 une '
        'fois un deck importé par son adresse VDB.'
    )


def upgrade() -> None:
    """Ajoute `deck.vdb_deck_id`, nullable, vide."""
    op.add_column(
        'deck', sa.Column('vdb_deck_id', sa.String(length=64), nullable=True)
    )


def downgrade() -> None:
    """Retire la colonne, refusé si un deck est lié à VDB."""
    _require_no_linked_deck()
    op.drop_column('deck', 'vdb_deck_id')
