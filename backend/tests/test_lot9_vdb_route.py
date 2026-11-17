"""Lot 9, étape B1 : lecture d'un deck chez VDB (`docs/lot9-plan-import-vdb.md`, A7).

Deux niveaux :

* le client (`app.services.vdb_client`) : forme de la réponse éprouvée sur les
  réponses réelles relevées le 2026-11-13 (`frontend/tests/fixtures/vdb/`),
  refus de toute réponse inattendue, statuts de VDB, lecture réseau bornée
  (délai, taille, pas de redirection) sur un faux `urllib`, lecture simulée
  des e2e (`VDB_STUB_DIR`) ;
* la route `GET /vdb/decks/{vdb_deck_id}` : 200, 404, 502, 401 et 422 sans
  appel sortant, 429 avec `Retry-After`, et l'ordre de ces contrôles.

Aucun test ne joint vdb.im : la lecture réseau est toujours remplacée.
"""

import io
import json
import urllib.error
from datetime import UTC, datetime
from pathlib import Path

import pytest

from app.main import app
from app.routers.vdb import VDB_DECK_NOT_FOUND, get_vdb_fetcher
from app.schemas.base import MAX_DB_INT
from app.services import vdb_client
from app.services.vdb_client import (
    VDB_API_DECK_URL,
    VDB_MAX_RESPONSE_BYTES,
    VDB_TIMEOUT_SECONDS,
    VdbDeckNotFoundError,
    VdbResponse,
    VdbUnavailableError,
    default_fetcher,
    fetch_from_vdb,
    make_stub_fetcher,
    parse_vdb_deck,
    read_vdb_deck,
    stub_file_name,
)
from tests.auth_helpers import log_in, make_account

VDB_FIXTURES = Path(__file__).resolve().parents[2] / "frontend/tests/fixtures/vdb"
API_FIXTURES = sorted(VDB_FIXTURES.glob("*-api.json"))
FETCHED_AT = datetime(2026, 11, 14, 9, 30, tzinfo=UTC)

MINIMAL = {"deckid": "4fc0ee5e9", "name": "Deck", "cards": {"100001": 2}}


def _body(payload) -> bytes:
    return json.dumps(payload).encode("utf-8")


def _parse(payload):
    return parse_vdb_deck(_body(payload), fetched_at=FETCHED_AT)


class RecordingFetcher:
    """Lecture simulée qui retient les identifiants demandés."""

    def __init__(self, response: VdbResponse | Exception):
        self.response = response
        self.calls: list[str] = []

    def __call__(self, vdb_deck_id: str) -> VdbResponse:
        self.calls.append(vdb_deck_id)
        if isinstance(self.response, Exception):
            raise self.response
        return self.response


def _fixture_response(name: str) -> VdbResponse:
    return VdbResponse(200, (VDB_FIXTURES / name).read_bytes())


# --------------------------------------------------------------------------
# Forme de la réponse : les réponses réelles
# --------------------------------------------------------------------------


def test_the_real_responses_are_all_there():
    names = {path.name for path in API_FIXTURES}
    assert {
        "ref-api.json",
        "difficile-api.json",
        "maj-avant-api.json",
        "maj-apres-api.json",
        "twda-api.json",
        "precon-api.json",
    } <= names


@pytest.mark.parametrize("path", API_FIXTURES, ids=lambda p: p.name)
def test_every_real_response_reads_without_loss(path):
    raw = json.loads(path.read_text(encoding="utf-8"))
    deck = parse_vdb_deck(path.read_bytes(), fetched_at=FETCHED_AT)

    assert deck.vdb_deck_id == raw["deckid"]
    assert deck.name == raw["name"]
    assert deck.author == (raw.get("author") or None)
    assert deck.fetched_at == FETCHED_AT
    expected = sorted((int(k), v) for k, v in raw["cards"].items() if v > 0)
    assert [(c.vekn_id, c.quantity) for c in deck.cards] == expected


def test_the_reference_deck_reads_as_relayed():
    deck = parse_vdb_deck(
        (VDB_FIXTURES / "ref-api.json").read_bytes(), fetched_at=FETCHED_AT
    )
    assert deck.vdb_deck_id == "4fc0ee5e9"
    assert deck.name == "Guns and shit (Mostly guns)"
    assert deck.author == "\N{GHOST} spigushe"
    assert deck.description == "by \N{LATIN CAPITAL LETTER E WITH ACUTE}douard Menneson"
    assert deck.cards[0].vekn_id == 100001 and deck.cards[0].quantity == 7
    assert [c.vekn_id for c in deck.cards] == sorted(c.vekn_id for c in deck.cards)


