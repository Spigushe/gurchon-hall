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

Lot 6 : `SESSION_COOKIE_SECURE` est forcée à faux **avant** tout import de
`app.*`, donc avant que `app.routers.common` ne lise la variable (une fois, au
chargement du module, cf. `_session_cookie_secure`). `TestClient` parle en
`http://testserver`, jamais en HTTPS : un cookie `Secure` ne serait réémis par
le pot de cookies d'`httpx` sur aucune requête suivante, et toute route
protégée semblerait rendre 401 juste après une connexion réussie. Même choix
qu'en développement (repli documenté dans `app.routers.common`), pour la même
raison.
"""

import os

os.environ.setdefault("SESSION_COOKIE_SECURE", "false")

import shutil  # noqa: E402

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from app.db.session import create_app_engine, get_session  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Base  # noqa: E402
from app.services.rate_limit import limiter  # noqa: E402
from tests.helpers import populate_world  # noqa: E402


@pytest.fixture(autouse=True)
def _reset_rate_limiter() -> None:
    """Vide les compteurs en mémoire de `slowapi` entre deux tests (Lot 6).

    Sans cette remise à zéro, des tests sans rapport entre eux qui appellent
    `POST /connexion` ou `POST /inscription` partageraient la même fenêtre de
    débit (même adresse cliente sous `TestClient`) et finiraient par recevoir
    un 429 à cause du cumul des appels précédents.
    """
    limiter.reset()


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


@pytest.fixture
def api_client_factory(db_engine):
    """Fabrique de `TestClient` indépendants, sur la **même** base jetable
    que `db` / `api` (Lot 6).

    `api` suffit à un test à un seul compte : son `TestClient` garde le
    cookie de session posé par `POST /connexion` d'un appel à l'autre, comme
    un navigateur. Un test d'**isolation entre deux comptes** (étape A3,
    `docs/lot6-plan-comptes.md`) a besoin de deux pots de cookies distincts
    sur la même base ; `api_client_factory()` en crée un nouveau à chaque
    appel, sans toucher à `app.dependency_overrides` une deuxième fois (déjà
    posé par cette fixture, idempotent).
    """

    def override_session():
        with Session(db_engine, autoflush=False, expire_on_commit=False) as session:
            yield session

    app.dependency_overrides[get_session] = override_session
    clients: list[TestClient] = []

    def _make() -> TestClient:
        test_client = TestClient(app)
        clients.append(test_client)
        return test_client

    yield _make
    for test_client in clients:
        test_client.close()
    app.dependency_overrides.clear()
