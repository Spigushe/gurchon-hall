"""Lot 12, étape B1 : mot de passe, sessions et renouvellement.

Ce que ce fichier éprouve (`docs/lot12-plan-consolidation.md`, A1 à A3, A10) :

* `POST /moi/mot-de-passe` : l'actuel faux rend 422 et jamais 401, le nouveau
  remplace l'ancien, les autres sessions sont fermées et la courante gardée
  (P2), la route est limitée en débit ;
* `GET /moi/sessions`, `DELETE /moi/sessions/{id}`, `DELETE /moi/sessions` :
  la liste du seul compte, sans les expirées, la courante en tête ; 409 sur la
  courante, 404 indistinct pour une session inconnue, expirée ou d'un autre
  compte ;
* l'appareil (`User-Agent`) noté à la connexion et à l'inscription, nettoyé
  et coupé à 256 caractères (A2) ;
* le renouvellement sur une horloge simulée (A10) : rien avant 24 heures,
  échéance repoussée et cookie reposé ensuite, plafond de 90 jours, expiration
  après 14 jours sans usage, `last_used_at` NULL lu comme `created_at`,
  verrou occupé sans échec, jamais dans la transaction d'un lot `/sync`, et
  démarrage refusé sur des durées incohérentes.

L'horloge des sessions est `app.services.auth.naive_utcnow`, seule fonction à
remplacer : le service et le `Max-Age` du cookie la lisent tous deux.
"""

import re
import time
from datetime import timedelta
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.main import app
from app.models.account import USER_AGENT_MAX_LENGTH, AuthSession
from app.routers.common import ACTIVE_SESSION_COOKIE_NAME
from app.services import auth as auth_service
from app.services import sync as sync_service
from tests.auth_helpers import DEFAULT_PASSWORD, log_in, make_account

NEW_PASSWORD = "N0uveau-Secret!"
EMAIL = "lot12@example.com"
DAY = timedelta(days=1)


class Clock:
    """Horloge réglable, posée à la place de `auth_service.naive_utcnow`."""

    def __init__(self) -> None:
        self.now = auth_service.naive_utcnow().replace(microsecond=0)

    def advance(self, delta: timedelta) -> None:
        self.now += delta


@pytest.fixture
def clock(monkeypatch) -> Clock:
    instance = Clock()
    monkeypatch.setattr(auth_service, "naive_utcnow", lambda: instance.now)
    return instance


@pytest.fixture
def account(db):
    return make_account(db, email=EMAIL, username="lot12")


@pytest.fixture
def me_api(api, account):
    log_in(api, EMAIL)
    return api


def sessions_of(db: Session, user_id: int) -> list[AuthSession]:
    db.expire_all()
    return list(
        db.scalars(
            select(AuthSession)
            .where(AuthSession.user_id == user_id)
            .order_by(AuthSession.id)
        )
    )


def max_age(response) -> int | None:
    """`Max-Age` du cookie de session posé par la réponse, ou `None`."""
    header = response.headers.get("set-cookie")
    if header is None or ACTIVE_SESSION_COOKIE_NAME not in header:
        return None
    return int(re.search(r"Max-Age=(\d+)", header).group(1))


def second_device(api_client_factory, user_agent: str = "Second appareil"):
    client = api_client_factory()
    client.headers["User-Agent"] = user_agent
    log_in(client, EMAIL)
    return client


# --- Changement de mot de passe (P2) -----------------------------------------


def change(api, current=DEFAULT_PASSWORD, new=NEW_PASSWORD):
    return api.post(
        "/moi/mot-de-passe",
        json={"current_password": current, "new_password": new},
    )


def test_changing_the_password_keeps_this_session_and_closes_the_others(
    me_api, api_client_factory, db, account
):
    other = second_device(api_client_factory)

    response = change(me_api)

    assert response.status_code == 204
    assert response.content == b""
    assert response.headers["Cache-Control"] == "private, no-store"
    assert me_api.get("/moi").status_code == 200
    assert other.get("/moi").status_code == 401
    assert len(sessions_of(db, account.id)) == 1


