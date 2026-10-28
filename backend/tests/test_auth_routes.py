"""Tests des routes d'authentification (Lot 6, étape A2).

`api` (cf. `tests/conftest.py`) est un `TestClient` qui garde son pot de
cookies d'une requête à l'autre, comme un navigateur : une connexion réussie
y laisse le cookie de session, que les requêtes suivantes renvoient seules.
"""

from app.models.account import AuthSession, UserAccount
from app.models.enums import UserRole
from app.routers.common import ACTIVE_SESSION_COOKIE_NAME, SESSION_COOKIE_SECURE
from app.schemas.account import PASSWORD_MAX_LENGTH
from app.services import auth as auth_service
from tests.auth_helpers import DEFAULT_PASSWORD, authenticated_api, log_in, make_account

# Toujours `api` (base jetable, cf. `tests/conftest.py`) et jamais `client`
# (base réelle `backend/vtes.db`, cf. `test_health.py`) dès qu'une route
# touche la base — ici, c'est le cas de toutes : même « 204 sans cookie »
# ouvre une session SQLAlchemy sur la base de la dépendance injectée.

_SIGN_UP_BODY = {
    "email": "Alice@Example.com",
    "username": "alice",
    "password": "Correct-Horse-1!",
}


def test_sign_up_creates_an_active_account_and_opens_a_session(api):
    response = api.post("/inscription", json=_SIGN_UP_BODY)

    assert response.status_code == 201
    body = response.json()
    assert body["email"] == "alice@example.com"  # normalisée en minuscules
    assert body["username"] == "alice"
    assert body["role"] == "user"
    assert "password" not in body
    assert "password_hash" not in body
    assert ACTIVE_SESSION_COOKIE_NAME in response.cookies

    # La session ouverte à l'inscription fonctionne tout de suite.
    me = api.get("/moi")
    assert me.status_code == 200
    assert me.json()["email"] == "alice@example.com"


def test_sign_up_rejects_an_unknown_field_including_role(api):
    response = api.post("/inscription", json={**_SIGN_UP_BODY, "role": "admin"})
    assert response.status_code == 422


def test_sign_up_rejects_a_password_below_the_complexity_rule(api):
    response = api.post("/inscription", json={**_SIGN_UP_BODY, "password": "short"})
    assert response.status_code == 422


