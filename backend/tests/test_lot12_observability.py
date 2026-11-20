"""Lot 12, étape B3 : journaux de l'API et rapport du journal `/sync` (P4, A5).

Ce que ce fichier éprouve (`docs/lot12-plan-consolidation.md`) :

* la forme : une ligne JSON par enregistrement, horodatage UTC, niveau,
  journal, événement, et les seuls champs passés à l'événement ; la sortie
  lisible de `LOG_FORMAT=text` ; des réglages illisibles refusés ;
* `http.request` : méthode, gabarit de route et jamais le chemin brut, statut,
  durée, compte de la session ; ni corps, ni requête `q`, ni adresse, ni mot
  de passe, ni jeton, y compris sur la connexion et les refus ;
* `sync.batch` : taille, issues, refus par motif et par type d'opération,
  écrit après le `COMMIT` du lot ;
* `scripts/sync_report.py` sur un journal fabriqué, en lecture seule.
"""

import importlib.util
import json
import logging
import sqlite3
import sys
from datetime import date, datetime
from pathlib import Path
from uuid import uuid4

import pytest
from sqlalchemy import func, select

from app.models.sync import SyncOperation
from app.observability import (
    ACCESS_LOGGER,
    APP_LOGGER,
    SYNC_LOGGER,
    UNMATCHED_ROUTE,
    JsonFormatter,
    LoggingSettingsError,
    TextFormatter,
    configure_logging,
)
from tests.auth_helpers import DEFAULT_PASSWORD, log_in
from tests.helpers import (
    DEFAULT_ACCOUNT_EMAIL,
    default_user_id,
    login_default_account,
    make_deck,
)

RECORDED_AT = "2026-11-18T20:00:00+01:00"

SCRIPT = Path(__file__).resolve().parent.parent / "scripts" / "sync_report.py"
_spec = importlib.util.spec_from_file_location("sync_report", SCRIPT)
sync_report = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(sync_report)


def _record(message="événement", fields=None, exc_info=None, name="app.test"):
    record = logging.LogRecord(name, logging.INFO, __file__, 1, message, (), exc_info)
    if fields is not None:
        record.fields = fields
    return record


def _lines(caplog, event):
    return [r for r in caplog.records if r.getMessage() == event]


def _requests(caplog):
    return [r.fields for r in _lines(caplog, "http.request")]


def _all_text(caplog):
    """Toutes les lignes telles que journald les recevrait."""
    formatter = JsonFormatter()
    return "\n".join(formatter.format(r) for r in caplog.records)


@pytest.fixture
def logs(caplog):
    caplog.set_level(logging.INFO, logger=APP_LOGGER)
    return caplog


# --- Formateurs ---------------------------------------------------------------


def test_a_json_line_carries_the_envelope_and_only_the_given_fields():
    record = _record("http.request", {"method": "GET", "status": 200})
    record.password = "ne-doit-pas-sortir"  # un attribut étranger est ignoré

    line = json.loads(JsonFormatter().format(record))

    assert set(line) == {"ts", "level", "logger", "event", "method", "status"}
    assert line["level"] == "info"
    assert line["logger"] == "app.test"
    assert line["event"] == "http.request"
    assert line["ts"].endswith("Z")
    datetime.fromisoformat(line["ts"].replace("Z", "+00:00"))


def test_an_exception_shows_only_its_type():
    try:
        raise ValueError("paramètres SQL : joueur@example.com")
    except ValueError:
        record = _record("échec", exc_info=sys.exc_info())

    formatted = JsonFormatter().format(record)

    assert json.loads(formatted)["exc_type"] == "ValueError"
    assert "joueur@example.com" not in formatted
    assert "Traceback" not in formatted


def test_the_text_format_is_one_readable_line():
    record = _record(
        "sync.batch", {"size": 2, "rejected_by_code": {"not_found": 1}}
    )

    line = TextFormatter().format(record)

    assert "\n" not in line
    assert " INFO    app.test sync.batch size=2" in line
    assert 'rejected_by_code={"not_found":1}' in line


# --- Réglages ---------------------------------------------------------------


@pytest.fixture
def restore_logging():
    logger = logging.getLogger(APP_LOGGER)
    handlers, level = list(logger.handlers), logger.level
    yield
    logger.handlers[:] = handlers
    logger.setLevel(level)


