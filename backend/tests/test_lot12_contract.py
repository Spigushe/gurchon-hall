"""Lot 12, étape A1 : le contrat du compte (`docs/lot12-plan-consolidation.md`).

Ce que ce fichier fige (A1, A2, A4) :

* les cinq routes sous `/moi`, toutes sous session, avec les réponses que le
  client doit typer : 422 et 429 au changement de mot de passe (jamais 401
  pour un actuel faux), 404 et 409 à la fermeture d'une session, l'en-tête
  `Content-Disposition` de l'export ;
* les schémas d'entrée (`PasswordChange`) et de sortie (`SessionRead`,
  `AccountExport`), sans jeton, empreinte ni hachage nulle part ;
* les deux colonnes de R15 au modèle (la migration est éprouvée dans la
  section « Lot 12 » de `test_migrations.py`).

Le comportement des routes est éprouvé ailleurs : mot de passe et sessions
dans `test_lot12_account_sessions.py` (B1), export dans
`test_lot12_account_export.py` (B2).
"""

import pytest
from pydantic import ValidationError

from app.main import app
from app.models.account import USER_AGENT_MAX_LENGTH, AuthSession
from app.schemas.account import PasswordChange, SessionRead
from app.schemas.account_export import ACCOUNT_EXPORT_FORMAT_VERSION, AccountExport
from tests.auth_helpers import DEFAULT_PASSWORD, log_in, make_account

NEW_PASSWORD = "N0uveau-Secret!"

ROUTES = {
    ("post", "/moi/mot-de-passe"): "changePassword",
    ("get", "/moi/sessions"): "listSessions",
    ("delete", "/moi/sessions"): "revokeOtherSessions",
    ("delete", "/moi/sessions/{session_id}"): "revokeSession",
    ("get", "/moi/export"): "exportAccount",
}

SECRET_WORDS = ("password_hash", "token", "token_hash", "hash")


@pytest.fixture
def schema():
    return app.openapi()


@pytest.fixture
def me_api(api, db):
    make_account(db, email="lot12@example.com", username="lot12")
    log_in(api, "lot12@example.com")
    return api


def operation(schema, method: str, path: str) -> dict:
    return schema["paths"][path][method]


def response_schema(schema, method: str, path: str, status: str) -> dict:
    return operation(schema, method, path)["responses"][status]["content"][
        "application/json"
    ]["schema"]


def all_property_names(schema, name: str, seen: set[str] | None = None) -> set[str]:
    """Noms de toutes les propriétés d'un schéma et des schémas qu'il cite."""
    seen = seen if seen is not None else set()
    if name in seen:
        return set()
    seen.add(name)
    component = schema["components"]["schemas"][name]
    names = set(component.get("properties", {}))

    def refs(node):
        if isinstance(node, dict):
            if "$ref" in node:
                yield node["$ref"].rsplit("/", 1)[-1]
            for value in node.values():
                yield from refs(value)
        elif isinstance(node, list):
            for value in node:
                yield from refs(value)

    for ref in refs(component):
        names |= all_property_names(schema, ref, seen)
    return names


# --- Routes ------------------------------------------------------------------


@pytest.mark.parametrize("method,path", list(ROUTES), ids=[p for _, p in ROUTES])
def test_each_route_is_declared_under_session_in_the_accounts_tag(
    schema, method, path
):
    declared = operation(schema, method, path)
    assert declared["operationId"] == ROUTES[(method, path)]
    assert declared["tags"] == ["comptes"]
    assert declared["security"] == [{"sessionCookie": []}]
    assert "401" in declared["responses"]


def test_changing_the_password_declares_204_422_429_and_the_origin_check(schema):
    responses = operation(schema, "post", "/moi/mot-de-passe")["responses"]
    assert set(responses) == {"204", "401", "403", "422", "429"}
    assert "content" not in responses["204"]
    assert "Retry-After" in responses["429"]["headers"]
    body = operation(schema, "post", "/moi/mot-de-passe")["requestBody"]
    assert body["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/PasswordChange"
    }


