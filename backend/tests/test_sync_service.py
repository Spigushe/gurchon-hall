"""`POST /sync` : ce que le service fait d'un lot.

Le contrat (formes, empreinte, OpenAPI) est figé dans `test_sync_contract.py` ;
ici on vérifie la **sémantique** posée par `docs/lot3-sync-contrat.md` :

* idempotence par `operation_id`, rejeu, `mismatched_replay` ;
* trois issues (`applied`, `replayed`, `rejected`), le conflit étant un motif ;
* un refus n'arrête pas le lot et n'écrit rien de partiel ;
* les références client (`client_ref`) se résolvent au journal, sur les seules
  créations appliquées ;
* l'ordre du lot est significatif, l'horloge du client ne l'est pas ;
* aucune règle métier n'est redéfinie : les refus sont ceux des services en
  ligne, message compris.

La sérialisation des écritures a sa propre suite (`test_sync_concurrency.py`).
"""

from datetime import datetime
from uuid import uuid4

import pytest
from sqlalchemy import func, select

from app.models import Card, CardCategory, CardCopy, Deck, DeckCard, SyncOperation
from app.models.enums import SyncOperationStatus
from app.schemas.sync import SyncRequest
from app.services import stock, sync
from app.services.errors import InvalidRequestError
from tests.helpers import make_card, make_copy, make_printing

RECORDED_AT = "2026-09-20T20:00:00+02:00"


def op(type_: str, **fields) -> dict:
    """Une opération de lot, avec sa clé d'idempotence neuve."""
    return {
        "type": type_,
        "operation_id": str(uuid4()),
        "recorded_at": RECORDED_AT,
    } | fields


def sync_batch(api, *operations: dict) -> dict:
    response = api.post("/sync", json={"operations": list(operations)})
    assert response.status_code == 200, response.text
    return response.json()


def upsert_stock(
    card_id: int,
    quantity: int,
    language: str = "EN",
    card_set_id: int = 1,
    *,
    operation_id: str | None = None,
    recorded_at: str | None = None,
    **data,
) -> dict:
    """`card_set_id` vaut 1 par défaut : suffisant pour les cartes inconnues des
    tests d'erreur (le refus porte sur la carte, pas sur l'extension) ; les
    écritures censées réussir doivent passer l'extension réelle de la carte
    visée (`spare.card_set_id`, `world.printing.card_set_id`)."""
    envelope = {}
    if operation_id is not None:
        envelope["operation_id"] = operation_id
    if recorded_at is not None:
        envelope["recorded_at"] = recorded_at
    return op(
        "stock.upsert",
        data={
            "card_id": card_id,
            "language_code": language,
            "card_set_id": card_set_id,
            "quantity_owned": quantity,
        }
        | data,
        **envelope,
    )


def owned(db, card_id: int, language: str = "EN") -> int | None:
    return db.scalar(
        select(CardCopy.quantity_owned).where(
            CardCopy.card_id == card_id, CardCopy.language_code == language
        )
    )


def deck_count(db, name: str) -> int:
    return db.scalar(select(func.count()).select_from(Deck).where(Deck.name == name))


def journal(db) -> list[SyncOperation]:
    db.expire_all()
    return list(db.scalars(select(SyncOperation).order_by(SyncOperation.id)))


@pytest.fixture
def spare(db, world) -> Card:
    """Une carte de library possédée en trois exemplaires EN, sans proxy.

    `card_set_id` est posé comme attribut dynamique (pas une colonne du
    modèle) : un raccourci pour les tests, qui doivent tous désigner une
    impression réelle depuis le Lot 4.
    """
    card = make_card(db, "Spare Part", CardCategory.LIBRARY)
    copy = make_copy(db, card, "EN", quantity_owned=3)
    card.card_set_id = copy.card_set_id
    db.commit()
    return card


# --------------------------------------------------------------------------
# Issues et compteurs
# --------------------------------------------------------------------------


def test_an_applied_operation_answers_with_its_verdict(api, world, spare):
    key = str(uuid4())
    body = sync_batch(
        api,
        upsert_stock(spare.id, 5, card_set_id=spare.card_set_id, operation_id=key),
    )

    assert (body["applied"], body["replayed"], body["rejected"]) == (1, 0, 0)
    [result] = body["results"]
    assert result["operation_id"] == key
    assert result["type"] == "stock.upsert"
    assert result["outcome"] == "applied"
    assert result["error"] is None
    assert result["resource"] == {
        "kind": "card_copy",
        "deck_id": None,
        "card_id": spare.id,
        "language_code": "EN",
        "card_set_id": spare.card_set_id,
        "bundle_id": None,
    }
    assert result["processed_at"].endswith("Z")
    assert body["synced_at"].endswith("Z")


def test_the_results_follow_the_order_of_the_request(api, world, spare):
    keys = [str(uuid4()) for _ in range(4)]
    body = sync_batch(
        api,
        *(
            upsert_stock(
                spare.id, n, card_set_id=spare.card_set_id, operation_id=key
            )
            for n, key in enumerate(keys)
        ),
    )
    assert [r["operation_id"] for r in body["results"]] == keys