def test_after_a_change_only_the_new_password_opens_a_session(
    me_api, api_client_factory
):
    change(me_api)
    client = api_client_factory()
    old = client.post("/connexion", json={"email": EMAIL, "password": DEFAULT_PASSWORD})
    new = client.post("/connexion", json={"email": EMAIL, "password": NEW_PASSWORD})
    assert old.status_code == 401
    assert new.status_code == 200


def test_a_wrong_current_password_is_a_422_in_the_form_never_a_401(
    me_api, api_client_factory, db, account
):
    other = second_device(api_client_factory)

    response = change(me_api, current="Pas-le-bon-1!")

    assert response.status_code == 422
    assert response.json()["detail"] == [
        {
            "type": "value_error",
            "loc": ["body", "current_password"],
            "msg": "Mot de passe actuel incorrect.",
        }
    ]
    # Rien n'a bougé : ni le secret, ni aucune session.
    assert me_api.get("/moi").status_code == 200
    assert other.get("/moi").status_code == 200
    assert len(sessions_of(db, account.id)) == 2
    log_in(api_client_factory(), EMAIL, DEFAULT_PASSWORD)


def test_a_password_change_requires_a_session(api):
    assert change(api).status_code == 401


def test_changing_the_password_is_rate_limited(monkeypatch, me_api):
    monkeypatch.setenv("PASSWORD_CHANGE_RATE_LIMIT", "1/minute")
    assert change(me_api, current="Pas-le-bon-1!").status_code == 422
    response = change(me_api, current="Pas-le-bon-1!")
    assert response.status_code == 429
    assert int(response.headers["Retry-After"]) >= 0


# --- Liste des sessions (P1) -------------------------------------------------


def test_the_list_shows_the_current_session_first_with_its_device(
    me_api, api_client_factory, clock
):
    clock.advance(timedelta(minutes=5))
    second_device(api_client_factory, "Firefox sur Linux")

    sessions = me_api.get("/moi/sessions").json()

    assert [item["current"] for item in sessions] == [True, False]
    assert sessions[0]["user_agent"] == "testclient"
    assert sessions[1]["user_agent"] == "Firefox sur Linux"
    # Jamais renouvelées : la dernière utilisation se lit comme l'ouverture.
    for item in sessions:
        assert item["last_used_at"] == item["created_at"]
        assert set(item) == {
            "id",
            "created_at",
            "last_used_at",
            "expires_at",
            "user_agent",
            "current",
        }


def test_the_others_are_listed_by_last_use_descending(me_api, db, account):
    older, _ = auth_service.create_session(db, account, user_agent="Ancien")
    recent, _ = auth_service.create_session(db, account, user_agent="Récent")
    older.last_used_at = older.created_at + timedelta(hours=1)
    recent.last_used_at = recent.created_at + timedelta(hours=2)
    db.commit()

    agents = [item["user_agent"] for item in me_api.get("/moi/sessions").json()]

    assert agents == ["testclient", "Récent", "Ancien"]


def test_the_list_leaves_out_expired_sessions_and_other_accounts(
    me_api, db, account
):
    expired, _ = auth_service.create_session(db, account, user_agent="Expirée")
    expired.created_at -= 30 * DAY
    expired.expires_at = expired.created_at + 14 * DAY
    stranger = make_account(db, email="autre@example.com", username="autre")
    auth_service.create_session(db, stranger, user_agent="Autre compte")
    db.commit()

    agents = [item["user_agent"] for item in me_api.get("/moi/sessions").json()]

    assert agents == ["testclient"]


def test_listing_the_sessions_requires_a_session(api):
    assert api.get("/moi/sessions").status_code == 401


# --- Fermer une session ------------------------------------------------------


