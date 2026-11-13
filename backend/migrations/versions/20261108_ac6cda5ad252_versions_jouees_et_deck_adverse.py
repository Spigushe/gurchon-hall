"""Versions jouées et deck adverse

Treizième révision, seule du Lot 8 (`docs/lot8-plan-analyse.md`, A1, A2, A8 et
A9). Elle donne au modèle de quoi figer la liste d'un deck quand il est joué,
décrire le deck d'un adversaire, et ferme la liste des archétypes.

* `deck_version` (nouvelle) — une liste figée d'un deck, numérotée par deck
  (`number` ≥ 1, unique par deck), en `AUTOINCREMENT` comme les tables du
  Lot 7 depuis R11. Clé composite (`deck_id`, `user_id`) vers `deck`, et
  unicité (`id`, `deck_id`, `user_id`) que visent les deux tables suivantes ;
* `deck_version_card` (nouvelle) — carte × quantité totale d'une version (P2),
  clé étrangère vers `card` seulement, comme `deleted_deck_card` vers
  `card_set` : une liste figée ne réserve rien ;
* `tournament_deck_version` (nouvelle, A9) — la version d'un deck dans un
  tournoi et la partie qui l'a figée ; sa clé primaire (`tournament_id`,
  `deck_id`) tient la règle « une version par deck et par tournoi » de P3 ;
* `participation` — `player_id` devient nullable (P6, adversaire non nommé) ;
  `deck_version_id`, avec une clé composite (`deck_version_id`, `deck_id`,
  `user_id`) vers `deck_version` et le CHECK
  `ck_participation_version_requires_deck` ; `opponent_deck_name` (120
  caractères), `opponent_deck_archetype` (les six archétypes, CHECK
  `ck_participation_deck_archetype`) et `opponent_clan_id` (clé étrangère vers
  `clan`) ;
* `deck` — `archetype` passe du texte libre (120 caractères) aux six codes
  `bleed`, `vote`, `wall`, `toolbox`, `rush`, `combo` (P5), sous le CHECK
  `ck_deck_deck_archetype`.

Le modèle passe à 28 tables et treize révisions.

**Recréation à la main, pas de mode batch**, comme R9 à R11 : supprimer les
index nommés, renommer la table (`<table>_avant_ac6cda5ad252`), créer la
nouvelle avec un DDL fixe, recopier les lignes (`INSERT … SELECT`), supprimer
l'ancienne. Une clé étrangère composite ou un CHECK ne s'ajoutent pas par
`ALTER TABLE` sous SQLite. `PRAGMA legacy_alter_table = ON` le temps de la
révision : renommer `deck`, que visent `deck_card`, `deleted_deck_card` et
`participation`, ne doit pas réécrire leurs clés étrangères vers la table
renommée (cf. R9). Les clés étrangères sont coupées par `migrations/env.py`,
qui passe un `foreign_key_check` final.

**Une seule conversion : l'archétype des decks.** Une valeur égale à l'un des
six codes une fois rognée et repliée (`fold_text`, « Toolbox » → `toolbox`)
devient ce code ; une valeur vide ou faite d'espaces devient NULL (elle ne
disait rien). Toute autre valeur fait **refuser la montée**, avant toute
modification, avec la liste des valeurs fautives : la révision ne devine pas
qu'un « stealth bleed » est un Bleed (patron des gardes du Lot 4). Les
participations sont recopiées telles quelles, colonnes nouvelles à NULL : la
révision ne fige aucune liste, puisque rien ne dit quelle liste a été jouée
(P4).

**Hors ligne.** La garde est sautée, et la montée se rend hors ligne
(`upgrade 8ab23342a26f:ac6cda5ad252 --sql`). Le script produit appelle
`fold_text`, fonction SQL que l'application enregistre sur chaque connexion
SQLite (`app.db.session`) : il se joue sur une connexion ouverte par
l'application, pas dans le client `sqlite3` nu.

**Descente** : refusée (`RuntimeError`, avant toute modification, avec le
nombre de lignes par motif) dès qu'il existe une version, une ligne qui porte
un champ adverse, ou une ligne sans joueur : le schéma d'avant ne sait
représenter aucune des trois. Sinon, elle rend les archétypes en texte, sans
perte, et retire les trois tables et les colonnes. Elle ne se rend pas hors
ligne, comme celle de R10 : sa garde lit les données (écart à A8, qui la
voulait hors ligne aussi ; une descente rendue sans garde perdrait les
versions sans prévenir).

Revision ID: ac6cda5ad252
Revises: 8ab23342a26f
Create Date: 2026-11-08 10:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import context, op

# Identifiants de révision utilisés par Alembic.
revision: str = 'ac6cda5ad252'
down_revision: str | Sequence[str] | None = '8ab23342a26f'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

OLD_SUFFIX = '_avant_ac6cda5ad252'

# Ordre de `app.models.enums.DeckArchetype`, que reproduit le texte des CHECK.
ARCHETYPES = ('bleed', 'vote', 'wall', 'toolbox', 'rush', 'combo')
ARCHETYPES_SQL = ', '.join(f"'{value}'" for value in ARCHETYPES)

# Archétype d'un deck tel que la montée le lit : rogné, replié, vide = NULL.
# La garde et la conversion emploient la même expression, si bien qu'une valeur
# acceptée par l'une est exactement une valeur convertie par l'autre.
FOLDED_ARCHETYPE = "NULLIF(fold_text(trim(archetype)), '')"


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


def _rename_away(table: str) -> str:
    old = f'{table}{OLD_SUFFIX}'
    op.rename_table(table, old)
    return old


# --------------------------------------------------------------------------
# deck
# --------------------------------------------------------------------------

DECK_COLUMNS = (
    'id',
    'user_id',
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


def _create_deck(*, lot8: bool) -> None:
    archetype_type = (
        _enum('deck_archetype', ARCHETYPES) if lot8 else sa.String(length=120)
    )
    op.create_table(
        'deck',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=120), nullable=False),
        sa.Column('discriminator', sa.String(length=4), nullable=False),
        sa.Column('created_on', sa.Date(), nullable=True),
        sa.Column(
            'status', _enum('deck_status', ('draft', 'active')), nullable=False
        ),
        sa.Column('archetype', archetype_type, nullable=True),
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
        sa.CheckConstraint(
            "discriminator GLOB '[0-9][0-9][0-9][0-9]' AND discriminator <> '0000'",
            name=op.f('ck_deck_discriminator_format'),
        ),
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


def _rebuild_deck(*, to_lot8: bool) -> None:
    """Recrée `deck`, archétype converti à la montée, recopié à la descente."""
    old = _rename_away('deck')
    _create_deck(lot8=to_lot8)
    columns = ', '.join(DECK_COLUMNS)
    selected = (
        columns.replace('archetype', FOLDED_ARCHETYPE, 1) if to_lot8 else columns
    )
    op.execute(f'INSERT INTO deck ({columns}) SELECT {selected} FROM {old}')
    op.drop_table(old)


# --------------------------------------------------------------------------
# deck_version, deck_version_card
# --------------------------------------------------------------------------


def _create_deck_version() -> None:
    op.create_table(
        'deck_version',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('deck_id', sa.Integer(), nullable=False),
        sa.Column('number', sa.Integer(), nullable=False),
        sa.Column(
            'created_at',
            sa.DateTime(),
            server_default=sa.text('(CURRENT_TIMESTAMP)'),
            nullable=False,
        ),
        sa.CheckConstraint(
            'number >= 1', name=op.f('ck_deck_version_number_positive')
        ),
        sa.ForeignKeyConstraint(
            ['deck_id', 'user_id'],
            ['deck.id', 'deck.user_id'],
            name=op.f('fk_deck_version_deck_id_user_id_deck'),
        ),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_deck_version')),
        sa.UniqueConstraint(
            'deck_id', 'number', name=op.f('uq_deck_version_deck_id_number')
        ),
        sa.UniqueConstraint(
            'id',
            'deck_id',
            'user_id',
            name=op.f('uq_deck_version_id_deck_id_user_id'),
        ),
        sqlite_autoincrement=True,
    )


def _create_deck_version_card() -> None:
    op.create_table(
        'deck_version_card',
        sa.Column('deck_version_id', sa.Integer(), nullable=False),
        sa.Column('card_id', sa.Integer(), nullable=False),
        sa.Column('quantity', sa.Integer(), nullable=False),
        sa.CheckConstraint(
            'quantity >= 1', name=op.f('ck_deck_version_card_quantity_positive')
        ),
        sa.ForeignKeyConstraint(
            ['deck_version_id'],
            ['deck_version.id'],
            name=op.f('fk_deck_version_card_deck_version_id_deck_version'),
            ondelete='CASCADE',
        ),
        sa.ForeignKeyConstraint(
            ['card_id'],
            ['card.id'],
            name=op.f('fk_deck_version_card_card_id_card'),
        ),
        sa.PrimaryKeyConstraint(
            'deck_version_id', 'card_id', name=op.f('pk_deck_version_card')
        ),
    )


# --------------------------------------------------------------------------
# participation
# --------------------------------------------------------------------------

# Colonnes communes aux deux formes, recopiées dans les deux sens.
PARTICIPATION_COLUMNS = (
    'id',
    'user_id',
    'game_id',
    'player_id',
    'deck_id',
    'seat',
    'victory_points',
    'game_win',
    'notes',
)
PARTICIPATION_INDEX = 'ix_participation_deck_id'


def _create_participation(*, lot8: bool) -> None:
    version_column = (
        [sa.Column('deck_version_id', sa.Integer(), nullable=True)] if lot8 else []
    )
    opponent_columns = (
        [
            sa.Column('opponent_deck_name', sa.String(length=120), nullable=True),
            sa.Column(
                'opponent_deck_archetype',
                _enum('deck_archetype', ARCHETYPES),
                nullable=True,
            ),
            sa.Column('opponent_clan_id', sa.Integer(), nullable=True),
        ]
        if lot8
        else []
    )
    lot8_constraints = (
        [
            sa.CheckConstraint(
                'deck_version_id IS NULL OR deck_id IS NOT NULL',
                name=op.f('ck_participation_version_requires_deck'),
            ),
            sa.ForeignKeyConstraint(
                ['deck_version_id', 'deck_id', 'user_id'],
                ['deck_version.id', 'deck_version.deck_id', 'deck_version.user_id'],
                name=op.f(
                    'fk_participation_deck_version_id_deck_id_user_id_deck_version'
                ),
            ),
            sa.ForeignKeyConstraint(
                ['opponent_clan_id'],
                ['clan.id'],
                name=op.f('fk_participation_opponent_clan_id_clan'),
            ),
        ]
        if lot8
        else []
    )
    op.create_table(
        'participation',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('game_id', sa.Integer(), nullable=False),
        # Nullable au Lot 8 (P6) : un adversaire peut ne pas être nommé.
        sa.Column('player_id', sa.Integer(), nullable=lot8),
        sa.Column('deck_id', sa.Integer(), nullable=True),
        *version_column,
        sa.Column('seat', sa.Integer(), nullable=True),
        sa.Column('victory_points', sa.Float(), nullable=True),
        sa.Column('game_win', sa.Boolean(), nullable=True),
        *opponent_columns,
        sa.Column('notes', sa.Text(), nullable=True),
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
        *lot8_constraints,
        _owner_fk('participation'),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_participation')),
    )
    op.create_index(
        op.f(PARTICIPATION_INDEX), 'participation', ['deck_id'], unique=False
    )


def _rebuild_participation(*, to_lot8: bool) -> None:
    """Recrée `participation` ; les colonnes du Lot 8 naissent à NULL à la
    montée et sont abandonnées à la descente (la garde les a trouvées vides)."""
    op.drop_index(op.f(PARTICIPATION_INDEX), table_name='participation')
    old = _rename_away('participation')
    _create_participation(lot8=to_lot8)
    columns = ', '.join(PARTICIPATION_COLUMNS)
    op.execute(f'INSERT INTO participation ({columns}) SELECT {columns} FROM {old}')
    op.drop_table(old)


# --------------------------------------------------------------------------
# tournament_deck_version
# --------------------------------------------------------------------------

TOURNAMENT_DECK_VERSION_INDEX = 'ix_tournament_deck_version_frozen_by_game_id'


def _create_tournament_deck_version() -> None:
    op.create_table(
        'tournament_deck_version',
        sa.Column('tournament_id', sa.Integer(), nullable=False),
        sa.Column('deck_id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('deck_version_id', sa.Integer(), nullable=False),
        sa.Column('frozen_by_game_id', sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(
            ['tournament_id', 'user_id'],
            ['tournament.id', 'tournament.user_id'],
            name=op.f('fk_tournament_deck_version_tournament_id_user_id_tournament'),
        ),
        sa.ForeignKeyConstraint(
            ['deck_version_id', 'deck_id', 'user_id'],
            ['deck_version.id', 'deck_version.deck_id', 'deck_version.user_id'],
            name=op.f(
                'fk_tournament_deck_version_deck_version_id_deck_id_user_id_'
                'deck_version'
            ),
        ),
        sa.ForeignKeyConstraint(
            ['frozen_by_game_id', 'user_id'],
            ['game.id', 'game.user_id'],
            name=op.f('fk_tournament_deck_version_frozen_by_game_id_user_id_game'),
        ),
        sa.PrimaryKeyConstraint(
            'tournament_id', 'deck_id', name=op.f('pk_tournament_deck_version')
        ),
    )
    op.create_index(
        op.f(TOURNAMENT_DECK_VERSION_INDEX),
        'tournament_deck_version',
        ['frozen_by_game_id'],
        unique=False,
    )


# --------------------------------------------------------------------------
# Gardes
# --------------------------------------------------------------------------

UNCONVERTIBLE_ARCHETYPES = (
    'SELECT DISTINCT archetype FROM deck'
    f' WHERE {FOLDED_ARCHETYPE} IS NOT NULL'
    f' AND {FOLDED_ARCHETYPE} NOT IN ({ARCHETYPES_SQL})'
    ' ORDER BY archetype'
)

# Ce que le schéma d'avant le Lot 8 ne sait pas représenter. Une ligne de
# `tournament_deck_version` ou une participation figée supposent une version :
# compter les versions suffit à les couvrir.
LOT8_DATA = {
    'deck_version': 'SELECT COUNT(*) FROM deck_version',
    'participation avec un deck adverse': (
        'SELECT COUNT(*) FROM participation'
        ' WHERE opponent_deck_name IS NOT NULL'
        ' OR opponent_deck_archetype IS NOT NULL'
        ' OR opponent_clan_id IS NOT NULL'
    ),
    'participation sans joueur': (
        'SELECT COUNT(*) FROM participation WHERE player_id IS NULL'
    ),
}


def _require_convertible_archetypes() -> None:
    """Refuse la montée si un deck porte un archétype hors des six codes.

    Précède toute modification ; sautée hors ligne, où la base n'est pas
    lisible.
    """
    if context.is_offline_mode():
        return
    bind = op.get_bind()
    values = [value for (value,) in bind.execute(sa.text(UNCONVERTIBLE_ARCHETYPES))]
    if not values:
        return
    listed = ', '.join(repr(value) for value in values)
    raise RuntimeError(
        'Migration ac6cda5ad252 (upgrade) interrompue avant toute modification : '
        f'archétype de deck hors des six codes ({", ".join(ARCHETYPES)}) : '
        f'{listed}. La révision ne devine pas lequel des six convient ; '
        'corrigez ou videz ces archétypes, puis relancez la montée.'
    )


def _require_no_lot8_data() -> None:
    """Refuse la descente dès qu'une donnée du Lot 8 existe. Précède toute
    modification ; ne se rend pas hors ligne, puisqu'elle lit la base."""
    if context.is_offline_mode():
        raise RuntimeError(
            'Migration ac6cda5ad252 (downgrade) : ce sens ne se rend pas hors '
            "ligne (`--sql`). Il doit d'abord vérifier qu'aucune version de "
            'deck ni aucun deck adverse n\'existe. Redescendez sur une '
            'connexion réelle. La montée, elle, se rend hors ligne.'
        )
    bind = op.get_bind()
    found = {}
    for label, sql in LOT8_DATA.items():
        count = bind.execute(sa.text(sql)).scalar_one()
        if count:
            found[label] = count
    if not found:
        return
    detail = ', '.join(f'{label} : {count}' for label, count in found.items())
    raise RuntimeError(
        'Migration ac6cda5ad252 (downgrade) interrompue : la base contient des '
        f"données du Lot 8 ({detail}). Le schéma d'avant ne sait pas les "
        'représenter ; on ne redescend pas sous le Lot 8 une fois des parties '
        'figées ou des decks adverses saisis.'
    )


def upgrade() -> None:
    _require_convertible_archetypes()

    op.execute('PRAGMA legacy_alter_table = ON')
    _rebuild_deck(to_lot8=True)
    _create_deck_version()
    _create_deck_version_card()
    _rebuild_participation(to_lot8=True)
    _create_tournament_deck_version()
    op.execute('PRAGMA legacy_alter_table = OFF')


def downgrade() -> None:
    _require_no_lot8_data()

    op.execute('PRAGMA legacy_alter_table = ON')
    op.drop_index(
        op.f(TOURNAMENT_DECK_VERSION_INDEX), table_name='tournament_deck_version'
    )
    op.drop_table('tournament_deck_version')
    _rebuild_participation(to_lot8=False)
    op.drop_table('deck_version_card')
    op.drop_table('deck_version')
    _rebuild_deck(to_lot8=False)
    op.execute('PRAGMA legacy_alter_table = OFF')
