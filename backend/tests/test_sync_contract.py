"""Contrat de `POST /sync` : schémas, empreinte, OpenAPI, validation de la route.

Le service est testé à part (`test_sync_service.py`, `test_sync_concurrency.py`) ;
ce qui est figé ici, c'est **ce que le back doit respecter** et ce que le front
génère :

* la forme d'un lot et de ses opérations, union discriminée par `type` ;
* les contrôles qui valent 422 *avant* toute écriture (clé dupliquée,
  désignation de deck ambiguë, bornes) ;
* la recette de l'empreinte, qui doit rester stable dans le temps — la changer
  ferait passer d'anciennes opérations journalisées pour incohérentes ;
* les conventions du §7 appliquées à une ressource neuve.
"""

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.main import app
from app.models.sync import CLIENT_REF_LENGTH, HASH_LENGTH, UUID_LENGTH, SyncOperation
from app.schemas.base import MAX_DB_INT
from app.schemas.sync import (
    MAX_SYNC_OPERATIONS,
    BundleDepositOperation,
    DeckCardUpsertOperation,
    DeckCreateOperation,
    DeckRef,
    DeckUpdateOperation,
    StockUpsertOperation,
    SyncRequest,
    fingerprint,
)

RECORDED_AT = "2026-09-20T20:00:00+02:00"


def operation(**overrides) -> dict:
    """Une opération valide, à dériver."""
    return {
        "type": "stock.upsert",
        "operation_id": str(uuid4()),
        "recorded_at": RECORDED_AT,
        "data": {"card_id": 1, "language_code": "FR", "quantity_owned": 3},
    } | overrides


def batch(*operations: dict) -> dict:
    return {"operations": list(operations) or [operation()]}


# --------------------------------------------------------------------------
# Forme d'un lot
# --------------------------------------------------------------------------


def test_a_batch_parses_each_operation_into_its_own_type():
    """L'union est discriminée : `type` suffit à trancher, sans essai-erreur."""
    request = SyncRequest.model_validate(
        batch(
            operation(),
            operation(
                type="deck.create",
                client_ref="ref-deck",
                data={"name": "Malkavien 2022"},
            ),
            operation(
                type="deck_card.upsert",
                deck={"client_ref": "ref-deck"},
                data={"card_id": 2, "language_code": "EN", "quantity": 4},
            ),
            operation(type="bundle.deposit", bundle_id=7, data={"language_code": "ES"}),
        )
    )

    kinds = [type(op) for op in request.operations]
    assert kinds == [
        StockUpsertOperation,
        DeckCreateOperation,
        DeckCardUpsertOperation,
        BundleDepositOperation,
    ]
    # La charge utile est celle de la route en ligne, réutilisée telle quelle.
    assert request.operations[0].data.quantity_owned == 3
    assert request.operations[1].data.name == "Malkavien 2022"


def test_an_unknown_operation_type_is_refused():
    with pytest.raises(ValidationError) as error:
        SyncRequest.model_validate(batch(operation(type="game.create")))
    assert "type" in str(error.value)


def test_an_unknown_field_is_refused_rather_than_ignored():
    """`extra="forbid"` : une file écrite par un front plus récent ne passe pas.

    Mieux vaut un 422 franc qu'une opération à demi appliquée dont un champ
    aurait été avalé en silence.
    """
    with pytest.raises(ValidationError):
        SyncRequest.model_validate(batch(operation(priority="haute")))


def test_an_empty_batch_is_refused():
    with pytest.raises(ValidationError):
        SyncRequest.model_validate({"operations": []})


def test_a_batch_is_bounded():
    """Un lot est traité en une passe : sa taille est plafonnée, pas libre."""
    too_many = [operation() for _ in range(MAX_SYNC_OPERATIONS + 1)]
    with pytest.raises(ValidationError):
        SyncRequest.model_validate({"operations": too_many})

    at_the_limit = [operation() for _ in range(MAX_SYNC_OPERATIONS)]
    assert len(SyncRequest.model_validate({"operations": at_the_limit}).operations) == (
        MAX_SYNC_OPERATIONS
    )


# --------------------------------------------------------------------------
# Clés d'idempotence et références client
# --------------------------------------------------------------------------


def test_the_idempotency_key_is_a_uuid():
    with pytest.raises(ValidationError):
        SyncRequest.model_validate(batch(operation(operation_id="op-1")))