def test_a_rejection_does_not_stop_the_batch_and_writes_nothing_partial(
    api, db, world, spare
):
    """[bon, refusé, bon] : les deux bons passent, le refus laisse la base intacte."""
    body = sync_batch(
        api,
        upsert_stock(spare.id, 5, card_set_id=spare.card_set_id),
        # 4 exemplaires alloués à un deck : descendre à 1 est refusé.
        upsert_stock(world.card.id, 1, card_set_id=world.printing.card_set_id),
        upsert_stock(spare.id, 6, card_set_id=spare.card_set_id),
    )

    assert [r["outcome"] for r in body["results"]] == ["applied", "rejected", "applied"]
    assert (body["applied"], body["replayed"], body["rejected"]) == (2, 0, 1)
    refused = body["results"][1]
    assert refused["error"]["code"] == "conflict"
    assert "alloués à des decks" in refused["error"]["message"]
    assert refused["resource"] is None
    assert owned(db, world.card.id) == 4  # inchangé
    assert owned(db, spare.id) == 6  # la dernière écriture de la file gagne


def test_the_error_message_is_the_one_the_online_route_gives(api, world):
    """Le service refuse, `/sync` ne fait que rapporter son texte."""
    card_set_id = world.printing.card_set_id
    online = api.patch(
        f"/stock/{world.card.id}/EN/{card_set_id}", json={"quantity_owned": 1}
    )
    assert online.status_code == 409

    body = sync_batch(api, upsert_stock(world.card.id, 1, card_set_id=card_set_id))
    assert body["results"][0]["error"]["message"] == online.json()["detail"]


def test_the_journal_records_every_verdict_with_the_batch_and_the_client_clock(
    api, db, world, spare
):
    good = upsert_stock(spare.id, 2, card_set_id=spare.card_set_id)
    bad = upsert_stock(world.card.id, 1, card_set_id=world.printing.card_set_id)
    body = sync_batch(api, good, bad)

    applied, rejected = journal(db)
    assert {applied.batch_id, rejected.batch_id} == {body["batch_id"]}
    assert applied.operation_id == good["operation_id"]
    assert applied.status is SyncOperationStatus.APPLIED
    assert applied.error_code is None
    assert applied.card_id == spare.id
    # 20:00 à +02:00, journalisé en UTC naïf.
    assert applied.recorded_at == datetime(2026, 9, 20, 18, 0)
    assert rejected.status is SyncOperationStatus.REJECTED
    assert rejected.error_code.value == "conflict"
    assert rejected.resource_kind is None


def test_a_malformed_batch_is_refused_before_anything_is_journaled(api, db, world):
    key = str(uuid4())
    response = api.post(
        "/sync",
        json={
            "operations": [
                upsert_stock(1, 1, operation_id=key),
                upsert_stock(2, 1, operation_id=key),
            ]
        },
    )
    assert response.status_code == 422
    assert journal(db) == []


# --------------------------------------------------------------------------
# Idempotence, rejeu, collision de clé
# --------------------------------------------------------------------------


def test_replaying_a_bundle_deposit_does_not_count_it_twice(api, db, world):
    """Le cas qui justifie le journal : `POST /bundles/{id}/stock` additionne."""
    deposit = op(
        "bundle.deposit",
        bundle_id=world.bundle.id,
        data={"language_code": "FR", "count": 1},
    )
    first = sync_batch(api, deposit)
    assert first["results"][0]["outcome"] == "applied"
    assert owned(db, world.card.id, "FR") == 2  # 0 possédé + 2 par produit

    again = sync_batch(api, deposit)
    [result] = again["results"]
    assert result["outcome"] == "replayed"
    assert (again["applied"], again["replayed"], again["rejected"]) == (0, 1, 0)
    assert owned(db, world.card.id, "FR") == 2  # pas 4

    # Et autant de fois qu'on veut : la clé a tranché une fois pour toutes.
    for _ in range(3):
        sync_batch(api, deposit)
    assert owned(db, world.card.id, "FR") == 2
    assert len(journal(db)) == 1


def test_a_replay_returns_the_original_verdict_untouched(api, world, spare):
    upsert = upsert_stock(spare.id, 5, card_set_id=spare.card_set_id)
    original = sync_batch(api, upsert)["results"][0]
    replay = sync_batch(api, upsert)["results"][0]

    assert replay["outcome"] == "replayed"
    # Le verdict d'origine, y compris son horodatage : rien n'est refait.
    assert replay | {"outcome": "applied"} == original


def test_a_replayed_rejection_stays_a_rejection(api, world):
    """Une opération `replayed` peut porter une erreur : le refus mémorisé."""
    refused = upsert_stock(
        world.card.id, 1, card_set_id=world.printing.card_set_id
    )
    first = sync_batch(api, refused)["results"][0]
    assert first["outcome"] == "rejected"

    replay = sync_batch(api, refused)
    assert replay["results"][0]["outcome"] == "replayed"
    assert replay["results"][0]["error"] == first["error"]
    assert replay["rejected"] == 0  # « rejeté » compte les refus d'aujourd'hui


