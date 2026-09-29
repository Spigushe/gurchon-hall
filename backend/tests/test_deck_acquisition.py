"""Acquisition depuis un deck (Lot 4b) : `acquired_quantity`.

Brief : `docs/lot4b-acquisition-depuis-deck.md`. Deux usages :

* monter un deck déjà construit à la main — la ligne fait entrer ses
  exemplaires en collection (entrée créée ou incrémentée) ;
* remplacer un proxy par une vraie carte — `proxy_quantity` baisse de `n`,
  `acquired_quantity` vaut `n`, l'entrée de collection gagne `n` exemplaires.

Chaque règle a son test : cas nominal, bornes (422), plafond (409), refus
hérités (deck archivé ou supprimé, proxy, langue, impression), atomicité (stock
et ligne ensemble ou rien), rejeu par `/sync`.
"""

import json
from hashlib import sha256
from uuid import uuid4

import pytest
from sqlalchemy import select, text

from app.models import CardCategory, CardCopy, DeckCard
from app.schemas.base import MAX_DB_INT
from app.schemas.sync import SyncRequest, fingerprint
from tests.helpers import add_languages, make_card, make_copy, make_deck, make_printing

RECORDED_AT = "2026-09-25T20:00:00+02:00"


# --------------------------------------------------------------------------
# Outils
# --------------------------------------------------------------------------


@pytest.fixture
def card(db):
    """Une carte de library imprimée dans une extension, sans entrée de stock.

    `card_set_id` est posé en attribut dynamique, comme dans les autres suites.
    """
    add_languages(db, "EN", "FR")
    card = make_card(db, "Govern the Unaligned", CardCategory.LIBRARY)
    card.card_set_id = make_printing(db, card).card_set_id
    db.commit()
    return card


def owned(db, card, language="EN") -> int | None:
    db.expire_all()
    return db.scalar(
        select(CardCopy.quantity_owned).where(
            CardCopy.card_id == card.id,
            CardCopy.language_code == language,
            CardCopy.card_set_id == card.card_set_id,
        )
    )


def line_of(db, deck_id, card, language="EN") -> DeckCard | None:
    db.expire_all()
    return db.get(DeckCard, (deck_id, card.id, language, card.card_set_id))


def body(card, quantity, proxy=0, acquired=None, language="EN", **extra) -> dict:
    payload = {
        "card_id": card.id,
        "language_code": language,
        "card_set_id": card.card_set_id,
        "quantity": quantity,
        "proxy_quantity": proxy,
    } | extra
    if acquired is not None:
        payload["acquired_quantity"] = acquired
    return payload


def url(deck_id, card, language="EN") -> str:
    return f"/decks/{deck_id}/cartes/{card.id}/{language}/{card.card_set_id}"


def op(type_: str, **fields) -> dict:
    return {
        "type": type_,
        "operation_id": str(uuid4()),
        "recorded_at": RECORDED_AT,
    } | fields


def sync_batch(api, *operations: dict) -> dict:
    response = api.post("/sync", json={"operations": list(operations)})
    assert response.status_code == 200, response.text
    return response.json()


def outcomes(result: dict) -> list[tuple[str, str | None]]:
    return [
        (r["outcome"], r["error"]["code"] if r["error"] else None)
        for r in result["results"]
    ]


# --------------------------------------------------------------------------
# Montage d'un deck déjà construit : POST /decks/{id}/cartes
# --------------------------------------------------------------------------


def test_acquiring_creates_the_missing_stock_entry(api, db, card):
    deck = make_deck(db)
    db.commit()

    response = api.post(f"/decks/{deck.id}/cartes", json=body(card, 3, acquired=3))

    assert response.status_code == 201, response.text
    assert response.json()["quantity"] == 3
    assert owned(db, card) == 3
    stock = api.get(f"/stock/{card.id}/EN/{card.card_set_id}").json()
    assert stock["quantity_owned"] == 3
    assert stock["notes"] is None


def test_acquiring_increments_an_existing_entry(api, db, card):
    """Deux exemplaires possédés, tous pris par un autre deck : on en acquiert 3."""
    make_copy(db, card, quantity_owned=2, card_set_id=card.card_set_id)
    other = make_deck(db, "Autre")
    db.add(
        DeckCard(
            deck_id=other.id,
            card_id=card.id,
            language_code="EN",
            card_set_id=card.card_set_id,
            quantity=2,
            proxy_quantity=0,
        )
    )
    deck = make_deck(db)
    db.commit()

    response = api.post(f"/decks/{deck.id}/cartes", json=body(card, 3, acquired=3))

    assert response.status_code == 201, response.text
    assert owned(db, card) == 5