def test_a_wrong_current_password_is_documented_as_422_never_401(schema):
    description = operation(schema, "post", "/moi/mot-de-passe")["description"]
    assert "422" in description
    assert "jamais 401" in description


def test_listing_the_sessions_returns_a_list_of_session_read(schema):
    assert response_schema(schema, "get", "/moi/sessions", "200") == {
        "type": "array",
        "items": {"$ref": "#/components/schemas/SessionRead"},
        "title": "Response Listsessions",
    }


def test_closing_one_session_declares_404_and_409(schema):
    responses = operation(schema, "delete", "/moi/sessions/{session_id}")["responses"]
    assert set(responses) == {"204", "401", "403", "404", "409", "422"}
    parameter = operation(schema, "delete", "/moi/sessions/{session_id}")[
        "parameters"
    ][0]
    assert parameter["schema"]["minimum"] == 1
    assert parameter["schema"]["maximum"] == 2**31 - 1


def test_closing_the_other_sessions_has_no_parameter(schema):
    declared = operation(schema, "delete", "/moi/sessions")
    assert "parameters" not in declared
    assert set(declared["responses"]) == {"204", "401", "403"}


def test_the_export_is_an_attachment_described_by_account_export(schema):
    responses = operation(schema, "get", "/moi/export")["responses"]
    assert response_schema(schema, "get", "/moi/export", "200") == {
        "$ref": "#/components/schemas/AccountExport"
    }
    assert "Content-Disposition" in responses["200"]["headers"]


# --- Schémas -----------------------------------------------------------------


def test_a_password_change_needs_the_current_and_a_valid_new_password():
    change = PasswordChange.model_validate(
        {"current_password": "ancien", "new_password": NEW_PASSWORD}
    )
    assert change.current_password == "ancien"


@pytest.mark.parametrize(
    "new_password",
    [
        "court-1A!",
        "sansmajuscule-1!",
        "SANSMINUSCULE-1!",
        "Sans-Chiffre-!!",
        "Sans1Symbole12",
    ],
)
def test_the_new_password_follows_the_sign_up_rule(new_password):
    with pytest.raises(ValidationError):
        PasswordChange.model_validate(
            {"current_password": DEFAULT_PASSWORD, "new_password": new_password}
        )


def test_the_current_password_has_no_complexity_rule_but_a_length_cap():
    """Comme à la connexion : un secret posé sous une règle plus ancienne doit
    pouvoir être remplacé. Seule la longueur est bornée, avant tout hachage."""
    PasswordChange.model_validate(
        {"current_password": "x", "new_password": NEW_PASSWORD}
    )
    for current in ("", "x" * 129):
        with pytest.raises(ValidationError):
            PasswordChange.model_validate(
                {"current_password": current, "new_password": NEW_PASSWORD}
            )


def test_a_password_change_refuses_any_other_field():
    with pytest.raises(ValidationError):
        PasswordChange.model_validate(
            {
                "current_password": DEFAULT_PASSWORD,
                "new_password": NEW_PASSWORD,
                "keep_other_sessions": True,
            }
        )


def test_a_session_read_has_every_field_required_and_no_secret(schema):
    session = schema["components"]["schemas"]["SessionRead"]
    assert set(session["properties"]) == {
        "id",
        "created_at",
        "last_used_at",
        "expires_at",
        "user_agent",
        "current",
    }
    assert set(session["required"]) == set(session["properties"])
    assert {"type": "null"} in session["properties"]["user_agent"]["anyOf"]
    assert session["properties"]["last_used_at"]["type"] == "string"


def test_a_session_read_reads_its_datetimes_as_explicit_utc():
    from datetime import datetime

    read = SessionRead(
        id=1,
        created_at=datetime(2026, 11, 18, 9, 0),
        last_used_at=datetime(2026, 11, 18, 9, 0),
        expires_at=datetime(2026, 12, 2, 9, 0),
        user_agent=None,
        current=True,
    )
    assert read.model_dump(mode="json")["expires_at"] == "2026-12-02T09:00:00Z"


