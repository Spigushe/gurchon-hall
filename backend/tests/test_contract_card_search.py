"""Contrat des cartes du catalogue, lot Chercher (A1, A3, A7, A10).

Compare des **ensembles** de propriétés, pas le texte du contrat (l'ordre des
propriétés de `CardRead` a changé : Pydantic range les champs hérités en
premier). Le contrat versionné, lui, est gardé par
`test_openapi_contract.test_committed_contract_matches_app_openapi`.
"""

import pytest

from app.main import app

SUMMARY = {
    "id",
    "vekn_id",
    "name",
    "category",
    "clan",
    "capacity",
    "group_code",
    "advanced",
    "image_url",
}
PRINTINGS = {"card_set_ids", "latest_card_set_id"}
SEARCH_FIELDS = {
    "sect",
    "title",
    "path",
    "cost_type",
    "cost_value",
    "clan_requirement",
    "path_requirement",
    "discipline_requirement",
    "card_text",
    "banned_on",
    "legal_from",
    "types",
    "discipline_links",
}
REQUIREMENT = {
    "library_requirement",
    "required_sects",
    "required_titles",
    "requires_titled",
    "requires_non_titled",
    "other_requirements",
}
SHEET_ONLY = {
    "burn_option",
    "trifle",
    "flavor_text",
    "artist",
    "printings",
    "translations",
}
CARD_READ_BEFORE_THE_LOT = SUMMARY | PRINTINGS | SEARCH_FIELDS | SHEET_ONLY


@pytest.fixture(scope="module")
def schemas():
    return app.openapi()["components"]["schemas"]


def properties(schemas, name):
    return set(schemas[name]["properties"])


def response_schema(path):
    return app.openapi()["paths"][path]["get"]["responses"]["200"]["content"][
        "application/json"
    ]["schema"]


def test_the_list_route_answers_card_search_items():
    assert response_schema("/cartes") == {
        "type": "array",
        "items": {"$ref": "#/components/schemas/CardSearchItem"},
        "title": "Response Listcards",
    }
    assert response_schema("/cartes/{card_id}") == {
        "$ref": "#/components/schemas/CardRead"
    }


def test_a_list_item_carries_everything_the_filters_read(schemas):
    assert properties(schemas, "CardSearchItem") == (
        SUMMARY | PRINTINGS | SEARCH_FIELDS | REQUIREMENT | {"translated_names"}
    )


def test_the_sheet_only_gains_the_requirement_and_no_translated_names(schemas):
    assert properties(schemas, "CardRead") == CARD_READ_BEFORE_THE_LOT | REQUIREMENT
    assert "translated_names" not in schemas["CardRead"]["properties"]


@pytest.mark.parametrize("name", ["CardSearchItem", "CardRead", "CardTranslatedName"])
def test_every_output_field_is_required(schemas, name):
    """Convention du §7 : un champ de lecture toujours produit est obligatoire."""
    assert set(schemas[name]["required"]) == properties(schemas, name)


def test_shared_properties_have_the_same_schema_in_the_list_and_the_sheet(schemas):
    search = schemas["CardSearchItem"]["properties"]
    sheet = schemas["CardRead"]["properties"]
    for name in set(search) & set(sheet):
        assert search[name] == sheet[name], name


def test_the_requirement_fields_have_their_types(schemas):
    props = schemas["CardSearchItem"]["properties"]
    assert props["library_requirement"]["anyOf"] == [
        {"type": "string"},
        {"type": "null"},
    ]
    for name in ("required_sects", "required_titles", "other_requirements"):
        assert props[name]["type"] == "array", name
        assert props[name]["items"] == {"type": "string"}, name
    for name in ("requires_titled", "requires_non_titled"):
        assert props[name]["type"] == "boolean", name


def test_translated_names_are_a_list_of_language_and_name(schemas):
    items = schemas["CardSearchItem"]["properties"]["translated_names"]
    assert items["type"] == "array"
    assert items["items"] == {"$ref": "#/components/schemas/CardTranslatedName"}
    assert properties(schemas, "CardTranslatedName") == {"language_code", "name"}


def test_the_card_summary_embedded_elsewhere_does_not_grow(schemas):
    assert properties(schemas, "CardSummary") == SUMMARY


def test_the_contract_has_fifty_operations_on_thirty_paths():
    paths = app.openapi()["paths"]
    verbs = {"get", "post", "put", "patch", "delete"}
    assert len(paths) == 30
    assert sum(1 for item in paths.values() for verb in item if verb in verbs) == 50