def test_a_twda_description_keeps_its_lines():
    deck = parse_vdb_deck(
        (VDB_FIXTURES / "twda-api.json").read_bytes(), fetched_at=FETCHED_AT
    )
    assert deck.vdb_deck_id == "12761"
    assert deck.description.splitlines()[:2] == ["Date: 2026-09-20", "Players: 80"]


def test_a_precon_keeps_its_colon_id():
    deck = parse_vdb_deck(
        (VDB_FIXTURES / "precon-api.json").read_bytes(), fetched_at=FETCHED_AT
    )
    assert deck.vdb_deck_id == "SV5:PCaine"


# --------------------------------------------------------------------------
# Forme de la réponse : tolérances
# --------------------------------------------------------------------------


@pytest.mark.parametrize("value", [None, "", "   ", "\n"])
def test_an_empty_author_or_description_reads_null(value):
    deck = _parse(MINIMAL | {"author": value, "description": value})
    assert deck.author is None and deck.description is None


def test_a_missing_author_or_description_reads_null():
    deck = _parse(MINIMAL)
    assert deck.author is None and deck.description is None


def test_a_description_is_relayed_untouched():
    text = "  **Markdown**\n\n- une ligne  \n"
    assert _parse(MINIMAL | {"description": text}).description == text


def test_an_empty_name_is_relayed():
    """Le navigateur remplace un nom vide par « Deck importé » (P7)."""
    assert _parse(MINIMAL | {"name": ""}).name == ""


def test_an_empty_deck_is_permitted():
    assert _parse(MINIMAL | {"cards": {}}).cards == []


def test_a_zero_quantity_is_omitted():
    deck = _parse(MINIMAL | {"cards": {"100002": 0, "100001": 3}})
    assert [(c.vekn_id, c.quantity) for c in deck.cards] == [(100001, 3)]


@pytest.mark.parametrize("tags", [[], {"base": [], "superior": ["vote"]}, None, 3])
def test_unread_fields_are_ignored_whatever_their_shape(tags):
    deck = _parse(MINIMAL | {"tags": tags, "timestamp": 12, "isNonEditable": "x"})
    assert deck.name == "Deck"


def test_the_bounds_are_accepted():
    deck = _parse(MINIMAL | {"cards": {str(MAX_DB_INT): MAX_DB_INT}})
    assert deck.cards[0].vekn_id == MAX_DB_INT
    assert deck.cards[0].quantity == MAX_DB_INT


# --------------------------------------------------------------------------
# Forme de la réponse : refus
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    "body",
    [
        b"",
        b"<html>Maintenance</html>",
        b"\xff\xfe",
        b"[]",
        b'"deck"',
        b"null",
    ],
)
def test_an_unreadable_body_is_unexpected(body):
    with pytest.raises(VdbUnavailableError, match="inattendue"):
        parse_vdb_deck(body, fetched_at=FETCHED_AT)


@pytest.mark.parametrize(
    "change",
    [
        {"deckid": None},
        {"deckid": 12761},
        {"deckid": ""},
        {"deckid": "a/b"},
        {"deckid": "x" * 65},
        {"name": None},
        {"name": 3},
        {"author": 3},
        {"description": ["a"]},
        {"cards": None},
        {"cards": []},
        {"cards": [[100001, 2]]},
        {"cards": {"abc": 1}},
        {"cards": {"0": 1}},
        {"cards": {"0100001": 1}},
        {"cards": {"-1": 1}},
        {"cards": {"100001.0": 1}},
        {"cards": {str(MAX_DB_INT + 1): 1}},
        {"cards": {"100001": -1}},
        {"cards": {"100001": MAX_DB_INT + 1}},
        {"cards": {"100001": 2.0}},
        {"cards": {"100001": "2"}},
        {"cards": {"100001": True}},
        {"cards": {"100001": None}},
    ],
    ids=repr,
)
def test_a_response_out_of_shape_is_unexpected(change):
    payload = MINIMAL | change
    with pytest.raises(VdbUnavailableError, match="inattendue"):
        _parse(payload)


def test_a_missing_field_is_unexpected():
    for key in ("deckid", "name", "cards"):
        payload = {k: v for k, v in MINIMAL.items() if k != key}
        with pytest.raises(VdbUnavailableError):
            _parse(payload)


