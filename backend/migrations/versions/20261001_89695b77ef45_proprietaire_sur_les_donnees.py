"""Propriétaire sur les données

Neuvième révision, seconde du Lot 6 (`docs/lot6-plan-comptes.md`, « R9 »).
Toute donnée privée reçoit un `user_id` NOT NULL, et toutes les lignes
existantes sont rattachées au compte historique (`1`), créé par la révision
précédente (`32d62f354d89`).

Neuf tables, dans l'ordre imposé par les clés (`deck` avant `deck_card`,
`venue` et `tournament` avant `game`, `game` avant `participation`) :

* `venue` — `user_id` ; `name` unique par compte (`uq_venue_user_id_name`) ;
  `uq_venue_id_user_id`, cible des clés composites de `tournament` et `game` ;
* `player` — `user_id` ; `name` unique par compte ; `ux_player_is_me` devient
  un index unique partiel sur `user_id` (`WHERE is_me = 1`) : un « Moi » par
  compte ; `uq_player_id_user_id`, cible de `participation` ;
* `deck` — `user_id` ; `uq_deck_name_discriminator` cède la place à
  `uq_deck_user_id_name_discriminator` (le discriminant est unique par compte,
  D2) ; `uq_deck_id_user_id`, cible de `deck_card` et `participation` ;
* `tournament` — `user_id` (indexé) ; `(venue_id, user_id)` → `venue` ;
  `uq_tournament_id_user_id` ;
* `game` — `user_id` (indexé) ; `(venue_id, user_id)` → `venue`,
  `(tournament_id, user_id)` → `tournament` ; `uq_game_id_user_id` ;
* `participation` — `user_id` ; `(game_id, user_id)` → `game` (cascade),
  `(player_id, user_id)` → `player`, `(deck_id, user_id)` → `deck` ;
* `deck_card` — `user_id`, copie de celui du deck : la clé simple vers `deck`
  devient la composite `(deck_id, user_id)` → `deck (id, user_id)` (cascade),
  et l'index de réconciliation commence par le compte
  (`ix_deck_card_user_id_card_id_language_code_card_set_id`) ;
* `card_copy` — `user_id` en tête de la clé primaire ;
* `sync_operation` — `user_id` **sans** clé étrangère (le journal n'en a
  aucune, par conception) ; l'idempotence et les références client deviennent
  par compte (`uq_sync_operation_user_id_operation_id`,
  `ux_sync_operation_client_ref` sur `(user_id, client_ref)`).

`deleted_deck_card` ne change pas : une decklist figée ne réserve rien et ne se
lit qu'à travers son deck. Partout ailleurs, `user_id` pointe `user_account.id`
sans `ON DELETE` (une suppression de compte passera par un service explicite).
La clé `participation (player_id, user_id)` → `player` n'est pas dans le
tableau du brief, qui ne cite que la partie et le deck ; elle suit la même
intention (une participation ne peut pas désigner le joueur d'un autre compte).

**Conversion, pas refus (D5).** C'est la première révision du projet qui
réécrit des données métier, à l'inverse des gardes de vacuité du Lot 4 : toute
ligne existante n'a qu'un propriétaire possible, puisqu'il n'y a jamais eu
qu'un utilisateur. La conversion est une constante (`user_id = 1`), sans
heuristique, et la même règle vaut pour les tables vides ou non — une ligne de
test oubliée dans une table du Lot 7 est rattachée au compte historique au lieu
de bloquer la migration. Le journal `sync_operation` est converti comme le
reste : une opération déjà tranchée qui attend encore dans une file doit rester
un rejeu après la migration.

**Recréation à la main, pas de mode batch**, pour la raison mesurée à
`f3a91c47b2de` : le mode batch recopie les contraintes dans un ordre qui varie
d'un processus à l'autre, et l'aller-retour comparé au texte près ne serait vert
qu'une fois sur deux. Pour chaque table : supprimer ses index nommés, renommer
la table (`<table>_avant_89695b77ef45`), créer la nouvelle avec un DDL fixe,
recopier les lignes (`INSERT … SELECT`, `user_id` posé à la constante), supprimer
l'ancienne. Les noms de contraintes existants sont recopiés à l'identique.

`PRAGMA legacy_alter_table = ON` le temps de la révision : depuis SQLite 3.26,
`ALTER TABLE … RENAME` réécrit aussi les clés étrangères des **autres** tables
qui visent la table renommée. Renommer `deck` ferait alors pointer
`deleted_deck_card` — que cette révision ne recrée pas — vers
`deck_avant_89695b77ef45`, puis vers une table supprimée. En mode hérité, avec
les clés étrangères coupées par `migrations/env.py`, seul le nom de la table
change ; les références des autres tables restent textuellement `deck` et
désignent la nouvelle table dès qu'elle existe. Le `foreign_key_check` final de
`env.py` le vérifie.

**Chaque `user_id` recopié désigne un compte existant**, par deux contrôles :

* sur les huit tables dont `user_id` porte une clé étrangère (`deck_card` par
  sa composite vers `deck`), c'est le `foreign_key_check` final de `env.py` ;
* `sync_operation` n'a aucune clé étrangère, par conception : aucun contrôle
  de clé ne la couvre. La montée vérifie donc **avant toute modification** que
  le compte historique existe (`_require_the_legacy_account`), ce qui suffit
  puisque toutes les lignes reçoivent cette constante.

Sans réflexion de schéma, la **montée se rend hors ligne**
(`upgrade 32d62f354d89:89695b77ef45 --sql`) : la vérification préalable est
alors sautée, le script SQL suivant celui de la révision précédente, qui
insère le compte.

**Descente** : refusée (`RuntimeError`, avant toute modification, avec le
nombre de lignes par table) dès qu'une ligne de l'une des neuf tables
appartient à un autre compte que `1`. C'est le critère exact de ce que le
schéma d'avant ne sait pas représenter : deux decks homonymes au même
discriminant dans deux comptes, deux entrées de stock de même clé, deux
opérations de même `operation_id`. Sinon, la descente retire les colonnes et
restaure les unicités globales sans perte. Elle ne se rend pas hors ligne : sa
garde lit les données.

Revision ID: 89695b77ef45
Revises: 32d62f354d89
Create Date: 2026-10-01 19:10:44.894507

"""