def test_the_export_names_cards_by_vekn_id_and_sets_by_abbreviation(schema):
    components = schema["components"]["schemas"]
    for name in ("ExportedCollectionEntry", "ExportedDeckLine"):
        properties = components[name]["properties"]
        assert {"vekn_id", "card_name", "language_code", "card_set_abbrev"} <= set(
            properties
        )
        assert "card_id" not in properties
        assert "card_set_id" not in properties
    assert {"vekn_id", "card_name", "quantity"} == set(
        components["ExportedDeckVersionCard"]["properties"]
    )
    assert "opponent_clan" in components["ExportedParticipation"]["properties"]
    assert "opponent_clan_id" not in components["ExportedParticipation"]["properties"]


def test_the_export_covers_every_private_domain_but_the_journal(schema):
    export = schema["components"]["schemas"]["AccountExport"]
    assert set(export["properties"]) == {
        "format_version",
        "exported_at",
        "schema_revision",
        "account",
        "collection",
        "decks",
        "players",
        "venues",
        "tournaments",
        "games",
        "shares",
        "tournament_reports",
    }
    assert set(export["required"]) == set(export["properties"])
    deck = schema["components"]["schemas"]["ExportedDeck"]["properties"]
    assert {"cards", "versions", "archived_at", "deleted_at"} <= set(deck)
    assert "deck_versions" in schema["components"]["schemas"]["ExportedTournament"][
        "properties"
    ]
    assert "participations" in schema["components"]["schemas"]["ExportedGame"][
        "properties"
    ]


def test_the_export_carries_no_secret_and_no_account_identifier(schema):
    names = all_property_names(schema, "AccountExport")
    assert not names & set(SECRET_WORDS)
    assert "user_id" not in names
    account = schema["components"]["schemas"]["ExportedAccount"]["properties"]
    # `display_name` depuis la v1.2.2 (A10) : un nom choisi, pas un secret.
    assert set(account) == {
        "email",
        "username",
        "role",
        "created_at",
        "display_name",
    }


def test_the_export_format_version_is_three_and_still_describes_the_others(schema):
    # Passée de 1 à 2 au Lot 13 (A5), à l'ajout des liens publics, puis à 3 au
    # lot Compte-rendu (A7), à l'ajout des comptes-rendus.
    assert ACCOUNT_EXPORT_FORMAT_VERSION == 3
    version = schema["components"]["schemas"]["AccountExport"]["properties"][
        "format_version"
    ]
    assert version["enum"] == [1, 2, 3]
    with pytest.raises(ValidationError):
        AccountExport.model_validate(
            {
                "format_version": 4,
                "exported_at": "2026-11-18T10:00:00Z",
                "schema_revision": "c4e8a1f2d7b3",
                "account": {
                    "email": "a@example.com",
                    "username": "a",
                    "role": "user",
                    "created_at": "2026-11-18T10:00:00Z",
                },
            }
        )


# --- Modèle ------------------------------------------------------------------


def test_the_session_model_gains_the_device_and_the_last_use():
    columns = AuthSession.__table__.columns
    assert USER_AGENT_MAX_LENGTH == 256
    assert columns["user_agent"].type.length == USER_AGENT_MAX_LENGTH
    assert columns["user_agent"].nullable
    assert columns["last_used_at"].nullable
    assert list(columns.keys())[-2:] == ["user_agent", "last_used_at"]


# --- Validation par le schéma ------------------------------------------------


def test_the_password_body_is_validated_by_the_schema(me_api):
    response = me_api.post(
        "/moi/mot-de-passe",
        json={"current_password": DEFAULT_PASSWORD, "new_password": "faible"},
    )
    assert response.status_code == 422


def test_the_session_identifier_is_validated_by_the_path(me_api):
    assert me_api.delete("/moi/sessions/0").status_code == 422
    assert me_api.delete(f"/moi/sessions/{2**31}").status_code == 422