# --------------------------------------------------------------------------
# Point d'entrée : statuts de VDB
# --------------------------------------------------------------------------


@pytest.mark.parametrize("status", [400, 404])
def test_vdb_saying_unknown_is_not_found(status):
    with pytest.raises(VdbDeckNotFoundError):
        read_vdb_deck("V5:Ma", fetch=RecordingFetcher(VdbResponse(status, b"")))


@pytest.mark.parametrize("status", [201, 204, 302, 401, 403, 429, 500, 502, 503])
def test_any_other_status_is_unexpected(status):
    fetch = RecordingFetcher(VdbResponse(status, _body(MINIMAL)))
    with pytest.raises(VdbUnavailableError, match=f"statut {status}"):
        read_vdb_deck("4fc0ee5e9", fetch=fetch)


def test_a_success_is_dated_by_the_clock():
    fetch = RecordingFetcher(VdbResponse(200, _body(MINIMAL)))
    deck = read_vdb_deck("4fc0ee5e9", fetch=fetch, now=lambda: FETCHED_AT)
    assert deck.fetched_at == FETCHED_AT
    assert fetch.calls == ["4fc0ee5e9"]


@pytest.mark.parametrize("value", ["", "a/b", "../api", "a.b", "a?b", " a", "x" * 65])
def test_an_id_outside_the_pattern_never_reaches_the_network(value):
    fetch = RecordingFetcher(VdbResponse(200, _body(MINIMAL)))
    with pytest.raises(ValueError):
        read_vdb_deck(value, fetch=fetch)
    assert fetch.calls == []


def test_the_id_vdb_returns_wins_over_the_one_asked():
    """VDB peut rendre un identifiant normalisé : c'est lui que le deck garde."""
    fetch = RecordingFetcher(VdbResponse(200, _body(MINIMAL | {"deckid": "abc"})))
    assert read_vdb_deck("abcdef", fetch=fetch).vdb_deck_id == "abc"


# --------------------------------------------------------------------------
# Lecture réseau réelle, sur un faux `urllib`
# --------------------------------------------------------------------------


class FakeHttpResponse(io.BytesIO):
    def __init__(self, body: bytes, status: int = 200):
        super().__init__(body)
        self.status = status


class FakeOpener:
    def __init__(self, outcome):
        self.outcome = outcome
        self.requests: list = []

    def open(self, request, timeout):
        self.requests.append((request, timeout))
        if isinstance(self.outcome, BaseException):
            raise self.outcome
        return self.outcome


@pytest.fixture
def opener(monkeypatch):
    def install(outcome) -> FakeOpener:
        fake = FakeOpener(outcome)
        monkeypatch.setattr(vdb_client, "_OPENER", fake)
        return fake

    return install


def test_the_network_read_targets_the_fixed_address(opener):
    fake = opener(FakeHttpResponse(b'{"a": 1}'))
    response = fetch_from_vdb("SV5:PCaine")

    request, timeout = fake.requests[0]
    assert request.full_url == "https://vdb.im/api/deck/SV5:PCaine"
    assert request.full_url.startswith(VDB_API_DECK_URL)
    assert request.get_method() == "GET"
    assert request.get_header("Accept") == "application/json"
    assert timeout == VDB_TIMEOUT_SECONDS == 10.0
    assert response == VdbResponse(200, b'{"a": 1}')


def test_an_http_error_is_returned_as_a_status(opener):
    error = urllib.error.HTTPError(
        "https://vdb.im/api/deck/x", 400, "Bad Request", {}, io.BytesIO(b"no")
    )
    opener(error)
    assert fetch_from_vdb("x") == VdbResponse(400, b"")


@pytest.mark.parametrize(
    "error",
    [
        urllib.error.URLError("Name or service not known"),
        TimeoutError("timed out"),
        ConnectionResetError(),
        OSError("network unreachable"),
    ],
    ids=lambda e: type(e).__name__,
)
def test_a_transport_failure_is_unavailable(opener, error):
    opener(error)
    with pytest.raises(VdbUnavailableError, match="injoignable"):
        fetch_from_vdb("x")


def test_a_body_at_the_limit_is_read(opener):
    body = b"x" * VDB_MAX_RESPONSE_BYTES
    opener(FakeHttpResponse(body))
    assert fetch_from_vdb("x").body == body


