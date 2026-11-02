"""Identifiants jamais réattribués

Onzième révision, seconde du Lot 7 (`docs/lot7-plan-parties.md`, « R11 »).
Elle corrige un défaut trouvé à la relecture de l'étape B3, sans rien changer
au contrat ni aux colonnes.

**Le défaut.** `player`, `venue`, `tournament` et `game` se suppriment
physiquement, et leur clé primaire était un simple `INTEGER PRIMARY KEY` :
SQLite donne alors à une nouvelle ligne `MAX(id) + 1`, et réattribue donc
l'identifiant de la dernière ligne supprimée. Une `client_ref` du journal de
synchronisation (ou un identifiant gardé par un miroir local périmé) qui
visait la ressource supprimée désignait en silence la suivante : un
`player.update` par la référence de Marc, supprimé, renommait Julie, créée
juste après.

**La correction.** Les quatre tables passent en `AUTOINCREMENT` (option
`sqlite_autoincrement` des modèles, `NEVER_REUSE_IDS`) : SQLite retient dans
`sqlite_sequence` le plus grand identifiant jamais attribué et ne redescend
jamais en dessous. Une référence périmée ne trouve plus rien et rend
`not_found`, ce qu'elle aurait dû faire dès le départ.

**`participation` n'est pas concernée.** Elle se supprime physiquement aussi
(sa partie remplace ses lignes en bloc, ou les emporte en cascade), mais rien
ne la désigne par son identifiant : ni route, ni opération `/sync`, ni
référence client, ni colonne du journal. Son `id` n'est qu'une lecture de
`ParticipationRead`. `deck` ne l'est pas davantage : sa suppression est
logique, la ligne reste et son identifiant avec.

**Recréation à la main, pas de mode batch**, comme R7, R9 et R10, pour que
l'ordre des contraintes soit stable d'un processus à l'autre : supprimer les
index nommés, renommer la table (`<table>_avant_e2a7819dd4a2`), créer la
nouvelle avec un DDL fixe, recopier toutes les lignes à l'identique
(`INSERT … SELECT`, mêmes identifiants), supprimer l'ancienne.
`PRAGMA legacy_alter_table = ON` le temps de la révision, pour que renommer
`venue`, `player`, `tournament` ou `game` ne réécrive pas les clés étrangères
de `tournament`, `game` et `participation`, qui doivent continuer de viser le
nom de la table (cf. R9). Ordre : `venue`, `player`, `tournament`, `game`,
parents avant enfants ; la descente le parcourt à l'envers. Colonnes, clés
étrangères composites, unicités, CHECK nommés et index partiels
(`ux_player_is_me`, `ux_game_preliminary_round`, `ux_game_final`) sont ceux de
R10. Seule différence visible du DDL : sous SQLite, une clé
`AUTOINCREMENT` s'écrit en ligne (`id INTEGER NOT NULL PRIMARY KEY
AUTOINCREMENT`), et la contrainte de clé primaire perd son nom `pk_<table>`.

**Point de départ de la séquence.** Après la recopie, la séquence de chaque
table est posée au plus grand de deux nombres : le plus grand identifiant
recopié, et le plus grand identifiant de ce genre cité par le journal
(`sync_operation.player_id`, `venue_id`, `tournament_id`, `game_id`). Le second
couvre le cas exact du défaut : une ressource créée puis supprimée par `/sync`
avant la révision, dont le journal garde l'identifiant alors que la table l'a
oublié. Un identifiant attribué puis supprimé hors de `/sync`, et que rien
n'a retenu, ne peut pas être reconstitué ; il reste exposé à une réattribution
unique. Les autres comptes n'entrent pas en ligne de compte : la séquence est
celle de la table, commune à tous.

**Aucune donnée n'est convertie** et la montée n'a pas de garde : elle ne lit
la base qu'en SQL et **se rend hors ligne**
(`upgrade 783b24f9e769:e2a7819dd4a2 --sql`).

**Descente** : sans perte de ligne, sans garde, et hors ligne elle aussi. Elle
recrée les quatre tables sous leur forme de R10 ; leurs entrées de
`sqlite_sequence` disparaissent avec les tables supprimées, et la table
`sqlite_sequence` elle-même reste en place, vide (SQLite interdit de la
supprimer). Les identifiants redeviennent réattribuables : c'est le
comportement de R10, défaut compris.

Revision ID: e2a7819dd4a2
Revises: 783b24f9e769
Create Date: 2026-10-29 18:00:00.000000

"""