def test_a_rejected_key_is_not_retried_even_once_the_cause_is_gone(api, db, world):
    """Même clé, même refus, à jamais : corriger, c'est une nouvelle opération."""
    sync_batch(api, op("deck.delete", deck={"deck_id": world.deck.id}))  # refus
    refused = journal(db)[0]
    assert refused.status is SyncOperationStatus.REJECTED

    # La cause disparaît (le deck est archivé) : la même clé ne se rejoue pas.
    api.patch(f"/decks/{world.deck.id}", json={"archived": True})
    replay = sync_batch(
        api,
        {
            "type": "deck.delete",
            "operation_id": refused.operation_id,
            "recorded_at": RECORDED_AT,
            "deck": {"deck_id": world.deck.id},
        },
    )["results"][0]
    assert replay["outcome"] == "replayed"
    assert replay["error"]["code"] == "conflict"
    assert api.get(f"/decks/{world.deck.id}").json()["deleted_at"] is None


def test_the_same_key_with_another_body_is_a_mismatched_replay(api, db, world, spare):
    key = str(uuid4())
    sync_batch(
        api,
        upsert_stock(spare.id, 5, card_set_id=spare.card_set_id, operation_id=key),
    )

    body = sync_batch(
        api,
        upsert_stock(spare.id, 9, card_set_id=spare.card_set_id, operation_id=key),
    )
    [result] = body["results"]
    assert result["outcome"] == "rejected"
    assert result["error"]["code"] == "mismatched_replay"
    assert key in result["error"]["message"]
    assert (body["applied"], body["replayed"], body["rejected"]) == (0, 0, 1)
    assert owned(db, spare.id) == 5  # rien n'a été appliqué

    # Le journal garde le verdict d'origine : l'opération d'origine se rejoue.
    assert len(journal(db)) == 1
    original = sync_batch(
        api,
        upsert_stock(spare.id, 5, card_set_id=spare.card_set_id, operation_id=key),
    )
    assert original["results"][0]["outcome"] == "replayed"


def test_omitting_a_field_and_sending_null_are_two_different_bodies(api, world):
    """L'empreinte suit `exclude_unset` : « efface » n'est pas « ne touche pas »."""
    key = str(uuid4())
    silent = {
        "type": "deck.update",
        "operation_id": key,
        "recorded_at": RECORDED_AT,
        "deck": {"deck_id": world.deck.id},
        "data": {"archetype": "Vote"},
    }
    erasing = silent | {"data": {"archetype": "Vote", "notes": None}}
    sync_batch(api, silent)

    result = sync_batch(api, erasing)["results"][0]
    assert result["error"]["code"] == "mismatched_replay"


def test_a_replay_within_a_mixed_batch_does_not_disturb_the_new_operations(
    api, db, world, spare
):
    known = upsert_stock(spare.id, 5, card_set_id=spare.card_set_id)
    sync_batch(api, known)

    body = sync_batch(
        api, known, upsert_stock(spare.id, 8, card_set_id=spare.card_set_id)
    )
    assert [r["outcome"] for r in body["results"]] == ["replayed", "applied"]
    assert (body["applied"], body["replayed"], body["rejected"]) == (1, 1, 0)
    assert owned(db, spare.id) == 8


# --------------------------------------------------------------------------
# Ordre d'application
# --------------------------------------------------------------------------


def test_the_last_write_of_the_queue_wins(api, db, world, spare):
    sync_batch(
        api,
        upsert_stock(spare.id, 3, card_set_id=spare.card_set_id),
        upsert_stock(spare.id, 1, card_set_id=spare.card_set_id),
    )
    assert owned(db, spare.id) == 1

    sync_batch(
        api,
        upsert_stock(spare.id, 1, card_set_id=spare.card_set_id),
        upsert_stock(spare.id, 3, card_set_id=spare.card_set_id),
    )
    assert owned(db, spare.id) == 3


def test_the_client_clock_arbitrates_nothing(api, db, world, spare):
    """Un `recorded_at` plus ancien, reçu après, n'est pas écarté ni réordonné."""
    late = upsert_stock(
        spare.id, 7, card_set_id=spare.card_set_id,
        recorded_at="2026-09-20T23:00:00+00:00",
    )
    early = upsert_stock(
        spare.id, 2, card_set_id=spare.card_set_id,
        recorded_at="2026-01-01T00:00:00+00:00",
    )
    sync_batch(api, late, early)
    assert owned(db, spare.id) == 2  # l'ordre de la file, pas celui des horloges


