"""Discriminant de deck, decklist figee et legalite

Quatre changements, tous issus de la relecture du Lot 2 :

1. **`deck.discriminator`** — quatre chiffres tirés par le serveur, qui
   distinguent deux decks de même nom (« Malkavien 2022#8561 »). L'unicité
   passe du nom seul au couple (nom, discriminant), sur *tous* les decks,
   supprimés compris : l'index partiel `uq_deck_name_not_deleted` disparaît.
   Les decks déjà en base sont numérotés par nom, dans l'ordre des id.
2. **`deck.status` perd `retired`** — « rangé » est une date (`archived_at`),
   pas un statut. Les decks `retired` deviennent `active` et prennent leur
   `updated_at` comme date d'archivage.
3. **`deleted_deck_card`** — la decklist figée d'un deck supprimé. Sans clé
   étrangère vers `card_copy` : un deck supprimé ne retient plus aucune entrée
   de collection.
4. **`card.legal_from`** et l'index (nom, groupe, advanced) — la date d'entrée
   en légalité publiée par krcg, et de quoi retrouver une carte de crypt par son
   triplet identifiant.

Deux points de méthode :

* le rattrapage des discriminants et le renommage du `downgrade` sont écrits en
  Python plutôt qu'en SQL : ils dépendent d'un comptage par nom, qu'aucune
  expression portable ne rend lisiblement. Corollaire assumé : cette révision ne
  se joue pas hors ligne (`--sql`), ce que le mode batch interdisait déjà ;
* les `ALTER TABLE` de SQLite passent par le mode batch, qui recrée la table.
  C'est `migrations/env.py` qui rend l'opération sûre, en coupant les clés
  étrangères le temps de la migration puis en vérifiant la base.

Revision ID: 5dc50e3c1701
Revises: de3b00e38c8d
Create Date: 2026-09-19 20:29:21.454405

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# Identifiants de révision utilisés par Alembic.
revision: str = '5dc50e3c1701'
down_revision: str | Sequence[str] | None = 'de3b00e38c8d'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

NAME_MAX_LENGTH = 120
DISCRIMINATOR_FORMAT = (
    "discriminator GLOB '[0-9][0-9][0-9][0-9]' AND discriminator <> '0000'"
)
PARTIAL_INDEX_WHERE = sa.text("deleted_at IS NULL")


def _fill_discriminators() -> None:
    """Numérote les decks existants : 0001, 0002… par nom, dans l'ordre des id.

    Deux decks de même nom ne se distinguaient jusqu'ici que par leur id ; le
    plus ancien prend donc « 0001 ». Au-delà de 9999 homonymes, la contrainte de
    format refuserait la valeur — cas de figure sans réalité pour une collection
    personnelle.
    """
    bind = op.get_bind()
    rows = bind.execute(sa.text("SELECT id, name FROM deck ORDER BY name, id"))
    seen: dict[str, int] = {}
    for deck_id, name in rows.fetchall():
        seen[name] = seen.get(name, 0) + 1
        bind.execute(
            sa.text("UPDATE deck SET discriminator = :value WHERE id = :id"),
            {"value": f"{seen[name]:04d}", "id": deck_id},
        )


def _merge_names_into_discriminated_names() -> None:
    """Rend les noms uniques avant de restaurer l'unicité du nom seul.

    Les decks qui partagent un nom prennent le nom affiché par l'application,
    « nom#discriminant », tronqué à la longueur de la colonne. Le discriminant
    est conservé en entier : c'est lui qui distingue.
    """
    bind = op.get_bind()
    rows = bind.execute(
        sa.text(
            "SELECT id, name, discriminator FROM deck WHERE name IN"
            " (SELECT name FROM deck GROUP BY name HAVING COUNT(*) > 1)"
        )
    )
    for deck_id, name, discriminator in rows.fetchall():
        suffix = f"#{discriminator}"
        merged = name[: NAME_MAX_LENGTH - len(suffix)] + suffix
        bind.execute(
            sa.text("UPDATE deck SET name = :value WHERE id = :id"),
            {"value": merged, "id": deck_id},
        )


def upgrade() -> None:
    # --- Catalogue : date de légalité et index d'identification ------------
    # `ADD COLUMN` et `CREATE INDEX` sont les deux seules formes d'`ALTER
    # TABLE` que SQLite accepte : pas de mode batch ici, donc pas de recopie
    # des 4149 cartes et de leurs tables liées.
    op.add_column('card', sa.Column('legal_from', sa.Date(), nullable=True))
    op.create_index(
        'ix_card_name_group_code_advanced',
        'card',
        ['name', 'group_code', 'advanced'],
        unique=False,
    )

    # --- Decks : discriminant, unicité, statuts ----------------------------
    # La colonne naît nullable, le temps de numéroter l'existant ; elle passe
    # NOT NULL dans le batch qui suit, une fois toutes les lignes servies.
    op.add_column('deck', sa.Column('discriminator', sa.String(length=4), nullable=True))
    _fill_discriminators()

    # « Retiré » devient « rangé » : le statut disparaît, la date le remplace.
    # L'ordre compte — poser `archived_at` d'abord, pendant que la valeur
    # `retired` existe encore.
    op.execute(
        "UPDATE deck SET archived_at = updated_at"
        " WHERE status = 'retired' AND archived_at IS NULL"
    )
    op.execute("UPDATE deck SET status = 'active' WHERE status = 'retired'")

    with op.batch_alter_table('deck', schema=None) as batch_op:
        batch_op.alter_column(
            'discriminator', existing_type=sa.String(length=4), nullable=False
        )
        batch_op.drop_index(
            'uq_deck_name_not_deleted',
            sqlite_where=PARTIAL_INDEX_WHERE,
            postgresql_where=PARTIAL_INDEX_WHERE,
        )
        batch_op.create_unique_constraint(
            batch_op.f('uq_deck_name_discriminator'), ['name', 'discriminator']
        )
        batch_op.create_check_constraint(
            batch_op.f('ck_deck_discriminator_format'), DISCRIMINATOR_FORMAT
        )
        # L'énumération est un VARCHAR assorti d'un CHECK : perdre « retired »,
        # c'est raccourcir la colonne d'un caractère *et* réécrire le CHECK.
        batch_op.alter_column(
            'status',
            existing_type=sa.String(length=7),
            type_=sa.String(length=6),
            existing_nullable=False,
        )
        batch_op.drop_constraint(batch_op.f('ck_deck_deck_status'), type_='check')
        batch_op.create_check_constraint(
            batch_op.f('ck_deck_deck_status'), "status IN ('draft', 'active')"
        )

    # --- Decklist figée d'un deck supprimé ---------------------------------
    # Les clés étrangères vont vers `card` et `language`, jamais vers
    # `card_copy` : c'est tout l'intérêt de la table.
    op.create_table(
        'deleted_deck_card',
        sa.Column('deck_id', sa.Integer(), nullable=False),
        sa.Column('card_id', sa.Integer(), nullable=False),
        sa.Column('language_code', sa.String(length=8), nullable=False),
        sa.Column('quantity', sa.Integer(), nullable=False),
        sa.Column('proxy_quantity', sa.Integer(), nullable=False),
        sa.CheckConstraint(
            'quantity >= 1', name=op.f('ck_deleted_deck_card_quantity_positive')
        ),
        sa.CheckConstraint(
            'proxy_quantity >= 0 AND proxy_quantity <= quantity',
            name=op.f('ck_deleted_deck_card_proxy_quantity_within_quantity'),
        ),
        sa.ForeignKeyConstraint(
            ['card_id'],
            ['card.id'],
            name=op.f('fk_deleted_deck_card_card_id_card'),
        ),
        sa.ForeignKeyConstraint(
            ['deck_id'],
            ['deck.id'],
            name=op.f('fk_deleted_deck_card_deck_id_deck'),
            ondelete='CASCADE',
        ),
        sa.ForeignKeyConstraint(
            ['language_code'],
            ['language.code'],
            name=op.f('fk_deleted_deck_card_language_code_language'),
        ),
        sa.PrimaryKeyConstraint(
            'deck_id', 'card_id', 'language_code', name=op.f('pk_deleted_deck_card')
        ),
    )


def downgrade() -> None:
    # Perte assumée : les decklists figées disparaissent. Les decks supprimés
    # logiquement restent en base et redeviennent, pour le schéma d'avant, des
    # decks ordinaires — sans composition, puisque leurs lignes vivantes
    # avaient été déplacées ici à la suppression.
    op.drop_table('deleted_deck_card')

    # Le nom redevient seul discriminant : les homonymes prennent le nom
    # affiché (« nom#0002 ») avant que la contrainte ne revienne.
    _merge_names_into_discriminated_names()

    with op.batch_alter_table('deck', schema=None) as batch_op:
        batch_op.drop_constraint(
            batch_op.f('ck_deck_discriminator_format'), type_='check'
        )
        batch_op.drop_constraint(
            batch_op.f('uq_deck_name_discriminator'), type_='unique'
        )
        batch_op.alter_column(
            'status',
            existing_type=sa.String(length=6),
            type_=sa.String(length=7),
            existing_nullable=False,
        )
        batch_op.drop_constraint(batch_op.f('ck_deck_deck_status'), type_='check')
        batch_op.create_check_constraint(
            batch_op.f('ck_deck_deck_status'),
            "status IN ('draft', 'active', 'retired')",
        )
        batch_op.create_index(
            'uq_deck_name_not_deleted',
            ['name'],
            unique=True,
            sqlite_where=PARTIAL_INDEX_WHERE,
            postgresql_where=PARTIAL_INDEX_WHERE,
        )
        batch_op.drop_column('discriminator')

    op.drop_index('ix_card_name_group_code_advanced', table_name='card')
    op.drop_column('card', 'legal_from')
