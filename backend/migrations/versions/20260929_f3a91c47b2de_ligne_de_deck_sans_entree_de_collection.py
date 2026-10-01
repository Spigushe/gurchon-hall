"""Ligne de deck sans entrée de collection

Septième révision. Une ligne de deck ne pointe plus l'entrée de collection
qu'elle consomme : elle pointe l'impression du catalogue et la langue.

Pourquoi : tant que `deck_card` portait une clé étrangère composite vers
`card_copy`, une ligne entièrement jouée en proxy était **impossible à
écrire**. Elle ne consomme aucun exemplaire réel, donc aucune valeur du champ
`acquired_quantity` ne la faisait passer : 0 butait sur « la carte n'est pas en
collection », et toute valeur supérieure dépassait la borne des exemplaires
réels ajoutés. Le diagnostic complet et la conception retenue (piste A1) sont
dans `docs/issues/2026-09-29-lot4b-ligne-100-pourcent-proxy-refusee.md`.

Ce que la révision change, sur `deck_card` et rien d'autre :

* la clé étrangère `(card_id, language_code, card_set_id)` vers `card_copy`
  disparaît ;
* `(card_id, card_set_id)` pointe `card_printing` — la même contrainte que
  `card_copy` porte déjà, adossée à l'unicité
  `uq_card_printing_card_id_card_set_id` : une ligne de deck reste rangée sous
  une impression réelle du catalogue (décision D2 du Lot 4) ;
* `language_code` pointe `language.code`.

Sans `ondelete`, comme pour `card_copy` : une impression ou une langue jouée
dans un deck ne se supprime pas. La clé primaire, les deux `CHECK` et l'index
`ix_deck_card_card_id_language_code_card_set_id` ne bougent pas — l'index reste
le chemin par lequel le service retrouve les lignes adossées à une entrée de
collection, maintenant que la base ne les relie plus.

**Aucune conversion de données, et aucune garde de vacuité** — contrairement
aux deux révisions du Lot 4, celle-ci s'exécute sur une base peuplée. Toute
ligne de `deck_card` en place référence aujourd'hui une `card_copy`, qui
référence elle-même une `card_printing` et une `language` : les nouvelles
contraintes sont donc satisfaites d'office, sans rien réécrire. La table est
recopiée, pas vidée, et les deux sens le vérifient.

Le `downgrade`, lui, remonte une contrainte plus stricte que les données
peuvent ne plus respecter : une ligne tout-proxy née après cette révision n'a
pas d'entrée de collection en face. Il **refuse** alors de tourner, avec les
coordonnées des lignes fautives, plutôt que de laisser le
`PRAGMA foreign_key_check` de `migrations/env.py` interrompre la migration sur
un message qui ne dit pas quoi corriger. Même choix que les gardes du Lot 4 :
une `RuntimeError` levée avant toute modification, la transaction annulée, la
base laissée à sa révision de départ.

**Recréation explicite plutôt que mode batch.** SQLite ne sait pas modifier une
clé étrangère en place : il faut recréer la table, dans un sens comme dans
l'autre. Le mode batch d'Alembic le ferait, mais il recopie les contraintes
dans l'ordre où il les sort d'un ensemble Python, qui change d'un processus à
l'autre : trois `upgrade head` successifs sur une base neuve donnent bien le
même schéma, mais deux textes de DDL différents (mesuré, et déjà constaté par
la révision `6c9a178b7a1d`, qui l'avait contourné par un `recreate='never'`).
Un aller-retour comparé au texte près ne serait donc vert qu'une fois sur deux.
D'où la séquence écrite à la main ci-dessous : l'ancienne table est renommée,
la nouvelle créée avec un DDL fixe, les lignes recopiées, l'ancienne
supprimée. C'est ce que fait le mode batch, à l'ordre des contraintes près.

Effet secondaire de cette écriture à la main : la **montée se rend hors ligne**
(`upgrade b7e41d0c9a52:f3a91c47b2de --sql`), là où les révisions du Lot 2 et du
Lot 4 ne le peuvent pas. Elle ne réfléchit rien et ne lit aucune donnée : le
`INSERT ... SELECT` recopie les lignes sans les regarder. La **descente**, elle,
ne se rend pas hors ligne, et c'est structurel : sa garde doit lire la table
pour savoir si la contrainte restaurée passe. Elle le dit plutôt que d'échouer
sur une erreur interne. `upgrade head --sql` reste hors de portée à cause des
révisions antérieures, pas de celle-ci.

Revision ID: f3a91c47b2de
Revises: b7e41d0c9a52
Create Date: 2026-09-29 17:30:00.000000

"""

from collections.abc import Callable, Sequence

import sqlalchemy as sa
from alembic import context, op

# Identifiants de révision utilisés par Alembic.
revision: str = 'f3a91c47b2de'
down_revision: str | Sequence[str] | None = 'b7e41d0c9a52'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

COPY_FK = 'fk_deck_card_card_id_language_code_card_set_id_card_copy'
PRINTING_FK = 'fk_deck_card_card_id_card_set_id_card_printing'
LANGUAGE_FK = 'fk_deck_card_language_code_language'
DECK_FK = 'fk_deck_card_deck_id_deck'
DECK_CARD_INDEX = 'ix_deck_card_card_id_language_code_card_set_id'
OLD_TABLE = 'deck_card_avant_f3a91c47b2de'
COLUMNS = (
    'deck_id',
    'card_id',
    'language_code',
    'card_set_id',
    'quantity',
    'proxy_quantity',
)

