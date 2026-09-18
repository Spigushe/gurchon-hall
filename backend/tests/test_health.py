"""Tests de l'endpoint `GET /health` (Lot 0).

Sert de test de bout en bout du squelette FastAPI : disponibilité, forme et
contenu de la réponse. Voir CLAUDE.md §12 (Lot 0) et contracts/README.md.
"""

from app import __version__


def test_health_returns_200(client):
    response = client.get("/health")

    assert response.status_code == 200


def test_health_reports_ok_status(client):
    response = client.get("/health")

    assert response.json()["status"] == "ok"


def test_health_reports_version_as_non_empty_string(client):
    body = client.get("/health").json()

    assert "version" in body
    assert isinstance(body["version"], str)
    assert body["version"] != ""


def test_health_version_matches_app_version(client):
    """La version renvoyée doit venir de `pyproject.toml`, pas être codée en dur."""
    body = client.get("/health").json()

    assert body["version"] == __version__


def test_health_response_has_no_unexpected_fields(client):
    body = client.get("/health").json()

    assert set(body.keys()) == {"status", "version"}