def test_an_operation_needing_a_later_creation_is_refused(api, world, spare):
    """L'ordre est significatif : une carte ne s'ajoute qu'à un deck déjà créé."""
    add = op(
        "deck_card.upsert",
        deck={"client_ref": "deck-1"},
        data={
            "card_id": spare.id,
            "language_code": "EN",
            "card_set_id": spare.card_set_id,
            "quantity": 1,
        },
    )
    create = op("deck.create", client_ref="deck-1", data={"name": "Trop tard"})

    body = sync_batch(api, add, create)
    assert body["results"][0]["error"]["code"] == "unresolved_client_ref"
    assert body["results"][1]["outcome"] == "applied"


# --------------------------------------------------------------------------
# Upsert : l'état complet voulu
# --------------------------------------------------------------------------


def test_a_stock_upsert_creates_then_replaces_with_the_full_state(api, db, world):
    card = make_card(db, "Upserted", CardCategory.LIBRARY)
    printing = make_printing(db, card)
    db.commit()

    sync_batch(
        api,
        upsert_stock(
            card.id, 4, language="fr", card_set_id=printing.card_set_id, notes="reçue"
        ),
    )
    entry = api.get(f"/stock/{card.id}/FR/{printing.card_set_id}").json()
    assert (entry["quantity_owned"], entry["notes"]) == (4, "reçue")

    # Champs omis : ils reprennent leur défaut, ils ne conservent rien.
    sync_batch(
        api,
        op(
            "stock.upsert",
            data={
                "card_id": card.id,
                "language_code": "FR",
                "card_set_id": printing.card_set_id,
            },
        ),
    )
    entry = api.get(f"/stock/{card.id}/FR/{printing.card_set_id}").json()
    assert (entry["quantity_owned"], entry["notes"]) == (0, None)


def test_a_deck_card_upsert_creates_then_replaces_the_line(api, db, world, spare):
    created = sync_batch(
        api, op("deck.create", client_ref="d", data={"name": "Réécrit"})
    )["results"][0]
    deck_id = created["resource"]["deck_id"]

    def upsert(quantity: int) -> dict:
        return op(
            "deck_card.upsert",
            deck={"deck_id": deck_id},
            data={
                "card_id": spare.id,
                "language_code": "EN",
                "card_set_id": spare.card_set_id,
                "quantity": quantity,
            },
        )

    assert sync_batch(api, upsert(2))["results"][0]["outcome"] == "applied"
    assert sync_batch(api, upsert(3))["results"][0]["outcome"] == "applied"

    [line] = api.get(f"/decks/{deck_id}").json()["cards"]
    assert line["quantity"] == 3
    # 3 exemplaires possédés, 3 alloués : un 4e n'existe pas, le remplacement non plus.
    assert sync_batch(api, upsert(4))["results"][0]["error"]["code"] == "conflict"
    [line] = api.get(f"/decks/{deck_id}").json()["cards"]
    assert line["quantity"] == 3


def test_a_line_removal_and_a_stock_removal_apply(api, db, world, spare):
    deck_id = sync_batch(
        api, op("deck.create", client_ref="d", data={"name": "Retrait"})
    )["results"][0]["resource"]["deck_id"]
    sync_batch(
        api,
        op(
            "deck_card.upsert",
            deck={"deck_id": deck_id},
            data={
                "card_id": spare.id,
                "language_code": "EN",
                "card_set_id": spare.card_set_id,
                "quantity": 1,
            },
        ),
    )

    # Encore utilisée par un deck : refusé, comme `DELETE /stock/...`.
    refused = sync_batch(
        api,
        op(
            "stock.delete",
            card_id=spare.id,
            language_code="EN",
            card_set_id=spare.card_set_id,
        ),
    )["results"][0]
    assert refused["error"]["code"] == "conflict"

    body = sync_batch(
        api,
        op(
            "deck_card.delete",
            deck={"deck_id": deck_id},
            card_id=spare.id,
            language_code="EN",
            card_set_id=spare.card_set_id,
        ),
        op(
            "stock.delete",
            card_id=spare.id,
            language_code="EN",
            card_set_id=spare.card_set_id,
        ),
    )
    assert [r["outcome"] for r in body["results"]] == ["applied", "applied"]
    assert api.get(f"/decks/{deck_id}").json()["cards"] == []
    assert owned(db, spare.id) is None


# --------------------------------------------------------------------------
# Références client
# --------------------------------------------------------------------------


def test_a_deck_created_offline_is_designated_by_its_reference_in_the_same_batch(
    api, db, world, spare
):
    body = sync_batch(
        api,
        op("deck.create", client_ref="ref-A", data={"name": "Hors ligne"}),
        op(
            "deck_card.upsert",
            deck={"client_ref": "ref-A"},
            data={
                "card_id": spare.id,
                "language_code": "EN",
                "card_set_id": spare.card_set_id,
                "quantity": 2,
            },
        ),
        op("deck.update", deck={"client_ref": "ref-A"}, data={"archetype": "Bleed"}),
    )

    assert [r["outcome"] for r in body["results"]] == ["applied"] * 3
    created = body["results"][0]
    assert created["client_ref"] == "ref-A"
    deck_id = created["resource"]["deck_id"]
    assert [r["resource"]["deck_id"] for r in body["results"]] == [deck_id] * 3

    deck = api.get(f"/decks/{deck_id}").json()
    assert deck["archetype"] == "Bleed"
    assert [line["quantity"] for line in deck["cards"]] == [2]
    # Le discriminant est tiré par le serveur, jamais fourni.
    assert len(deck["discriminator"]) == 4


