"""Pratique de jeu

Dixième révision, seule du Lot 7 (`docs/lot7-plan-parties.md`, « R10 »). Les
tables de la pratique existent depuis le Lot 1 et portent leur propriétaire
depuis R9 ; elle les complète pour les règles du lot, élargit le journal de
synchronisation aux quatre nouveaux genres de ressource, et donne un « Moi » à
chaque compte.

* `tournament` — `player_count` (nullable, au moins 2 : P6), `event_tier`
  (non nul, `standard` pour toute ligne existante) et `final_deck_rule`
  (nullable), avec deux contraintes croisées : la règle du deck de finale n'a
  de sens qu'en multi-deck (`ck_tournament_final_deck_rule_only_multi`), et le
  multi-deck n'existe qu'au niveau standard
  (`ck_tournament_multi_only_standard_tier`, VEKN 3.1.5) (A11) ;
* `game` — une amicale n'a pas de tournoi et une partie de tournoi en a un
  (`ck_game_casual_iff_no_tournament`), seule une préliminaire porte un numéro
  de ronde (`ck_game_round_number_iff_preliminary`), une préliminaire par
  numéro et par tournoi (`ux_game_preliminary_round`), une finale par tournoi
  (`ux_game_final`) (A6) ;
* `sync_operation` — `player_id`, `venue_id`, `tournament_id`, `game_id`,
  nullables et sans clé étrangère, comme `deck_id` (A10) ; les CHECK de
  `sync_operation_type` et `sync_resource_kind` gagnent les douze types et les
  quatre genres du Lot 7 ;
* `player` — aucune colonne ne change, mais chaque compte qui n'en a pas reçoit
  son « Moi » (`name` = `username`, `is_me` = 1) (A1).

`participation` ne change pas : un adversaire n'a ni VP ni GW, ce qui dépend de
`player.is_me` et reste au service (A13, P7).

**Recréation à la main, pas de mode batch**, comme R9 et `f3a91c47b2de`, pour
que l'ordre des contraintes soit stable d'un processus à l'autre : supprimer
les index nommés, renommer la table (`<table>_avant_783b24f9e769`), créer la
nouvelle avec un DDL fixe, recopier les lignes (`INSERT … SELECT`), supprimer
l'ancienne. `PRAGMA legacy_alter_table = ON` le temps de la révision, pour que
renommer `tournament` ou `game` ne réécrive pas les clés étrangères de `game`
et `participation` (cf. R9).

**Le journal est la seule table peuplée du lot.** Ses lignes sont recopiées à
l'identique, nouvelles colonnes à NULL : même identifiant, même empreinte, même
verdict, même `client_ref`. Une opération déjà tranchée qui attend encore dans
une file reste un rejeu.

**Insertion des « Moi ».** Deuxième conversion de données du projet après R9,
aussi simple : une ligne par compte qui n'a pas encore de « Moi », sans choix à
faire. Le code qui crée le « Moi » à l'inscription part avec cette révision ;
un compte créé entre les deux n'en aurait pas.

**Gardes de montée**, avant toute modification, sautées hors ligne : une partie
déjà en base qui contredirait les nouvelles contraintes de `game`, ou un compte
sans « Moi » qui aurait déjà un joueur du nom de son `username`, arrêtent la
révision avec un message plutôt qu'avec une erreur de contrainte. Les tables de
la pratique n'ayant jamais eu de route, aucune base en service n'est concernée.
Sans réflexion de schéma par ailleurs, la **montée se rend hors ligne**
(`upgrade 89695b77ef45:783b24f9e769 --sql`).

**Descente** : refusée (`RuntimeError`, avant toute modification, avec le
nombre de lignes par table) dès qu'il existe un tournoi, une partie, une
participation ou une opération du journal qui relève du Lot 7. On ne redescend
pas sous le Lot 7 une fois des parties saisies. Les lieux et les adversaires,
dont la forme ne change pas, ne bloquent rien et restent en place. Sinon, elle
retire les « Moi » (qu'aucune participation ne peut plus désigner), les
colonnes, les contraintes et les index. Elle ne se rend pas hors ligne : sa
garde lit les données.

Revision ID: 783b24f9e769
Revises: 89695b77ef45
Create Date: 2026-10-29 14:00:00.000000

"""