def test_closing_another_session_logs_that_device_out(
    me_api, api_client_factory, db, account
):
    other = second_device(api_client_factory)
    target = sessions_of(db, account.id)[-1]

    response = me_api.delete(f"/moi/sessions/{target.id}")

    assert response.status_code == 204
    assert response.headers["Cache-Control"] == "private, no-store"
    assert other.get("/moi").status_code == 401
    assert me_api.get("/moi").status_code == 200


def test_the_current_session_cannot_be_closed_from_the_list(me_api, db, account):
    current = sessions_of(db, account.id)[0]

    response = me_api.delete(f"/moi/sessions/{current.id}")

    assert response.status_code == 409
    assert "déconnexion" in response.json()["detail"]
    assert me_api.get("/moi").status_code == 200


def test_unknown_expired_and_foreign_sessions_are_the_same_404(me_api, db, account):
    expired, _ = auth_service.create_session(db, account)
    expired.created_at -= 30 * DAY
    expired.expires_at = expired.created_at + 14 * DAY
    stranger = make_account(db, email="autre@example.com", username="autre")
    foreign, _ = auth_service.create_session(db, stranger)
    db.commit()

    for session_id in (999_999, expired.id, foreign.id):
        response = me_api.delete(f"/moi/sessions/{session_id}")
        assert response.status_code == 404
        assert response.json() == {"detail": f"Session {session_id} introuvable."}
    assert len(sessions_of(db, stranger.id)) == 1


def test_closing_every_other_session_keeps_only_this_one(
    me_api, api_client_factory, db, account
):
    first = second_device(api_client_factory, "Un")
    second = second_device(api_client_factory, "Deux")
    stranger = make_account(db, email="autre@example.com", username="autre")
    auth_service.create_session(db, stranger)

    response = me_api.delete("/moi/sessions")

    assert response.status_code == 204
    assert first.get("/moi").status_code == 401
    assert second.get("/moi").status_code == 401
    assert me_api.get("/moi").status_code == 200
    assert len(sessions_of(db, account.id)) == 1
    assert len(sessions_of(db, stranger.id)) == 1
    # Idempotente : plus rien à fermer, toujours 204.
    assert me_api.delete("/moi/sessions").status_code == 204


@pytest.mark.parametrize(
    "method,path", [("DELETE", "/moi/sessions"), ("DELETE", "/moi/sessions/1")]
)
def test_closing_sessions_requires_a_session(api, method, path):
    assert api.request(method, path).status_code == 401


# --- Appareil noté à l'ouverture (A2) ----------------------------------------


def test_sign_up_records_the_device(api, db):
    api.headers["User-Agent"] = "Mozilla/5.0 (Linux; Android 15) Chrome/140"
    response = api.post(
        "/inscription",
        json={
            "email": "neuf@example.com",
            "username": "neuf",
            "password": DEFAULT_PASSWORD,
        },
    )
    assert response.status_code == 201
    [session] = sessions_of(db, response.json()["id"])
    assert session.user_agent == "Mozilla/5.0 (Linux; Android 15) Chrome/140"


def test_a_login_without_user_agent_records_an_unknown_device(api, db, account):
    del api.headers["User-Agent"]
    log_in(api, EMAIL)
    [session] = sessions_of(db, account.id)
    assert session.user_agent is None


def test_the_device_is_cleaned_and_cut_to_256_characters(db, account):
    session, _ = auth_service.create_session(
        db, account, user_agent="  Navi\x00gateur\x1b  " + "x" * 400
    )
    assert session.user_agent.startswith("Navigateur ")
    assert len(session.user_agent) == USER_AGENT_MAX_LENGTH
    assert session.user_agent.isprintable()


@pytest.mark.parametrize(
    "raw,expected",
    [
        (None, None),
        ("", None),
        ("   ", None),
        ("\x00\x07\n", None),
        ("  Safari  ", "Safari"),
        ("a\tb", "ab"),
        ("é" * 300, "é" * USER_AGENT_MAX_LENGTH),
    ],
)
def test_clean_user_agent(raw, expected):
    assert auth_service.clean_user_agent(raw) == expected


# --- Renouvellement (P10, A10) -----------------------------------------------