def _own_handlers():
    return [
        h
        for h in logging.getLogger(APP_LOGGER).handlers
        if getattr(h, "_gurchon_hall_handler", False)
    ]


def test_configuration_is_idempotent_and_defaults_to_json_at_info(
    monkeypatch, restore_logging
):
    monkeypatch.delenv("LOG_LEVEL", raising=False)
    monkeypatch.delenv("LOG_FORMAT", raising=False)

    configure_logging()
    configure_logging()

    handlers = _own_handlers()
    assert len(handlers) == 1
    assert isinstance(handlers[0].formatter, JsonFormatter)
    assert logging.getLogger(APP_LOGGER).level == logging.INFO


def test_the_level_and_the_format_are_read_from_the_environment(
    monkeypatch, restore_logging
):
    monkeypatch.setenv("LOG_LEVEL", " warning ")
    monkeypatch.setenv("LOG_FORMAT", "TEXT")

    configure_logging()

    assert isinstance(_own_handlers()[0].formatter, TextFormatter)
    assert logging.getLogger(APP_LOGGER).level == logging.WARNING


@pytest.mark.parametrize(
    ("name", "value"), [("LOG_LEVEL", "bavard"), ("LOG_FORMAT", "xml")]
)
def test_an_unreadable_setting_refuses_to_start(
    monkeypatch, restore_logging, name, value
):
    monkeypatch.setenv(name, value)
    before = list(logging.getLogger(APP_LOGGER).handlers)

    with pytest.raises(LoggingSettingsError, match=name):
        configure_logging()

    assert logging.getLogger(APP_LOGGER).handlers == before


def test_a_line_reaches_the_standard_output(capsys, monkeypatch, restore_logging):
    monkeypatch.delenv("LOG_FORMAT", raising=False)
    configure_logging()

    logging.getLogger(ACCESS_LOGGER).info("http.request", extra={"fields": {"a": 1}})

    line = json.loads(capsys.readouterr().out.strip().splitlines()[-1])
    assert line["event"] == "http.request" and line["a"] == 1


# --- Une ligne par requête ----------------------------------------------------


def test_a_request_logs_its_route_template_status_duration_and_account(
    api, db, logs
):
    login_default_account(api, db)
    deck = make_deck(db, name="Banu Princes")
    db.commit()
    logs.clear()

    assert api.get(f"/decks/{deck.id}").status_code == 200

    [fields] = _requests(logs)
    assert fields["method"] == "GET"
    assert fields["route"] == "/decks/{deck_id}"
    assert fields["status"] == 200
    assert isinstance(fields["duration_ms"], float) and fields["duration_ms"] >= 0
    assert fields["user_id"] == default_user_id(db)
    assert set(fields) == {"method", "route", "status", "duration_ms", "user_id"}
    assert "Banu" not in _all_text(logs)


def test_a_public_route_logs_no_account_and_never_the_search_text(api, logs):
    assert api.get("/cartes", params={"q": "texte-cherché-secret"}).status_code == 200

    [fields] = _requests(logs)
    assert fields["route"] == "/cartes"
    assert "user_id" not in fields
    assert "texte-cherché-secret" not in _all_text(logs)


def test_an_unknown_path_is_logged_without_the_raw_path(api, logs):
    assert api.get("/nulle-part/12345").status_code == 404

    [fields] = _requests(logs)
    assert fields["route"] == UNMATCHED_ROUTE
    assert fields["status"] == 404
    assert "12345" not in _all_text(logs)


def test_a_request_without_session_is_logged_as_401_without_account(api, logs):
    assert api.get("/decks/999999").status_code == 401

    [fields] = _requests(logs)
    assert fields == {
        "method": "GET",
        "route": "/decks/{deck_id}",
        "status": 401,
        "duration_ms": fields["duration_ms"],
    }


def test_logging_in_never_logs_the_address_the_password_or_the_token(
    api, db, logs
):
    default_user_id(db)
    db.commit()

    response = log_in(api, DEFAULT_ACCOUNT_EMAIL, DEFAULT_PASSWORD)
    token = next(iter(response.cookies.values()))
    wrong = {"email": DEFAULT_ACCOUNT_EMAIL, "password": "Faux-1234567!"}
    api.post("/connexion", json=wrong)

    text = _all_text(logs)
    assert [f["status"] for f in _requests(logs)] == [200, 401]
    assert {f["route"] for f in _requests(logs)} == {"/connexion"}
    for secret in (DEFAULT_ACCOUNT_EMAIL, DEFAULT_PASSWORD, "Faux-1234567!", token):
        assert secret not in text