from collections.abc import Callable, Sequence

import sqlalchemy as sa
from alembic import context, op

# Identifiants de révision utilisés par Alembic.
revision: str = '783b24f9e769'
down_revision: str | Sequence[str] | None = '89695b77ef45'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

OLD_SUFFIX = '_avant_783b24f9e769'

APPLIED_CLIENT_REF = sa.text("client_ref IS NOT NULL AND status = 'applied'")
PRELIMINARY = sa.text("round_type = 'preliminary'")
FINAL = sa.text("round_type = 'final'")

# Valeurs d'énumération avant et après la révision. L'ordre est celui des
# `StrEnum` de `app.models.enums`, que reproduit le texte des CHECK.
SYNC_OPERATION_TYPES_LOT6 = (
    'stock.upsert',
    'stock.delete',
    'deck.create',
    'deck.update',
    'deck.delete',
    'deck_card.upsert',
    'deck_card.delete',
    'bundle.deposit',
)
SYNC_OPERATION_TYPES_LOT7 = (
    'player.create',
    'player.update',
    'player.delete',
    'venue.create',
    'venue.update',
    'venue.delete',
    'tournament.create',
    'tournament.update',
    'tournament.delete',
    'game.create',
    'game.update',
    'game.delete',
)
SYNC_RESOURCE_KINDS_LOT6 = ('card_copy', 'deck', 'deck_card', 'bundle')
SYNC_RESOURCE_KINDS_LOT7 = ('player', 'venue', 'tournament', 'game')

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
# tournament
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
    'round_count',
    'my_ranking',
    'notes',
    'created_at',
    'updated_at',
)


def _create_tournament(*, lot7: bool) -> None:
    lot7_columns = (
        [
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
        ]
        if lot7
        else []
    )
    lot7_player_count = (
        [sa.Column('player_count', sa.Integer(), nullable=True)] if lot7 else []
    )
    lot7_checks = (
        [
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
        if lot7
        else []
    )
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
        *lot7_columns,
        sa.Column('round_count', sa.Integer(), nullable=True),
        *lot7_player_count,
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
    )
    op.create_index(
        op.f('ix_tournament_user_id'), 'tournament', ['user_id'], unique=False
    )


def _drop_tournament_indexes(*, lot7: bool) -> None:
    op.drop_index(op.f('ix_tournament_user_id'), table_name='tournament')


# --------------------------------------------------------------------------
# game
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


def _create_game(*, lot7: bool) -> None:
    lot7_checks = (
        [
            sa.CheckConstraint(
                "(round_type = 'casual') = (tournament_id IS NULL)",
                name=op.f('ck_game_casual_iff_no_tournament'),
            ),
            sa.CheckConstraint(
                "(round_type = 'preliminary') = (round_number IS NOT NULL)",
                name=op.f('ck_game_round_number_iff_preliminary'),
            ),
        ]
        if lot7
        else []
    )
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
    )
    op.create_index(
        op.f('ix_game_tournament_id'), 'game', ['tournament_id'], unique=False
    )
    op.create_index(op.f('ix_game_user_id'), 'game', ['user_id'], unique=False)
    if lot7:
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


def _drop_game_indexes(*, lot7: bool) -> None:
    if lot7:
        op.drop_index('ux_game_final', table_name='game')
        op.drop_index('ux_game_preliminary_round', table_name='game')
    op.drop_index(op.f('ix_game_user_id'), table_name='game')
    op.drop_index(op.f('ix_game_tournament_id'), table_name='game')


