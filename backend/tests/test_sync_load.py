"""Un lot de 200 opérations : ce qu'il coûte, et combien de temps il tient le verrou.

**Ce sont des mesures, pas des seuils.** Le contrat plafonne un lot à 200
opérations (`MAX_SYNC_OPERATIONS`) et fait attendre les autres écritures pendant
qu'il tient le verrou d'écriture (`app.db.locking`, `BEGIN IMMEDIATE`, délai
d'attente du pilote : 5 s). Aucun test ici ne compare un temps à un seuil : la
machine, le disque et la charge en font varier la valeur, et un seuil fragile
ferait échouer la suite pour de mauvaises raisons. Les tests vérifient que le lot
**aboutit correctement** à pleine taille, et affichent les durées relevées
(`pytest -s` ou, sans `-s`, la ligne « MESURE » de chaque test) pour que le
rapport de QA puisse les citer.

Le verrou est tenu du `BEGIN IMMEDIATE` au `COMMIT` : la durée relevée est celle
du bloc `serialized_writes`, journal et validation compris.
"""

import threading
import time
from contextlib import contextmanager
from uuid import uuid4

import pytest

from app.models import CardCategory
from app.schemas.sync import MAX_SYNC_OPERATIONS
from app.services import sync
from tests.helpers import add_languages, make_card, make_copy

RECORDED_AT = "2026-09-20T20:00:00+02:00"


def op(type_: str, **fields) -> dict:
    return {
        "type": type_,
        "operation_id": str(uuid4()),
        "recorded_at": RECORDED_AT,
    } | fields


@pytest.fixture
def lock_timings(monkeypatch, capsys):
    """Relève, pour chaque lot, l'attente du verrou puis sa durée de tenue."""
    timings: list[dict] = []
    real = sync.serialized_writes

    @contextmanager
    def timed(engine):
        asked = time.perf_counter()
        record: dict[str, float] = {}
        try:
            with real(engine) as session:
                acquired = time.perf_counter()
                record["waited"] = acquired - asked
                yield session
            # Sorti du bloc : le COMMIT est fait, le verrou rendu.
            record["held"] = time.perf_counter() - acquired
        finally:
            if "held" in record:
                timings.append(record)

    monkeypatch.setattr(sync, "serialized_writes", timed)
    return timings


def report(capsys, label: str, **values: float | int) -> None:
    """Affiche une ligne de mesure même sans `-s`."""
    text = ", ".join(
        f"{key}={value * 1000:.0f} ms" if isinstance(value, float) else f"{key}={value}"
        for key, value in values.items()
    )
    with capsys.disabled():
        print(f"\nMESURE {label} : {text}")


@pytest.fixture
def library_cards(db):
    """Deux cents cartes de library possédées en 100 exemplaires EN chacune.

    `card_set_id` posé comme attribut dynamique sur chaque carte (Lot 4) : un
    raccourci pour ce fichier, qui n'a besoin que d'une impression par carte.
    """
    add_languages(db, "EN", "FR")
    cards = [
        make_card(db, f"Carte de charge {index:03d}", CardCategory.LIBRARY)
        for index in range(MAX_SYNC_OPERATIONS)
    ]
    for card in cards:
        card.card_set_id = make_copy(db, card, "EN", quantity_owned=100).card_set_id
    db.commit()
    return cards


def stock_batch(cards) -> list[dict]:
    """Deux cents écritures de collection : le lot le plus large, sans contrôle."""
    return [
        op(
            "stock.upsert",
            data={
                "card_id": card.id,
                "language_code": "EN",
                "card_set_id": card.card_set_id,
                "quantity_owned": 7,
            },
        )
        for card in cards
    ]


