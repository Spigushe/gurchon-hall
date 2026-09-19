"""Moteur et sessions SQLAlchemy.

L'URL vient de la variable d'environnement `DATABASE_URL`, avec une valeur de
repli SQLite dans le dossier `backend/`. Même logique que `BACKEND_CORS_ORIGINS`
côté application : un défaut de dev explicite, surchargeable sans toucher au
code.

Point SQLite important : les contraintes de clé étrangère ne sont **pas**
appliquées tant que `PRAGMA foreign_keys = ON` n'a pas été exécuté sur la
connexion. Or le modèle s'appuie dessus (`deck_card` référence `card_copy`
pour interdire une carte de deck absente de la collection, cf. CLAUDE.md §11
point 2). D'où l'écouteur ci-dessous.
"""

import os
from collections.abc import Iterator
from pathlib import Path

from sqlalchemy import Engine, create_engine, event
from sqlalchemy.orm import Session, sessionmaker

_BACKEND_DIR = Path(__file__).resolve().parents[2]
_DEFAULT_SQLITE_PATH = _BACKEND_DIR / "vtes.db"
DEFAULT_DATABASE_URL = f"sqlite+pysqlite:///{_DEFAULT_SQLITE_PATH}"


def database_url() -> str:
    """URL de connexion courante."""
    return os.getenv("DATABASE_URL") or DEFAULT_DATABASE_URL


@event.listens_for(Engine, "connect")
def _enable_sqlite_foreign_keys(dbapi_connection, connection_record) -> None:
    """Active l'intégrité référentielle sur toute connexion SQLite."""
    if dbapi_connection.__class__.__module__.startswith("sqlite3"):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys = ON")
        cursor.close()


def create_app_engine(url: str | None = None) -> Engine:
    """Crée un moteur configuré pour l'application."""
    return create_engine(url or database_url(), future=True)


engine = create_app_engine()
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_session() -> Iterator[Session]:
    """Dépendance FastAPI : une session par requête (utilisée dès le Lot 2)."""
    with SessionLocal() as session:
        yield session