from collections.abc import Callable, Sequence

import sqlalchemy as sa
from alembic import op

# Identifiants de révision utilisés par Alembic.
revision: str = 'e2a7819dd4a2'
down_revision: str | Sequence[str] | None = '783b24f9e769'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

OLD_SUFFIX = '_avant_e2a7819dd4a2'

IS_ME = sa.text('is_me = 1')
# Postgres ne compare pas un booléen à un entier ; SQLite ignore cette variante.
IS_ME_POSTGRES = sa.text('is_me')
PRELIMINARY = sa.text("round_type = 'preliminary'")
FINAL = sa.text("round_type = 'final'")

EVENT_TIERS = (
    'standard',
    'national_championship',
    'grand_prix',
    'continental_championship',
)
FINAL_DECK_RULES = ('best_performing', 'free_choice')


def _enum(name: str, values: Sequence[str]) -> sa.Enum:
    return sa.Enum(*values, name=name, native_enum=False, create_constraint=True)


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


def _owner_fk(table: str) -> sa.ForeignKeyConstraint:
    return sa.ForeignKeyConstraint(
        ['user_id'],
        ['user_account.id'],
        name=op.f(f'fk_{table}_user_id_user_account'),
    )


# --------------------------------------------------------------------------
# venue (forme de R9, inchangée depuis)
# --------------------------------------------------------------------------

VENUE_COLUMNS = ('id', 'user_id', 'name', 'city', 'notes')


def _create_venue(*, autoincrement: bool) -> None:
    op.create_table(
        'venue',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=120), nullable=False),
        sa.Column('city', sa.String(length=80), nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),
        _owner_fk('venue'),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_venue')),
        sa.UniqueConstraint('user_id', 'name', name=op.f('uq_venue_user_id_name')),
        sa.UniqueConstraint('id', 'user_id', name=op.f('uq_venue_id_user_id')),
        sqlite_autoincrement=autoincrement,
    )


def _drop_venue_indexes() -> None:
    """`venue` n'a que des index implicites (unicités), qui suivent la table."""


# --------------------------------------------------------------------------
# player (forme de R9, inchangée depuis)
# --------------------------------------------------------------------------

PLAYER_COLUMNS = ('id', 'user_id', 'name', 'is_me')


def _create_player(*, autoincrement: bool) -> None:
    op.create_table(
        'player',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=80), nullable=False),
        sa.Column('is_me', sa.Boolean(), nullable=False),
        _owner_fk('player'),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_player')),
        sa.UniqueConstraint('user_id', 'name', name=op.f('uq_player_user_id_name')),
        sa.UniqueConstraint('id', 'user_id', name=op.f('uq_player_id_user_id')),
        sqlite_autoincrement=autoincrement,
    )
    op.create_index(
        'ux_player_is_me',
        'player',
        ['user_id'],
        unique=True,
        sqlite_where=IS_ME,
        postgresql_where=IS_ME_POSTGRES,
    )


def _drop_player_indexes() -> None:
    op.drop_index('ux_player_is_me', table_name='player')


# --------------------------------------------------------------------------
# tournament (forme de R10)
# --------------------------------------------------------------------------

TOURNAMENT_COLUMNS = (
    'id',
    'user_id',
    'name',
    'start_date',
    'end_date',
    'venue_id',
    'deck_policy',
    'format',
    'event_tier',
    'final_deck_rule',
    'round_count',
    'player_count',
    'my_ranking',
    'notes',
    'created_at',
    'updated_at',
)


