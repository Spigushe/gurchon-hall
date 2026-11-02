"""Contrôle de la révision Alembic de la base au démarrage.

Le code attend un schéma précis (la tête des scripts de `backend/migrations/`).
Contre une base restée en retard, l'application démarre et répond sur les
routes qui ne touchent pas les colonnes manquantes, puis échoue en 500 plus
tard (`no such column: ...`). `check_schema_revision` compare donc la révision
enregistrée dans `alembic_version` à la tête des scripts, et lève
`SchemaRevisionError` au moindre écart, avec le geste à faire.

Lecture seule : ni migration automatique, ni écriture. `migrations/env.py`
n'est pas exécuté (il manipule les PRAGMA et sert aux migrations) : on lit les
scripts par `ScriptDirectory` et la base par `MigrationContext`.

Réglage : `SCHEMA_REVISION_CHECK` (activé par défaut) ; voir `schema_check_enabled`.
"""

import logging
import os
from pathlib import Path

from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from alembic.script.revision import RevisionError
from alembic.util import CommandError
from sqlalchemy import Engine

logger = logging.getLogger(__name__)

_MIGRATIONS_DIR = Path(__file__).resolve().parents[2] / "migrations"

_UPGRADE_HINT = (
    "Vérifier d'abord DATABASE_URL (sans elle, la base visée est backend/vtes.db, "
    "la base de développement), puis lancer depuis backend/ : "
    "uv run alembic upgrade head. Voir CLAUDE.md, « Avant de lancer Alembic »."
)


class SchemaRevisionError(RuntimeError):
    """La révision de la base ne correspond pas au code."""


def schema_check_enabled() -> bool:
    """Lit `SCHEMA_REVISION_CHECK` (vrai par défaut) à chaque appel."""
    raw = os.getenv("SCHEMA_REVISION_CHECK")
    if raw is None:
        return True
    return raw.strip().lower() not in {"0", "false", "no", "off"}


def describe_database(engine: Engine) -> str:
    """Base visée, sans mot de passe : le chemin pour SQLite, l'URL sinon."""
    url = engine.url
    if url.get_backend_name() == "sqlite":
        return f"SQLite {url.database or '(en mémoire)'}"
    return url.render_as_string(hide_password=True)


def _script_heads() -> tuple[ScriptDirectory, list[str]]:
    config = Config()
    config.set_main_option("script_location", str(_MIGRATIONS_DIR))
    script = ScriptDirectory.from_config(config)
    return script, list(script.get_heads())


def _database_heads(engine: Engine) -> list[str]:
    """Révisions enregistrées en base ; vide si la table manque ou est vide.

    Une base SQLite fichier absente n'est pas ouverte : se connecter la
    créerait vide, ce qui est une écriture."""
    url = engine.url
    is_sqlite_file = url.get_backend_name() == "sqlite" and url.database not in (
        None,
        "",
        ":memory:",
    )
    if is_sqlite_file and not Path(url.database).exists():
        return []
    with engine.connect() as connection:
        context = MigrationContext.configure(connection)
        return sorted(context.get_current_heads())


def check_schema_revision(engine: Engine) -> None:
    """Lève `SchemaRevisionError` si la base n'est pas à la tête des scripts."""
    base = describe_database(engine)
    script, script_heads = _script_heads()

    if len(script_heads) != 1:
        raise SchemaRevisionError(
            f"Les scripts de migration ont {len(script_heads)} têtes "
            f"({', '.join(script_heads) or 'aucune'}) : une seule est attendue. "
            "Fusionner les branches (uv run alembic merge) avant de démarrer."
        )
    head = script_heads[0]

    db_heads = _database_heads(engine)
    if not db_heads:
        raise SchemaRevisionError(
            f"Base {base} : aucune révision Alembic (table alembic_version "
            f"absente ou vide), alors que le code attend {head}. La base est "
            "neuve ou n'a pas été créée par Alembic. " + _UPGRADE_HINT
        )
    if len(db_heads) > 1:
        raise SchemaRevisionError(
            f"Base {base} : plusieurs révisions Alembic enregistrées "
            f"({', '.join(db_heads)}), le code attend {head}. État ambigu : "
            "ne pas migrer à l'aveugle : inspecter la table alembic_version."
        )
    current = db_heads[0]
    if current == head:
        return

    try:
        script.get_revision(current)
    except (CommandError, RevisionError):
        raise SchemaRevisionError(
            f"Base {base} : révision {current} inconnue des scripts de "
            f"migration, le code attend {head}. La base est en avance sur le "
            "code (code plus ancien que la base) ou vient d'une autre branche : "
            "mettre le code à jour, ne pas redescendre la base sans sauvegarde. "
            "Voir CLAUDE.md, « Avant de lancer Alembic »."
        ) from None
    raise SchemaRevisionError(
        f"Base {base} : révision {current}, le code attend {head}. La base est "
        "en retard sur le code. " + _UPGRADE_HINT
    )


def enforce_schema_revision(engine: Engine) -> None:
    """Point d'entrée du lifespan : contrôle, journalise l'échec en ERROR, ou
    avertit si le contrôle est coupé."""
    if not schema_check_enabled():
        logger.warning(
            "SCHEMA_REVISION_CHECK désactivé : la révision de la base (%s) "
            "n'est pas vérifiée au démarrage.",
            describe_database(engine),
        )
        return
    try:
        check_schema_revision(engine)
    except SchemaRevisionError as error:
        logger.error("Démarrage bloqué : %s", error)
        raise