def test_a_batch_refuses_two_operations_sharing_an_idempotency_key():
    """Le client a dupliqué une entrée de sa file : indécidable, donc 422."""
    key = str(uuid4())
    with pytest.raises(ValidationError) as error:
        SyncRequest.model_validate(
            batch(operation(operation_id=key), operation(operation_id=key))
        )
    assert "deux fois" in str(error.value)


def test_a_batch_refuses_two_creations_sharing_a_client_reference():
    with pytest.raises(ValidationError) as error:
        SyncRequest.model_validate(
            batch(
                operation(type="deck.create", client_ref="ref", data={"name": "A"}),
                operation(type="deck.create", client_ref="ref", data={"name": "B"}),
            )
        )
    assert "référence client" in str(error.value)


def test_a_creation_must_carry_its_client_reference():
    """Sans elle, rien de la suite de la file ne peut désigner le deck créé."""
    with pytest.raises(ValidationError):
        SyncRequest.model_validate(
            batch(operation(type="deck.create", data={"name": "Sans référence"}))
        )


def test_a_deck_is_designated_by_its_identifier_or_its_reference_but_not_both():
    assert DeckRef.model_validate({"deck_id": 3}).client_ref is None
    assert DeckRef.model_validate({"client_ref": "ref"}).deck_id is None

    for ambiguous in ({}, {"deck_id": 3, "client_ref": "ref"}):
        with pytest.raises(ValidationError) as error:
            DeckRef.model_validate(ambiguous)
        assert "pas les deux ni aucun des deux" in str(error.value)


def test_a_client_reference_is_trimmed_and_never_blank():
    assert DeckRef.model_validate({"client_ref": "  ref  "}).client_ref == "ref"
    with pytest.raises(ValidationError):
        DeckRef.model_validate({"client_ref": "   "})


def test_a_client_reference_fits_the_column_that_stores_it():
    """Le contrat et la colonne doivent s'accorder, sinon c'est un 500 à l'insert."""
    longest = "r" * CLIENT_REF_LENGTH
    assert DeckRef.model_validate({"client_ref": longest}).client_ref == longest
    with pytest.raises(ValidationError):
        DeckRef.model_validate({"client_ref": "r" * (CLIENT_REF_LENGTH + 1)})


def test_the_client_never_provides_a_deck_discriminator():
    """Hors ligne comme en ligne, l'identité d'affichage vient du serveur."""
    with pytest.raises(ValidationError):
        SyncRequest.model_validate(
            batch(
                operation(
                    type="deck.create",
                    client_ref="ref",
                    data={"name": "Malkavien", "discriminator": "8561"},
                )
            )
        )


# --------------------------------------------------------------------------
# Conventions du §7 : fuseau obligatoire, bornes, textes non vides
# --------------------------------------------------------------------------


def test_the_capture_instant_requires_a_timezone_and_lands_in_utc():
    with pytest.raises(ValidationError) as naive:
        SyncRequest.model_validate(batch(operation(recorded_at="2026-09-20T20:00:00")))
    assert "fuseau" in str(naive.value)

    request = SyncRequest.model_validate(batch(operation()))
    assert request.operations[0].recorded_at == datetime(
        2026, 9, 20, 18, 0, tzinfo=UTC
    )


def test_a_clock_ahead_of_the_server_is_accepted_and_arbitrates_nothing():
    """L'horloge du client n'est pas une autorité : elle est journalisée, point.

    Refuser un `recorded_at` dans le futur reviendrait à perdre une saisie
    parce que le téléphone du joueur avance de deux minutes.
    """
    ahead = (datetime.now(UTC) + timedelta(days=1)).isoformat()
    request = SyncRequest.model_validate(batch(operation(recorded_at=ahead)))
    assert request.operations[0].recorded_at > datetime.now(UTC)


@pytest.mark.parametrize("card_id", [0, -1, MAX_DB_INT + 1])
def test_identifiers_are_bounded(card_id):
    with pytest.raises(ValidationError):
        SyncRequest.model_validate(
            batch(
                operation(
                    type="stock.delete", card_id=card_id, language_code="FR"
                )
            )
        )


def test_a_language_code_is_never_blank():
    with pytest.raises(ValidationError):
        SyncRequest.model_validate(
            batch(operation(type="stock.delete", card_id=1, language_code="   "))
        )