def current_row(db: Session, account) -> AuthSession:
    [session] = sessions_of(db, account.id)
    return session


def test_a_new_session_lasts_fourteen_days(me_api, db, account):
    session = current_row(db, account)
    assert session.expires_at - session.created_at == 14 * DAY
    assert session.last_used_at is None


def test_nothing_is_renewed_within_twenty_four_hours(clock, me_api, db, account):
    clock.advance(timedelta(hours=23, minutes=59))

    response = me_api.get("/moi")

    assert response.status_code == 200
    assert max_age(response) is None
    session = current_row(db, account)
    assert session.last_used_at is None
    assert session.expires_at - session.created_at == 14 * DAY


def test_after_a_day_the_expiry_moves_and_the_cookie_is_set_again(
    clock, me_api, db, account
):
    created_at = current_row(db, account).created_at
    clock.advance(3 * DAY)

    response = me_api.get("/moi")

    assert response.status_code == 200
    assert response.headers["Cache-Control"] == "private, no-store"
    session = current_row(db, account)
    assert session.last_used_at == clock.now
    assert session.expires_at == clock.now + 14 * DAY
    assert session.created_at == created_at
    assert max_age(response) == int((14 * DAY).total_seconds())
    # Le jeton ne change pas : le même cookie continue de servir.
    assert me_api.get("/moi").status_code == 200


def test_the_next_renewal_waits_another_day(clock, me_api, db, account):
    clock.advance(2 * DAY)
    me_api.get("/moi")
    first = current_row(db, account).last_used_at

    clock.advance(timedelta(hours=12))
    assert max_age(me_api.get("/moi")) is None
    assert current_row(db, account).last_used_at == first

    clock.advance(timedelta(hours=12))
    assert max_age(me_api.get("/moi")) is not None
    assert current_row(db, account).last_used_at == clock.now


def test_a_session_used_every_ten_days_never_outlives_ninety_days(
    clock, me_api, db, account
):
    created_at = current_row(db, account).created_at
    for _ in range(8):
        clock.advance(10 * DAY)
        assert me_api.get("/moi").status_code == 200
    # Jour 80 : l'échéance ne peut plus aller au-delà du jour 90.
    session = current_row(db, account)
    assert session.expires_at == created_at + 90 * DAY

    clock.advance(9 * DAY)
    response = me_api.get("/moi")
    assert response.status_code == 200
    assert max_age(response) == int(timedelta(days=1).total_seconds())
    assert current_row(db, account).expires_at == created_at + 90 * DAY

    clock.advance(DAY)
    assert me_api.get("/moi").status_code == 401


def test_a_session_unused_for_fourteen_days_expires(clock, me_api, db, account):
    clock.advance(5 * DAY)
    me_api.get("/moi")
    clock.advance(14 * DAY)
    assert me_api.get("/moi").status_code == 401
    assert sessions_of(db, account.id) == []


def test_a_session_from_before_the_lot_is_renewed_at_its_first_request(
    clock, db, account, api
):
    # Une session de la v1.0 : échéance fixe, `last_used_at` NULL.
    session, token = auth_service.create_session(db, account)
    session.created_at -= 10 * DAY
    session.expires_at = session.created_at + 14 * DAY
    db.commit()
    api.cookies.set(ACTIVE_SESSION_COOKIE_NAME, token)

    response = api.get("/moi")

    assert response.status_code == 200
    renewed = current_row(db, account)
    assert renewed.last_used_at == clock.now
    assert renewed.expires_at == clock.now + 14 * DAY
    assert max_age(response) == int((14 * DAY).total_seconds())


def test_the_durations_follow_the_environment(monkeypatch, clock, me_api, db, account):
    monkeypatch.setenv("SESSION_IDLE_DAYS", "3")
    monkeypatch.setenv("SESSION_MAX_DAYS", "5")
    created_at = current_row(db, account).created_at
    clock.advance(DAY)
    me_api.get("/moi")
    assert current_row(db, account).expires_at == clock.now + 3 * DAY
    clock.advance(2 * DAY)
    me_api.get("/moi")
    assert current_row(db, account).expires_at == created_at + 5 * DAY


