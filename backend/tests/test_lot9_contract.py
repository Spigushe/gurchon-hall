"""Lot 9, étape A1 : le contrat de l'import depuis VDB.

Ce que ce fichier fige (`docs/lot9-plan-import-vdb.md`, A6 et A7) :

* le motif fermé d'un identifiant de deck VDB, éprouvé sur les identifiants
  réels des fixtures (deck d'utilisateur, deck de la TWDA, précon) ;
* `vdb_deck_id` à la création d'un deck, en ligne comme par `/sync`, et en
  lecture ; jamais en modification ;
* l'empreinte inchangée d'une `deck.create` écrite avant le lot ;
* la déclaration de `GET /vdb/decks/{vdb_deck_id}` au contrat, et le refus
  en 422 d'un identifiant hors motif. Le corps de la route (étape B1) est
  éprouvé dans `test_lot9_vdb_route.py`.
"""

import json
from pathlib import Path
from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.main import app
from app.schemas.collection import DeckCreate, DeckUpdate
from app.schemas.sync import DeckCreateOperation, fingerprint
from app.schemas.vdb import VdbDeckRead
from tests.auth_helpers import log_in, make_account

VDB_FIXTURES = Path(__file__).resolve().parents[2] / "frontend/tests/fixtures/vdb"
RECORDED_AT = "2026-11-13T20:00:00+01:00"

# Identifiants relevés le 2026-11-13 : decks d'utilisateur (adresses courtes et
# instantanés), deck de la TWDA, précon.
REAL_IDS = ["4fc0ee5e9", "b4a7ee6d5", "31203cb9e", "6cd179ff5", "12761", "SV5:PCaine"]

REFUSED_IDS = [
    "",
    " 4fc0ee5e9",
    "4fc0ee5e9 ",
    "4fc0ee5e9\n",
    "a/b",
    "../api",
    "a.b",
    "a?b=1",
    "a#b",
    "a%2Fb",
    "https://vdb.im/decks/4fc0ee5e9",
    "é",
    "x" * 65,
]


@pytest.fixture
def me_api(api, db):
    make_account(db, email="lot9@example.com", username="lot9")
    db.commit()
    log_in(api, "lot9@example.com")
    return api


def _op(type_: str, **fields) -> dict:
    return {
        "type": type_,
        "operation_id": str(uuid4()),
        "recorded_at": RECORDED_AT,
    } | fields


# --------------------------------------------------------------------------
# Motif de l'identifiant
# --------------------------------------------------------------------------


def test_every_real_vdb_fixture_id_matches_the_pattern():
    """Les `deckid` rendus par l'API de VDB dans les fixtures de
    l'utilisateur passent tous le motif."""
    deck_ids = {
        json.loads(path.read_text(encoding="utf-8"))["deckid"]
        for path in VDB_FIXTURES.glob("*-api.json")
    }
    assert {"31203cb9e", "12761", "SV5:PCaine"} <= deck_ids
    for deck_id in deck_ids:
        assert DeckCreate.model_validate({"name": "D", "vdb_deck_id": deck_id})


@pytest.mark.parametrize("value", [*REAL_IDS, "Promo-20191005:Malk_1", "x" * 64])
def test_a_deck_accepts_a_vdb_deck_id(value):
    deck = DeckCreate.model_validate({"name": "D", "vdb_deck_id": value})
    assert deck.vdb_deck_id == value


@pytest.mark.parametrize("value", REFUSED_IDS)
def test_a_deck_refuses_an_id_outside_the_pattern(value):
    """Ni rognage ni repli : un identifiant qui ferait sortir la route de
    l'adresse fixée (`/`, `.`, `?`, `#`, `%`) ou une adresse entière est
    refusé."""
    with pytest.raises(ValidationError):
        DeckCreate.model_validate({"name": "D", "vdb_deck_id": value})


def test_a_deck_is_unlinked_by_default():
    deck = DeckCreate.model_validate({"name": "D"})
    assert deck.vdb_deck_id is None
    assert "vdb_deck_id" not in deck.model_fields_set


def test_the_link_cannot_be_set_or_cleared_by_an_update():
    """Ni lien après coup ni « délier » dans ce lot (A6)."""
    for value in ("4fc0ee5e9", None):
        with pytest.raises(ValidationError):
            DeckUpdate.model_validate({"vdb_deck_id": value})