def test_the_reference_still_resolves_in_a_later_batch(api, world, spare):
    """Même si le client a perdu la réponse qui lui donnait l'identifiant."""
    deck_id = sync_batch(
        api, op("deck.create", client_ref="ref-B", data={"name": "Mémorisé"})
    )["results"][0]["resource"]["deck_id"]

    body = sync_batch(
        api,
        op(
            "deck_card.upsert",
            deck={"client_ref": "ref-B"},
            data={
                "card_id": spare.id,
                "language_code": "EN",
                "card_set_id": spare.card_set_id,
                "quantity": 1,
            },
        ),
    )
    assert body["results"][0]["outcome"] == "applied"
    assert body["results"][0]["resource"]["deck_id"] == deck_id
    assert body["results"][0]["client_ref"] is None  # seule la création la porte


def test_a_refused_creation_makes_its_followers_unresolved_and_frees_the_reference(
    api, db, world, spare
):
    """Une référence n'est réservée que par une création **appliquée**."""
    add = {
        "deck": {"client_ref": "ref-C"},
        "data": {
            "card_id": spare.id,
            "language_code": "EN",
            "card_set_id": spare.card_set_id,
            "quantity": 1,
        },
    }
    body = sync_batch(
        api,
        # Un deck actif sans cartes est illégal : refusé.
        op(
            "deck.create",
            client_ref="ref-C",
            data={"name": "Trop tôt", "status": "active"},
        ),
        op("deck_card.upsert", **add),
        op("deck.update", deck={"client_ref": "ref-C"}, data={"notes": "x"}),
    )
    creation, follower, other = body["results"]
    assert creation["outcome"] == "rejected"
    assert creation["error"]["code"] == "conflict"
    assert creation["client_ref"] == "ref-C"
    assert creation["resource"] is None
    assert follower["error"]["code"] == "unresolved_client_ref"
    assert other["error"]["code"] == "unresolved_client_ref"
    assert deck_count(db, "Trop tôt") == 0

    # Le client corrige, et rejoue avec une nouvelle clé et la même référence.
    fixed = sync_batch(
        api,
        op("deck.create", client_ref="ref-C", data={"name": "Corrigé"}),
        op("deck_card.upsert", **add),
    )
    assert [r["outcome"] for r in fixed["results"]] == ["applied", "applied"]
    # Deux créations au journal pour la même référence, une seule appliquée.
    creations = [e for e in journal(db) if e.client_ref == "ref-C"]
    assert [e.status for e in creations] == [
        SyncOperationStatus.REJECTED,
        SyncOperationStatus.APPLIED,
    ]


def test_an_applied_reference_is_never_reused(api, db, world):
    first = sync_batch(api, op("deck.create", client_ref="ref-D", data={"name": "Un"}))
    deck_id = first["results"][0]["resource"]["deck_id"]

    second = sync_batch(
        api, op("deck.create", client_ref="ref-D", data={"name": "Deux"})
    )["results"][0]
    assert second["outcome"] == "rejected"
    assert second["error"]["code"] == "conflict"
    assert str(deck_id) in second["error"]["message"]
    assert deck_count(db, "Deux") == 0


def test_a_taken_reference_refuses_the_creation_without_any_write(api, db, world):
    """Ni deck, ni exemplaire touché : seul le refus est journalisé."""
    sync_batch(api, op("deck.create", client_ref="ref-E", data={"name": "Premier"}))
    decks_before = db.scalar(select(func.count()).select_from(Deck))
    applied_before = [e for e in journal(db) if e.status is SyncOperationStatus.APPLIED]

    refused = sync_batch(
        api, op("deck.create", client_ref="ref-E", data={"name": "Second"})
    )["results"][0]
    assert refused["outcome"] == "rejected"
    assert refused["error"]["code"] == "conflict"
    assert refused["resource"] is None

    assert db.scalar(select(func.count()).select_from(Deck)) == decks_before
    entries = journal(db)
    assert [e for e in entries if e.status is SyncOperationStatus.APPLIED] == (
        applied_before
    )
    assert entries[-1].status is SyncOperationStatus.REJECTED
    assert entries[-1].deck_id is None
    # La référence désigne toujours le premier deck.
    followers = sync_batch(
        api, op("deck.update", deck={"client_ref": "ref-E"}, data={"notes": "ok"})
    )["results"][0]
    assert followers["outcome"] == "applied"
    assert deck_count(db, "Premier") == 1


# --------------------------------------------------------------------------
# Rejeu d'un `deck.create` : le client s'y appuie pour retrouver son deck
# --------------------------------------------------------------------------


