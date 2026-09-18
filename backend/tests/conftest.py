"""Fixtures partagées pour les tests backend.

`client` instancie un `TestClient` sur l'application FastAPI complète. Au
Lot 0 il n'y a pas de base de données à isoler ; les lots suivants pourront
ajouter ici une fixture de session SQLite dédiée (cf. skill tests-backend,
"Base de test") sans changer la façon dont les tests d'endpoint consomment
`client`.
"""

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture
def client() -> TestClient:
    with TestClient(app) as test_client:
        yield test_client