from collections.abc import Callable, Sequence

import sqlalchemy as sa
from alembic import context, op

# Identifiants de révision utilisés par Alembic.
revision: str = '89695b77ef45'
down_revision: str | Sequence[str] | None = '32d62f354d89'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

LEGACY_ACCOUNT_ID = 1
OLD_SUFFIX = '_avant_89695b77ef45'

APPLIED_CLIENT_REF = sa.text("client_ref IS NOT NULL AND status = 'applied'")
IS_ME = sa.text('is_me = 1')
# Postgres ne compare pas un booléen à un entier ; SQLite ignore cette variante.
IS_ME_POSTGRES = sa.text('is_me')

# Ordre de montée ; la descente le parcourt à l'envers.
OWNED_TABLES = (
    'venue',
    'player',
    'deck',
    'tournament',
    'game',
    'participation',
    'deck_card',
    'card_copy',
    'sync_operation',
)


# --------------------------------------------------------------------------
# Colonnes communes aux deux formes de chaque table
# --------------------------------------------------------------------------
#
# Fonctions et non listes : un `sa.Column` ne s'attache qu'à une table. Les noms
# servent aussi à la recopie des lignes (`INSERT … SELECT`), d'où le tuple de
# noms qui les accompagne, dans le même ordre.


def _timestamps() -> list[sa.Column]:
    return [
        sa.Column(
            'created_at',
            sa.DateTime(),
            server_default=sa.text('(CURRENT_TIMESTAMP)'),
            nullable=False,
        ),
        sa.Column(
            'updated_at',
            sa.DateTime(),
            server_default=sa.text('(CURRENT_TIMESTAMP)'),
            nullable=False,
        ),
    ]


def _user_id() -> sa.Column:
    return sa.Column('user_id', sa.Integer(), nullable=False)


def _owner_fk(table: str) -> sa.ForeignKeyConstraint:
    return sa.ForeignKeyConstraint(
        ['user_id'],
        ['user_account.id'],
        name=op.f(f'fk_{table}_user_id_user_account'),
    )


VENUE_COLUMNS = ('id', 'name', 'city', 'notes')
PLAYER_COLUMNS = ('id', 'name', 'is_me')
DECK_COLUMNS = (
    'id',
    'name',
    'discriminator',
    'created_on',
    'status',
    'archetype',
    'notes',
    'proxy_allowed',
    'archived_at',
    'deleted_at',
    'created_at',
    'updated_at',
)
TOURNAMENT_COLUMNS = (
    'id',
    'name',
    'start_date',
    'end_date',
    'venue_id',
    'deck_policy',
    'format',
    'round_count',
    'my_ranking',
    'notes',
    'created_at',
    'updated_at',
)
GAME_COLUMNS = (
    'id',
    'played_at',
    'venue_id',
    'tournament_id',
    'round_number',
    'round_type',
    'player_count',
    'notes',
    'created_at',
    'updated_at',
)
PARTICIPATION_COLUMNS = (
    'id',
    'game_id',
    'player_id',
    'deck_id',
    'seat',
    'victory_points',
    'game_win',
    'notes',
)
DECK_CARD_COLUMNS = (
    'deck_id',
    'card_id',
    'language_code',
    'card_set_id',
    'quantity',
    'proxy_quantity',
)
CARD_COPY_COLUMNS = (
    'card_id',
    'language_code',
    'card_set_id',
    'quantity_owned',
    'notes',
)
SYNC_OPERATION_COLUMNS = (
    'id',
    'operation_id',
    'batch_id',
    'operation_type',
    'request_hash',
    'status',
    'error_code',
    'error_message',
    'client_ref',
    'resource_kind',
    'deck_id',
    'card_id',
    'language_code',
    'card_set_id',
    'bundle_id',
    'recorded_at',
    'processed_at',
)