def test_sign_up_rejects_an_oversized_password_before_hashing(api, monkeypatch):
    """Un mot de passe de plusieurs mégaoctets doit être refusé par la borne de
    longueur de Pydantic (§ « Bornes ») avant d'atteindre le hachage Argon2 :
    sinon, l'entrée démesurée ferait tourner Argon2 sur plusieurs Mo, un moyen
    de dépenser son temps de calcul (DoS). `hash_password` est espionné pour
    s'assurer qu'il n'est jamais appelé."""
    calls: list[str] = []
    monkeypatch.setattr(
        auth_service,
        "hash_password",
        lambda plain: calls.append(plain) or "unreachable",
    )
    huge_password = "Aa1!" * (2 * 1024 * 1024 // 4)  # ~2 Mio, motif valide
    assert len(huge_password) > PASSWORD_MAX_LENGTH

    response = api.post(
        "/inscription", json={**_SIGN_UP_BODY, "password": huge_password}
    )

    assert response.status_code == 422
    assert calls == []


def test_sign_up_rejects_a_duplicate_email(api):
    api.post("/inscription", json=_SIGN_UP_BODY)
    response = api.post(
        "/inscription",
        json={**_SIGN_UP_BODY, "username": "alice2"},
    )
    assert response.status_code == 409


def test_sign_up_rejects_a_duplicate_username(api):
    api.post("/inscription", json=_SIGN_UP_BODY)
    response = api.post(
        "/inscription",
        json={**_SIGN_UP_BODY, "email": "someone-else@example.com"},
    )
    assert response.status_code == 409


def test_log_in_succeeds_with_the_right_credentials(api, db):
    make_account(db, email="a@example.com", password="Correct-Horse-1!")
    response = api.post(
        "/connexion", json={"email": "a@example.com", "password": "Correct-Horse-1!"}
    )
    assert response.status_code == 200
    assert ACTIVE_SESSION_COOKIE_NAME in response.cookies


def test_log_in_rejects_an_unknown_email_with_401(api):
    response = api.post(
        "/connexion", json={"email": "nobody@example.com", "password": "whatever123!A"}
    )
    assert response.status_code == 401


def test_log_in_rejects_a_wrong_password_with_the_same_401(api, db):
    make_account(db, email="a@example.com", password="Correct-Horse-1!")
    unknown = api.post(
        "/connexion", json={"email": "nobody@example.com", "password": "whatever123!A"}
    )
    wrong = api.post(
        "/connexion", json={"email": "a@example.com", "password": "wrong-password!A"}
    )
    assert unknown.status_code == wrong.status_code == 401
    assert unknown.json() == wrong.json()


def test_log_out_is_idempotent_without_any_cookie(api):
    response = api.post("/deconnexion")
    assert response.status_code == 204


def test_log_out_clears_the_cookie_and_the_session(api, db):
    make_account(db, email="a@example.com", password="Correct-Horse-1!")
    log_in(api, "a@example.com", "Correct-Horse-1!")

    response = api.post("/deconnexion")
    assert response.status_code == 204

    # Le cookie renvoyé par le serveur a expiré : le client ne l'envoie plus.
    me = api.get("/moi")
    assert me.status_code == 401


def test_read_current_user_requires_a_session(api):
    response = api.get("/moi")
    assert response.status_code == 401
    assert response.json() == {"detail": "Authentification requise."}


def test_read_current_user_returns_the_account_of_the_session(api, db):
    _api, account = authenticated_api(api, db, email="a@example.com")
    response = api.get("/moi")
    assert response.status_code == 200
    body = response.json()
    assert body["id"] == account.id
    assert body["email"] == "a@example.com"


def test_authenticated_response_sets_cache_control_no_store(api, db):
    authenticated_api(api, db, email="a@example.com")
    response = api.get("/moi")
    assert response.headers["cache-control"] == "private, no-store"


def test_an_unknown_or_expired_session_cookie_also_rejects(api):
    api.cookies.set(ACTIVE_SESSION_COOKIE_NAME, "not-a-real-token")
    response = api.get("/moi")
    assert response.status_code == 401


def test_session_cookie_is_http_only_and_secure_follows_configuration(api):
    response = api.post("/inscription", json=_SIGN_UP_BODY)
    set_cookie = response.headers.get("set-cookie", "")
    assert "HttpOnly" in set_cookie
    assert "samesite=lax" in set_cookie.lower()
    if SESSION_COOKIE_SECURE:
        assert "Secure" in set_cookie


def test_only_the_token_hash_is_stored_never_the_raw_token(api, db):
    api.post("/inscription", json=_SIGN_UP_BODY)

    sessions = db.query(AuthSession).all()
    assert len(sessions) == 1
    cookie_token = next(iter(api.cookies.values()))
    assert sessions[0].token_hash != cookie_token


# ---------------------------------------------------------------------------
# Origine (403), rôles (403), débit (429)
# ---------------------------------------------------------------------------


def test_a_write_from_a_disallowed_origin_is_rejected(api):
    response = api.post(
        "/inscription",
        json=_SIGN_UP_BODY,
        headers={"Origin": "https://attacker.example"},
    )
    assert response.status_code == 403


def test_a_write_from_an_allowed_origin_still_works(api):
    response = api.post(
        "/inscription",
        json=_SIGN_UP_BODY,
        headers={"Origin": "http://localhost:5173"},
    )
    assert response.status_code == 201


def test_create_language_requires_a_session(api):
    response = api.post("/langues", json={"code": "DE", "label": "Allemand"})
    assert response.status_code == 401


def test_create_language_requires_the_admin_role(api, db):
    authenticated_api(api, db, email="a@example.com", role=UserRole.USER)
    response = api.post("/langues", json={"code": "DE", "label": "Allemand"})
    assert response.status_code == 403


def test_create_language_succeeds_for_an_admin(api, db):
    authenticated_api(api, db, email="admin@example.com", role=UserRole.ADMIN)
    response = api.post("/langues", json={"code": "DE", "label": "Allemand"})
    assert response.status_code == 201


def test_log_in_is_rate_limited_after_the_configured_threshold(monkeypatch, api, db):
    monkeypatch.setenv("LOGIN_RATE_LIMIT", "2/minute")
    make_account(db, email="a@example.com", password=DEFAULT_PASSWORD)

    bodies = [{"email": "a@example.com", "password": "wrong"}] * 3
    statuses = [api.post("/connexion", json=body).status_code for body in bodies]

    assert statuses[:2] == [401, 401]
    assert statuses[2] == 429


def test_sign_up_is_rate_limited_after_the_configured_threshold(monkeypatch, api):
    monkeypatch.setenv("SIGNUP_RATE_LIMIT", "1/minute")

    first = api.post("/inscription", json=_SIGN_UP_BODY)
    second = api.post(
        "/inscription", json={**_SIGN_UP_BODY, "email": "someone-else@example.com"}
    )

    assert first.status_code == 201
    assert second.status_code == 429
    assert "Retry-After" in second.headers
    assert second.json() == {"detail": "Trop de tentatives ; réessayer plus tard."}


def test_account_historique_is_untouched_by_this_module(db):
    """Garde-fou : ce module de tests ne doit jamais dépendre du compte
    historique (`id = 1`, D6) — il est créé par une migration, pas par ces
    fixtures (base vierge, cf. `tests/conftest.py`)."""
    assert db.get(UserAccount, 1) is None