def test_a_refused_origin_is_still_logged(api, db, logs):
    login_default_account(api, db)
    logs.clear()

    response = api.post(
        "/decks", json={"name": "X"}, headers={"Origin": "https://ailleurs.example"}
    )

    assert response.status_code == 403
    [fields] = _requests(logs)
    assert fields["status"] == 403
    assert "ailleurs" not in _all_text(logs)


def test_a_server_error_line_is_at_error_level(api, logs):
    from app.main import app

    @app.get("/__boom_lot12")
    def _boom():
        raise RuntimeError("mot de passe en clair")

    try:
        with pytest.raises(RuntimeError):
            api.get("/__boom_lot12")
    finally:
        app.router.routes[:] = [
            r for r in app.router.routes if getattr(r, "path", None) != "/__boom_lot12"
        ]

    [record] = _lines(logs, "http.request")
    assert record.levelno == logging.ERROR
    assert record.fields["status"] == 500
    assert record.fields["route"] == "/__boom_lot12"
    assert "mot de passe en clair" not in _all_text(logs)


# --- Une ligne par lot /sync ----------------------------------------------------


def _deck_create(name):
    return {
        "type": "deck.create",
        "operation_id": str(uuid4()),
        "recorded_at": RECORDED_AT,
        "client_ref": str(uuid4()),
        "data": {"name": name},
    }


def _unknown_stock(card_id=999_999):
    return {
        "type": "stock.upsert",
        "operation_id": str(uuid4()),
        "recorded_at": RECORDED_AT,
        "data": {
            "card_id": card_id,
            "language_code": "EN",
            "card_set_id": 1,
            "quantity_owned": 1,
        },
    }


def test_a_sync_batch_logs_its_size_outcomes_and_refusals(api, db, logs):
    login_default_account(api, db)
    replayed = _deck_create("Rejoué")
    assert api.post("/sync", json={"operations": [replayed]}).status_code == 200
    logs.clear()

    response = api.post(
        "/sync",
        json={
            "operations": [
                replayed,
                _deck_create("Deck secret"),
                _unknown_stock(),
                _unknown_stock(999_998),
            ]
        },
    )

    assert response.status_code == 200
    [record] = _lines(logs, "sync.batch")
    assert record.name == SYNC_LOGGER
    assert record.levelno == logging.WARNING
    assert record.fields == {
        "user_id": default_user_id(db),
        "batch_id": response.json()["batch_id"],
        "size": 4,
        "applied": 1,
        "replayed": 1,
        "rejected": 2,
        "rejected_by_code": {"not_found": 2},
        "rejected_by_type": {"stock.upsert": 2},
    }
    text = _all_text(logs)
    assert "Deck secret" not in text
    assert "introuvable" not in text  # aucun message de refus


def test_a_clean_sync_batch_logs_at_info(api, db, logs):
    login_default_account(api, db)

    api.post("/sync", json={"operations": [_deck_create("Propre")]})

    [record] = _lines(logs, "sync.batch")
    assert record.levelno == logging.INFO
    assert record.fields["rejected_by_code"] == {}
    assert record.fields["rejected_by_type"] == {}


def test_the_sync_summary_is_written_after_the_commit(api, db, db_engine, logs):
    """Au moment où la ligne s'écrit, le journal est déjà en base, visible
    depuis une autre connexion."""
    login_default_account(api, db)
    seen: list[int] = []

    class _Probe(logging.Handler):
        def emit(self, record):
            if record.getMessage() == "sync.batch":
                with db_engine.connect() as other:
                    seen.append(
                        other.scalar(select(func.count()).select_from(SyncOperation))
                    )

    probe = _Probe()
    logging.getLogger(SYNC_LOGGER).addHandler(probe)
    try:
        operations = [_deck_create("Après"), _unknown_stock()]
        api.post("/sync", json={"operations": operations})
    finally:
        logging.getLogger(SYNC_LOGGER).removeHandler(probe)

    assert seen == [2]


