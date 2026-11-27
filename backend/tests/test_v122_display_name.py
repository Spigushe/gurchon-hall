"""v1.2.2 : nom à afficher du compte (`docs/v1.2.2-plan.md`, A9 à A11).

Ce que ce fichier éprouve :

* `PATCH /moi` (`updateCurrentUser`, A10) : pose, rognage, vide ou blanc
  ramené à nul, `null` qui efface, champ omis qui ne change rien, borne de 64
  caractères comptée après rognage, champ inconnu en 422, 401 sans session,
  403 pour une origine refusée, isolation entre comptes ;
* `UserRead.display_name` partout où le compte ressort : `GET /moi`,
  l'inscription et la connexion ;
* l'export du compte, qui gagne le champ sans changer `format_version` ;
* le contrat : la route, `UserUpdate`, et le champ obligatoire en sortie ;
* le modèle (R19) : colonne nullable de 64 caractères, ni unique ni indexée.

L'instantané du compte-rendu (A11) est éprouvé avec les autres comptes-rendus,
dans `test_tournament_reports.py`.
"""

import pytest

from app.main import app
from app.models.account import DISPLAY_NAME_MAX_LENGTH, UserAccount
from app.schemas.account_export import ACCOUNT_EXPORT_FORMAT_VERSION
from tests.auth_helpers import DEFAULT_PASSWORD, log_in, make_account

EMAIL = "nom@example.com"


@pytest.fixture
def me_api(api, db):
    make_account(db, email=EMAIL, username="pseudo")
    log_in(api, EMAIL)
    return api


def _patch(api, body, **kwargs):
    return api.patch("/moi", json=body, **kwargs)


# --- Route -------------------------------------------------------------------


def test_a_new_account_has_no_display_name(me_api):
    assert me_api.get("/moi").json()["display_name"] is None


def test_patching_sets_the_display_name_and_returns_the_account(me_api):
    response = _patch(me_api, {"display_name": "Martin le Toréador"})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["display_name"] == "Martin le Toréador"
    assert body["username"] == "pseudo"
    assert body["email"] == EMAIL
    assert response.headers["Cache-Control"] == "private, no-store"
    assert me_api.get("/moi").json()["display_name"] == "Martin le Toréador"


def test_the_display_name_is_trimmed(me_api):
    body = _patch(me_api, {"display_name": "  Martin \t"}).json()
    assert body["display_name"] == "Martin"


@pytest.mark.parametrize("blank", ["", "   ", "\t\n "])
def test_an_empty_or_blank_display_name_becomes_null(me_api, db, blank):
    _patch(me_api, {"display_name": "Martin"})
    response = _patch(me_api, {"display_name": blank})
    assert response.status_code == 200, response.text
    assert response.json()["display_name"] is None
    db.expire_all()
    assert db.query(UserAccount).one().display_name is None


def test_null_clears_the_display_name(me_api):
    _patch(me_api, {"display_name": "Martin"})
    response = _patch(me_api, {"display_name": None})
    assert response.status_code == 200
    assert response.json()["display_name"] is None


def test_an_omitted_display_name_changes_nothing(me_api):
    _patch(me_api, {"display_name": "Martin"})
    response = _patch(me_api, {})
    assert response.status_code == 200
    assert response.json()["display_name"] == "Martin"


def test_the_bound_is_sixty_four_characters_once_trimmed(me_api):
    longest = "x" * DISPLAY_NAME_MAX_LENGTH
    assert _patch(me_api, {"display_name": longest}).status_code == 200
    padded = _patch(me_api, {"display_name": f"  {longest} "})
    assert padded.status_code == 200
    assert padded.json()["display_name"] == longest

    too_long = _patch(me_api, {"display_name": longest + "y"})
    assert too_long.status_code == 422
    assert too_long.json()["detail"][0]["loc"][:2] == ["body", "display_name"]
    assert me_api.get("/moi").json()["display_name"] == longest


@pytest.mark.parametrize(
    "body",
    [
        {"display_name": "Martin", "username": "autre"},
        {"email": "autre@example.com"},
        {"role": "admin"},
        {"nom": "Martin"},
    ],
)
def test_an_unknown_field_is_a_422_and_changes_nothing(me_api, body):
    response = _patch(me_api, body)
    assert response.status_code == 422
    after = me_api.get("/moi").json()
    assert (after["username"], after["email"], after["role"]) == (
        "pseudo",
        EMAIL,
        "user",
    )
    assert after["display_name"] is None


def test_a_non_string_display_name_is_a_422(me_api):
    assert _patch(me_api, {"display_name": 12}).status_code == 422


@pytest.mark.parametrize(
    "name",
    [
        "Martin\nle Toréador",
        "Martin\r\nle Toréador",
        "Martin\tle Toréador",
        "Martin\x00",
        "Martin\x1bX",
        "Mar\x7ftin",
        "Martin\x85le Toréador",  # NEL, contrôle C1
    ],
)
def test_a_control_character_left_after_trimming_is_a_422(me_api, name):
    """Le nom tient sur une ligne de table : tout caractère `Cc` qui reste
    après le rognage fait refuser la saisie, et rien ne change."""
    _patch(me_api, {"display_name": "Avant"})
    response = _patch(me_api, {"display_name": name})
    assert response.status_code == 422, response.text
    error = response.json()["detail"][0]
    assert error["loc"][:2] == ["body", "display_name"]
    assert "Une seule ligne" in error["msg"]
    assert me_api.get("/moi").json()["display_name"] == "Avant"