ORPHAN_LINES = sa.text(
    'SELECT dc.deck_id, dc.card_id, dc.language_code, dc.card_set_id'
    ' FROM deck_card AS dc'
    ' LEFT JOIN card_copy AS cc'
    ' ON cc.card_id = dc.card_id'
    ' AND cc.language_code = dc.language_code'
    ' AND cc.card_set_id = dc.card_set_id'
    ' WHERE cc.card_id IS NULL'
)


def _require_every_line_backed_by_a_collection_entry() -> None:
    """Refuse la descente si une ligne de deck n'a pas d'entrée en face.

    C'est exactement ce que la clé étrangère restaurée exigerait. La vérifier
    ici permet de nommer les lignes à corriger ; laissée au
    `foreign_key_check` de `migrations/env.py`, l'erreur arriverait après coup
    et sans ces coordonnées. La `RuntimeError` précède toute modification : la
    transaction est annulée et la base reste à sa révision de départ.
    """
    if context.is_offline_mode():
        raise RuntimeError(
            'Migration f3a91c47b2de (downgrade) : ce sens ne se rend pas hors '
            "ligne (`--sql`). Il ne peut pas s'écrire sans lire les données, "
            'puisque la clé étrangère qu\'il restaure interdit des lignes que '
            'la révision montante autorise. Redescendez sur une connexion '
            'réelle, la vérification vous dira quoi corriger. La montée, elle, '
            'se rend hors ligne.'
        )
    bind = op.get_bind()
    orphans = bind.execute(ORPHAN_LINES).fetchall()
    if not orphans:
        return
    sample = ', '.join(
        f'deck {deck_id} / carte {card_id} ({language_code}, extension {card_set_id})'
        for deck_id, card_id, language_code, card_set_id in orphans[:5]
    )
    raise RuntimeError(
        'Migration f3a91c47b2de (downgrade) interrompue : elle restaure la clé '
        'étrangère de deck_card vers card_copy, or '
        f'{len(orphans)} ligne(s) de deck ne correspondent à aucune entrée de '
        'collection — des lignes entièrement jouées en proxy, que la révision '
        'montante rend justement possibles '
        '(docs/issues/2026-09-29-lot4b-ligne-100-pourcent-proxy-refusee.md). '
        f'Par exemple : {sample}. Supprimez ces lignes (ou déclarez les '
        'exemplaires en collection) avant de redescendre.'
    )


def _recreate_deck_card(
    collection_keys: Callable[[], list[sa.ForeignKeyConstraint]],
) -> None:
    """Recrée `deck_card` avec les clés étrangères données, lignes comprises.

    Le reste de la table est identique dans les deux sens : mêmes colonnes,
    même clé primaire, mêmes `CHECK`, même index, mêmes noms de contraintes
    qu'à la révision `b7e41d0c9a52`. Seule change la façon dont une ligne
    s'adosse à la collection ou au catalogue, d'où le paramètre.

    Il est passé sous forme de fonction, et non de contraintes déjà
    construites, pour une raison précise : SQLAlchemy écrit les contraintes
    d'une table dans leur ordre de **création**, pas dans l'ordre des arguments.
    Des contraintes construites à l'appel passeraient donc devant les `CHECK`
    créés ici, et la descente rendrait un DDL équivalent mais écrit autrement
    que celui de `b7e41d0c9a52`. Créées au bon endroit, elles reproduisent le
    texte de la révision précédente à l'octet près.

    L'ancienne table est renommée avant que la nouvelle ne prenne son nom :
    rien ne référence `deck_card`, donc le renommage ne réécrit aucune clé
    étrangère ailleurs. L'index porte le même nom des deux côtés, il est donc
    supprimé d'abord.
    """
    op.drop_index(DECK_CARD_INDEX, table_name='deck_card')
    op.rename_table('deck_card', OLD_TABLE)

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
        *collection_keys(),
        sa.ForeignKeyConstraint(
            ['deck_id'],
            ['deck.id'],
            name=op.f(DECK_FK),
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
        DECK_CARD_INDEX,
        'deck_card',
        ['card_id', 'language_code', 'card_set_id'],
        unique=False,
    )

    columns = ', '.join(COLUMNS)
    op.execute(f'INSERT INTO deck_card ({columns}) SELECT {columns} FROM {OLD_TABLE}')
    op.drop_table(OLD_TABLE)


def _catalogue_keys() -> list[sa.ForeignKeyConstraint]:
    """L'impression et la langue : ce qu'une ligne de deck référence désormais."""
    return [
        sa.ForeignKeyConstraint(
            ['card_id', 'card_set_id'],
            ['card_printing.card_id', 'card_printing.card_set_id'],
            name=op.f(PRINTING_FK),
        ),
        sa.ForeignKeyConstraint(
            ['language_code'],
            ['language.code'],
            name=op.f(LANGUAGE_FK),
        ),
    ]


def _collection_key() -> list[sa.ForeignKeyConstraint]:
    """L'entrée de collection : ce qu'une ligne de deck référençait avant."""
    return [
        sa.ForeignKeyConstraint(
            ['card_id', 'language_code', 'card_set_id'],
            ['card_copy.card_id', 'card_copy.language_code', 'card_copy.card_set_id'],
            name=op.f(COPY_FK),
        ),
    ]


def upgrade() -> None:
    _recreate_deck_card(_catalogue_keys)


def downgrade() -> None:
    _require_every_line_backed_by_a_collection_entry()

    _recreate_deck_card(_collection_key)