def _create_tournament(*, autoincrement: bool) -> None:
    # Créées avant les autres, comme dans R10 : SQLAlchemy écrit les
    # contraintes dans leur ordre de création, et le DDL doit rester celui de
    # R10 au caractère près (la descente est comparée au texte).
    lot7_checks = [
        sa.CheckConstraint(
            'player_count >= 2', name=op.f('ck_tournament_player_count_minimum')
        ),
        sa.CheckConstraint(
            "deck_policy = 'multi' OR final_deck_rule IS NULL",
            name=op.f('ck_tournament_final_deck_rule_only_multi'),
        ),
        sa.CheckConstraint(
            "deck_policy = 'mono' OR event_tier = 'standard'",
            name=op.f('ck_tournament_multi_only_standard_tier'),
        ),
    ]
    op.create_table(
        'tournament',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=120), nullable=False),
        sa.Column('start_date', sa.Date(), nullable=False),
        sa.Column('end_date', sa.Date(), nullable=True),
        sa.Column('venue_id', sa.Integer(), nullable=True),
        sa.Column(
            'deck_policy', _enum('deck_policy', ('mono', 'multi')), nullable=False
        ),
        sa.Column(
            'format',
            _enum('tournament_format', ('constructed', 'draft', 'other')),
            nullable=False,
        ),
        sa.Column(
            'event_tier',
            _enum('event_tier', EVENT_TIERS),
            server_default='standard',
            nullable=False,
        ),
        sa.Column(
            'final_deck_rule',
            _enum('final_deck_rule', FINAL_DECK_RULES),
            nullable=True,
        ),
        sa.Column('round_count', sa.Integer(), nullable=True),
        sa.Column('player_count', sa.Integer(), nullable=True),
        sa.Column('my_ranking', sa.Integer(), nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),
        *_timestamps(),
        sa.CheckConstraint(
            'round_count >= 1', name=op.f('ck_tournament_round_count_positive')
        ),
        sa.CheckConstraint(
            'my_ranking >= 1', name=op.f('ck_tournament_my_ranking_positive')
        ),
        *lot7_checks,
        sa.ForeignKeyConstraint(
            ['venue_id', 'user_id'],
            ['venue.id', 'venue.user_id'],
            name=op.f('fk_tournament_venue_id_user_id_venue'),
        ),
        _owner_fk('tournament'),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_tournament')),
        sa.UniqueConstraint('id', 'user_id', name=op.f('uq_tournament_id_user_id')),
        sqlite_autoincrement=autoincrement,
    )
    op.create_index(
        op.f('ix_tournament_user_id'), 'tournament', ['user_id'], unique=False
    )


def _drop_tournament_indexes() -> None:
    op.drop_index(op.f('ix_tournament_user_id'), table_name='tournament')


# --------------------------------------------------------------------------
# game (forme de R10)
# --------------------------------------------------------------------------