def test_acquisition_completes_the_free_stock(api, db, card):
    """Un exemplaire libre en collection, deux acquis : la ligne en consomme trois."""
    make_copy(db, card, quantity_owned=1, card_set_id=card.card_set_id)
    deck = make_deck(db)
    db.commit()

    response = api.post(f"/decks/{deck.id}/cartes", json=body(card, 3, acquired=2))

    assert response.status_code == 201, response.text
    assert owned(db, card) == 3


def test_acquisition_with_proxies_on_a_deck_that_allows_them(api, db, card):
    deck = make_deck(db, proxy_allowed=True)
    db.commit()

    response = api.post(
        f"/decks/{deck.id}/cartes", json=body(card, 4, proxy=1, acquired=3)
    )

    assert response.status_code == 201, response.text
    assert owned(db, card) == 3
    assert line_of(db, deck.id, card).proxy_quantity == 1


def test_without_acquisition_the_card_must_already_be_in_collection(api, db, card):
    """Décision §11.2 assouplie, pas abolie : sans acquisition, toujours 409."""
    deck = make_deck(db)
    db.commit()

    response = api.post(f"/decks/{deck.id}/cartes", json=body(card, 1))

    assert response.status_code == 409
    assert "acquired_quantity" in response.json()["detail"]
    assert owned(db, card) is None


def test_explicit_zero_acquisition_behaves_like_its_absence(api, db, card):
    deck = make_deck(db)
    db.commit()

    response = api.post(f"/decks/{deck.id}/cartes", json=body(card, 1, acquired=0))

    assert response.status_code == 409
    assert owned(db, card) is None


def test_insufficient_copies_despite_acquisition_writes_nothing(api, db, card):
    """Atomicité : le refus d'allocation ne laisse ni entrée ni incrément."""
    deck = make_deck(db)
    db.commit()

    response = api.post(f"/decks/{deck.id}/cartes", json=body(card, 3, acquired=2))

    assert response.status_code == 409
    assert "insuffisants" in response.json()["detail"]
    assert owned(db, card) is None
    assert line_of(db, deck.id, card) is None


@pytest.mark.parametrize(
    ("quantity", "proxy", "acquired"),
    [(2, 0, 3), (4, 2, 3), (1, 1, 1)],
    ids=["more-than-quantity", "more-than-real", "all-proxies"],
)
def test_acquiring_more_than_the_line_consumes_is_invalid(
    api, db, card, quantity, proxy, acquired
):
    deck = make_deck(db, proxy_allowed=True)
    db.commit()

    response = api.post(
        f"/decks/{deck.id}/cartes",
        json=body(card, quantity, proxy=proxy, acquired=acquired),
    )

    assert response.status_code == 422
    assert owned(db, card) is None


@pytest.mark.parametrize("value", [-1, MAX_DB_INT + 1, None, 1.5])
def test_acquired_quantity_bounds(api, db, card, value):
    deck = make_deck(db)
    db.commit()
    payload = body(card, 3) | {"acquired_quantity": value}

    assert api.post(f"/decks/{deck.id}/cartes", json=payload).status_code == 422


def test_acquisition_ceiling_is_a_conflict(api, db, card):
    make_copy(db, card, quantity_owned=MAX_DB_INT, card_set_id=card.card_set_id)
    deck = make_deck(db)
    db.commit()

    response = api.post(f"/decks/{deck.id}/cartes", json=body(card, 1, acquired=1))

    assert response.status_code == 409
    assert "plafond" in response.json()["detail"]
    assert owned(db, card) == MAX_DB_INT


def test_acquisition_needs_a_known_language(api, db, card):
    deck = make_deck(db)
    db.commit()

    response = api.post(
        f"/decks/{deck.id}/cartes", json=body(card, 1, acquired=1, language="DE")
    )

    assert response.status_code == 404
    assert owned(db, card, "DE") is None


def test_acquisition_needs_a_real_printing(api, db, card):
    other_set = make_printing(db, make_card(db, "Autre carte")).card_set_id
    deck = make_deck(db)
    db.commit()

    payload = body(card, 1, acquired=1) | {"card_set_id": other_set}
    response = api.post(f"/decks/{deck.id}/cartes", json=payload)

    assert response.status_code == 404
    assert db.scalar(select(CardCopy).where(CardCopy.card_id == card.id)) is None


def test_acquisition_of_an_unknown_card_is_not_found(api, db, card):
    deck = make_deck(db)
    db.commit()

    payload = body(card, 1, acquired=1) | {"card_id": 999_999}
    assert api.post(f"/decks/{deck.id}/cartes", json=payload).status_code == 404


