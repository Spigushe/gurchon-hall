"""Contrôle de la révision de la base au démarrage (`app.db.schema_check`).

Bases éphémères uniquement : copies du schéma de test, auxquelles on pose à la
main la ligne `alembic_version` voulue (rapide, et sans exécuter `env.py`).
"""

import logging
import shutil

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.db import schema_check
from app.db import session as db_session
from app.db.schema_check import (
    SchemaRevisionError,
    check_schema_revision,
    describe_database,
)
from app.main import app


def _head() -> str:
    _, heads = schema_check._script_heads()
    return heads[0]


def _parent_of_head() -> str:
    script, _ = schema_check._script_heads()
    parent = script.get_revision(_head()).down_revision
    assert isinstance(parent, str)
    return parent


@pytest.fixture
def make_engine(tmp_path, schema_template):
    """Fabrique un moteur sur une copie du schéma, avec ces révisions en base
    (`None` : pas de table `alembic_version` ; `[]` : table vide)."""
    engines = []

    def _make(revisions):
        path = tmp_path / f"rev{len(engines)}.db"
        shutil.copyfile(schema_template, path)
        engine = db_session.create_app_engine(f"sqlite+pysqlite:///{path.as_posix()}")
        engines.append(engine)
        if revisions is not None:
            with engine.begin() as connection:
                connection.execute(
                    text(
                        "CREATE TABLE alembic_version "
                        "(version_num VARCHAR(32) NOT NULL)"
                    )
                )
                for revision in revisions:
                    connection.execute(
                        text("INSERT INTO alembic_version VALUES (:r)"), {"r": revision}
                    )
        return engine

    yield _make
    for engine in engines:
        engine.dispose()


def test_une_seule_tete_dans_les_scripts():
    _, heads = schema_check._script_heads()
    assert len(heads) == 1


def test_base_a_la_tete_passe(make_engine):
    check_schema_revision(make_engine([_head()]))


def test_base_en_retard_cite_les_deux_revisions_et_la_commande(make_engine):
    engine = make_engine([_parent_of_head()])
    with pytest.raises(SchemaRevisionError) as info:
        check_schema_revision(engine)
    message = str(info.value)
    assert _parent_of_head() in message
    assert _head() in message
    assert "en retard" in message
    assert "uv run alembic upgrade head" in message
    assert "DATABASE_URL" in message
    assert "CLAUDE.md" in message
    assert describe_database(engine) in message


def test_base_en_avance_ou_inconnue_bloque(make_engine):
    with pytest.raises(SchemaRevisionError) as info:
        check_schema_revision(make_engine(["ffffffffffff"]))
    message = str(info.value)
    assert "ffffffffffff" in message
    assert _head() in message
    assert "inconnue" in message
    assert "upgrade head" not in message


def test_sans_table_alembic_version_bloque(make_engine):
    with pytest.raises(SchemaRevisionError, match="aucune révision Alembic"):
        check_schema_revision(make_engine(None))


def test_table_alembic_version_vide_bloque(make_engine):
    with pytest.raises(SchemaRevisionError, match="aucune révision Alembic"):
        check_schema_revision(make_engine([]))


def test_plusieurs_revisions_en_base_bloque(make_engine):
    with pytest.raises(SchemaRevisionError, match="plusieurs révisions"):
        check_schema_revision(make_engine([_head(), _parent_of_head()]))


def test_plusieurs_tetes_de_scripts_bloque(make_engine, monkeypatch):
    script, _ = schema_check._script_heads()
    monkeypatch.setattr(schema_check, "_script_heads", lambda: (script, ["aaa", "bbb"]))
    with pytest.raises(SchemaRevisionError, match="2 têtes"):
        check_schema_revision(make_engine([_head()]))


def test_fichier_sqlite_absent_n_est_pas_cree(tmp_path):
    path = tmp_path / "absente.db"
    engine = db_session.create_app_engine(f"sqlite+pysqlite:///{path.as_posix()}")
    with pytest.raises(SchemaRevisionError, match="aucune révision Alembic"):
        check_schema_revision(engine)
    assert not path.exists()


def test_description_sans_mot_de_passe_hors_sqlite():
    from sqlalchemy.engine import make_url

    class _Fake:
        url = make_url("postgresql://moi:secret@hote/base")

    rendered = describe_database(_Fake())
    assert "secret" not in rendered
    assert "hote/base" in rendered


# --- Lifespan ---------------------------------------------------------------


def _start(engine, monkeypatch, check):
    monkeypatch.setattr(db_session, "engine", engine)
    monkeypatch.setenv("SCHEMA_REVISION_CHECK", check)
    with TestClient(app) as client:
        return client.get("/health").status_code


def test_demarrage_a_la_tete(make_engine, monkeypatch):
    assert _start(make_engine([_head()]), monkeypatch, "true") == 200


def test_demarrage_bloque_en_retard_et_journalise_en_error(
    make_engine, monkeypatch, caplog
):
    with caplog.at_level(logging.ERROR, logger="app.db.schema_check"):
        with pytest.raises(SchemaRevisionError):
            _start(make_engine([_parent_of_head()]), monkeypatch, "true")
    errors = [r for r in caplog.records if r.levelno == logging.ERROR]
    assert errors
    assert _parent_of_head() in errors[0].getMessage()
    assert _head() in errors[0].getMessage()


def test_demarrage_bloque_sans_alembic_version(make_engine, monkeypatch):
    with pytest.raises(SchemaRevisionError):
        _start(make_engine(None), monkeypatch, "true")


def test_controle_actif_par_defaut(make_engine, monkeypatch):
    monkeypatch.delenv("SCHEMA_REVISION_CHECK", raising=False)
    assert schema_check.schema_check_enabled() is True
    monkeypatch.setattr(db_session, "engine", make_engine([_parent_of_head()]))
    with pytest.raises(SchemaRevisionError):
        with TestClient(app):
            pass


@pytest.mark.parametrize("value", ["false", "0", "No", "OFF"])
def test_interrupteur_desactive_demarre_et_avertit(
    make_engine, monkeypatch, caplog, value
):
    with caplog.at_level(logging.WARNING, logger="app.db.schema_check"):
        status = _start(make_engine([_parent_of_head()]), monkeypatch, value)
    assert status == 200
    assert any(
        r.levelno == logging.WARNING and "SCHEMA_REVISION_CHECK" in r.getMessage()
        for r in caplog.records
    )
