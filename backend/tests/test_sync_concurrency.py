"""`POST /sync` sous concurrence réelle : le verrou d'écriture tient-il ?

Ce qui est en jeu, c'est la limite connue n° 1 du §11 : la comptabilité du stock
est un « vérifier puis écrire », donc deux écritures simultanées pouvaient
chacune trouver assez d'exemplaires et, ensemble, en allouer trop. Ces tests
lancent de **vrais fils d'exécution** contre une **vraie base SQLite** (fichier),
sans simulation de la concurrence.

Comme la course est rare à l'état naturel, on **agrandit sa fenêtre** : le
contrôle de disponibilité est enveloppé d'une courte pause, après qu'il a rendu
son verdict et avant l'écriture. Sans verrou, tous les fils passent le contrôle
avant qu'aucun n'écrive ; avec lui, ils se font la queue. (Vérifié à la main :
avec un `BEGIN` différé à la place de `BEGIN IMMEDIATE` dans `app.db.locking`,
les trois tests de course échouent, à chaque essai.)
"""

import threading
import time
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, func, select, text
from sqlalchemy.orm import Session

from app.db.locking import WriteLockTimeout, serialized_writes
from app.db.session import get_session
from app.main import app
from app.models import CardCategory, CardCopy, DeckCard
from app.schemas.collection import CardCopyCreate
from app.services import decks, stock
from tests.helpers import make_card, make_copy, make_deck

RECORDED_AT = "2026-09-20T20:00:00+02:00"
RACE_WINDOW = 0.05  # secondes entre le contrôle et l'écriture


def op(type_: str, **fields) -> dict:
    return {
        "type": type_,
        "operation_id": str(uuid4()),
        "recorded_at": RECORDED_AT,
    } | fields


def widen_the_race(monkeypatch) -> None:
    """Pause après le contrôle de disponibilité, avant l'écriture de la ligne."""
    check = decks._check_allocation

    def slow_check(*args, **kwargs):
        check(*args, **kwargs)
        time.sleep(RACE_WINDOW)

    monkeypatch.setattr(decks, "_check_allocation", slow_check)


def run_concurrently(calls):
    """Lance tous les appels d'un coup (barrière) et rend leurs résultats."""
    barrier = threading.Barrier(len(calls))

    def run(call):
        barrier.wait()
        return call()

    with ThreadPoolExecutor(max_workers=len(calls)) as pool:
        return [future.result() for future in [pool.submit(run, c) for c in calls]]


# --------------------------------------------------------------------------
# Le cœur : la comptabilité du stock ne se sur-alloue plus
# --------------------------------------------------------------------------


def test_concurrent_batches_cannot_oversubscribe_a_stock_entry(
    api, db, world, monkeypatch
):
    """Trois exemplaires, six decks qui en veulent un chacun, au même instant."""
    card = make_card(db, "Rare Copy", CardCategory.LIBRARY)
    make_copy(db, card, "EN", quantity_owned=3)
    deck_ids = [make_deck(db, f"Course {n}").id for n in range(6)]
    db.commit()
    # Les identifiants sont lus ici : les fils ne doivent pas rafraîchir, en
    # même temps, des objets de la session du test (elle n'est pas partagée).
    card_id = card.id
    widen_the_race(monkeypatch)

    def send(deck_id):
        return lambda: api.post(
            "/sync",
            json={
                "operations": [
                    op(
                        "deck_card.upsert",
                        deck={"deck_id": deck_id},
                        data={
                            "card_id": card_id,
                            "language_code": "EN",
                            "quantity": 1,
                        },
                    )
                ]
            },
        )

    responses = run_concurrently([send(deck_id) for deck_id in deck_ids])

    assert [r.status_code for r in responses] == [200] * 6
    results = [r.json()["results"][0] for r in responses]
    applied = [r for r in results if r["outcome"] == "applied"]
    refused = [r for r in results if r["outcome"] == "rejected"]
    assert len(applied) == 3
    assert len(refused) == 3
    assert {r["error"]["code"] for r in refused} == {"conflict"}
    assert all("insuffisants" in r["error"]["message"] for r in refused)

    db.expire_all()
    assert stock.allocated_real(db, card_id, "EN") == 3  # jamais 4, 5 ou 6
    assert db.scalar(select(func.count()).select_from(DeckCard)) == 3 + 1  # + `world`


def test_concurrent_replays_of_one_batch_apply_it_once(api, db, world):
    """Le rejeu qui double l'original (réseau lent, client impatient)."""
    deposit = op(
        "bundle.deposit",
        bundle_id=world.bundle.id,
        data={"language_code": "FR", "count": 1},
    )
    body = {"operations": [deposit]}

    responses = run_concurrently([lambda: api.post("/sync", json=body)] * 5)

    assert [r.status_code for r in responses] == [200] * 5
    outcomes = sorted(r.json()["results"][0]["outcome"] for r in responses)
    assert outcomes == ["applied"] + ["replayed"] * 4
    db.expire_all()
    # 0 possédé au départ, 2 exemplaires dans le produit : versé une seule fois.
    assert (
        db.scalar(
            select(CardCopy.quantity_owned).where(
                CardCopy.card_id == world.card.id, CardCopy.language_code == "FR"
            )
        )
        == 2
    )