def test_a_deck_update_keeps_the_semantics_of_the_online_patch():
    """Seuls les champs fournis comptent — archivage compris."""
    request = SyncRequest.model_validate(
        batch(
            operation(
                type="deck.update", deck={"deck_id": 3}, data={"archived": True}
            )
        )
    )
    update = request.operations[0]
    assert isinstance(update, DeckUpdateOperation)
    assert update.data.model_fields_set == {"archived"}
    assert update.data.archived is True


# --------------------------------------------------------------------------
# Empreinte du corps
# --------------------------------------------------------------------------


def test_the_same_body_always_gives_the_same_fingerprint():
    payload = operation()
    first = SyncRequest.model_validate(batch(payload)).operations[0]
    second = SyncRequest.model_validate(batch(payload)).operations[0]
    assert fingerprint(first) == fingerprint(second)
    assert len(fingerprint(first)) == HASH_LENGTH


def test_the_order_of_the_json_keys_does_not_change_the_fingerprint():
    payload = operation()
    reversed_payload = dict(reversed(list(payload.items())))
    assert fingerprint(
        SyncRequest.model_validate(batch(payload)).operations[0]
    ) == fingerprint(
        SyncRequest.model_validate(batch(reversed_payload)).operations[0]
    )


def test_a_different_body_gives_a_different_fingerprint():
    key = str(uuid4())
    three = SyncRequest.model_validate(
        batch(operation(operation_id=key))
    ).operations[0]
    four = SyncRequest.model_validate(
        batch(
            operation(
                operation_id=key,
                data={"card_id": 1, "language_code": "FR", "quantity_owned": 4},
            )
        )
    ).operations[0]
    assert fingerprint(three) != fingerprint(four)


def test_an_explicit_null_is_not_the_same_request_as_an_omitted_field():
    """« Efface les notes » et « ne touche pas aux notes » sont deux requêtes.

    C'est tout l'intérêt d'`exclude_unset` dans la recette : sans lui, les deux
    donneraient la même empreinte et un rejeu rendrait le mauvais verdict.
    """
    key = str(uuid4())
    silent = SyncRequest.model_validate(
        batch(operation(operation_id=key, type="deck.update", deck={"deck_id": 1},
                        data={"name": "Grinder"}))
    ).operations[0]
    erasing = SyncRequest.model_validate(
        batch(operation(operation_id=key, type="deck.update", deck={"deck_id": 1},
                        data={"name": "Grinder", "notes": None}))
    ).operations[0]
    assert fingerprint(silent) != fingerprint(erasing)


# --------------------------------------------------------------------------
# Journal (modèle)
# --------------------------------------------------------------------------


def test_the_journal_records_a_verdict_and_dates_it_itself(db):
    recorded = datetime(2026, 9, 20, 18, 0, tzinfo=UTC)
    entry = SyncOperation(
        operation_id=str(uuid4()),
        batch_id=str(uuid4()),
        operation_type="deck.create",
        request_hash="a" * HASH_LENGTH,
        status="applied",
        client_ref="ref-1",
        resource_kind="deck",
        deck_id=12,
        recorded_at=recorded,
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)

    assert entry.id is not None
    assert entry.error_code is None
    # Stocké en UTC naïf, comme toute date-heure du modèle.
    assert entry.recorded_at == recorded.replace(tzinfo=None)
    assert entry.processed_at is not None


def test_the_journal_columns_hold_a_uuid_and_a_sha256():
    columns = SyncOperation.__table__.columns
    assert columns["operation_id"].type.length == UUID_LENGTH
    assert columns["batch_id"].type.length == UUID_LENGTH
    assert columns["request_hash"].type.length == HASH_LENGTH
    assert columns["client_ref"].type.length == CLIENT_REF_LENGTH
    # Un journal ne retient rien : aucune clé étrangère (cf. `app.models.sync`).
    assert SyncOperation.__table__.foreign_keys == set()


# --------------------------------------------------------------------------
# Contrat OpenAPI
# --------------------------------------------------------------------------

SCHEMAS = app.openapi()["components"]["schemas"]
SYNC_POST = app.openapi()["paths"]["/sync"]["post"]


