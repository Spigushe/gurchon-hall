"""Comptes et sessions

Huitième révision, première du Lot 6 (`docs/lot6-plan-comptes.md`, « R8 »).
Elle crée les deux tables de l'authentification et le compte historique, sans
toucher à aucune table existante : le rattachement des données à ce compte est
l'affaire de la révision suivante (`89695b77ef45`, « R9 »).

* `user_account` — un compte : adresse e-mail (identifiant de connexion,
  unique), nom d'utilisateur (handle public, unique), empreinte du mot de passe
  (chaîne PHC Argon2id), rôle (`user` ou `admin`, enum fermé porté par un CHECK
  nommé, `user` par défaut jusque dans la base), horodatages.
* `auth_session` — une session : compte (clé étrangère en cascade, indexée),
  empreinte SHA-256 du jeton (unique, c'est la clé de recherche), instant de
  création et échéance fixe.

**Le compte historique (D6).** La révision insère le compte d'identifiant `1`,
nom `compte-historique`, adresse `compte-historique@gurchon-hall.invalid`
(domaine réservé par la RFC 2606, qui ne peut appartenir à personne), rôle
`admin` (P4), mot de passe `!` : ce n'est pas une empreinte Argon2, donc la
vérification échoue toujours et personne ne peut s'y connecter tant que
`scripts/manage_accounts.py claim-legacy` n'a pas posé la vraie adresse, le
vrai nom et un vrai secret. Les horodatages viennent des défauts de la base
(`CURRENT_TIMESTAMP`), c'est-à-dire de l'instant de la migration.

Valeurs littérales, aucune lecture de la base, aucune variable d'environnement :
la **montée se rend hors ligne** (`upgrade f3a91c47b2de:32d62f354d89 --sql`) et
se rejoue à l'identique partout.

**Descente** : refusée (`RuntimeError`, avant toute modification) s'il existe un
compte autre que le compte historique. Supprimer `user_account` perdrait des
comptes que des personnes ont créés, avec leurs identifiants ; un arrêt
explicite qui les nomme vaut mieux. Avec le seul compte historique, la descente
supprime les deux tables, sessions comprises. En pratique, la révision suivante
doit être redescendue d'abord, et elle a sa propre garde. La descente ne se rend
pas hors ligne : sa garde doit lire la table.

Revision ID: 32d62f354d89
Revises: f3a91c47b2de
Create Date: 2026-10-01 19:10:43.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import context, op

# Identifiants de révision utilisés par Alembic.
revision: str = '32d62f354d89'
down_revision: str | Sequence[str] | None = 'f3a91c47b2de'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Valeurs figées ici plutôt qu'importées de `app.models.account` : une révision
# décrit l'état à une date donnée et ne doit pas suivre le code applicatif.
LEGACY_ACCOUNT_ID = 1
LEGACY_USERNAME = 'compte-historique'
LEGACY_EMAIL = 'compte-historique@gurchon-hall.invalid'
LEGACY_ROLE = 'admin'
UNUSABLE_PASSWORD_HASH = '!'


def _require_only_the_legacy_account() -> None:
    """Refuse la descente s'il existe un autre compte que le compte historique."""
    if context.is_offline_mode():
        raise RuntimeError(
            'Migration 32d62f354d89 (downgrade) : ce sens ne se rend pas hors '
            "ligne (`--sql`). Il supprime les comptes, et doit d'abord vérifier "
            "qu'aucun autre compte que le compte historique n'existe. "
            'Redescendez sur une connexion réelle. La montée, elle, se rend '
            'hors ligne.'
        )
    others = (
        op.get_bind()
        .execute(
            sa.text(
                'SELECT id, username FROM user_account WHERE id <> :legacy ORDER BY id'
            ),
            {'legacy': LEGACY_ACCOUNT_ID},
        )
        .fetchall()
    )
    if not others:
        return
    sample = ', '.join(f'{username} (id {user_id})' for user_id, username in others[:5])
    raise RuntimeError(
        'Migration 32d62f354d89 (downgrade) interrompue : elle supprime la table '
        f'des comptes, or {len(others)} compte(s) autre(s) que le compte '
        f'historique existe(nt) : {sample}. Revenir sous le Lot 6 les ferait '
        'disparaître avec leurs identifiants. On ne redescend pas sous le Lot 6 '
        "tant qu'il existe un autre compte que le compte historique."
    )


def upgrade() -> None:
    op.create_table(
        'user_account',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('email', sa.String(length=320), nullable=False),
        sa.Column('username', sa.String(length=32), nullable=False),
        sa.Column('password_hash', sa.String(length=255), nullable=False),
        sa.Column(
            'role',
            sa.Enum(
                'user',
                'admin',
                name='user_role',
                native_enum=False,
                create_constraint=True,
            ),
            server_default='user',
            nullable=False,
        ),
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
        sa.PrimaryKeyConstraint('id', name=op.f('pk_user_account')),
        sa.UniqueConstraint('email', name=op.f('uq_user_account_email')),
        sa.UniqueConstraint('username', name=op.f('uq_user_account_username')),
    )
    op.create_table(
        'auth_session',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('token_hash', sa.String(length=64), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('expires_at', sa.DateTime(), nullable=False),
        sa.CheckConstraint(
            'expires_at > created_at',
            name=op.f('ck_auth_session_expires_after_creation'),
        ),
        sa.ForeignKeyConstraint(
            ['user_id'],
            ['user_account.id'],
            name=op.f('fk_auth_session_user_id_user_account'),
            ondelete='CASCADE',
        ),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_auth_session')),
        sa.UniqueConstraint('token_hash', name=op.f('uq_auth_session_token_hash')),
    )
    op.create_index(
        op.f('ix_auth_session_user_id'),
        'auth_session',
        ['user_id'],
        unique=False,
    )

    # Le compte historique : valeurs littérales, horodatages par défaut de la
    # base. Rendu tel quel par `--sql`.
    op.execute(
        'INSERT INTO user_account (id, email, username, password_hash, role)'
        f" VALUES ({LEGACY_ACCOUNT_ID}, '{LEGACY_EMAIL}', '{LEGACY_USERNAME}',"
        f" '{UNUSABLE_PASSWORD_HASH}', '{LEGACY_ROLE}')"
    )


def downgrade() -> None:
    _require_only_the_legacy_account()

    op.drop_index(op.f('ix_auth_session_user_id'), table_name='auth_session')
    op.drop_table('auth_session')
    op.drop_table('user_account')
