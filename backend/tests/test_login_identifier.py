"""Connexion par l'adresse ou par le nom d'utilisateur, dans un même champ
(correctif après la v1.1.0).

`identifier` accepte l'une ou l'autre forme ; `email`, l'ancien champ, reste
accepté pour une coquille v1.1.0 encore en cache. Un identifiant introuvable,
quelle que soit sa forme, rend le même 401 qu'un mauvais mot de passe.
"""

import pytest

from app.routers.common import ACTIVE_SESSION_COOKIE_NAME
from app.services import auth as auth_service
from tests.auth_helpers import make_account

PASSWORD = "Correct-Horse-1!"


def _log_in(api, body):
    return api.post("/connexion", json={**body, "password": PASSWORD})


@pytest.mark.parametrize(
    "identifier",
    [
        "alice@example.com",
        "  Alice@Example.COM ",
        "Alice",
        " Alice ",
        "alice",
        "ALICE",
    ],
)
def test_identifier_accepts_the_email_or_the_username(api, db, identifier):
    make_account(db, email="alice@example.com", username="Alice", password=PASSWORD)
    response = _log_in(api, {"identifier": identifier})
    assert response.status_code == 200, response.text
    assert response.json()["username"] == "Alice"
    assert ACTIVE_SESSION_COOKIE_NAME in response.cookies


def test_the_former_email_field_still_logs_in(api, db):
    make_account(db, email="alice@example.com", username="Alice", password=PASSWORD)
    assert _log_in(api, {"email": "alice@example.com"}).status_code == 200


def test_the_former_email_field_still_refuses_a_username_with_422(api, db):
    # Comportement de la v1.1.0 inchangé pour l'ancien champ.
    make_account(db, email="alice@example.com", username="Alice", password=PASSWORD)
    assert _log_in(api, {"email": "Alice"}).status_code == 422


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"identifier": "Alice", "email": "alice@example.com"},
        {"identifier": "   "},
        {"identifier": ""},
    ],
)
def test_exactly_one_non_empty_identifier_is_required(api, db, body):
    assert _log_in(api, body).status_code == 422


@pytest.mark.parametrize(
    "identifier",
    ["bob", "nobody@example.com", "pas une adresse@", "alice@", "a@b@c.fr"],
)
def test_unknown_or_malformed_identifiers_get_the_same_401_as_a_wrong_password(
    api, db, identifier
):
    make_account(db, email="alice@example.com", username="Alice", password=PASSWORD)
    unknown = _log_in(api, {"identifier": identifier})
    wrong = api.post(
        "/connexion", json={"identifier": "Alice", "password": "Wrong-Horse-1!"}
    )
    assert unknown.status_code == wrong.status_code == 401
    assert unknown.json() == wrong.json()


def test_a_case_insensitive_username_only_logs_in_when_it_is_unambiguous(api, db):
    make_account(db, email="a@example.com", username="Alice", password=PASSWORD)
    make_account(db, email="b@example.com", username="alice", password=PASSWORD)
    # Les deux formes exactes connectent chacune leur compte…
    assert _log_in(api, {"identifier": "Alice"}).json()["email"] == "a@example.com"
    assert _log_in(api, {"identifier": "alice"}).json()["email"] == "b@example.com"
    # …mais une troisième casse désignerait deux comptes : refusée.
    assert _log_in(api, {"identifier": "ALICE"}).status_code == 401


def test_an_unknown_identifier_still_spends_a_dummy_verification(db, monkeypatch):
    calls: list[str] = []
    monkeypatch.setattr(auth_service, "dummy_verify", calls.append)
    make_account(db, email="alice@example.com", username="Alice", password=PASSWORD)
    for identifier in ("bob", "nobody@example.com", "alice@"):
        assert auth_service.authenticate(db, login=identifier, password="x") is None
    assert calls == ["x", "x", "x"]


def test_find_login_account_never_matches_an_email_by_its_username_part(db):
    make_account(db, email="alice@example.com", username="carol", password=PASSWORD)
    assert auth_service.find_login_account(db, "alice") is None
    assert auth_service.find_login_account(db, "carol") is not None