# --- scripts/sync_report.py ------------------------------------------------------


def _journal_row(db, *, user_id, kind, status, code=None, at):
    db.add(
        SyncOperation(
            user_id=user_id,
            operation_id=str(uuid4()),
            batch_id=str(uuid4()),
            operation_type=kind,
            request_hash="0" * 64,
            status=status,
            error_code=code,
            error_message="Deck « Secret » introuvable." if code else None,
            resource_kind=None if code else "deck",
            recorded_at=at,
            processed_at=at,
        )
    )


@pytest.fixture
def journal(db, db_engine):
    rows = [
        (1, "deck.create", "applied", None, datetime(2026, 11, 16, 23, 59)),
        (1, "stock.upsert", "rejected", "not_found", datetime(2026, 11, 17, 8, 0)),
        (1, "stock.upsert", "rejected", "not_found", datetime(2026, 11, 17, 9, 0)),
        (1, "deck_card.upsert", "rejected", "conflict", datetime(2026, 11, 17, 10, 0)),
        (2, "game.create", "rejected", "invalid", datetime(2026, 11, 18, 0, 0)),
        (2, "deck.update", "applied", None, datetime(2026, 11, 19, 12, 0)),
    ]
    for user_id, kind, status, code, at in rows:
        _journal_row(db, user_id=user_id, kind=kind, status=status, code=code, at=at)
    db.commit()
    return db_engine.url.database


def test_the_report_counts_refusals_by_code_type_and_day(journal):
    report = sync_report.build_report(Path(journal))

    assert report["operations"] == 6
    assert report["applied"] == 2
    assert report["rejected"] == 4
    assert report["rejected_by_code"] == {"not_found": 2, "conflict": 1, "invalid": 1}
    assert report["rejected_by_code_and_type"][0] == {
        "code": "not_found",
        "type": "stock.upsert",
        "count": 2,
    }
    assert report["by_day"] == [
        {"day": "2026-11-16", "applied": 1, "rejected": 0},
        {"day": "2026-11-17", "applied": 0, "rejected": 3},
        {"day": "2026-11-18", "applied": 0, "rejected": 1},
        {"day": "2026-11-19", "applied": 1, "rejected": 0},
    ]


def test_the_period_includes_both_days_and_the_account_filters(journal):
    path = Path(journal)

    period = sync_report.build_report(
        path, since=date(2026, 11, 17), until=date(2026, 11, 18)
    )
    assert period["operations"] == 4
    assert period["rejected_by_code"] == {"not_found": 2, "conflict": 1, "invalid": 1}

    account = sync_report.build_report(path, user_id=2)
    assert (account["operations"], account["applied"], account["rejected"]) == (2, 1, 1)


def test_the_report_never_quotes_a_refusal_message(journal, capsys):
    assert sync_report.main([journal]) == 0
    text = capsys.readouterr().out
    assert sync_report.main([journal, "--json"]) == 0
    text += capsys.readouterr().out

    assert "Secret" not in text
    assert "not_found" in text and "stock.upsert" in text


def test_the_report_opens_the_base_read_only(journal, monkeypatch):
    opened: list[str] = []
    real_connect = sqlite3.connect

    def spy(target, *args, **kwargs):
        opened.append(target)
        return real_connect(target, *args, **kwargs)

    monkeypatch.setattr(sync_report.sqlite3, "connect", spy)
    sync_report.build_report(Path(journal))

    assert opened and all(t.endswith("?mode=ro") for t in opened)


def test_the_report_refuses_a_missing_file_a_base_without_journal_and_a_bad_date(
    tmp_path, capsys
):
    assert sync_report.main([str(tmp_path / "absente.db")]) == 2

    empty = tmp_path / "vide.db"
    sqlite3.connect(empty).close()
    assert sync_report.main([str(empty)]) == 2
    assert "sync_operation" in capsys.readouterr().err

    with pytest.raises(SystemExit) as refused:
        sync_report.main([str(empty), "--since", "17/11/2026"])
    assert refused.value.code == 2


def test_an_empty_period_says_so(journal, capsys):
    assert sync_report.main([journal, "--since", "2030-01-01"]) == 0

    out = capsys.readouterr().out
    assert "Opérations tranchées : 0" in out
    assert "Aucun refus sur la période." in out