def test_a_204_carries_the_renewed_cookie(clock, me_api, db, account):
    clock.advance(2 * DAY)
    response = me_api.delete("/moi/sessions")
    assert response.status_code == 204
    assert max_age(response) == int((14 * DAY).total_seconds())


def test_a_busy_database_serves_the_request_without_renewing(
    clock, me_api, db, db_engine, account
):
    clock.advance(2 * DAY)
    with db_engine.connect() as holder:
        holder.exec_driver_sql("BEGIN IMMEDIATE")
        started = time.monotonic()
        response = me_api.get("/moi")
        elapsed = time.monotonic() - started
        holder.rollback()

    assert response.status_code == 200
    assert max_age(response) is None
    # L'attente du verrou est abaissée : loin des 5 s du pilote.
    assert elapsed < 2
    assert current_row(db, account).last_used_at is None

    # Le verrou rendu, la requête suivante renouvelle.
    response = me_api.get("/moi")
    assert max_age(response) is not None
    assert current_row(db, account).last_used_at == clock.now


def test_the_renewal_restores_the_driver_busy_timeout(clock, db, account):
    session, _ = auth_service.create_session(db, account)
    before = db.connection().exec_driver_sql("PRAGMA busy_timeout").scalar()
    clock.advance(2 * DAY)

    assert auth_service.renew_session(db, session) is True

    after = db.connection().exec_driver_sql("PRAGMA busy_timeout").scalar()
    assert after == before


def test_the_renewal_is_committed_before_the_sync_batch_takes_its_lock(
    monkeypatch, clock, me_api, db_engine, account
):
    seen: list = []
    original = sync_service.serialized_writes

    def spying_serialized_writes(engine):
        # Lu sur une connexion à part : seul ce qui est déjà commité s'y voit.
        with db_engine.connect() as reader:
            seen.append(
                reader.execute(
                    text("SELECT last_used_at FROM auth_session WHERE user_id = :u"),
                    {"u": account.id},
                ).scalar()
            )
        return original(engine)

    monkeypatch.setattr(sync_service, "serialized_writes", spying_serialized_writes)
    clock.advance(2 * DAY)

    response = me_api.post(
        "/sync",
        json={
            "operations": [
                {
                    "type": "player.create",
                    "operation_id": str(uuid4()),
                    "recorded_at": "2026-11-18T20:00:00Z",
                    "client_ref": str(uuid4()),
                    "data": {"name": "Marc"},
                }
            ]
        },
    )

    assert response.status_code == 200, response.text
    assert seen and seen[0] is not None
    assert max_age(response) is not None


# --- Réglages des durées -----------------------------------------------------


@pytest.mark.parametrize(
    "idle,maximum",
    [("100", "90"), ("abc", None), ("0", None), (None, "-1")],
)
def test_incoherent_durations_refuse_to_start(monkeypatch, idle, maximum):
    for name, value in (("SESSION_IDLE_DAYS", idle), ("SESSION_MAX_DAYS", maximum)):
        if value is None:
            monkeypatch.delenv(name, raising=False)
        else:
            monkeypatch.setenv(name, value)
    with pytest.raises(auth_service.SessionSettingsError):
        with TestClient(app):
            pass


def test_equal_durations_are_allowed(monkeypatch):
    monkeypatch.setenv("SESSION_IDLE_DAYS", "30")
    monkeypatch.setenv("SESSION_MAX_DAYS", "30")
    auth_service.check_session_settings()
    assert auth_service.session_idle() == auth_service.session_max() == 30 * DAY


def test_default_durations_are_fourteen_and_ninety_days(monkeypatch):
    monkeypatch.delenv("SESSION_IDLE_DAYS", raising=False)
    monkeypatch.delenv("SESSION_MAX_DAYS", raising=False)
    assert auth_service.session_idle() == 14 * DAY
    assert auth_service.session_max() == 90 * DAY