def deck_batch(cards) -> list[dict]:
    """Quarante decks de quatre cartes : 40 créations et 160 lignes.

    Chaque ligne est contrôlée contre l'allocation du stock : le lot le plus
    coûteux par opération.
    """
    operations: list[dict] = []
    for deck_index in range(40):
        ref = f"charge-{deck_index}"
        name = f"Deck de charge {deck_index}"
        operations.append(op("deck.create", client_ref=ref, data={"name": name}))
        for offset in range(4):
            card = cards[(deck_index * 4 + offset) % len(cards)]
            operations.append(
                op(
                    "deck_card.upsert",
                    deck={"client_ref": ref},
                    data={
                        "card_id": card.id,
                        "language_code": "EN",
                        "card_set_id": card.card_set_id,
                        "quantity": 2,
                    },
                )
            )
    assert len(operations) == MAX_SYNC_OPERATIONS
    return operations


@pytest.mark.parametrize("kind", ["stock", "decks"])
def test_a_full_batch_of_200_operations_applies_then_replays(
    api, library_cards, lock_timings, capsys, kind
):
    operations = (stock_batch if kind == "stock" else deck_batch)(library_cards)

    started = time.perf_counter()
    first = api.post("/sync", json={"operations": operations})
    first_total = time.perf_counter() - started
    assert first.status_code == 200, first.text
    body = first.json()
    assert len(body["results"]) == MAX_SYNC_OPERATIONS
    assert body["applied"] == MAX_SYNC_OPERATIONS
    assert body["rejected"] == 0

    # Le même lot, mêmes clés : rien n'est refait, tout revient rejoué.
    started = time.perf_counter()
    second = api.post("/sync", json={"operations": operations})
    second_total = time.perf_counter() - started
    assert second.status_code == 200
    assert second.json()["replayed"] == MAX_SYNC_OPERATIONS
    assert second.json()["applied"] == 0

    assert len(lock_timings) == 2
    report(
        capsys,
        f"lot de 200 ({kind})",
        applique_total=first_total,
        verrou_tenu_applique=lock_timings[0]["held"],
        par_operation=lock_timings[0]["held"] / MAX_SYNC_OPERATIONS,
        rejoue_total=second_total,
        verrou_tenu_rejoue=lock_timings[1]["held"],
    )
    if kind == "decks":
        assert len(api.get("/decks").json()) == 40  # 40 decks, pas 80


def test_two_full_batches_queue_behind_the_lock(
    api, library_cards, lock_timings, capsys
):
    """Deux lots de 200 arrivent ensemble : le second attend le premier.

    Aucun seuil : selon la machine, l'attente du second peut même dépasser les
    5 s du pilote, auquel cas il reçoit le 503 du contrat et n'a rien appliqué —
    ce que le test accepte, tout en vérifiant la cohérence de l'état obtenu.
    """
    first_batch = stock_batch(library_cards)
    second_batch = [
        op(
            "stock.upsert",
            data={
                "card_id": card.id,
                "language_code": "EN",
                "card_set_id": card.card_set_id,
                "quantity_owned": 9,
            },
        )
        for card in library_cards
    ]
    barrier = threading.Barrier(2)
    responses: list = [None, None]

    def send(index: int, operations: list[dict]) -> None:
        barrier.wait()
        responses[index] = api.post("/sync", json={"operations": operations})

    threads = [
        threading.Thread(target=send, args=(0, first_batch)),
        threading.Thread(target=send, args=(1, second_batch)),
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    statuses = [response.status_code for response in responses]
    assert set(statuses) <= {200, 503}
    assert 200 in statuses
    served = [r for r in responses if r.status_code == 200]
    assert all(r.json()["applied"] == MAX_SYNC_OPERATIONS for r in served)

    # Les deux lots portent sur les mêmes cartes : l'état final est celui du
    # DERNIER lot appliqué, jamais un mélange des deux.
    entries = api.get("/stock?limit=200").json()
    quantities = {entry["quantity_owned"] for entry in entries}
    assert len(quantities) == 1
    assert quantities <= {7, 9}

    assert len(lock_timings) >= 1
    report(
        capsys,
        "deux lots de 200 simultanés",
        statuts=str(statuses),
        attente_du_verrou_max=max(t["waited"] for t in lock_timings),
        verrou_tenu_max=max(t["held"] for t in lock_timings),
        lots_entres=len(lock_timings),
    )
