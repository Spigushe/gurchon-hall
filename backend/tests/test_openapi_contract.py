"""Tests de contrat OpenAPI (Lot 0).

Deux angles distincts, cf. CLAUDE.md §7 et §10 (contract-first) :

- la *forme* du schéma OpenAPI produit par l'application vivante (ce que le
  front peut attendre de `/health`) ;
- la *non-divergence* entre `contracts/openapi.json` (versionné) et ce même
  schéma vivant — le garde-fou qui empêche le contrat de dériver du code sans
  que personne ne le remarque.
"""

import subprocess
import sys
from pathlib import Path

from app.main import app

BACKEND_DIR = Path(__file__).resolve().parent.parent
EXPORT_SCRIPT = BACKEND_DIR / "scripts" / "export_openapi.py"


def test_openapi_exposes_health_with_expected_operation_id():
    schema = app.openapi()

    health_get = schema["paths"]["/health"]["get"]
    assert health_get["operationId"] == "getHealth"


def test_openapi_health_response_schema_matches_contract():
    schema = app.openapi()
    health_get = schema["paths"]["/health"]["get"]

    response_schema = health_get["responses"]["200"]["content"]["application/json"][
        "schema"
    ]
    assert response_schema == {"$ref": "#/components/schemas/HealthResponse"}

    health_response = schema["components"]["schemas"]["HealthResponse"]
    assert health_response["required"] == ["status", "version"]
    assert health_response["properties"]["version"]["type"] == "string"
    assert (
        health_response["properties"]["status"]["$ref"]
        == "#/components/schemas/HealthStatus"
    )

    health_status = schema["components"]["schemas"]["HealthStatus"]
    assert health_status["enum"] == ["ok"]