def test_a_body_over_the_limit_is_refused(opener):
    opener(FakeHttpResponse(b"x" * (VDB_MAX_RESPONSE_BYTES + 1)))
    with pytest.raises(VdbUnavailableError, match="volumineuse"):
        fetch_from_vdb("x")


def test_a_custom_limit_applies(opener):
    opener(FakeHttpResponse(b"12345"))
    with pytest.raises(VdbUnavailableError):
        fetch_from_vdb("x", max_bytes=4)


def test_redirects_are_never_followed():
    """Le gestionnaire de redirection refuse : `urllib` rend alors le 3xx en
    `HTTPError`, que `fetch_from_vdb` ramène à un statut inattendu."""
    handler = vdb_client._RefuseRedirects()
    assert (
        handler.redirect_request(None, None, 302, "Found", {}, "http://evil/")
        is None
    )
    assert any(
        isinstance(h, vdb_client._RefuseRedirects)
        for h in vdb_client._OPENER.handlers
    )


# --------------------------------------------------------------------------
# Lecture simulée (`VDB_STUB_DIR`, e2e)
# --------------------------------------------------------------------------


def test_the_stub_file_name_replaces_the_colon():
    assert stub_file_name("SV5:PCaine") == "SV5_PCaine.json"
    assert stub_file_name("4fc0ee5e9") == "4fc0ee5e9.json"


def test_the_stub_reads_a_file_or_answers_unknown(tmp_path):
    (tmp_path / "SV5_PCaine.json").write_bytes(b'{"x": 1}')
    fetch = make_stub_fetcher(tmp_path)
    assert fetch("SV5:PCaine") == VdbResponse(200, b'{"x": 1}')
    assert fetch("absent") == VdbResponse(400, b"")


def test_the_default_fetcher_follows_the_stub_setting(monkeypatch, tmp_path):
    monkeypatch.delenv("VDB_STUB_DIR", raising=False)
    assert default_fetcher() is fetch_from_vdb

    monkeypatch.setenv("VDB_STUB_DIR", str(tmp_path))
    (tmp_path / "abc.json").write_bytes(_body(MINIMAL))
    assert default_fetcher()("abc").status == 200


# --------------------------------------------------------------------------
# Route
# --------------------------------------------------------------------------


@pytest.fixture
def me_api(api, db):
    make_account(db, email="lot9b1@example.com", username="lot9b1")
    db.commit()
    log_in(api, "lot9b1@example.com")
    return api


@pytest.fixture
def vdb(api):
    """Remplace la lecture réseau de la route ; rend le faux pour inspection."""

    def install(response: VdbResponse | Exception) -> RecordingFetcher:
        fake = RecordingFetcher(response)
        app.dependency_overrides[get_vdb_fetcher] = lambda: fake
        return fake

    return install


def test_the_route_relays_a_real_deck(me_api, vdb):
    fake = vdb(_fixture_response("ref-api.json"))
    response = me_api.get("/vdb/decks/4fc0ee5e9")

    assert response.status_code == 200
    body = response.json()
    assert set(body) == {
        "vdb_deck_id",
        "name",
        "author",
        "description",
        "cards",
        "fetched_at",
    }
    assert body["vdb_deck_id"] == "4fc0ee5e9"
    assert body["name"] == "Guns and shit (Mostly guns)"
    assert body["cards"][0] == {"vekn_id": 100001, "quantity": 7}
    assert body["fetched_at"].endswith("Z")
    assert fake.calls == ["4fc0ee5e9"]
    assert "no-store" in response.headers["Cache-Control"]


def test_the_route_relays_a_precon_by_its_colon_id(me_api, vdb):
    fake = vdb(_fixture_response("precon-api.json"))
    response = me_api.get("/vdb/decks/SV5:PCaine")
    assert response.status_code == 200
    assert response.json()["vdb_deck_id"] == "SV5:PCaine"
    assert fake.calls == ["SV5:PCaine"]


def test_the_route_says_not_found(me_api, vdb):
    vdb(VdbResponse(400, b""))
    response = me_api.get("/vdb/decks/V5Ma")
    assert response.status_code == 404
    assert response.json() == {"detail": VDB_DECK_NOT_FOUND}