def test_concurrent_lowering_of_the_stock_cannot_undercut_an_allocation(
    api, db, world, monkeypatch
):
    """L'autre sens de la course : baisser le stock pendant qu'on l'alloue."""
    card = make_card(db, "Contested", CardCategory.LIBRARY)
    make_copy(db, card, "EN", quantity_owned=3)
    deck = make_deck(db, "Preneur")
    db.commit()
    widen_the_race(monkeypatch)

    take = op(
        "deck_card.upsert",
        deck={"deck_id": deck.id},
        data={"card_id": card.id, "language_code": "EN", "quantity": 3},
    )
    lower = op(
        "stock.upsert",
        data={"card_id": card.id, "language_code": "EN", "quantity_owned": 1},
    )
    responses = run_concurrently(
        [
            lambda: api.post("/sync", json={"operations": [take]}),
            lambda: api.post("/sync", json={"operations": [lower]}),
        ]
    )
    assert [r.status_code for r in responses] == [200, 200]
    # Exactement un des deux passe : ils se contredisent (3 alloués ≠ 1 possédé).
    outcomes = sorted(r.json()["results"][0]["outcome"] for r in responses)
    assert outcomes == ["applied", "rejected"]

    db.expire_all()
    owned = db.scalar(
        select(CardCopy.quantity_owned).where(CardCopy.card_id == card.id)
    )
    # Selon l'ordre d'arrivée, l'un des deux est refusé : jamais les deux appliqués.
    assert stock.allocated_real(db, card.id, "EN") <= owned


# --------------------------------------------------------------------------
# Le verrou lui-même
# --------------------------------------------------------------------------


def test_the_lock_survives_the_commits_of_the_services(db_engine, db, world):
    """Un `commit()` de service ne relâche que son point de sauvegarde.

    Sur une session ordinaire il libérerait le verrou ; c'est ce qui
    empêcherait de tenir un lot d'un bout à l'autre.
    """
    card = make_card(db, "Locked", CardCategory.LIBRARY)
    db.commit()
    impatient = create_engine(db_engine.url, connect_args={"timeout": 0.2})

    with serialized_writes(db_engine) as session:
        stock.create_copy(
            session,
            CardCopyCreate(card_id=card.id, language_code="EN", quantity_owned=1),
        )  # commit() du service, à l'intérieur du bloc
        with pytest.raises(WriteLockTimeout):
            with serialized_writes(impatient):
                pytest.fail("le verrou aurait dû être tenu")

    # Le bloc est sorti : le verrou est rendu, et l'écriture est bien validée.
    with serialized_writes(impatient) as session:
        assert (
            session.scalar(
                select(func.count())
                .select_from(CardCopy)
                .where(CardCopy.card_id == card.id)
            )
            == 1
        )
    impatient.dispose()


def test_an_exception_in_the_block_undoes_everything_and_releases_the_lock(
    db_engine, db, world
):
    card = make_card(db, "Undone", CardCategory.LIBRARY)
    db.commit()

    with pytest.raises(RuntimeError):
        with serialized_writes(db_engine) as session:
            stock.create_copy(
                session,
                CardCopyCreate(card_id=card.id, language_code="EN", quantity_owned=1),
            )
            raise RuntimeError("boum")

    assert (
        db.scalar(
            select(func.count())
            .select_from(CardCopy)
            .where(CardCopy.card_id == card.id)
        )
        == 0
    )
    with serialized_writes(db_engine):  # verrou rendu
        pass


def test_a_service_rollback_only_undoes_its_own_operation(db_engine, db, world):
    """Le `rollback()` d'un service revient à son point de sauvegarde, pas plus loin."""
    kept = make_card(db, "Kept", CardCategory.LIBRARY)
    db.commit()

    with serialized_writes(db_engine) as session:
        stock.create_copy(
            session, CardCopyCreate(card_id=kept.id, language_code="EN")
        )
        session.add(CardCopy(card_id=kept.id, language_code="FR", quantity_owned=1))
        session.rollback()  # ce que fait un service qui refuse

    languages = list(
        db.scalars(select(CardCopy.language_code).where(CardCopy.card_id == kept.id))
    )
    assert languages == ["EN"]


def test_readers_are_not_blocked_while_a_batch_holds_the_lock(db_engine, db, world):
    """`BEGIN IMMEDIATE` ne prend que le droit d'écrire : on peut lire en parallèle."""
    impatient = create_engine(db_engine.url, connect_args={"timeout": 0.2})
    with serialized_writes(db_engine):
        with Session(impatient) as reader:
            assert reader.execute(text("SELECT count(*) FROM card")).scalar() >= 1
    impatient.dispose()


# --------------------------------------------------------------------------
# Verrou non obtenu
# --------------------------------------------------------------------------


def test_a_batch_that_cannot_get_the_lock_answers_503_and_writes_nothing(
    db_engine, db, world
):
    """Hors contrat 200 : ce n'est pas un verdict sur le lot, il se renvoie tel quel."""
    impatient = create_engine(db_engine.url, connect_args={"timeout": 0.2})

    def session_on_impatient():
        with Session(impatient, autoflush=False, expire_on_commit=False) as session:
            yield session

    app.dependency_overrides[get_session] = session_on_impatient
    batch = {
        "operations": [
            op(
                "stock.upsert",
                data={
                    "card_id": world.card.id,
                    "language_code": "EN",
                    "quantity_owned": 9,
                },
            )
        ]
    }
    try:
        with TestClient(app) as client:
            with serialized_writes(db_engine):  # une autre écriture est en cours
                blocked = client.post("/sync", json=batch)
            assert blocked.status_code == 503
            assert blocked.headers["retry-after"] == "1"
            db.expire_all()
            assert db.scalar(
                select(CardCopy.quantity_owned).where(
                    CardCopy.card_id == world.card.id, CardCopy.language_code == "EN"
                )
            ) == 4

            # Le verrou est rendu : le même lot, clé comprise, passe.
            retried = client.post("/sync", json=batch)
            assert retried.status_code == 200
            assert retried.json()["results"][0]["outcome"] == "applied"
    finally:
        app.dependency_overrides.clear()
        impatient.dispose()
