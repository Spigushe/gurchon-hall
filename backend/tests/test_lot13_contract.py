"""Lot 13, étape A1 : le contrat des liens publics (`docs/lot13-plan-partage.md`).

Ce que ce fichier fige (A1, A2) :

* les cinq opérations, quatre sous session et une publique, avec les réponses
  que le client doit typer ;
* les schémas d'entrée (`DeckShareCreate`) et de sortie (`DeckShareRead`,
  `SharedDecklistRead`, `SharePurgeResult`), sans `user_id` nulle part, et
  sans jeton dans la lecture publique ;
* le motif du jeton (huit caractères de `[A-Za-z0-9_]`) et le contrôle croisé
  de `scope` et `share_id`, tranchés avant toute lecture ;
* le filtre `ids` de `GET /cartes`, implémenté dès A1 ;
* les deux tables de R16 au modèle (la migration est éprouvée dans la section
  « Lot 13 » de `test_migrations.py`).

Les corps des cinq routes rendent 501 jusqu'aux étapes B1 et B2, qui
retireront les tests `..._is_not_delivered_yet` avec leurs gardes.
"""

import pytest
from pydantic import ValidationError
from sqlalchemy import inspect

from app.main import app
from app.models import Base, DeckShare, DeckShareCard, DeckShareKind
from app.models.share import SHARE_TOKEN_ALPHABET, SHARE_TOKEN_LENGTH
from app.schemas.share import (
    SHARE_TOKEN_PATTERN,
    DeckShareCreate,
    SharePurgeScope,
)
from tests.auth_helpers import log_in, make_account
from tests.helpers import make_card, make_printing

TOKEN = "aB3x_9pQ"

SESSION_ROUTES = {
    ("get", "/decks/{deck_id}/partages"): "listDeckShares",
    ("post", "/decks/{deck_id}/partages"): "createDeckShare",
    ("get", "/moi/partages"): "listMyShares",
    ("delete", "/moi/partages"): "purgeShares",
}
PUBLIC_ROUTE = ("get", "/listes/{token}")


@pytest.fixture
def schema():
    return app.openapi()


@pytest.fixture
def me_api(api, db):
    make_account(db, email="lot13@example.com", username="lot13")
    log_in(api, "lot13@example.com")
    return api


def operation(schema, method: str, path: str) -> dict:
    return schema["paths"][path][method]


def ref(name: str) -> dict:
    return {"$ref": f"#/components/schemas/{name}"}


def response_schema(schema, method: str, path: str, status: str) -> dict:
    return operation(schema, method, path)["responses"][status]["content"][
        "application/json"
    ]["schema"]


def properties(schema, name: str) -> set[str]:
    return set(schema["components"]["schemas"][name]["properties"])


# --- Routes ------------------------------------------------------------------


@pytest.mark.parametrize(
    "method,path", list(SESSION_ROUTES), ids=[p for _, p in SESSION_ROUTES]
)
def test_each_session_route_is_declared_under_session(schema, method, path):
    declared = operation(schema, method, path)
    assert declared["operationId"] == SESSION_ROUTES[(method, path)]
    assert declared["tags"] == ["partages"]
    assert declared["security"] == [{"sessionCookie": []}]
    assert "401" in declared["responses"]


def test_the_public_route_declares_no_session_at_all(schema):
    declared = operation(schema, *PUBLIC_ROUTE)
    assert declared["operationId"] == "readSharedDecklist"
    assert "security" not in declared
    assert set(declared["responses"]) == {"200", "404", "422", "429"}
    headers = declared["responses"]["200"]["headers"]
    assert set(headers) == {"Cache-Control", "X-Robots-Tag"}
    assert response_schema(schema, *PUBLIC_ROUTE, "200") == ref("SharedDecklistRead")
    assert "Retry-After" in declared["responses"]["429"]["headers"]


def test_the_token_is_a_closed_pattern_of_eight_characters(schema):
    (parameter,) = operation(schema, *PUBLIC_ROUTE)["parameters"]
    assert parameter["in"] == "path"
    assert parameter["schema"]["pattern"] == "^[A-Za-z0-9_]{8}$"
    assert parameter["schema"]["minLength"] == parameter["schema"]["maxLength"] == 8
    assert SHARE_TOKEN_PATTERN == parameter["schema"]["pattern"]
    assert len(SHARE_TOKEN_ALPHABET) == len(set(SHARE_TOKEN_ALPHABET)) == 63
    assert SHARE_TOKEN_LENGTH == 8