# --------------------------------------------------------------------------
# sync_operation
# --------------------------------------------------------------------------

SYNC_OPERATION_COLUMNS = (
    'id',
    'user_id',
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


def _create_sync_operation(*, lot7: bool) -> None:
    operation_types = SYNC_OPERATION_TYPES_LOT6 + (
        SYNC_OPERATION_TYPES_LOT7 if lot7 else ()
    )
    resource_kinds = SYNC_RESOURCE_KINDS_LOT6 + (
        SYNC_RESOURCE_KINDS_LOT7 if lot7 else ()
    )
    lot7_columns = (
        [
            sa.Column('player_id', sa.Integer(), nullable=True),
            sa.Column('venue_id', sa.Integer(), nullable=True),
            sa.Column('tournament_id', sa.Integer(), nullable=True),
            sa.Column('game_id', sa.Integer(), nullable=True),
        ]
        if lot7
        else []
    )
    op.create_table(
        'sync_operation',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('operation_id', sa.String(length=36), nullable=False),
        sa.Column('batch_id', sa.String(length=36), nullable=False),
        sa.Column(
            'operation_type',
            _enum('sync_operation_type', operation_types),
            nullable=False,
        ),
        sa.Column('request_hash', sa.String(length=64), nullable=False),
        sa.Column(
            'status',
            _enum('sync_operation_status', ('applied', 'rejected')),
            nullable=False,
        ),
        sa.Column(
            'error_code',
            _enum(
                'sync_error_code',
                (
                    'not_found',
                    'conflict',
                    'invalid',
                    'unresolved_client_ref',
                    'mismatched_replay',
                ),
            ),
            nullable=True,
        ),
        sa.Column('error_message', sa.Text(), nullable=True),
        sa.Column('client_ref', sa.String(length=64), nullable=True),
        sa.Column(
            'resource_kind',
            _enum('sync_resource_kind', resource_kinds),
            nullable=True,
        ),
        sa.Column('deck_id', sa.Integer(), nullable=True),
        sa.Column('card_id', sa.Integer(), nullable=True),
        sa.Column('language_code', sa.String(length=8), nullable=True),
        sa.Column('card_set_id', sa.Integer(), nullable=True),
        sa.Column('bundle_id', sa.Integer(), nullable=True),
        *lot7_columns,
        sa.Column('recorded_at', sa.DateTime(), nullable=False),
        sa.Column('processed_at', sa.DateTime(), nullable=False),
        sa.CheckConstraint(
            "(status = 'rejected') = (error_code IS NOT NULL)",
            name=op.f('ck_sync_operation_error_code_iff_rejected'),
        ),
        sa.CheckConstraint(
            "status <> 'applied' OR resource_kind IS NOT NULL",
            name=op.f('ck_sync_operation_resource_kind_when_applied'),
        ),
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


def _drop_sync_operation_indexes(*, lot7: bool) -> None:
    op.drop_index('ux_sync_operation_client_ref', table_name='sync_operation')
    op.drop_index('ix_sync_operation_batch_id', table_name='sync_operation')


# --------------------------------------------------------------------------
# Recréation
# --------------------------------------------------------------------------

# table -> (colonnes communes recopiées, colonnes posées à la montée avec leur
#           valeur, suppression des index, création)
STEPS: dict[
    str,
    tuple[
        tuple[str, ...],
        dict[str, str],
        Callable[..., None],
        Callable[..., None],
    ],
] = {
    'tournament': (
        TOURNAMENT_COLUMNS,
        {'event_tier': "'standard'"},
        _drop_tournament_indexes,
        _create_tournament,
    ),
    'game': (GAME_COLUMNS, {}, _drop_game_indexes, _create_game),
    'sync_operation': (
        SYNC_OPERATION_COLUMNS,
        {},
        _drop_sync_operation_indexes,
        _create_sync_operation,
    ),
}
REBUILT_TABLES = ('tournament', 'game', 'sync_operation')


def _rebuild(table: str, *, to_lot7: bool) -> None:
    """Recrée `table` sous sa forme d'arrivée, lignes comprises.

    Les index nommés partent d'abord : ils suivraient la table renommée et leur
    nom serait pris quand la nouvelle table voudrait les recréer. Les colonnes
    propres au Lot 7 reçoivent leur valeur de départ à la montée (NULL sauf
    mention), et sont simplement abandonnées à la descente.
    """
    common, set_on_upgrade, drop_indexes, create = STEPS[table]
    old = f'{table}{OLD_SUFFIX}'
    columns = ', '.join(common)

    drop_indexes(lot7=not to_lot7)
    op.rename_table(table, old)
    create(lot7=to_lot7)
    if to_lot7 and set_on_upgrade:
        extra_names = ', '.join(set_on_upgrade)
        extra_values = ', '.join(set_on_upgrade.values())
        op.execute(
            f'INSERT INTO {table} ({columns}, {extra_names})'
            f' SELECT {columns}, {extra_values} FROM {old}'
        )
    else:
        op.execute(f'INSERT INTO {table} ({columns}) SELECT {columns} FROM {old}')
    op.drop_table(old)


def _insert_the_missing_mes() -> None:
    """Un « Moi » par compte qui n'en a pas, nommé d'après son `username`."""
    op.execute(
        'INSERT INTO player (user_id, name, is_me)'
        ' SELECT a.id, a.username, 1 FROM user_account a'
        ' WHERE NOT EXISTS ('
        '  SELECT 1 FROM player p WHERE p.user_id = a.id AND p.is_me = 1'
        ' )'
        ' ORDER BY a.id'
    )


# --------------------------------------------------------------------------
# Gardes
# --------------------------------------------------------------------------

# Parties qui contrediraient une contrainte posée par cette révision.
GAME_VIOLATIONS = {
    'amicale avec tournoi ou partie de tournoi sans tournoi': (
        "SELECT COUNT(*) FROM game"
        " WHERE (round_type = 'casual') <> (tournament_id IS NULL)"
    ),
    'numéro de ronde hors préliminaire, ou préliminaire sans numéro': (
        "SELECT COUNT(*) FROM game"
        " WHERE (round_type = 'preliminary') <> (round_number IS NOT NULL)"
    ),
    'même ronde préliminaire saisie deux fois': (
        "SELECT COALESCE(SUM(n - 1), 0) FROM ("
        " SELECT COUNT(*) AS n FROM game WHERE round_type = 'preliminary'"
        " GROUP BY user_id, tournament_id, round_number)"
    ),
    'plusieurs finales pour un tournoi': (
        "SELECT COALESCE(SUM(n - 1), 0) FROM ("
        " SELECT COUNT(*) AS n FROM game WHERE round_type = 'final'"
        " GROUP BY user_id, tournament_id)"
    ),
}

MES_NAME_TAKEN = (
    'SELECT a.username FROM user_account a'
    ' JOIN player p ON p.user_id = a.id AND p.name = a.username AND p.is_me = 0'
    ' WHERE NOT EXISTS ('
    '  SELECT 1 FROM player m WHERE m.user_id = a.id AND m.is_me = 1'
    ' )'
    ' ORDER BY a.id'
)

LOT7_OPERATION_TYPES_SQL = ', '.join(f"'{value}'" for value in SYNC_OPERATION_TYPES_LOT7)
LOT7_RESOURCE_KINDS_SQL = ', '.join(f"'{value}'" for value in SYNC_RESOURCE_KINDS_LOT7)

# Données de pratique qui interdisent la descente. `venue` et `player` n'y
# sont pas : leur forme ne change pas, et leurs lignes survivent à la descente.
PRACTICE_DATA = {
    'tournament': 'SELECT COUNT(*) FROM tournament',
    'game': 'SELECT COUNT(*) FROM game',
    'participation': 'SELECT COUNT(*) FROM participation',
    'sync_operation (Lot 7)': (
        'SELECT COUNT(*) FROM sync_operation'
        f' WHERE operation_type IN ({LOT7_OPERATION_TYPES_SQL})'
        f' OR resource_kind IN ({LOT7_RESOURCE_KINDS_SQL})'
        ' OR player_id IS NOT NULL OR venue_id IS NOT NULL'
        ' OR tournament_id IS NOT NULL OR game_id IS NOT NULL'
    ),
}


def _require_a_consistent_starting_point() -> None:
    """Refuse la montée si une ligne existante contredit la forme d'arrivée.

    Les tables de la pratique n'ont jamais eu de route : seule une ligne posée
    à la main peut déclencher cette garde. Elle précède toute modification, et
    elle est sautée hors ligne, où la base n'est pas lisible.
    """
    if context.is_offline_mode():
        return
    bind = op.get_bind()
    problems = []
    for label, sql in GAME_VIOLATIONS.items():
        count = bind.execute(sa.text(sql)).scalar_one()
        if count:
            problems.append(f'game, {label} : {count}')
    taken = [name for (name,) in bind.execute(sa.text(MES_NAME_TAKEN))]
    if taken:
        problems.append(
            'player, nom du futur « Moi » déjà pris par un autre joueur du même '
            f'compte : {", ".join(taken)}'
        )
    if not problems:
        return
    raise RuntimeError(
        'Migration 783b24f9e769 (upgrade) interrompue avant toute modification : '
        + ' ; '.join(problems)
        + '. Corrigez ou supprimez ces lignes, puis relancez la montée.'
    )


def _require_no_practice_data() -> None:
    """Refuse la descente dès qu'un tournoi, une partie ou une opération du
    Lot 7 existe.

    Le schéma d'avant ne sait pas porter le niveau d'un tournoi, sa règle de
    deck de finale, son nombre de joueurs, ni une opération du journal d'un
    genre du Lot 7 ; plutôt que de trier ce qui se perdrait, on ne redescend
    pas sous le Lot 7 une fois des parties saisies. Une participation bloque
    aussi : elle peut désigner un « Moi », que la descente supprime. La garde
    précède toute modification.
    """
    if context.is_offline_mode():
        raise RuntimeError(
            'Migration 783b24f9e769 (downgrade) : ce sens ne se rend pas hors '
            "ligne (`--sql`). Il doit d'abord vérifier qu'aucune donnée de "
            'pratique n\'existe. Redescendez sur une connexion réelle. La '
            'montée, elle, se rend hors ligne.'
        )
    bind = op.get_bind()
    found = {}
    for label, sql in PRACTICE_DATA.items():
        count = bind.execute(sa.text(sql)).scalar_one()
        if count:
            found[label] = count
    if not found:
        return
    detail = ', '.join(f'{label} : {count}' for label, count in found.items())
    raise RuntimeError(
        'Migration 783b24f9e769 (downgrade) interrompue : la base contient des '
        f'données de pratique ({detail}). Le schéma d\'avant le Lot 7 ne sait pas '
        'toutes les représenter ; on ne redescend pas sous le Lot 7 une fois des '
        'parties saisies.'
    )


def upgrade() -> None:
    _require_a_consistent_starting_point()

    op.execute('PRAGMA legacy_alter_table = ON')
    for table in REBUILT_TABLES:
        _rebuild(table, to_lot7=True)
    op.execute('PRAGMA legacy_alter_table = OFF')
    _insert_the_missing_mes()


def downgrade() -> None:
    _require_no_practice_data()

    op.execute('DELETE FROM player WHERE is_me = 1')
    op.execute('PRAGMA legacy_alter_table = ON')
    for table in reversed(REBUILT_TABLES):
        _rebuild(table, to_lot7=False)
    op.execute('PRAGMA legacy_alter_table = OFF')