def test_committed_contract_matches_app_openapi():
    """`contracts/openapi.json` ne doit jamais diverger du schéma de l'app.

    Réutilise le mode `--check` de `scripts/export_openapi.py` (source unique
    de la logique de comparaison, cf. contracts/README.md) plutôt que de la
    réimplémenter ici. Doit échouer explicitement si un schéma Pydantic ou une
    route change sans que le contrat versionné soit régénéré.
    """
    result = subprocess.run(
        [sys.executable, str(EXPORT_SCRIPT), "--check"],
        cwd=BACKEND_DIR,
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, (
        "contracts/openapi.json est désynchronisé de l'application. "
        "Lancer `python scripts/export_openapi.py` pour le régénérer.\n"
        f"stdout: {result.stdout}\nstderr: {result.stderr}"
    )


# --- Ressources métier (Lot 2) ----------------------------------------------

EXPECTED_OPERATIONS = {
    ("get", "/health"): "getHealth",
    ("get", "/cartes"): "listCards",
    ("get", "/cartes/{card_id}"): "getCard",
    ("get", "/bundles"): "listBundles",
    ("get", "/bundles/{bundle_id}"): "getBundle",
    ("post", "/bundles/{bundle_id}/stock"): "depositBundle",
    ("get", "/langues"): "listLanguages",
    ("post", "/langues"): "createLanguage",
    ("get", "/stock"): "listStock",
    ("post", "/stock"): "createStockEntry",
    ("get", "/stock/{card_id}/{language_code}"): "getStockEntry",
    ("patch", "/stock/{card_id}/{language_code}"): "updateStockEntry",
    ("delete", "/stock/{card_id}/{language_code}"): "deleteStockEntry",
    ("get", "/decks"): "listDecks",
    ("post", "/decks"): "createDeck",
    ("get", "/decks/{deck_id}"): "getDeck",
    ("patch", "/decks/{deck_id}"): "updateDeck",
    ("delete", "/decks/{deck_id}"): "deleteDeck",
    ("get", "/decks/{deck_id}/legalite"): "getDeckLegality",
    ("post", "/decks/{deck_id}/cartes"): "addDeckCard",
    ("patch", "/decks/{deck_id}/cartes/{card_id}/{language_code}"): "updateDeckCard",
    ("delete", "/decks/{deck_id}/cartes/{card_id}/{language_code}"): "removeDeckCard",
    ("post", "/sync"): "syncOperations",
}


def test_every_route_has_its_documented_operation_id():
    paths = app.openapi()["paths"]

    declared = {
        (method, path): operation["operationId"]
        for path, methods in paths.items()
        for method, operation in methods.items()
    }

    assert declared == EXPECTED_OPERATIONS


def test_business_errors_are_declared_with_the_error_schema():
    schema = app.openapi()
    error = schema["components"]["schemas"]["ErrorResponse"]
    assert error["required"] == ["detail"]

    add_card = schema["paths"]["/decks/{deck_id}/cartes"]["post"]["responses"]
    for status in ("404", "409"):
        assert add_card[status]["content"]["application/json"]["schema"] == {
            "$ref": "#/components/schemas/ErrorResponse"
        }
    assert add_card["201"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/DeckCardRead"
    }


def test_deletions_answer_204_without_body():
    paths = app.openapi()["paths"]

    for path in ("/stock/{card_id}/{language_code}", "/decks/{deck_id}"):
        responses = paths[path]["delete"]["responses"]
        assert "204" in responses
        assert "content" not in responses["204"]


# --- Archivage des decks (Lot 2, passe 2) -----------------------------------

ERROR_REF = {"$ref": "#/components/schemas/ErrorResponse"}
DECK_READ_REF = {"$ref": "#/components/schemas/DeckRead"}


def test_deck_legality_exposes_crypt_groups_and_banned_cards():
    """Le verdict de légalité transporte le détail des règles ajoutées.

    Les groupes sortent au format des cartes (« G2 »), et les cartes fautives
    sont des cartes entières : un vampire ne se désigne pas par son nom seul.
    Tous ces champs sont **obligatoires** en réponse — la réponse les contient
    toujours, même vides, et le client TypeScript généré doit les voir ainsi
    (cf. `ReadModel`).
    """
    legality = app.openapi()["components"]["schemas"]["DeckLegality"]
    properties = legality["properties"]

    assert properties["crypt_groups"]["type"] == "array"
    assert properties["crypt_groups"]["items"] == {"type": "string"}
    assert properties["banned_cards"]["type"] == "array"
    assert properties["banned_cards"]["items"] == {
        "$ref": "#/components/schemas/CardSummary"
    }
    assert properties["not_yet_legal_cards"]["items"] == {
        "$ref": "#/components/schemas/CardSummary"
    }
    assert properties["evaluated_on"]["format"] == "date"

    assert {
        "crypt_groups",
        "banned_cards",
        "not_yet_legal_cards",
        "issues",
        "evaluated_on",
    } <= set(legality["required"])


def test_deck_read_exposes_a_nullable_archived_at():
    """`archived_at` est nul tant que le deck n'est pas archivé.

    Nullable, mais **présent** : la réponse porte toujours le champ, donc il est
    obligatoire au contrat et vaut `string | null` côté TypeScript — et non
    `string | null | undefined`.
    """
    deck_read = app.openapi()["components"]["schemas"]["DeckRead"]

    archived_at = deck_read["properties"]["archived_at"]
    assert archived_at["anyOf"] == [
        {"type": "string", "format": "date-time"},
        {"type": "null"},
    ]
    assert "archived_at" in deck_read["required"]
    assert set(deck_read["required"]) == set(deck_read["properties"])


def test_deck_read_carries_the_discriminator():
    """Le nom ne suffit plus : le couple nom + discriminant identifie un deck."""
    deck_read = app.openapi()["components"]["schemas"]["DeckRead"]

    assert deck_read["properties"]["discriminator"]["type"] == "string"
    assert "discriminator" in deck_read["required"]
    # Le client ne le fournit jamais : il n'est ni en création, ni en mise à jour.
    for name in ("DeckCreate", "DeckUpdate"):
        schema = app.openapi()["components"]["schemas"][name]
        assert "discriminator" not in schema["properties"], name


def test_list_decks_takes_a_three_valued_state_filter():
    parameters = app.openapi()["paths"]["/decks"]["get"]["parameters"]
    state = next(p for p in parameters if p["name"] == "state")

    assert state["in"] == "query"
    assert state["required"] is False
    assert state["schema"]["$ref"] == "#/components/schemas/DeckListState"
    assert state["schema"]["default"] == "active"
    enum = app.openapi()["components"]["schemas"]["DeckListState"]
    assert enum["enum"] == ["active", "archived", "all"]
    # Le booléen `archived` a disparu de la requête.
    assert "archived" not in {p["name"] for p in parameters}


def test_delete_deck_declares_the_archived_only_conflict():
    """La suppression est logique et réservée aux decks archivés.

    Un deck actif refusé, c'est un 409 ; un identifiant inconnu (ou déjà
    supprimé), un 404. Les deux portent `ErrorResponse`.
    """
    responses = app.openapi()["paths"]["/decks/{deck_id}"]["delete"]["responses"]

    assert "204" in responses
    for status in ("404", "409"):
        assert responses[status]["content"]["application/json"]["schema"] == (
            ERROR_REF
        )


def test_archive_and_restore_routes_are_gone():
    """L'archivage passe par `PATCH /decks/{id}` (`archived: bool`)."""
    paths = app.openapi()["paths"]

    assert "/decks/{deck_id}/archiver" not in paths
    assert "/decks/{deck_id}/restaurer" not in paths
    patch = paths["/decks/{deck_id}"]["patch"]["responses"]
    assert patch["200"]["content"]["application/json"]["schema"] == DECK_READ_REF


def test_updating_a_deck_is_how_one_archives_it():
    """`archived` est un booléen de la charge utile, pas une route à part."""
    deck_update = app.openapi()["components"]["schemas"]["DeckUpdate"]

    assert deck_update["properties"]["archived"]["type"] == "boolean"
    # Facultatif : ne pas le fournir laisse l'état d'archivage tel quel.
    assert "archived" not in deck_update.get("required", [])
    # Et il ne se lit pas ainsi : la lecture expose l'instant, pas le booléen.
    assert "archived" not in app.openapi()["components"]["schemas"]["DeckRead"][
        "properties"
    ]


def test_every_datetime_of_the_contract_is_declared_as_an_instant():
    """Une date-heure sortante est une chaîne `date-time`, et rien d'autre.

    Garde-fou du correctif de sérialisation (cf. `ReadModel`) : normaliser en
    UTC *aware* ne doit pas changer le contrat — le client TypeScript continue
    de voir une `string`. Ce qui change est la valeur, toujours suffixée « Z ».
    """
    schemas = app.openapi()["components"]["schemas"]
    dated = {
        (name, prop)
        for name, schema in schemas.items()
        for prop, definition in schema.get("properties", {}).items()
        for branch in definition.get("anyOf", [definition])
        if branch.get("format") == "date-time"
    }

    assert {
        ("DeckRead", "created_at"),
        ("DeckRead", "updated_at"),
        ("DeckRead", "archived_at"),
        ("DeckRead", "deleted_at"),
    } <= dated

    for name, prop in dated:
        definition = schemas[name]["properties"][prop]
        for branch in definition.get("anyOf", [definition]):
            if branch.get("format") == "date-time":
                assert branch["type"] == "string", f"{name}.{prop}"


def test_identifier_path_parameters_are_bounded():
    """Un identifiant hors des bornes d'une colonne vaut 422, pas 500.

    Sans bornes, la valeur descend jusqu'au pilote SQLite, qui la refuse par
    une erreur d'exécution.
    """
    paths = app.openapi()["paths"]
    checked = 0

    for path, operations in paths.items():
        for operation in operations.values():
            for parameter in operation.get("parameters", []):
                schema = parameter["schema"]
                if parameter["in"] != "path" or schema.get("type") != "integer":
                    continue
                assert schema["minimum"] == 1, (path, parameter["name"])
                assert schema["maximum"] == 2147483647, (path, parameter["name"])
                checked += 1

    assert checked >= 6


def test_error_codes_declared_per_deck_route_are_exactly_the_reachable_ones():
    paths = app.openapi()["paths"]

    def errors(path, method):
        return {
            status
            for status in paths[path][method]["responses"]
            if status in ("404", "409")
        }

    assert errors("/decks", "get") == set()
    assert errors("/decks", "post") == {"409"}
    assert errors("/decks/{deck_id}", "get") == {"404"}
    assert errors("/decks/{deck_id}", "patch") == {"404", "409"}
    assert errors("/decks/{deck_id}", "delete") == {"404", "409"}
    assert errors("/decks/{deck_id}/legalite", "get") == {"404", "409"}
    assert errors("/decks/{deck_id}/cartes", "post") == {"404", "409"}