def test_the_responses_of_each_session_route(schema):
    def statuses(method, path):
        return set(operation(schema, method, path)["responses"])

    assert statuses("get", "/decks/{deck_id}/partages") == {"200", "401", "404", "422"}
    assert statuses("post", "/decks/{deck_id}/partages") == {
        "201", "401", "403", "404", "409", "422",
    }
    assert statuses("get", "/moi/partages") == {"200", "401"}
    assert statuses("delete", "/moi/partages") == {
        "200", "401", "403", "404", "409", "422",
    }
    for path in ("/decks/{deck_id}/partages", "/moi/partages"):
        listed = response_schema(schema, "get", path, "200")
        assert listed["type"] == "array"
        assert listed["items"] == ref("DeckShareRead")
    assert response_schema(
        schema, "post", "/decks/{deck_id}/partages", "201"
    ) == ref("DeckShareRead")
    assert response_schema(schema, "delete", "/moi/partages", "200") == ref(
        "SharePurgeResult"
    )
    body = operation(schema, "post", "/decks/{deck_id}/partages")["requestBody"]
    assert body["content"]["application/json"]["schema"] == ref("DeckShareCreate")


def test_the_purge_takes_a_mandatory_scope_and_up_to_200_share_ids(schema):
    parameters = {
        p["name"]: p for p in operation(schema, "delete", "/moi/partages")["parameters"]
    }
    assert set(parameters) == {"scope", "share_id"}
    assert parameters["scope"]["required"] is True
    assert schema["components"]["schemas"]["SharePurgeScope"]["enum"] == [
        "selected",
        "deleted_decks",
        "all",
    ]
    ids = parameters["share_id"]
    assert ids["required"] is False
    array = ids["schema"]["anyOf"][0]
    assert (array["minItems"], array["maxItems"]) == (1, 200)
    assert (array["items"]["minimum"], array["items"]["maximum"]) == (1, 2147483647)


def test_list_cards_gains_an_ids_filter_of_one_to_200(schema):
    declared = operation(schema, "get", "/cartes")["parameters"]
    parameters = {p["name"]: p for p in declared}
    array = parameters["ids"]["schema"]["anyOf"][0]
    assert (array["minItems"], array["maxItems"]) == (1, 200)
    assert array["items"]["minimum"] == 1


# --- Schémas -----------------------------------------------------------------


def test_the_public_decklist_shows_no_owner_nor_token(schema):
    assert properties(schema, "SharedDecklistRead") == {
        "name",
        "archetype",
        "kind",
        "frozen_at",
        "author",
        "notes",
        "cards",
        "reprinted_card_ids",
    }
    assert properties(schema, "SharedDeckCardRead") == {"card", "quantity"}
    card = schema["components"]["schemas"]["SharedDeckCardRead"]["properties"]["card"]
    assert card == ref("CardSearchItem")
    required = schema["components"]["schemas"]["SharedDecklistRead"]["required"]
    assert set(required) == properties(schema, "SharedDecklistRead")


def test_the_owner_reads_the_token_and_the_state_of_the_deck(schema):
    assert properties(schema, "DeckShareRead") == {
        "id",
        "token",
        "kind",
        "show_notes",
        "created_at",
        "frozen_name",
        "deck_version_number",
        "deck",
    }
    assert properties(schema, "SharedDeckState") == {
        "id",
        "name",
        "discriminator",
        "archived_at",
        "deleted_at",
    }
    assert properties(schema, "SharePurgeResult") == {"revoked"}


def test_no_share_schema_carries_an_owner(schema):
    for name in (
        "DeckShareCreate",
        "DeckShareRead",
        "SharedDeckState",
        "SharedDecklistRead",
        "SharedDeckCardRead",
        "SharePurgeResult",
    ):
        assert "user_id" not in properties(schema, name), name


def test_a_share_is_created_live_or_frozen_and_notes_are_hidden_by_default():
    created = DeckShareCreate.model_validate({"kind": "live"})
    assert created.kind is DeckShareKind.LIVE
    assert created.show_notes is False
    assert created.deck_version_number is None
    frozen = DeckShareCreate.model_validate(
        {"kind": "frozen", "show_notes": True, "deck_version_number": 3}
    )
    assert frozen.deck_version_number == 3


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"kind": "shared"},
        {"kind": "live", "deck_version_number": 1},
        {"kind": "frozen", "deck_version_number": 0},
        {"kind": "frozen", "deck_version_number": 2**31},
        {"kind": "live", "user_id": 1},
        {"kind": "live", "token": TOKEN},
    ],
    ids=[
        "sans genre",
        "genre inconnu",
        "version sur un vivant",
        "version zéro",
        "version hors bornes",
        "propriétaire envoyé",
        "jeton envoyé",
    ],
)
def test_a_share_creation_is_refused_by_its_shape(payload):
    with pytest.raises(ValidationError):
        DeckShareCreate.model_validate(payload)