def test_acquisition_needs_a_deck_that_allows_the_proxies_it_plays(api, db, card):
    deck = make_deck(db, proxy_allowed=False)
    db.commit()

    response = api.post(
        f"/decks/{deck.id}/cartes", json=body(card, 3, proxy=1, acquired=2)
    )

    assert response.status_code == 409
    assert owned(db, card) is None


def test_acquisition_into_an_archived_deck_is_refused(api, db, card):
    deck = make_deck(db)
    db.commit()
    api.patch(f"/decks/{deck.id}", json={"archived": True})

    response = api.post(f"/decks/{deck.id}/cartes", json=body(card, 1, acquired=1))

    assert response.status_code == 409
    assert owned(db, card) is None


def test_acquisition_into_a_deleted_or_unknown_deck_is_refused(api, db, card):
    deck = make_deck(db)
    db.commit()
    api.patch(f"/decks/{deck.id}", json={"archived": True})
    assert api.delete(f"/decks/{deck.id}").status_code == 204

    deleted = api.post(f"/decks/{deck.id}/cartes", json=body(card, 1, acquired=1))
    unknown = api.post("/decks/999999/cartes", json=body(card, 1, acquired=1))

    assert deleted.status_code == 409
    assert unknown.status_code == 404
    assert owned(db, card) is None


def test_acquisition_on_a_line_already_in_the_deck_is_refused(api, db, card):
    deck = make_deck(db)
    db.commit()
    first = api.post(f"/decks/{deck.id}/cartes", json=body(card, 1, acquired=1))
    assert first.status_code == 201

    response = api.post(f"/decks/{deck.id}/cartes", json=body(card, 1, acquired=1))

    assert response.status_code == 409
    assert "déjà dans le deck" in response.json()["detail"]
    assert owned(db, card) == 1


def test_database_refusal_rolls_back_the_acquisition_too(api, db, card):
    """Atomicité réelle : la base refuse la ligne, l'entrée créée disparaît avec.

    Un déclencheur fait échouer l'insertion dans `deck_card` au moment du
    commit, après l'ajout de l'entrée de collection dans la même transaction.
    """
    deck = make_deck(db)
    db.commit()
    db.execute(
        text(
            "CREATE TRIGGER refuse_deck_card BEFORE INSERT ON deck_card "
            "BEGIN SELECT RAISE(ABORT, 'refus de test'); END"
        )
    )
    db.commit()

    response = api.post(f"/decks/{deck.id}/cartes", json=body(card, 2, acquired=2))

    assert response.status_code == 409
    assert owned(db, card) is None


def test_acquired_copies_stay_in_collection_after_the_deck_is_deleted(api, db, card):
    """`deleted_deck_card` n'est pas concerné : l'acquisition est définitive."""
    deck = make_deck(db)
    db.commit()
    api.post(f"/decks/{deck.id}/cartes", json=body(card, 2, acquired=2))
    api.patch(f"/decks/{deck.id}", json={"archived": True})

    assert api.delete(f"/decks/{deck.id}").status_code == 204
    assert owned(db, card) == 2
    assert api.get(f"/decks/{deck.id}").json()["cards"][0]["quantity"] == 2


# --------------------------------------------------------------------------
# Un proxy devient une vraie carte : PATCH /decks/{id}/cartes/...
# --------------------------------------------------------------------------


@pytest.fixture
def proxied(api, db, card):
    """Un deck qui joue la carte en trois proxies ; entrée de stock à 0."""
    make_copy(db, card, quantity_owned=0, card_set_id=card.card_set_id)
    deck = make_deck(db, proxy_allowed=True)
    db.commit()
    response = api.post(f"/decks/{deck.id}/cartes", json=body(card, 3, proxy=3))
    assert response.status_code == 201, response.text
    return deck


def test_converting_proxies_adds_real_copies(api, db, card, proxied):
    response = api.patch(
        url(proxied.id, card), json={"proxy_quantity": 1, "acquired_quantity": 2}
    )

    assert response.status_code == 200, response.text
    assert (response.json()["quantity"], response.json()["proxy_quantity"]) == (3, 1)
    assert owned(db, card) == 2


def test_replaying_a_conversion_never_counts_twice(api, db, card, proxied):
    payload = {"proxy_quantity": 1, "acquired_quantity": 2}
    assert api.patch(url(proxied.id, card), json=payload).status_code == 200

    replay = api.patch(url(proxied.id, card), json=payload)

    assert replay.status_code == 422
    assert owned(db, card) == 2