def _create(name: str, ref: str) -> dict:
    return op("deck.create", client_ref=ref, data={"name": name})


def _assert_same_identity(replay: dict, original: dict) -> None:
    assert replay["outcome"] == "replayed"
    assert replay["client_ref"] == original["client_ref"]
    assert replay["resource"] == original["resource"]
    assert replay["resource"]["deck_id"] == original["resource"]["deck_id"]
    # Le verdict d'origine, tel quel, horodatage compris.
    assert replay | {"outcome": "applied"} == original


def test_a_replayed_deck_creation_returns_the_same_reference_and_deck(api, world):
    creation = _create("Rejoué", "ref-R1")
    original = sync_batch(api, creation)["results"][0]
    assert original["client_ref"] == "ref-R1"

    body = sync_batch(api, creation)
    assert (body["applied"], body["replayed"], body["rejected"]) == (0, 1, 0)
    _assert_same_identity(body["results"][0], original)


def test_a_deck_creation_replayed_in_another_batch_keeps_its_identity(
    api, db, world, spare
):
    creation = _create("Autre lot", "ref-R2")
    original = sync_batch(api, creation)["results"][0]
    decks_before = db.scalar(select(func.count()).select_from(Deck))

    # Le rejeu est mêlé à d'autres opérations, neuves, dans un lot différent.
    body = sync_batch(
        api,
        upsert_stock(spare.id, 2, card_set_id=spare.card_set_id),
        creation,
        op(
            "deck_card.upsert",
            deck={"client_ref": "ref-R2"},
            data={
                "card_id": spare.id,
                "language_code": "EN",
                "card_set_id": spare.card_set_id,
                "quantity": 1,
            },
        ),
    )
    assert [r["outcome"] for r in body["results"]] == [
        "applied",
        "replayed",
        "applied",
    ]
    _assert_same_identity(body["results"][1], original)
    assert body["results"][2]["resource"]["deck_id"] == original["resource"]["deck_id"]
    assert db.scalar(select(func.count()).select_from(Deck)) == decks_before


def test_a_replayed_creation_ignores_the_deck_being_renamed(api, db, world):
    creation = _create("Nom d'origine", "ref-R3")
    original = sync_batch(api, creation)["results"][0]
    deck_id = original["resource"]["deck_id"]

    renamed = api.patch(f"/decks/{deck_id}", json={"name": "Nom changé"})
    assert renamed.status_code == 200
    _assert_same_identity(sync_batch(api, creation)["results"][0], original)
    assert deck_count(db, "Nom d'origine") == 0
    assert deck_count(db, "Nom changé") == 1  # le rejeu n'a pas recréé l'ancien nom


def test_a_replayed_creation_ignores_the_deck_being_archived(api, world):
    creation = _create("Rangé", "ref-R4")
    original = sync_batch(api, creation)["results"][0]
    deck_id = original["resource"]["deck_id"]

    assert api.patch(f"/decks/{deck_id}", json={"archived": True}).status_code == 200
    _assert_same_identity(sync_batch(api, creation)["results"][0], original)
    # Le rejeu ne désarchive rien.
    assert api.get(f"/decks/{deck_id}").json()["archived_at"] is not None


def test_a_replayed_creation_ignores_the_deck_being_soft_deleted(api, db, world):
    creation = _create("Supprimé", "ref-R5")
    original = sync_batch(api, creation)["results"][0]
    deck_id = original["resource"]["deck_id"]

    assert api.patch(f"/decks/{deck_id}", json={"archived": True}).status_code == 200
    assert api.delete(f"/decks/{deck_id}").status_code == 204
    decks_before = db.scalar(select(func.count()).select_from(Deck))

    _assert_same_identity(sync_batch(api, creation)["results"][0], original)
    assert db.scalar(select(func.count()).select_from(Deck)) == decks_before
    assert api.get(f"/decks/{deck_id}").json()["deleted_at"] is not None


def test_a_reference_that_never_existed_is_unresolved(api, world):
    result = sync_batch(
        api, op("deck.delete", deck={"client_ref": "fantôme"})
    )["results"][0]
    assert result["outcome"] == "rejected"
    assert result["error"]["code"] == "unresolved_client_ref"
    assert "fantôme" in result["error"]["message"]


# --------------------------------------------------------------------------
# Les invariants font loi : refus des services, mêmes motifs qu'en ligne
# --------------------------------------------------------------------------


def test_not_found_covers_unknown_cards_decks_and_languages(api, world, spare):
    body = sync_batch(
        api,
        upsert_stock(999_999, 1),
        upsert_stock(spare.id, 1, language="ZZ"),
        op("deck.update", deck={"deck_id": 999_999}, data={"notes": "x"}),
        op("bundle.deposit", bundle_id=999_999, data={"language_code": "EN"}),
        op(
            "stock.delete",
            card_id=spare.id,
            language_code="ES",
            card_set_id=spare.card_set_id,
        ),
    )
    assert [r["error"]["code"] for r in body["results"]] == ["not_found"] * 5
    assert body["rejected"] == 5