# --- Ordre des contrôles, avant les étapes B1 et B2 --------------------------


@pytest.mark.parametrize(
    "token",
    ["aB3x_9p", "aB3x_9pQQ", "aB3x-9pQ", "aB3x_9pé", "aB3x 9pQ"],
    ids=["sept", "neuf", "tiret", "accent", "espace"],
)
def test_a_malformed_token_is_refused_before_any_read(api, token):
    assert api.get(f"/listes/{token}").status_code == 422


def test_the_public_route_is_not_delivered_yet_but_needs_no_session(api):
    response = api.get(f"/listes/{TOKEN}")
    assert response.status_code == 501
    assert "B2" in response.json()["detail"]


@pytest.mark.parametrize(
    "method,path,body",
    [
        ("GET", "/decks/1/partages", None),
        ("POST", "/decks/1/partages", {"kind": "live"}),
        ("GET", "/moi/partages", None),
        ("DELETE", "/moi/partages?scope=selected&share_id=1&share_id=1", None),
        ("DELETE", "/moi/partages?scope=deleted_decks", None),
        ("DELETE", "/moi/partages?scope=all", None),
    ],
)
def test_each_session_route_is_not_delivered_yet(me_api, method, path, body):
    response = me_api.request(method, path, json=body)
    assert response.status_code == 501
    assert "B1" in response.json()["detail"]


@pytest.mark.parametrize(
    "query,field",
    [
        ("", "scope"),
        ("scope=tout", "scope"),
        ("scope=selected", "share_id"),
        ("scope=all&share_id=1", "share_id"),
        ("scope=deleted_decks&share_id=1", "share_id"),
        ("scope=selected&share_id=0", "share_id"),
        ("scope=selected&" + "&".join(f"share_id={n}" for n in range(1, 202)),
         "share_id"),
    ],
    ids=[
        "sans portée",
        "portée inconnue",
        "sélection vide",
        "liens avec tout",
        "liens avec les decks supprimés",
        "identifiant nul",
        "201 liens",
    ],
)
def test_a_purge_is_refused_by_its_scope_and_its_selection(me_api, query, field):
    response = me_api.delete(f"/moi/partages?{query}")
    assert response.status_code == 422
    assert any(field in error["loc"] for error in response.json()["detail"])


def test_a_live_share_with_a_version_is_refused_in_422(me_api):
    response = me_api.post(
        "/decks/1/partages", json={"kind": "live", "deck_version_number": 1}
    )
    assert response.status_code == 422


# --- Filtre `ids` de `GET /cartes` -------------------------------------------


def test_list_cards_reads_only_the_requested_identifiers(api, db):
    first = make_card(db, name="Aidan Lyle")
    second = make_card(db, name="Bindusara")
    third = make_card(db, name="Cesewayo")
    for card in (first, second, third):
        make_printing(db, card)
    db.commit()

    response = api.get(
        "/cartes", params=[("ids", second.id), ("ids", first.id), ("ids", 999_999)]
    )

    assert response.status_code == 200
    assert [card["id"] for card in response.json()] == [first.id, second.id]


@pytest.mark.parametrize(
    "params",
    [[("ids", 0)], [("ids", n) for n in range(1, 202)]],
    ids=["identifiant nul", "201 identifiants"],
)
def test_list_cards_refuses_ids_out_of_bounds(api, params):
    assert api.get("/cartes", params=params).status_code == 422


# --- Modèle ------------------------------------------------------------------


def test_the_two_share_tables_are_in_the_model(db_engine):
    inspector = inspect(db_engine)
    assert {"deck_share", "deck_share_card"} <= set(inspector.get_table_names())
    assert DeckShare.__tablename__ in Base.metadata.tables
    assert DeckShareCard.__tablename__ in Base.metadata.tables
    columns = {c["name"]: c for c in inspector.get_columns("deck_share")}
    assert columns["user_id"]["nullable"] is False
    assert columns["token"]["nullable"] is False
    assert columns["deck_version_id"]["nullable"] is True


def test_scope_values_are_those_of_the_plan():
    assert [scope.value for scope in SharePurgeScope] == [
        "selected",
        "deleted_decks",
        "all",
    ]