COPIED_COLUMNS = {
    'venue': VENUE_COLUMNS,
    'player': PLAYER_COLUMNS,
    'deck': DECK_COLUMNS,
    'tournament': TOURNAMENT_COLUMNS,
    'game': GAME_COLUMNS,
    'participation': PARTICIPATION_COLUMNS,
    'deck_card': DECK_CARD_COLUMNS,
    'card_copy': CARD_COPY_COLUMNS,
    'sync_operation': SYNC_OPERATION_COLUMNS,
}


# --------------------------------------------------------------------------
# venue
# --------------------------------------------------------------------------


def _venue_columns() -> list[sa.Column]:
    return [
        sa.Column('name', sa.String(length=120), nullable=False),
        sa.Column('city', sa.String(length=80), nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),
    ]


def _create_venue_owned() -> None:
    op.create_table(
        'venue',
        sa.Column('id', sa.Integer(), nullable=False),
        _user_id(),
        *_venue_columns(),
        _owner_fk('venue'),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_venue')),
        sa.UniqueConstraint('user_id', 'name', name=op.f('uq_venue_user_id_name')),
        sa.UniqueConstraint('id', 'user_id', name=op.f('uq_venue_id_user_id')),
    )


def _create_venue_shared() -> None:
    op.create_table(
        'venue',
        sa.Column('id', sa.Integer(), nullable=False),
        *_venue_columns(),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_venue')),
        sa.UniqueConstraint('name', name=op.f('uq_venue_name')),
    )


# --------------------------------------------------------------------------
# player
# --------------------------------------------------------------------------


def _create_player_owned() -> None:
    op.create_table(
        'player',
        sa.Column('id', sa.Integer(), nullable=False),
        _user_id(),
        sa.Column('name', sa.String(length=80), nullable=False),
        sa.Column('is_me', sa.Boolean(), nullable=False),
        _owner_fk('player'),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_player')),
        sa.UniqueConstraint('user_id', 'name', name=op.f('uq_player_user_id_name')),
        sa.UniqueConstraint('id', 'user_id', name=op.f('uq_player_id_user_id')),
    )
    op.create_index(
        'ux_player_is_me',
        'player',
        ['user_id'],
        unique=True,
        sqlite_where=IS_ME,
        postgresql_where=IS_ME_POSTGRES,
    )


def _create_player_shared() -> None:
    op.create_table(
        'player',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=80), nullable=False),
        sa.Column('is_me', sa.Boolean(), nullable=False),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_player')),
        sa.UniqueConstraint('name', name=op.f('uq_player_name')),
    )
    op.create_index(
        'ux_player_is_me',
        'player',
        ['is_me'],
        unique=True,
        sqlite_where=IS_ME,
    )


def _drop_player_indexes() -> None:
    op.drop_index('ux_player_is_me', table_name='player')


# --------------------------------------------------------------------------
# deck
# --------------------------------------------------------------------------