# --------------------------------------------------------------------------
# En ligne
# --------------------------------------------------------------------------


def test_a_deck_created_online_keeps_its_vdb_link(me_api):
    body = {"name": "Guns", "proxy_allowed": True, "vdb_deck_id": "4fc0ee5e9"}
    created = me_api.post("/decks", json=body)
    assert created.status_code == 201, created.text
    deck = created.json()
    assert deck["vdb_deck_id"] == "4fc0ee5e9"
    assert me_api.get(f"/decks/{deck['id']}").json()["vdb_deck_id"] == "4fc0ee5e9"
    assert [d["vdb_deck_id"] for d in me_api.get("/decks").json()] == ["4fc0ee5e9"]


def test_a_deck_created_without_link_reads_null(me_api):
    deck = me_api.post("/decks", json={"name": "Maison"}).json()
    assert deck["vdb_deck_id"] is None
    assert me_api.get(f"/decks/{deck['id']}").json()["vdb_deck_id"] is None


def test_an_id_outside_the_pattern_is_refused_online(me_api):
    response = me_api.post("/decks", json={"name": "D", "vdb_deck_id": "a/b"})
    assert response.status_code == 422
    assert me_api.get("/decks").json() == []


def test_a_patch_cannot_touch_the_link(me_api):
    deck = me_api.post("/decks", json={"name": "D", "vdb_deck_id": "12761"}).json()
    for value in ("31203cb9e", None):
        response = me_api.patch(f"/decks/{deck['id']}", json={"vdb_deck_id": value})
        assert response.status_code == 422
    assert me_api.get(f"/decks/{deck['id']}").json()["vdb_deck_id"] == "12761"


def test_two_decks_may_share_a_vdb_link(me_api):
    """Ni unicité ni index (A6) : deux appareils hors ligne peuvent importer
    le même deck VDB."""
    for _ in range(2):
        body = {"name": "Twin", "vdb_deck_id": "SV5:PCaine"}
        response = me_api.post("/decks", json=body)
        assert response.status_code == 201
    assert [d["vdb_deck_id"] for d in me_api.get("/decks").json()] == ["SV5:PCaine"] * 2


# --------------------------------------------------------------------------
# Par /sync
# --------------------------------------------------------------------------