def test_acquiring_without_lowering_proxies_is_invalid(api, db, card, proxied):
    response = api.patch(url(proxied.id, card), json={"acquired_quantity": 1})

    assert response.status_code == 422
    assert response.json()["detail"][0]["loc"] == ["body", "acquired_quantity"]
    assert owned(db, card) == 0


def test_converting_more_than_the_proxies_removed_is_invalid(api, db, card, proxied):
    response = api.patch(
        url(proxied.id, card), json={"proxy_quantity": 2, "acquired_quantity": 2}
    )

    assert response.status_code == 422
    assert owned(db, card) == 0
    assert line_of(db, proxied.id, card).proxy_quantity == 3


def test_partial_conversion_may_draw_on_free_stock(api, db, card, proxied):
    """Deux proxies retirés : un exemplaire acquis, l'autre pris au stock libre."""
    db.get(CardCopy, (card.id, "EN", card.card_set_id)).quantity_owned = 1
    db.commit()

    response = api.patch(
        url(proxied.id, card), json={"proxy_quantity": 1, "acquired_quantity": 1}
    )

    assert response.status_code == 200, response.text
    assert owned(db, card) == 2


def test_conversion_short_of_copies_writes_nothing(api, db, card, proxied):
    response = api.patch(
        url(proxied.id, card), json={"proxy_quantity": 0, "acquired_quantity": 2}
    )

    assert response.status_code == 409
    assert owned(db, card) == 0
    assert line_of(db, proxied.id, card).proxy_quantity == 3


def test_buying_more_copies_for_a_line(api, db, card):
    deck = make_deck(db)
    db.commit()
    api.post(f"/decks/{deck.id}/cartes", json=body(card, 2, acquired=2))

    response = api.patch(
        url(deck.id, card), json={"quantity": 4, "acquired_quantity": 2}
    )

    assert response.status_code == 200, response.text
    assert owned(db, card) == 4


def test_conversion_on_an_archived_deck_is_refused(api, db, card, proxied):
    api.patch(f"/decks/{proxied.id}", json={"archived": True})

    response = api.patch(
        url(proxied.id, card), json={"proxy_quantity": 1, "acquired_quantity": 2}
    )

    assert response.status_code == 409
    assert owned(db, card) == 0


def test_conversion_ceiling_is_a_conflict(api, db, card, proxied):
    db.get(CardCopy, (card.id, "EN", card.card_set_id)).quantity_owned = MAX_DB_INT
    db.commit()

    response = api.patch(
        url(proxied.id, card), json={"proxy_quantity": 2, "acquired_quantity": 1}
    )

    assert response.status_code == 409
    assert owned(db, card) == MAX_DB_INT


def test_full_conversion_lets_the_deck_drop_proxies(api, db, card, proxied):
    api.patch(url(proxied.id, card), json={"proxy_quantity": 0, "acquired_quantity": 3})

    response = api.patch(f"/decks/{proxied.id}", json={"proxy_allowed": False})

    assert response.status_code == 200
    assert owned(db, card) == 3


# --------------------------------------------------------------------------
# /sync : deck_card.upsert porte l'acquisition
# --------------------------------------------------------------------------


def upsert_line(ref: dict, card, quantity, proxy=0, acquired=None, **envelope):
    return op(
        "deck_card.upsert",
        deck=ref,
        data=body(card, quantity, proxy=proxy, acquired=acquired),
        **envelope,
    )


def test_sync_builds_an_already_mounted_deck(api, db, card):
    """Création d'un deck et de sa composition hors ligne, dans le même lot."""
    ref = str(uuid4())
    result = sync_batch(
        api,
        op("deck.create", client_ref=ref, data={"name": "Déjà monté"}),
        upsert_line({"client_ref": ref}, card, 4, acquired=4),
    )

    assert outcomes(result) == [("applied", None), ("applied", None)]
    assert result["results"][1]["resource"]["kind"] == "deck_card"
    assert owned(db, card) == 4


def test_sync_replay_of_an_acquisition_is_not_reapplied(api, db, card):
    deck = make_deck(db)
    db.commit()
    operation = upsert_line({"deck_id": deck.id}, card, 2, acquired=2)

    first = sync_batch(api, operation)
    again = sync_batch(api, operation)

    assert outcomes(first) == [("applied", None)]
    assert outcomes(again) == [("replayed", None)]
    assert owned(db, card) == 2