GAME_COLUMNS = (
    'id',
    'user_id',
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


def _create_game(*, autoincrement: bool) -> None:
    # Même raison que pour `tournament` : l'ordre de création de R10.
    lot7_checks = [
        sa.CheckConstraint(
            "(round_type = 'casual') = (tournament_id IS NULL)",
            name=op.f('ck_game_casual_iff_no_tournament'),
        ),
        sa.CheckConstraint(
            "(round_type = 'preliminary') = (round_number IS NOT NULL)",
            name=op.f('ck_game_round_number_iff_preliminary'),
        ),
    ]
    op.create_table(
        'game',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('played_at', sa.DateTime(), nullable=False),
        sa.Column('venue_id', sa.Integer(), nullable=True),
        sa.Column('tournament_id', sa.Integer(), nullable=True),
        sa.Column('round_number', sa.Integer(), nullable=True),
        sa.Column(
            'round_type',
            _enum('round_type', ('casual', 'preliminary', 'final')),
            nullable=False,
        ),
        sa.Column('player_count', sa.Integer(), nullable=False),
        sa.Column('notes', sa.Text(), nullable=True),
        *_timestamps(),
        sa.CheckConstraint(
            'player_count >= 2', name=op.f('ck_game_player_count_minimum')
        ),
        sa.CheckConstraint(
            'round_number >= 1', name=op.f('ck_game_round_number_positive')
        ),
        *lot7_checks,
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
        sqlite_autoincrement=autoincrement,
    )
    op.create_index(
        op.f('ix_game_tournament_id'), 'game', ['tournament_id'], unique=False
    )
    op.create_index(op.f('ix_game_user_id'), 'game', ['user_id'], unique=False)
    op.create_index(
        'ux_game_preliminary_round',
        'game',
        ['user_id', 'tournament_id', 'round_number'],
        unique=True,
        sqlite_where=PRELIMINARY,
        postgresql_where=PRELIMINARY,
    )
    op.create_index(
        'ux_game_final',
        'game',
        ['user_id', 'tournament_id'],
        unique=True,
        sqlite_where=FINAL,
        postgresql_where=FINAL,
    )


def _drop_game_indexes() -> None:
    op.drop_index('ux_game_final', table_name='game')
    op.drop_index('ux_game_preliminary_round', table_name='game')
    op.drop_index(op.f('ix_game_user_id'), table_name='game')
    op.drop_index(op.f('ix_game_tournament_id'), table_name='game')


# --------------------------------------------------------------------------
# Recréation
# --------------------------------------------------------------------------

# table -> (colonnes recopiées, colonne du journal qui cite ce genre,
#           suppression des index nommés, création)
STEPS: dict[
    str,
    tuple[tuple[str, ...], str, Callable[[], None], Callable[..., None]],
] = {
    'venue': (VENUE_COLUMNS, 'venue_id', _drop_venue_indexes, _create_venue),
    'player': (PLAYER_COLUMNS, 'player_id', _drop_player_indexes, _create_player),
    'tournament': (
        TOURNAMENT_COLUMNS,
        'tournament_id',
        _drop_tournament_indexes,
        _create_tournament,
    ),
    'game': (GAME_COLUMNS, 'game_id', _drop_game_indexes, _create_game),
}
# Parents avant enfants ; la descente parcourt l'ordre à l'envers.
REBUILT_TABLES = ('venue', 'player', 'tournament', 'game')


def _rebuild(table: str, *, autoincrement: bool) -> None:
    """Recrée `table` avec ou sans `AUTOINCREMENT`, lignes comprises.

    Les index nommés partent d'abord : ils suivraient la table renommée et leur
    nom serait pris quand la nouvelle table voudrait les recréer. Les lignes
    sont recopiées avec leur identifiant.
    """
    columns_tuple, _, drop_indexes, create = STEPS[table]
    old = f'{table}{OLD_SUFFIX}'
    columns = ', '.join(columns_tuple)

    drop_indexes()
    op.rename_table(table, old)
    create(autoincrement=autoincrement)
    op.execute(f'INSERT INTO {table} ({columns}) SELECT {columns} FROM {old}')
    op.drop_table(old)


def _start_the_sequence(table: str) -> None:
    """Pose la séquence au-dessus de tout identifiant déjà attribué et connu.

    La recopie a déjà avancé la séquence jusqu'au plus grand identifiant
    recopié (SQLite la tient à jour sur une insertion explicite). On la
    réécrit pour y ajouter les identifiants que seul le journal retient : ceux
    des ressources créées puis supprimées par `/sync`. Une séquence à zéro
    n'est pas écrite, comme SQLite ne l'écrit pas pour une table vide.
    """
    journal_column = STEPS[table][1]
    op.execute(f"DELETE FROM sqlite_sequence WHERE name = '{table}'")
    op.execute(
        f"INSERT INTO sqlite_sequence (name, seq) SELECT '{table}', seq FROM ("
        f'SELECT MAX('
        f'COALESCE((SELECT MAX(id) FROM {table}), 0), '
        f'COALESCE((SELECT MAX({journal_column}) FROM sync_operation), 0)'
        f') AS seq) WHERE seq > 0'
    )


def upgrade() -> None:
    op.execute('PRAGMA legacy_alter_table = ON')
    for table in REBUILT_TABLES:
        _rebuild(table, autoincrement=True)
        _start_the_sequence(table)
    op.execute('PRAGMA legacy_alter_table = OFF')


def downgrade() -> None:
    op.execute('PRAGMA legacy_alter_table = ON')
    for table in reversed(REBUILT_TABLES):
        _rebuild(table, autoincrement=False)
    op.execute('PRAGMA legacy_alter_table = OFF')
