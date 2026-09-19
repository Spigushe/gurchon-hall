"""Fixtures partagées pour les tests backend.

`client` instancie un `TestClient` sur l'application FastAPI complète.

Depuis le Lot 1, la base de test est isolée par test (cf. skill tests-backend,
"Base de test") :

* `db_engine` — un fichier SQLite jetable dans `tmp_path`, schéma créé depuis
  les métadonnées. Un fichier plutôt que `:memory:` : chaque connexion du pool
  voit la même base, comme en usage réel. Le moteur passe par
  `create_app_engine`, donc hérite du `PRAGMA foreign_keys = ON` ; sans lui
  SQLite ignorerait les clés étrangères et les tests de contraintes ne
  prouveraient rien.
* `db` — une session sur ce moteur.
* `world` — un jeu de données minimal mais complet (une ligne dans chaque
  table), pour les tests qui ont besoin d'un graphe d'objets déjà relié.

Jamais la vraie base (`backend/vtes.db`) : `DATABASE_URL` n'est pas consulté.
"""

import shutil

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.db.session import create_app_engine, get_session
from app.main import app
from app.models import Base
from tests.helpers import populate_world


@pytest.fixture
def client() -> TestClient:
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture(scope="session")
def schema_template(tmp_path_factory):
    """Fichier SQLite au schéma vierge, créé une fois pour toute la session.

    Le copier est bien plus rapide que de rejouer `create_all` (et son fsync)
    avant chaque test, et laisse chaque test travailler sur son propre fichier.
    """
    path = tmp_path_factory.mktemp("schema") / "template.db"
    engine = create_app_engine(f"sqlite+pysqlite:///{path.as_posix()}")
    Base.metadata.create_all(engine)
    engine.dispose()
    return path


@pytest.fixture
def db_engine(tmp_path, schema_template):
    path = tmp_path / "test.db"
    shutil.copyfile(schema_template, path)
    engine = create_app_engine(f"sqlite+pysqlite:///{path.as_posix()}")
    yield engine
    engine.dispose()


@pytest.fixture
def db(db_engine):
    with Session(db_engine) as session:
        yield session


@pytest.fixture
def api(db_engine):
    """`TestClient` branché sur la base jetable du test (Lot 2).

    Remplace la dépendance `get_session` : chaque requête ouvre sa propre
    session sur `db_engine`, avec les mêmes réglages que `SessionLocal`. Les
    tests peuvent donc préparer des données via `db` / `world` puis les lire
    par l'API, et inversement.
    """

    def override_session():
        with Session(db_engine, autoflush=False, expire_on_commit=False) as session:
            yield session

    app.dependency_overrides[get_session] = override_session
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.fixture
def world(db):
    """Graphe d'objets déjà persisté, cf. `tests.helpers.populate_world`."""
    return populate_world(db)