def test_sync_duplicate_acquisition_under_a_new_key_is_invalid(api, db, card):
    """La même saisie mise deux fois en file : la borne refuse le doublon."""
    deck = make_deck(db)
    db.commit()
    sync_batch(api, upsert_line({"deck_id": deck.id}, card, 2, acquired=2))

    duplicate = sync_batch(api, upsert_line({"deck_id": deck.id}, card, 2, acquired=2))

    assert outcomes(duplicate) == [("rejected", "invalid")]
    assert owned(db, card) == 2


def test_sync_converts_proxies_on_an_existing_line(api, db, card, proxied):
    result = sync_batch(
        api, upsert_line({"deck_id": proxied.id}, card, 3, proxy=0, acquired=3)
    )

    assert outcomes(result) == [("applied", None)]
    assert owned(db, card) == 3
    assert line_of(db, proxied.id, card).proxy_quantity == 0


def test_sync_refusal_keeps_stock_intact_and_the_batch_goes_on(api, db, card):
    other = make_card(db, "Deflection", CardCategory.LIBRARY)
    other.card_set_id = make_printing(db, other).card_set_id
    deck = make_deck(db)
    db.commit()

    result = sync_batch(
        api,
        upsert_line({"deck_id": deck.id}, card, 3, acquired=2),  # 1 manquant
        upsert_line({"deck_id": deck.id}, other, 1, acquired=1),
    )

    assert outcomes(result) == [("rejected", "conflict"), ("applied", None)]
    assert owned(db, card) is None
    assert owned(db, other) == 1


def test_sync_database_refusal_rolls_back_the_acquisition(api, db, card):
    deck = make_deck(db)
    db.commit()
    db.execute(
        text(
            "CREATE TRIGGER refuse_deck_card BEFORE INSERT ON deck_card "
            "BEGIN SELECT RAISE(ABORT, 'refus de test'); END"
        )
    )
    db.commit()

    result = sync_batch(api, upsert_line({"deck_id": deck.id}, card, 2, acquired=2))

    assert outcomes(result) == [("rejected", "conflict")]
    assert owned(db, card) is None


@pytest.mark.parametrize(
    ("setup", "language", "expected"),
    [
        ("ceiling", "EN", "conflict"),
        ("archived", "EN", "conflict"),
        (None, "DE", "not_found"),
    ],
)
def test_sync_refuses_like_the_online_route(api, db, card, setup, language, expected):
    deck = make_deck(db)
    if setup == "ceiling":
        make_copy(db, card, quantity_owned=MAX_DB_INT, card_set_id=card.card_set_id)
    db.commit()
    if setup == "archived":
        api.patch(f"/decks/{deck.id}", json={"archived": True})

    operation = op(
        "deck_card.upsert",
        deck={"deck_id": deck.id},
        data=body(card, 1, acquired=1, language=language),
    )
    result = sync_batch(api, operation)

    assert outcomes(result) == [("rejected", expected)]


def test_fingerprint_of_an_operation_without_acquisition_is_unchanged(card):
    """Une opération mise en file avant le Lot 4b garde son empreinte.

    `fingerprint` n'hache que les champs fournis : le nouveau champ, absent,
    n'entre pas dans le calcul, et le rejeu d'une vieille opération reste un
    `replayed`, pas un `mismatched_replay`.
    """
    raw = op("deck_card.upsert", deck={"deck_id": 1}, data=body(card, 2))
    [operation] = SyncRequest.model_validate({"operations": [raw]}).operations

    legacy = json.dumps(
        {**raw, "recorded_at": "2026-09-25T18:00:00Z"},
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    )
    assert fingerprint(operation) == sha256(legacy.encode("utf-8")).hexdigest()


def test_sync_mounts_a_legal_deck_from_scratch_then_activates_it(api, db, card):
    """Le cas d'usage complet : un deck monté avant l'application, saisi d'un coup.

    Aucun stock au départ. Le deck naît en brouillon (un deck neuf est vide,
    donc illégal), reçoit sa composition avec ses exemplaires, puis s'active.
    """
    crypt = make_card(db, "Vampire sans groupe", CardCategory.CRYPT)
    crypt.card_set_id = make_printing(db, crypt).card_set_id
    db.commit()
    ref = str(uuid4())

    result = sync_batch(
        api,
        op("deck.create", client_ref=ref, data={"name": "Monté en 2019"}),
        upsert_line({"client_ref": ref}, crypt, 12, acquired=12),
        upsert_line({"client_ref": ref}, card, 60, acquired=60),
        op("deck.update", deck={"client_ref": ref}, data={"status": "active"}),
    )

    assert [o for o, _ in outcomes(result)] == ["applied"] * 4
    assert (owned(db, crypt), owned(db, card)) == (12, 60)