def test_an_unknown_language_is_not_replaced_by_the_server(api, db, world, spare):
    """Le repli sur `XX` est l'affaire de la file cliente (document de contrat)."""
    result = sync_batch(api, upsert_stock(spare.id, 1, language="ZZ"))["results"][0]
    assert result["error"]["code"] == "not_found"
    assert "ZZ" in result["error"]["message"]
    assert owned(db, spare.id, "XX") is None


def test_deck_composition_rules_are_the_ones_of_the_service(api, world, spare):
    deck_id = sync_batch(
        api, op("deck.create", client_ref="r", data={"name": "Règles"})
    )["results"][0]["resource"]["deck_id"]

    def add(**data) -> dict:
        return op(
            "deck_card.upsert",
            deck={"deck_id": deck_id},
            data={
                "card_id": spare.id,
                "language_code": "EN",
                "card_set_id": spare.card_set_id,
            }
            | data,
        )

    body = sync_batch(
        api,
        add(quantity=4),  # 3 possédés
        add(quantity=2, proxy_quantity=1),  # proxy non autorisé
        op(  # carte absente de la collection dans cette langue
            "deck_card.upsert",
            deck={"deck_id": deck_id},
            data={
                "card_id": spare.id,
                "language_code": "FR",
                "card_set_id": spare.card_set_id,
                "quantity": 1,
            },
        ),
    )
    assert [r["error"]["code"] for r in body["results"]] == ["conflict"] * 3
    assert "insuffisants" in body["results"][0]["error"]["message"]
    assert "proxy" in body["results"][1]["error"]["message"]
    assert api.get(f"/decks/{deck_id}").json()["cards"] == []


def test_disabling_proxy_on_a_deck_that_plays_one_is_refused(api, world):
    """Refus déplacé sur le deck (Lot 4) : même motif qu'en ligne, par `/sync`."""
    body = sync_batch(
        api,
        op(
            "deck.update",
            deck={"deck_id": world.deck.id},
            data={"proxy_allowed": True},
        ),
        op(
            "deck_card.upsert",
            deck={"deck_id": world.deck.id},
            data={
                "card_id": world.card.id,
                "language_code": "FR",
                "card_set_id": world.printing.card_set_id,
                "quantity": 1,
                "proxy_quantity": 1,
            },
        ),
        op(
            "deck.update",
            deck={"deck_id": world.deck.id},
            data={"proxy_allowed": False},
        ),
    )
    allow, add_proxy_line, disallow = body["results"]
    assert allow["outcome"] == "applied"
    assert add_proxy_line["outcome"] == "applied"
    assert disallow["error"]["code"] == "conflict"
    assert "proxy" in disallow["error"]["message"]
    assert api.get(f"/decks/{world.deck.id}").json()["proxy_allowed"] is True


def test_activating_an_illegal_deck_is_refused(api, world):
    result = sync_batch(
        api,
        op("deck.update", deck={"deck_id": world.deck.id}, data={"status": "draft"}),
        op("deck.update", deck={"deck_id": world.deck.id}, data={"status": "active"}),
    )
    draft, activate = result["results"]
    assert draft["outcome"] == "applied"
    assert activate["error"]["code"] == "conflict"
    assert "illégal" in activate["error"]["message"]
    assert api.get(f"/decks/{world.deck.id}").json()["status"] == "draft"


def test_a_refused_creation_leaves_no_deck_behind(api, db, world):
    """Le deck est inséré puis la légalité refuse : tout doit être défait."""
    before = db.scalar(select(func.count()).select_from(Deck))
    sync_batch(
        api,
        op(
            "deck.create",
            client_ref="r",
            data={"name": "Fantôme", "status": "active"},
        ),
    )
    assert db.scalar(select(func.count()).select_from(Deck)) == before


def test_the_deck_lifecycle_goes_through_the_queue(api, db, world):
    deck = {"deck_id": world.deck.id}
    body = sync_batch(
        api,
        op("deck.delete", deck=deck),  # pas archivé : refusé
        op("deck.update", deck=deck, data={"archived": True}),
        op("deck.update", deck=deck, data={"notes": "rangé"}),  # archivé : refusé
        op("deck.delete", deck=deck),
        op(  # supprimé : plus rien ne s'écrit
            "deck_card.upsert",
            deck=deck,
            data={
                "card_id": world.card.id,
                "language_code": "EN",
                "card_set_id": world.printing.card_set_id,
                "quantity": 1,
            },
        ),
    )
    assert [r["outcome"] for r in body["results"]] == [
        "rejected",
        "applied",
        "rejected",
        "applied",
        "rejected",
    ]
    assert "archivé" in body["results"][2]["error"]["message"]
    assert "supprimé" in body["results"][4]["error"]["message"]
    assert api.get(f"/decks/{world.deck.id}").json()["deleted_at"] is not None
    # Le deck supprimé a rendu ses exemplaires : le stock n'est plus retenu.
    assert (
        stock.allocated_real(db, world.card.id, "EN", world.printing.card_set_id) == 0
    )


