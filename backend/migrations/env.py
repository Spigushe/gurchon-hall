"""Environnement Alembic.

Trois points structurants :

* `target_metadata` pointe les métadonnées des modèles de `app.models` ; c'est
  ce qui permet à `--autogenerate` de comparer le code et la base.
* `render_as_batch=True` : SQLite ne sait pas faire la plupart des
  `ALTER TABLE`. Le mode batch d'Alembic recrée la table et recopie les données
  à la place. Sans lui, la première migration qui modifie une colonne ou une
  contrainte échoue (cf. skill `migrations-alembic`).
* Sous SQLite, les clés étrangères sont **désactivées pendant la migration**,
  puis vérifiées. Voir `_disable_sqlite_foreign_keys` : c'est le corollaire
  indispensable du point précédent.
"""

from logging.config import fileConfig

from alembic import context
from sqlalchemy import Connection, engine_from_config, pool, text

from app.db.session import database_url
from app.models import Base

config = context.config
config.set_main_option("sqlalchemy.url", database_url())

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    """Génère le SQL sans ouvrir de connexion (`alembic upgrade --sql`)."""
    context.configure(
        url=config.get_main_option("sqlalchemy.url"),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        render_as_batch=True,
        compare_type=True,
    )

    with context.begin_transaction():
        context.run_migrations()


def _disable_sqlite_foreign_keys(connection: Connection) -> bool:
    """Coupe l'intégrité référentielle le temps de la migration (SQLite).

    Le mode batch recrée les tables : `deck` est copiée, *supprimée*, puis
    remplacée. Avec `PRAGMA foreign_keys = ON` — que l'écouteur global de
    `app.db.session` pose sur chaque connexion, celle d'Alembic comprise —, ce
    `DROP TABLE` déclenche les `ON DELETE CASCADE` qui pointent vers elle :
    `deck_card` se vide en silence, et une `participation` qui référence un deck
    fait carrément échouer la migration, table temporaire à moitié écrite en
    prime. C'est le mode d'emploi de SQLite lui-même : couper les clés
    étrangères, recréer, remettre.

    Le `PRAGMA` est **sans effet à l'intérieur d'une transaction** : il faut
    donc l'exécuter avant que la migration n'en ouvre une. Le `rollback` qui
    suit referme la transaction que SQLAlchemy ouvre automatiquement au premier
    ordre — il n'annule rien (un `PRAGMA` n'est pas transactionnel) et laisse la
    connexion propre pour `context.begin_transaction()`.

    Renvoie vrai si la coupure a eu lieu (donc s'il faudra vérifier et remettre).
    """
    if connection.dialect.name != "sqlite":
        return False
    connection.exec_driver_sql("PRAGMA foreign_keys = OFF")
    connection.rollback()
    return True


def _check_sqlite_foreign_keys(connection: Connection) -> None:
    """Rétablit l'intégrité référentielle et refuse une base incohérente.

    Couper les clés étrangères, c'est accepter qu'une migration maladroite
    laisse des lignes orphelines. `PRAGMA foreign_key_check` passe la base
    entière en revue : une seule violation et la migration s'arrête ici, avant
    que l'application ne travaille sur des données fausses.
    """
    violations = connection.execute(text("PRAGMA foreign_key_check")).fetchall()
    connection.exec_driver_sql("PRAGMA foreign_keys = ON")
    connection.rollback()
    if violations:
        raise RuntimeError(
            "Migration interrompue : la base contient des références orphelines "
            f"après migration ({len(violations)} ligne(s), "
            f"par exemple {tuple(violations[0])}). Aucune clé étrangère n'était "
            "active pendant la migration : le correctif est dans la révision, "
            "pas ici."
        )


def run_migrations_online() -> None:
    """Applique les migrations sur une connexion réelle."""
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        foreign_keys_were_disabled = _disable_sqlite_foreign_keys(connection)

        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            render_as_batch=True,
            compare_type=True,
        )

        with context.begin_transaction():
            context.run_migrations()

        if foreign_keys_were_disabled:
            _check_sqlite_foreign_keys(connection)


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
