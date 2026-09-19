"""Configuration de `app.db.session` : URL, moteur, session par requête."""

from pathlib import Path

from sqlalchemy import text
from sqlalchemy.orm import Session, sessionmaker

from app.db import session as session_module
from app.db.session import (
    DEFAULT_DATABASE_URL,
    create_app_engine,
    database_url,
    get_session,
)


def test_database_url_defaults_to_a_sqlite_file_in_backend(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    assert database_url() == DEFAULT_DATABASE_URL
    assert DEFAULT_DATABASE_URL.startswith("sqlite+pysqlite:///")
    assert (
        Path(DEFAULT_DATABASE_URL.removeprefix("sqlite+pysqlite:///")).name == "vtes.db"
    )


def test_database_url_is_overridden_by_the_environment(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "sqlite+pysqlite:///elsewhere.db")
    assert database_url() == "sqlite+pysqlite:///elsewhere.db"


def test_empty_database_url_falls_back_to_the_default(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "")
    assert database_url() == DEFAULT_DATABASE_URL


def test_create_app_engine_uses_the_given_url(tmp_path):
    target = tmp_path / "custom.db"
    engine = create_app_engine(f"sqlite+pysqlite:///{target.as_posix()}")
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
        assert Path(engine.url.database) == target
    finally:
        engine.dispose()


def test_create_app_engine_does_not_touch_the_default_database(tmp_path):
    """Créer un moteur de test ne crée pas `backend/vtes.db`."""
    default_path = Path(DEFAULT_DATABASE_URL.removeprefix("sqlite+pysqlite:///"))
    existed = default_path.exists()
    engine = create_app_engine(f"sqlite+pysqlite:///{(tmp_path / 't.db').as_posix()}")
    engine.dispose()
    assert default_path.exists() == existed


def test_get_session_yields_a_session_then_closes_it(db_engine, monkeypatch):
    monkeypatch.setattr(
        session_module,
        "SessionLocal",
        sessionmaker(bind=db_engine, autoflush=False, expire_on_commit=False),
    )
    generator = get_session()
    session = next(generator)
    assert isinstance(session, Session)
    assert session.execute(text("PRAGMA foreign_keys")).scalar() == 1
    generator.close()
    # Session fermée : plus aucune transaction en cours.
    assert not session.in_transaction()