def test_the_batch_is_a_discriminated_union_usable_from_typescript():
    """`oneOf` + `mapping` : `op.type === "deck.create"` suffit côté client."""
    items = SCHEMAS["SyncRequest"]["properties"]["operations"]["items"]

    assert items["discriminator"]["propertyName"] == "type"
    assert set(items["discriminator"]["mapping"]) == {
        "stock.upsert",
        "stock.delete",
        "deck.create",
        "deck.update",
        "deck.delete",
        "deck_card.upsert",
        "deck_card.delete",
        "bundle.deposit",
    }
    assert len(items["oneOf"]) == len(items["discriminator"]["mapping"])


def test_the_batch_reuses_the_payloads_of_the_online_routes():
    """Le client n'écrit qu'une forme de charge utile, en ligne comme hors ligne."""
    reused = {
        "StockUpsertOperation": "CardCopyCreate",
        "DeckCreateOperation": "DeckCreate",
        "DeckUpdateOperation": "DeckUpdate",
        "DeckCardUpsertOperation": "DeckCardCreate",
        "BundleDepositOperation": "BundleDeposit",
    }
    for wrapper, payload in reused.items():
        assert SCHEMAS[wrapper]["properties"]["data"] == {
            "$ref": f"#/components/schemas/{payload}"
        }, wrapper


def test_the_outcome_and_the_reason_are_two_separate_fields():
    """Le conflit est un motif de refus, pas une quatrième issue."""
    assert SCHEMAS["SyncOutcome"]["enum"] == ["applied", "replayed", "rejected"]
    assert SCHEMAS["SyncErrorCode"]["enum"] == [
        "not_found",
        "conflict",
        "invalid",
        "unresolved_client_ref",
        "mismatched_replay",
    ]
    assert SCHEMAS["SyncOperationError"]["required"] == ["code", "message"]


def test_every_field_of_a_result_is_present_in_the_response():
    """Convention §7 : un champ de lecture à défaut est obligatoire en sortie."""
    for name in ("SyncResult", "SyncOperationResult", "SyncResourceRef"):
        schema = SCHEMAS[name]
        assert set(schema["required"]) == set(schema["properties"]), name


def test_a_result_dates_its_verdict_as_an_instant():
    processed = SCHEMAS["SyncOperationResult"]["properties"]["processed_at"]
    assert processed["type"] == "string"
    assert processed["format"] == "date-time"
    assert SCHEMAS["SyncResult"]["properties"]["synced_at"]["format"] == "date-time"


def test_the_capture_instant_is_required_on_every_operation():
    for name, schema in SCHEMAS.items():
        if not name.endswith("Operation") or "properties" not in schema:
            continue
        if "recorded_at" not in schema["properties"]:
            continue
        assert {"operation_id", "recorded_at", "type"} <= set(schema["required"]), name


def test_the_batch_never_fails_as_a_whole():
    """Ni 404 ni 409 sur `/sync` : un refus vit dans le corps de la réponse 200.

    Les deux seuls autres codes ne portent pas de verdict : le 422 refuse un lot
    mal formé avant toute écriture, le 503 dit que le lot n'a pas pu être traité
    du tout.
    """
    assert set(SYNC_POST["responses"]) == {"200", "422", "503"}
    assert SYNC_POST["responses"]["200"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/SyncResult"
    }


def test_a_busy_write_lock_is_declared_as_a_transient_503():
    """Le client doit pouvoir distinguer « pas maintenant » de « non ».

    Sans cette déclaration, le 503 serait une réponse inconnue du contrat, donc
    du client généré, qui la traiterait comme un échec quelconque — et pourrait
    croire le lot tranché. Il ne l'est pas : rien n'a été appliqué, et le même
    lot se renvoie tel quel, ses clés d'idempotence le rendant sûr.
    """
    unavailable = SYNC_POST["responses"]["503"]

    assert unavailable["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/ErrorResponse"
    }
    retry_after = unavailable["headers"]["Retry-After"]
    assert retry_after["required"] is True
    assert retry_after["schema"]["type"] == "integer"
    assert "transitoire" in unavailable["description"]


# --------------------------------------------------------------------------
# Validation de la route
# --------------------------------------------------------------------------


def test_a_malformed_batch_is_refused_with_a_422(api):
    """La validation précède tout traitement : 422, rien n'est écrit."""
    response = api.post("/sync", json={"operations": []})
    assert response.status_code == 422