def test_a_bundle_deposit_goes_through_the_queue_and_respects_the_ceiling(
    api, db, world
):
    deposit = {"language_code": "en", "count": 3}
    result = sync_batch(
        api, op("bundle.deposit", bundle_id=world.bundle.id, data=deposit)
    )["results"][0]
    assert result["resource"]["kind"] == "bundle"
    assert result["resource"]["bundle_id"] == world.bundle.id
    assert result["resource"]["language_code"] == "EN"
    assert owned(db, world.card.id) == 4 + 2 * 3

    huge = op(
        "bundle.deposit",
        bundle_id=world.bundle.id,
        data={"language_code": "EN", "count": 2**31 - 1},
    )
    refused = sync_batch(api, huge)["results"][0]
    assert refused["error"]["code"] == "conflict"
    assert owned(db, world.card.id) == 4 + 2 * 3  # rien d'écrit


# --------------------------------------------------------------------------
# Atomicité
# --------------------------------------------------------------------------


def _valid_request(*operations: dict) -> SyncRequest:
    return SyncRequest.model_validate({"operations": list(operations)})


def test_an_unexpected_error_cancels_the_whole_batch_and_its_journal(
    db_engine, db, world, spare, monkeypatch
):
    """Pas un verdict : rien n'est journalisé, tout est défait, le lot se rejoue."""
    real = stock.deposit_bundle

    def deposit_then_crash(session, bundle_id, payload):
        real(session, bundle_id, payload)  # écrit, puis…
        raise RuntimeError("panne")

    monkeypatch.setattr(stock, "deposit_bundle", deposit_then_crash)
    request = _valid_request(
        upsert_stock(spare.id, 9, card_set_id=spare.card_set_id),
        op(
            "bundle.deposit",
            bundle_id=world.bundle.id,
            data={"language_code": "FR"},
        ),
    )
    with pytest.raises(RuntimeError):
        sync.apply_batch(db_engine, request)

    assert owned(db, spare.id) == 3
    assert owned(db, world.card.id, "FR") == 0
    assert journal(db) == []

    # Le même lot, renvoyé une fois la panne passée, s'applique entièrement.
    monkeypatch.setattr(stock, "deposit_bundle", real)
    result = sync.apply_batch(db_engine, request)
    assert (result.applied, result.replayed, result.rejected) == (2, 0, 0)
    assert owned(db, spare.id) == 9
    assert owned(db, world.card.id, "FR") == 2


def test_every_operation_of_a_batch_is_journaled_exactly_once(api, db, world, spare):
    operations = [
        upsert_stock(spare.id, 5, card_set_id=spare.card_set_id),
        upsert_stock(
            world.card.id, 1, card_set_id=world.printing.card_set_id
        ),  # refusé
        op("deck.create", client_ref="r", data={"name": "Journal"}),
        op("deck.delete", deck={"client_ref": "inconnue"}),  # irrésolu
    ]
    sync_batch(api, *operations)
    sync_batch(api, *operations)  # rejeu complet

    entries = journal(db)
    assert [e.operation_id for e in entries] == [o["operation_id"] for o in operations]
    assert [e.status.value for e in entries] == [
        "applied",
        "rejected",
        "applied",
        "rejected",
    ]


def test_the_journal_error_columns_match_the_verdict(api, db, world):
    sync_batch(
        api, upsert_stock(world.card.id, 1, card_set_id=world.printing.card_set_id)
    )
    [entry] = journal(db)
    assert entry.error_code.value == "conflict"
    assert entry.error_message
    assert entry.deck_id is None and entry.card_id is None


def test_a_service_invalid_request_is_mapped_to_invalid():
    """Le motif `invalid` reprend `InvalidRequestError` (jamais levé par un upsert
    complet, qui envoie les deux quantités : la table de correspondance suffit)."""
    assert sync._error_code(InvalidRequestError("x")).value == "invalid"


def test_no_operation_leaves_a_deck_card_without_its_stock(api, db, world, spare):
    """Filet global : quoi qu'on file, la comptabilité du stock tient."""
    deck_ids = [
        sync_batch(api, op("deck.create", client_ref=f"r{n}", data={"name": f"D{n}"}))[
            "results"
        ][0]["resource"]["deck_id"]
        for n in range(4)
    ]
    sync_batch(
        api,
        *(
            op(
                "deck_card.upsert",
                deck={"deck_id": deck_id},
                data={
                    "card_id": spare.id,
                    "language_code": "EN",
                    "card_set_id": spare.card_set_id,
                    "quantity": 1,
                },
            )
            for deck_id in deck_ids
        ),
    )
    lines = db.scalar(
        select(func.count()).select_from(DeckCard).where(DeckCard.card_id == spare.id)
    )
    assert lines == 3  # 3 exemplaires possédés : le 4e deck est refusé
    assert stock.allocated_real(db, spare.id, "EN", spare.card_set_id) == 3