@pytest.mark.parametrize(
    ("outcome", "fragment"),
    [
        (VdbUnavailableError("VDB est injoignable."), "injoignable"),
        (VdbResponse(500, b"Internal Server Error"), "statut 500"),
        (VdbResponse(200, b"<html>"), "corps illisible"),
        (VdbResponse(200, _body(MINIMAL | {"cards": {"100001": -2}})), "hors bornes"),
        (VdbResponse(200, _body(MINIMAL | {"deckid": "../x"})), "identifiant de deck"),
    ],
    ids=["unreachable", "server-error", "html", "quantity", "deckid"],
)
def test_the_route_says_bad_gateway(me_api, vdb, outcome, fragment):
    vdb(outcome)
    response = me_api.get("/vdb/decks/4fc0ee5e9")
    assert response.status_code == 502
    detail = response.json()["detail"]
    assert fragment in detail
    assert "Internal Server Error" not in detail


def test_the_route_needs_a_session_before_anything(api, vdb):
    fake = vdb(VdbResponse(200, _body(MINIMAL)))
    assert api.get("/vdb/decks/4fc0ee5e9").status_code == 401
    assert api.get("/vdb/decks/a.b").status_code == 401
    assert fake.calls == []


@pytest.mark.parametrize("value", ["a.b", "a%3Fb", "a%23b", "x" * 65])
def test_the_route_refuses_an_id_outside_the_pattern_without_calling(
    me_api, vdb, value
):
    fake = vdb(VdbResponse(200, _body(MINIMAL)))
    assert me_api.get(f"/vdb/decks/{value}").status_code == 422
    assert fake.calls == []


@pytest.mark.parametrize("value", ["a/b", "a%2Fb", "..%2Fapi"])
def test_a_slash_never_reaches_vdb(me_api, vdb, value):
    """Une barre, même encodée, sort du chemin de la route : le routage rend
    404 avant toute lecture, sans le message d'un deck VDB introuvable."""
    fake = vdb(VdbResponse(200, _body(MINIMAL)))
    response = me_api.get(f"/vdb/decks/{value}")
    assert response.status_code == 404
    assert response.json() != {"detail": VDB_DECK_NOT_FOUND}
    assert fake.calls == []


def test_the_route_is_rate_limited(monkeypatch, me_api, vdb):
    monkeypatch.setenv("VDB_RATE_LIMIT", "2/minute")
    fake = vdb(VdbResponse(200, _body(MINIMAL)))

    statuses = [me_api.get("/vdb/decks/4fc0ee5e9").status_code for _ in range(3)]

    assert statuses == [200, 200, 429]
    assert len(fake.calls) == 2
    limited = me_api.get("/vdb/decks/4fc0ee5e9")
    assert limited.status_code == 429
    assert "Retry-After" in limited.headers


def test_refused_calls_do_not_consume_the_rate_limit(monkeypatch, me_api, vdb):
    """Le contrôle de slowapi passe après le motif : un 422 ne compte pas."""
    monkeypatch.setenv("VDB_RATE_LIMIT", "2/minute")
    vdb(VdbResponse(200, _body(MINIMAL)))

    for _ in range(3):
        assert me_api.get("/vdb/decks/a.b").status_code == 422
    statuses = [me_api.get("/vdb/decks/4fc0ee5e9").status_code for _ in range(3)]
    assert statuses == [200, 200, 429]


def test_a_failed_read_still_counts_against_the_limit(monkeypatch, me_api, vdb):
    """Un 404 ou un 502 a bien joint VDB : il compte."""
    monkeypatch.setenv("VDB_RATE_LIMIT", "2/minute")
    vdb(VdbResponse(400, b""))
    statuses = [me_api.get("/vdb/decks/4fc0ee5e9").status_code for _ in range(3)]
    assert statuses == [404, 404, 429]


def test_the_default_rate_limit_is_twenty_a_minute(monkeypatch):
    from app.services.rate_limit import vdb_rate_limit

    monkeypatch.delenv("VDB_RATE_LIMIT", raising=False)
    assert vdb_rate_limit() == "20/minute"


def test_the_route_reads_the_stub_directory(monkeypatch, me_api, tmp_path):
    """Sans remplacement de la dépendance, la route suit `VDB_STUB_DIR` : c'est
    ainsi que les e2e contre le vrai back simulent VDB."""
    (tmp_path / "SV5_PCaine.json").write_bytes(
        (VDB_FIXTURES / "precon-api.json").read_bytes()
    )
    monkeypatch.setenv("VDB_STUB_DIR", str(tmp_path))

    found = me_api.get("/vdb/decks/SV5:PCaine")
    assert found.status_code == 200
    assert found.json()["vdb_deck_id"] == "SV5:PCaine"
    assert me_api.get("/vdb/decks/absent").status_code == 404