def test_a_queued_deck_create_carries_the_link(me_api):
    response = me_api.post(
        "/sync",
        json={
            "operations": [
                _op(
                    "deck.create",
                    client_ref="ref-vdb",
                    data={
                        "name": "Trophy",
                        "proxy_allowed": True,
                        "vdb_deck_id": "31203cb9e",
                    },
                )
            ]
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["results"][0]["outcome"] == "applied"
    [deck] = me_api.get("/decks").json()
    assert deck["vdb_deck_id"] == "31203cb9e"


def test_a_queued_id_outside_the_pattern_fails_the_whole_batch(me_api):
    """Borne de schéma : le lot entier est refusé en 422, comme tout champ
    mal formé, et la bissection du client isole l'opération."""
    response = me_api.post(
        "/sync",
        json={
            "operations": [
                _op("deck.create", client_ref="ref-a", data={"name": "A"}),
                _op(
                    "deck.create",
                    client_ref="ref-b",
                    data={"name": "B", "vdb_deck_id": "https://vdb.im/decks/x"},
                ),
            ]
        },
    )
    assert response.status_code == 422
    assert me_api.get("/decks").json() == []


def test_a_deck_create_written_before_the_lot_keeps_its_fingerprint():
    """L'empreinte suit `exclude_unset` : une opération en file d'avant le lot,
    sans le champ, garde la sienne, et son rejeu reste un rejeu."""
    body = {
        "type": "deck.create",
        "operation_id": "0b8f6d1e-5c2a-4f3e-9d7b-1a2b3c4d5e6f",
        "recorded_at": RECORDED_AT,
        "client_ref": "deck-ref",
        "data": {"name": "Banu Princes", "proxy_allowed": True},
    }
    before = DeckCreateOperation.model_validate(body)
    assert "vdb_deck_id" not in before.model_dump(exclude_unset=True)["data"]
    linked = DeckCreateOperation.model_validate(
        body | {"data": body["data"] | {"vdb_deck_id": "4fc0ee5e9"}}
    )
    assert fingerprint(before) != fingerprint(linked)
    assert fingerprint(before) == fingerprint(DeckCreateOperation.model_validate(body))


def test_replaying_a_deck_create_written_before_the_lot_is_a_replay(me_api):
    operation = _op("deck.create", client_ref="ref-old", data={"name": "Ancien"})
    first = me_api.post("/sync", json={"operations": [operation]})
    again = me_api.post("/sync", json={"operations": [operation]})
    assert first.json()["results"][0]["outcome"] == "applied"
    assert again.json()["results"][0]["outcome"] == "replayed"
    [deck] = me_api.get("/decks").json()
    assert deck["vdb_deck_id"] is None


# --------------------------------------------------------------------------
# Contrat
# --------------------------------------------------------------------------


@pytest.fixture(scope="module")
def contract():
    return app.openapi()


def test_deck_read_always_carries_the_nullable_link(contract):
    schema = contract["components"]["schemas"]["DeckRead"]
    assert "vdb_deck_id" in schema["required"]
    variants = schema["properties"]["vdb_deck_id"]["anyOf"]
    assert {variant.get("type") for variant in variants} == {"string", "null"}


def test_deck_create_takes_an_optional_link_with_the_closed_pattern(contract):
    schema = contract["components"]["schemas"]["DeckCreate"]
    assert "vdb_deck_id" not in schema.get("required", [])
    [string] = [
        variant
        for variant in schema["properties"]["vdb_deck_id"]["anyOf"]
        if variant.get("type") == "string"
    ]
    assert string["pattern"] == "^[A-Za-z0-9:_-]{1,64}$"
    assert string["maxLength"] == 64
    update = contract["components"]["schemas"]["DeckUpdate"]
    assert "vdb_deck_id" not in update["properties"]


def test_vdb_deck_read_has_only_the_fields_common_to_every_kind_of_deck(contract):
    schemas = contract["components"]["schemas"]
    read = schemas["VdbDeckRead"]
    fields = {"vdb_deck_id", "name", "author", "description", "cards", "fetched_at"}
    assert set(read["properties"]) == fields
    assert set(read["required"]) == fields
    card = schemas["VdbDeckCardRead"]
    assert set(card["properties"]) == {"vekn_id", "quantity"}
    assert card["properties"]["quantity"]["minimum"] == 1


def test_the_vdb_route_is_declared_with_its_errors(contract):
    operation = contract["paths"]["/vdb/decks/{vdb_deck_id}"]["get"]
    assert operation["operationId"] == "readVdbDeck"
    assert operation["responses"]["200"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/VdbDeckRead"
    }
    assert set(operation["responses"]) == {"200", "401", "404", "422", "429", "502"}
    error = {"$ref": "#/components/schemas/ErrorResponse"}
    for status in ("401", "404", "429", "502"):
        content = operation["responses"][status]["content"]
        assert content["application/json"]["schema"] == error
    assert "Retry-After" in operation["responses"]["429"]["headers"]
    [parameter] = operation["parameters"]
    assert parameter["in"] == "path"
    assert parameter["schema"]["pattern"] == "^[A-Za-z0-9:_-]{1,64}$"
    assert parameter["schema"]["maxLength"] == 64


def test_vdb_deck_read_serializes_with_explicit_utc():
    deck = VdbDeckRead.model_validate(
        {
            "vdb_deck_id": "12761",
            "name": "Baby meeting",
            "cards": [{"vekn_id": 100054, "quantity": 1}],
            "fetched_at": "2026-11-13T21:00:00+01:00",
        }
    )
    dumped = deck.model_dump(mode="json")
    assert dumped["fetched_at"] == "2026-11-13T20:00:00Z"
    assert dumped["author"] is None and dumped["description"] is None


# --------------------------------------------------------------------------
# Route : motif contrôlé (corps de la route : `test_lot9_vdb_route.py`)
# --------------------------------------------------------------------------


@pytest.mark.parametrize("value", ["a.b", "a%3Fb", "x" * 65])
def test_the_route_refuses_an_id_outside_the_pattern(me_api, value):
    assert me_api.get(f"/vdb/decks/{value}").status_code == 422