def test_control_characters_at_the_edges_go_with_the_trimming(me_api):
    response = _patch(me_api, {"display_name": "\n\tMartin \r\n"})
    assert response.status_code == 200, response.text
    assert response.json()["display_name"] == "Martin"


def test_non_control_characters_are_kept(me_api):
    """Seule la catégorie `Cc` est refusée : accents, espaces insécables,
    symboles et emoji restent."""
    name = "Zoë « Tremere » 🦇 ✓"
    response = _patch(me_api, {"display_name": name})
    assert response.status_code == 200, response.text
    assert response.json()["display_name"] == name


def test_the_single_line_rule_is_described_in_the_contract(schema):
    field = schema["components"]["schemas"]["UserUpdate"]["properties"][
        "display_name"
    ]
    assert "caractère de contrôle" in field["description"]
    assert "`Cc`" in field["description"]
    route = schema["paths"]["/moi"]["patch"]["description"]
    assert "une seule ligne" in route


def test_patching_without_a_session_is_a_401(api):
    response = _patch(api, {"display_name": "Martin"})
    assert response.status_code == 401
    assert response.json() == {"detail": "Authentification requise."}


def test_patching_from_a_refused_origin_is_a_403_and_changes_nothing(me_api):
    response = _patch(
        me_api,
        {"display_name": "Martin"},
        headers={"Origin": "https://attacker.example"},
    )
    assert response.status_code == 403
    assert me_api.get("/moi").json()["display_name"] is None


def test_patching_from_an_allowed_origin_works(me_api):
    response = _patch(
        me_api, {"display_name": "Martin"}, headers={"Origin": "http://localhost:5173"}
    )
    assert response.status_code == 200


def test_one_account_never_touches_another(me_api, api_client_factory, db):
    make_account(db, email="autre@example.com", username="autre")
    other = api_client_factory()
    log_in(other, "autre@example.com")
    _patch(me_api, {"display_name": "Martin"})
    assert other.get("/moi").json()["display_name"] is None
    _patch(other, {"display_name": "Alice"})
    assert me_api.get("/moi").json()["display_name"] == "Martin"


# --- Le compte ressort partout avec son nom -----------------------------------


def test_sign_up_returns_a_null_display_name(api):
    response = api.post(
        "/inscription",
        json={
            "email": "neuf@example.com",
            "username": "neuf",
            "password": DEFAULT_PASSWORD,
        },
    )
    assert response.status_code == 201, response.text
    assert response.json()["display_name"] is None


def test_log_in_returns_the_display_name(me_api, api_client_factory):
    _patch(me_api, {"display_name": "Martin"})
    again = api_client_factory()
    response = log_in(again, "pseudo")
    assert response.json()["display_name"] == "Martin"


def test_the_export_carries_the_display_name_without_a_new_format(me_api):
    _patch(me_api, {"display_name": "Martin"})
    body = me_api.get("/moi/export").json()
    assert body["account"]["display_name"] == "Martin"
    assert body["format_version"] == ACCOUNT_EXPORT_FORMAT_VERSION == 3


# --- Contrat et modèle ---------------------------------------------------------


@pytest.fixture
def schema():
    return app.openapi()


def test_the_route_is_declared_under_session_with_its_responses(schema):
    operation = schema["paths"]["/moi"]["patch"]
    assert operation["operationId"] == "updateCurrentUser"
    assert operation["tags"] == ["comptes"]
    assert operation["security"] == [{"sessionCookie": []}]
    assert set(operation["responses"]) == {"200", "401", "403", "422"}
    assert operation["requestBody"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/UserUpdate"
    }
    assert operation["responses"]["200"]["content"]["application/json"][
        "schema"
    ] == {"$ref": "#/components/schemas/UserRead"}


def test_the_update_body_is_one_optional_nullable_bounded_field(schema):
    component = schema["components"]["schemas"]["UserUpdate"]
    assert component["additionalProperties"] is False
    assert "required" not in component
    assert set(component["properties"]) == {"display_name"}
    variants = component["properties"]["display_name"]["anyOf"]
    assert {"type": "string", "maxLength": 64} in variants
    assert {"type": "null"} in variants


@pytest.mark.parametrize("name", ["UserRead", "ExportedAccount"])
def test_the_display_name_is_always_read(schema, name):
    component = schema["components"]["schemas"][name]
    assert "display_name" in component["required"]
    variants = component["properties"]["display_name"]["anyOf"]
    assert {variant["type"] for variant in variants} == {"string", "null"}


def test_the_model_gains_a_nullable_unindexed_column():
    columns = UserAccount.__table__.columns
    assert DISPLAY_NAME_MAX_LENGTH == 64
    assert columns["display_name"].type.length == DISPLAY_NAME_MAX_LENGTH
    assert columns["display_name"].nullable
    assert not columns["display_name"].unique
    assert not columns["display_name"].index