def _deck_columns() -> list[sa.Column]:
    return [
        sa.Column('name', sa.String(length=120), nullable=False),
        sa.Column('discriminator', sa.String(length=4), nullable=False),
        sa.Column('created_on', sa.Date(), nullable=True),
        sa.Column(
            'status',
            sa.Enum(
                'draft',
                'active',
                name='deck_status',
                native_enum=False,
                create_constraint=True,
            ),
            nullable=False,
        ),
        sa.Column('archetype', sa.String(length=120), nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column(
            'proxy_allowed',
            sa.Boolean(),
            server_default=sa.false(),
            nullable=False,
        ),
        sa.Column('archived_at', sa.DateTime(), nullable=True),
        sa.Column('deleted_at', sa.DateTime(), nullable=True),
        *_timestamps(),
    ]


def _discriminator_format() -> sa.CheckConstraint:
    return sa.CheckConstraint(
        "discriminator GLOB '[0-9][0-9][0-9][0-9]' AND discriminator <> '0000'",
        name=op.f('ck_deck_discriminator_format'),
    )


def _create_deck_owned() -> None:
    op.create_table(
        'deck',
        sa.Column('id', sa.Integer(), nullable=False),
        _user_id(),
        *_deck_columns(),
        _discriminator_format(),
        _owner_fk('deck'),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_deck')),
        sa.UniqueConstraint(
            'user_id',
            'name',
            'discriminator',
            name=op.f('uq_deck_user_id_name_discriminator'),
        ),
        sa.UniqueConstraint('id', 'user_id', name=op.f('uq_deck_id_user_id')),
    )


def _create_deck_shared() -> None:
    op.create_table(
        'deck',
        sa.Column('id', sa.Integer(), nullable=False),
        *_deck_columns(),
        _discriminator_format(),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_deck')),
        sa.UniqueConstraint(
            'name', 'discriminator', name=op.f('uq_deck_name_discriminator')
        ),
    )


# --------------------------------------------------------------------------
# tournament
# --------------------------------------------------------------------------


def _tournament_columns() -> list[sa.Column]:
    return [
        sa.Column('name', sa.String(length=120), nullable=False),
        sa.Column('start_date', sa.Date(), nullable=False),
        sa.Column('end_date', sa.Date(), nullable=True),
        sa.Column('venue_id', sa.Integer(), nullable=True),
        sa.Column(
            'deck_policy',
            sa.Enum(
                'mono',
                'multi',
                name='deck_policy',
                native_enum=False,
                create_constraint=True,
            ),
            nullable=False,
        ),
        sa.Column(
            'format',
            sa.Enum(
                'constructed',
                'draft',
                'other',
                name='tournament_format',
                native_enum=False,
                create_constraint=True,
            ),
            nullable=False,
        ),
        sa.Column('round_count', sa.Integer(), nullable=True),
        sa.Column('my_ranking', sa.Integer(), nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),
        *_timestamps(),
    ]


def _tournament_checks() -> list[sa.CheckConstraint]:
    return [
        sa.CheckConstraint(
            'round_count >= 1', name=op.f('ck_tournament_round_count_positive')
        ),
        sa.CheckConstraint(
            'my_ranking >= 1', name=op.f('ck_tournament_my_ranking_positive')
        ),
    ]


def _create_tournament_owned() -> None:
    op.create_table(
        'tournament',
        sa.Column('id', sa.Integer(), nullable=False),
        _user_id(),
        *_tournament_columns(),
        *_tournament_checks(),
        sa.ForeignKeyConstraint(
            ['venue_id', 'user_id'],
            ['venue.id', 'venue.user_id'],
            name=op.f('fk_tournament_venue_id_user_id_venue'),
        ),
        _owner_fk('tournament'),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_tournament')),
        sa.UniqueConstraint('id', 'user_id', name=op.f('uq_tournament_id_user_id')),
    )
    op.create_index(
        op.f('ix_tournament_user_id'), 'tournament', ['user_id'], unique=False
    )


def _create_tournament_shared() -> None:
    op.create_table(
        'tournament',
        sa.Column('id', sa.Integer(), nullable=False),
        *_tournament_columns(),
        *_tournament_checks(),
        sa.ForeignKeyConstraint(
            ['venue_id'], ['venue.id'], name=op.f('fk_tournament_venue_id_venue')
        ),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_tournament')),
    )


def _drop_tournament_owned_indexes() -> None:
    op.drop_index(op.f('ix_tournament_user_id'), table_name='tournament')


# --------------------------------------------------------------------------
# game
# --------------------------------------------------------------------------


def _game_columns() -> list[sa.Column]:
    return [
        sa.Column('played_at', sa.DateTime(), nullable=False),
        sa.Column('venue_id', sa.Integer(), nullable=True),
        sa.Column('tournament_id', sa.Integer(), nullable=True),
        sa.Column('round_number', sa.Integer(), nullable=True),
        sa.Column(
            'round_type',
            sa.Enum(
                'casual',
                'preliminary',
                'final',
                name='round_type',
                native_enum=False,
                create_constraint=True,
            ),
            nullable=False,
        ),
        sa.Column('player_count', sa.Integer(), nullable=False),
        sa.Column('notes', sa.Text(), nullable=True),
        *_timestamps(),
    ]


def _game_checks() -> list[sa.CheckConstraint]:
    return [
        sa.CheckConstraint(
            'player_count >= 2', name=op.f('ck_game_player_count_minimum')
        ),
        sa.CheckConstraint(
            'round_number >= 1', name=op.f('ck_game_round_number_positive')
        ),
    ]


def _create_game_owned() -> None:
    op.create_table(
        'game',
        sa.Column('id', sa.Integer(), nullable=False),
        _user_id(),
        *_game_columns(),
        *_game_checks(),
        sa.ForeignKeyConstraint(
            ['venue_id', 'user_id'],
            ['venue.id', 'venue.user_id'],
            name=op.f('fk_game_venue_id_user_id_venue'),
        ),
        sa.ForeignKeyConstraint(
            ['tournament_id', 'user_id'],
            ['tournament.id', 'tournament.user_id'],
            name=op.f('fk_game_tournament_id_user_id_tournament'),
        ),
        _owner_fk('game'),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_game')),
        sa.UniqueConstraint('id', 'user_id', name=op.f('uq_game_id_user_id')),
    )
    op.create_index(
        op.f('ix_game_tournament_id'), 'game', ['tournament_id'], unique=False
    )
    op.create_index(op.f('ix_game_user_id'), 'game', ['user_id'], unique=False)


def _create_game_shared() -> None:
    op.create_table(
        'game',
        sa.Column('id', sa.Integer(), nullable=False),
        *_game_columns(),
        *_game_checks(),
        sa.ForeignKeyConstraint(
            ['tournament_id'],
            ['tournament.id'],
            name=op.f('fk_game_tournament_id_tournament'),
        ),
        sa.ForeignKeyConstraint(
            ['venue_id'], ['venue.id'], name=op.f('fk_game_venue_id_venue')
        ),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_game')),
    )
    op.create_index(
        op.f('ix_game_tournament_id'), 'game', ['tournament_id'], unique=False
    )


def _drop_game_shared_indexes() -> None:
    op.drop_index(op.f('ix_game_tournament_id'), table_name='game')


def _drop_game_owned_indexes() -> None:
    op.drop_index(op.f('ix_game_user_id'), table_name='game')
    op.drop_index(op.f('ix_game_tournament_id'), table_name='game')


# --------------------------------------------------------------------------
# participation
# --------------------------------------------------------------------------


def _participation_columns() -> list[sa.Column]:
    return [
        sa.Column('game_id', sa.Integer(), nullable=False),
        sa.Column('player_id', sa.Integer(), nullable=False),
        sa.Column('deck_id', sa.Integer(), nullable=True),
        sa.Column('seat', sa.Integer(), nullable=True),
        sa.Column('victory_points', sa.Float(), nullable=True),
        sa.Column('game_win', sa.Boolean(), nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),
    ]


def _participation_checks_and_uniques() -> list[sa.Constraint]:
    return [
        sa.CheckConstraint('seat >= 1', name=op.f('ck_participation_seat_positive')),
        sa.CheckConstraint(
            'victory_points >= 0',
            name=op.f('ck_participation_victory_points_positive'),
        ),
        sa.UniqueConstraint(
            'game_id', 'player_id', name=op.f('uq_participation_game_id_player_id')
        ),
        sa.UniqueConstraint(
            'game_id', 'seat', name=op.f('uq_participation_game_id_seat')
        ),
    ]


def _create_participation_owned() -> None:
    op.create_table(
        'participation',
        sa.Column('id', sa.Integer(), nullable=False),
        _user_id(),
        *_participation_columns(),
        *_participation_checks_and_uniques(),
        sa.ForeignKeyConstraint(
            ['game_id', 'user_id'],
            ['game.id', 'game.user_id'],
            name=op.f('fk_participation_game_id_user_id_game'),
            ondelete='CASCADE',
        ),
        sa.ForeignKeyConstraint(
            ['player_id', 'user_id'],
            ['player.id', 'player.user_id'],
            name=op.f('fk_participation_player_id_user_id_player'),
        ),
        sa.ForeignKeyConstraint(
            ['deck_id', 'user_id'],
            ['deck.id', 'deck.user_id'],
            name=op.f('fk_participation_deck_id_user_id_deck'),
        ),
        _owner_fk('participation'),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_participation')),
    )
    op.create_index(
        op.f('ix_participation_deck_id'), 'participation', ['deck_id'], unique=False
    )


def _create_participation_shared() -> None:
    op.create_table(
        'participation',
        sa.Column('id', sa.Integer(), nullable=False),
        *_participation_columns(),
        *_participation_checks_and_uniques(),
        sa.ForeignKeyConstraint(
            ['deck_id'], ['deck.id'], name=op.f('fk_participation_deck_id_deck')
        ),
        sa.ForeignKeyConstraint(
            ['game_id'],
            ['game.id'],
            name=op.f('fk_participation_game_id_game'),
            ondelete='CASCADE',
        ),
        sa.ForeignKeyConstraint(
            ['player_id'],
            ['player.id'],
            name=op.f('fk_participation_player_id_player'),
        ),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_participation')),
    )
    op.create_index(
        op.f('ix_participation_deck_id'), 'participation', ['deck_id'], unique=False
    )


def _drop_participation_indexes() -> None:
    op.drop_index(op.f('ix_participation_deck_id'), table_name='participation')


# --------------------------------------------------------------------------
# deck_card
# --------------------------------------------------------------------------

DECK_CARD_INDEX_SHARED = 'ix_deck_card_card_id_language_code_card_set_id'
DECK_CARD_INDEX_OWNED = 'ix_deck_card_user_id_card_id_language_code_card_set_id'


def _deck_card_checks() -> list[sa.CheckConstraint]:
    return [
        sa.CheckConstraint(
            'proxy_quantity >= 0 AND proxy_quantity <= quantity',
            name=op.f('ck_deck_card_proxy_quantity_within_quantity'),
        ),
        sa.CheckConstraint('quantity >= 1', name=op.f('ck_deck_card_quantity_positive')),
    ]


def _deck_card_catalogue_keys() -> list[sa.ForeignKeyConstraint]:
    return [
        sa.ForeignKeyConstraint(
            ['card_id', 'card_set_id'],
            ['card_printing.card_id', 'card_printing.card_set_id'],
            name=op.f('fk_deck_card_card_id_card_set_id_card_printing'),
        ),
        sa.ForeignKeyConstraint(
            ['language_code'],
            ['language.code'],
            name=op.f('fk_deck_card_language_code_language'),
        ),
    ]


def _deck_card_key_columns() -> list[sa.Column]:
    return [
        sa.Column('deck_id', sa.Integer(), nullable=False),
        sa.Column('card_id', sa.Integer(), nullable=False),
        sa.Column('language_code', sa.String(length=8), nullable=False),
        sa.Column('card_set_id', sa.Integer(), nullable=False),
    ]


def _deck_card_quantities() -> list[sa.Column]:
    return [
        sa.Column('quantity', sa.Integer(), nullable=False),
        sa.Column('proxy_quantity', sa.Integer(), nullable=False),
    ]


def _deck_card_pk() -> sa.PrimaryKeyConstraint:
    return sa.PrimaryKeyConstraint(
        'deck_id',
        'card_id',
        'language_code',
        'card_set_id',
        name=op.f('pk_deck_card'),
    )


def _create_deck_card_owned() -> None:
    op.create_table(
        'deck_card',
        *_deck_card_key_columns(),
        _user_id(),
        *_deck_card_quantities(),
        *_deck_card_checks(),
        *_deck_card_catalogue_keys(),
        sa.ForeignKeyConstraint(
            ['deck_id', 'user_id'],
            ['deck.id', 'deck.user_id'],
            name=op.f('fk_deck_card_deck_id_user_id_deck'),
            ondelete='CASCADE',
        ),
        _deck_card_pk(),
    )
    op.create_index(
        DECK_CARD_INDEX_OWNED,
        'deck_card',
        ['user_id', 'card_id', 'language_code', 'card_set_id'],
        unique=False,
    )


def _create_deck_card_shared() -> None:
    op.create_table(
        'deck_card',
        *_deck_card_key_columns(),
        *_deck_card_quantities(),
        *_deck_card_checks(),
        *_deck_card_catalogue_keys(),
        sa.ForeignKeyConstraint(
            ['deck_id'],
            ['deck.id'],
            name=op.f('fk_deck_card_deck_id_deck'),
            ondelete='CASCADE',
        ),
        _deck_card_pk(),
    )
    op.create_index(
        DECK_CARD_INDEX_SHARED,
        'deck_card',
        ['card_id', 'language_code', 'card_set_id'],
        unique=False,
    )


# --------------------------------------------------------------------------
# card_copy
# --------------------------------------------------------------------------


def _card_copy_columns() -> list[sa.Column]:
    return [
        sa.Column('card_id', sa.Integer(), nullable=False),
        sa.Column('language_code', sa.String(length=8), nullable=False),
        sa.Column('card_set_id', sa.Integer(), nullable=False),
        sa.Column('quantity_owned', sa.Integer(), nullable=False),
        sa.Column('notes', sa.Text(), nullable=True),
    ]


def _card_copy_constraints() -> list[sa.Constraint]:
    return [
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
    ]


def _create_card_copy_owned() -> None:
    op.create_table(
        'card_copy',
        _user_id(),
        *_card_copy_columns(),
        *_card_copy_constraints(),
        _owner_fk('card_copy'),
        sa.PrimaryKeyConstraint(
            'user_id',
            'card_id',
            'language_code',
            'card_set_id',
            name=op.f('pk_card_copy'),
        ),
    )


def _create_card_copy_shared() -> None:
    op.create_table(
        'card_copy',
        *_card_copy_columns(),
        *_card_copy_constraints(),
        sa.PrimaryKeyConstraint(
            'card_id', 'language_code', 'card_set_id', name=op.f('pk_card_copy')
        ),
    )


# --------------------------------------------------------------------------
# sync_operation
# --------------------------------------------------------------------------


def _sync_operation_columns() -> list[sa.Column]:
    return [
        sa.Column('operation_id', sa.String(length=36), nullable=False),
        sa.Column('batch_id', sa.String(length=36), nullable=False),
        sa.Column(
            'operation_type',
            sa.Enum(
                'stock.upsert',
                'stock.delete',
                'deck.create',
                'deck.update',
                'deck.delete',
                'deck_card.upsert',
                'deck_card.delete',
                'bundle.deposit',
                name='sync_operation_type',
                native_enum=False,
                create_constraint=True,
            ),
            nullable=False,
        ),
        sa.Column('request_hash', sa.String(length=64), nullable=False),
        sa.Column(
            'status',
            sa.Enum(
                'applied',
                'rejected',
                name='sync_operation_status',
                native_enum=False,
                create_constraint=True,
            ),
            nullable=False,
        ),
        sa.Column(
            'error_code',
            sa.Enum(
                'not_found',
                'conflict',
                'invalid',
                'unresolved_client_ref',
                'mismatched_replay',
                name='sync_error_code',
                native_enum=False,
                create_constraint=True,
            ),
            nullable=True,
        ),
        sa.Column('error_message', sa.Text(), nullable=True),
        sa.Column('client_ref', sa.String(length=64), nullable=True),
        sa.Column(
            'resource_kind',
            sa.Enum(
                'card_copy',
                'deck',
                'deck_card',
                'bundle',
                name='sync_resource_kind',
                native_enum=False,
                create_constraint=True,
            ),
            nullable=True,
        ),
        sa.Column('deck_id', sa.Integer(), nullable=True),
        sa.Column('card_id', sa.Integer(), nullable=True),
        sa.Column('language_code', sa.String(length=8), nullable=True),
        sa.Column('card_set_id', sa.Integer(), nullable=True),
        sa.Column('bundle_id', sa.Integer(), nullable=True),
        sa.Column('recorded_at', sa.DateTime(), nullable=False),
        sa.Column('processed_at', sa.DateTime(), nullable=False),
    ]


def _sync_operation_checks() -> list[sa.CheckConstraint]:
    return [
        sa.CheckConstraint(
            "(status = 'rejected') = (error_code IS NOT NULL)",
            name=op.f('ck_sync_operation_error_code_iff_rejected'),
        ),
        sa.CheckConstraint(
            "status <> 'applied' OR resource_kind IS NOT NULL",
            name=op.f('ck_sync_operation_resource_kind_when_applied'),
        ),
    ]


def _create_sync_operation_owned() -> None:
    op.create_table(
        'sync_operation',
        sa.Column('id', sa.Integer(), nullable=False),
        _user_id(),
        *_sync_operation_columns(),
        *_sync_operation_checks(),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_sync_operation')),
        sa.UniqueConstraint(
            'user_id',
            'operation_id',
            name=op.f('uq_sync_operation_user_id_operation_id'),
        ),
    )
    op.create_index(
        'ix_sync_operation_batch_id', 'sync_operation', ['batch_id'], unique=False
    )
    op.create_index(
        'ux_sync_operation_client_ref',
        'sync_operation',
        ['user_id', 'client_ref'],
        unique=True,
        sqlite_where=APPLIED_CLIENT_REF,
        postgresql_where=APPLIED_CLIENT_REF,
    )


def _create_sync_operation_shared() -> None:
    op.create_table(
        'sync_operation',
        sa.Column('id', sa.Integer(), nullable=False),
        *_sync_operation_columns(),
        *_sync_operation_checks(),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_sync_operation')),
        sa.UniqueConstraint(
            'operation_id', name=op.f('uq_sync_operation_operation_id')
        ),
    )
    op.create_index(
        'ix_sync_operation_batch_id', 'sync_operation', ['batch_id'], unique=False
    )
    op.create_index(
        'ux_sync_operation_client_ref',
        'sync_operation',
        ['client_ref'],
        unique=True,
        sqlite_where=APPLIED_CLIENT_REF,
        postgresql_where=APPLIED_CLIENT_REF,
    )


def _drop_sync_operation_indexes() -> None:
    op.drop_index('ux_sync_operation_client_ref', table_name='sync_operation')
    op.drop_index('ix_sync_operation_batch_id', table_name='sync_operation')


# --------------------------------------------------------------------------
# Recréation
# --------------------------------------------------------------------------


def _no_index() -> None:
    return None


# table -> (index de la forme partagée, index de la forme possédée,
#           création possédée, création partagée)
STEPS: dict[str, tuple[Callable[[], None], ...]] = {
    'venue': (_no_index, _no_index, _create_venue_owned, _create_venue_shared),
    'player': (
        _drop_player_indexes,
        _drop_player_indexes,
        _create_player_owned,
        _create_player_shared,
    ),
    'deck': (_no_index, _no_index, _create_deck_owned, _create_deck_shared),
    'tournament': (
        _no_index,
        _drop_tournament_owned_indexes,
        _create_tournament_owned,
        _create_tournament_shared,
    ),
    'game': (
        _drop_game_shared_indexes,
        _drop_game_owned_indexes,
        _create_game_owned,
        _create_game_shared,
    ),
    'participation': (
        _drop_participation_indexes,
        _drop_participation_indexes,
        _create_participation_owned,
        _create_participation_shared,
    ),
    'deck_card': (
        lambda: op.drop_index(DECK_CARD_INDEX_SHARED, table_name='deck_card'),
        lambda: op.drop_index(DECK_CARD_INDEX_OWNED, table_name='deck_card'),
        _create_deck_card_owned,
        _create_deck_card_shared,
    ),
    'card_copy': (
        _no_index,
        _no_index,
        _create_card_copy_owned,
        _create_card_copy_shared,
    ),
    'sync_operation': (
        _drop_sync_operation_indexes,
        _drop_sync_operation_indexes,
        _create_sync_operation_owned,
        _create_sync_operation_shared,
    ),
}


def _rebuild(
    table: str,
    drop_indexes: Callable[[], None],
    create: Callable[[], None],
    *,
    with_owner: bool,
) -> None:
    """Recrée `table` sous sa nouvelle forme, lignes comprises.

    Les index nommés partent d'abord : ils suivraient la table renommée et leur
    nom serait pris quand la nouvelle table voudrait les recréer. Les index
    implicites des contraintes `UNIQUE` et de la clé primaire, eux, suivent la
    table et disparaissent avec elle.
    """
    old = f'{table}{OLD_SUFFIX}'
    columns = ', '.join(COPIED_COLUMNS[table])

    drop_indexes()
    op.rename_table(table, old)
    create()
    if with_owner:
        op.execute(
            f'INSERT INTO {table} (user_id, {columns})'
            f' SELECT {LEGACY_ACCOUNT_ID}, {columns} FROM {old}'
        )
    else:
        op.execute(f'INSERT INTO {table} ({columns}) SELECT {columns} FROM {old}')
    op.drop_table(old)


def _require_every_row_owned_by_the_legacy_account() -> None:
    """Refuse la descente dès qu'une ligne appartient à un autre compte que 1.

    Le schéma d'avant ne sait pas représenter deux comptes : deux decks
    homonymes au même discriminant, deux entrées de stock de même clé ou deux
    opérations de même `operation_id` n'y tiennent pas ensemble. La garde
    précède toute modification : la transaction est annulée et la base reste à
    sa révision de départ.
    """
    if context.is_offline_mode():
        raise RuntimeError(
            'Migration 89695b77ef45 (downgrade) : ce sens ne se rend pas hors '
            "ligne (`--sql`). Il retire le propriétaire des données et doit "
            "d'abord vérifier que toutes appartiennent au compte historique. "
            'Redescendez sur une connexion réelle. La montée, elle, se rend '
            'hors ligne.'
        )
    bind = op.get_bind()
    foreign = {}
    for table in OWNED_TABLES:
        count = bind.execute(
            sa.text(f'SELECT COUNT(*) FROM {table} WHERE user_id <> :legacy'),
            {'legacy': LEGACY_ACCOUNT_ID},
        ).scalar_one()
        if count:
            foreign[table] = count
    if not foreign:
        return
    detail = ', '.join(f'{table} : {count}' for table, count in foreign.items())
    raise RuntimeError(
        'Migration 89695b77ef45 (downgrade) interrompue : des lignes appartiennent '
        f'à un autre compte que le compte historique ({detail}). Le schéma '
        "d'avant le Lot 6 ne connaît qu'un utilisateur et ne saurait pas les "
        "représenter. On ne redescend pas sous le Lot 6 tant qu'il existe des "
        'données d\'un autre compte.'
    )


def _require_the_legacy_account() -> None:
    """Refuse la montée si le compte historique n'existe pas.

    Toutes les lignes recopiées reçoivent `user_id = 1`. Sur les tables à clé
    étrangère, un compte absent serait relevé par le `foreign_key_check` final
    de `env.py`, mais pas sur `sync_operation`, qui n'en a aucune : le journal
    serait rattaché en silence à un compte inexistant. Le contrôle précède
    toute modification. Hors ligne (`--sql`), il est sauté : la base n'est pas
    lisible, et le script suit celui de `32d62f354d89`, qui insère le compte.
    """
    if context.is_offline_mode():
        return
    found = (
        op.get_bind()
        .execute(
            sa.text('SELECT COUNT(*) FROM user_account WHERE id = :legacy'),
            {'legacy': LEGACY_ACCOUNT_ID},
        )
        .scalar_one()
    )
    if not found:
        raise RuntimeError(
            'Migration 89695b77ef45 (upgrade) interrompue : le compte historique '
            f'(id {LEGACY_ACCOUNT_ID}) est absent de user_account. Toutes les '
            'données existantes lui sont rattachées, journal sync_operation '
            'compris, qui n\'a pas de clé étrangère pour le signaler. Il est créé '
            'par la révision 32d62f354d89 : rien ne devrait l\'avoir supprimé.'
        )


def upgrade() -> None:
    _require_the_legacy_account()

    op.execute('PRAGMA legacy_alter_table = ON')
    for table in OWNED_TABLES:
        drop_shared_indexes, _, create_owned, _ = STEPS[table]
        _rebuild(table, drop_shared_indexes, create_owned, with_owner=True)
    op.execute('PRAGMA legacy_alter_table = OFF')


def downgrade() -> None:
    _require_every_row_owned_by_the_legacy_account()

    op.execute('PRAGMA legacy_alter_table = ON')
    for table in reversed(OWNED_TABLES):
        _, drop_owned_indexes, _, create_shared = STEPS[table]
        _rebuild(table, drop_owned_indexes, create_shared, with_owner=False)
    op.execute('PRAGMA legacy_alter_table = OFF')
