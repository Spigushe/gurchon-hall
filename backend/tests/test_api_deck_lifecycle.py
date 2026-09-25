"""API `/decks` : discriminant, archivage par PATCH, suppression logique, listes.

Le discriminant est tiré au hasard : les tests injectent la fonction de tirage
(`app.services.decks.pick_discriminator`) pour exercer le retry et la
saturation sans dépendre du hasard.
"""

import re

import pytest
from sqlalchemy import insert, select
from sqlalchemy.orm import Session

from app.models import (
    CardCategory,
    CardCopy,
    Deck,
    DeckCard,
    DeletedDeckCard,
    Participation,
)
from app.services import decks, stock
from tests.helpers import add_languages, make_card, make_copy, make_deck

LINE = {"card_id": 1, "language_code": "EN", "card_set_id": 1, "quantity": 1}


def card_set_id_of(db, card_id, language="EN") -> int:
    """Cf. `test_api_decks.py` : même repli sur n'importe quelle impression
    connue de la carte, puis sur `1` si la carte est inconnue de la collection."""
    exact = db.scalars(
        select(CardCopy.card_set_id).where(
            CardCopy.card_id == card_id, CardCopy.language_code == language
        )
    ).first()
    if exact is not None:
        return exact
    any_printing = db.scalars(
        select(CardCopy.card_set_id).where(CardCopy.card_id == card_id)
    ).first()
    return any_printing if any_printing is not None else 1


def line_url(db, deck_id, card_id, language="EN") -> str:
    card_set_id = card_set_id_of(db, card_id, language)
    return f"/decks/{deck_id}/cartes/{card_id}/{language}/{card_set_id}"


def add_line(api, db, deck_id, card_id, language="EN", quantity=1, proxy=0):
    return api.post(
        f"/decks/{deck_id}/cartes",
        json={
            "card_id": card_id,
            "language_code": language,
            "card_set_id": card_set_id_of(db, card_id, language),
            "quantity": quantity,
            "proxy_quantity": proxy,
        },
    )


def archive(api, deck_id):
    return api.patch(f"/decks/{deck_id}", json={"archived": True})


def unarchive(api, deck_id, **fields):
    return api.patch(f"/decks/{deck_id}", json={"archived": False, **fields})


def delete_from_archive(api, deck_id):
    assert archive(api, deck_id).status_code == 200
    response = api.delete(f"/decks/{deck_id}")
    assert response.status_code == 204
    return response


def sequence(monkeypatch, *values):
    """Fait tirer ces discriminants, dans l'ordre, sans regarder les pris.

    Renvoie la liste des tirages demandés (pour compter les essais).
    """
    calls = []
    remaining = list(values)

    def fake(taken):
        calls.append(set(taken))
        return remaining.pop(0) if len(remaining) > 1 else remaining[0]

    monkeypatch.setattr("app.services.decks.pick_discriminator", fake)
    return calls


# --- Discriminant : tirage ---------------------------------------------------


def test_discriminator_is_four_digits_and_never_zero(api):
    for index in range(30):
        body = api.post("/decks", json={"name": f"Deck {index}"}).json()
        assert re.fullmatch(r"\d{4}", body["discriminator"])
        assert body["discriminator"] != "0000"


def test_two_decks_may_share_a_name_and_get_different_discriminators(api):
    first = api.post("/decks", json={"name": "Malkavien 2022"})
    second = api.post("/decks", json={"name": "Malkavien 2022"})

    assert (first.status_code, second.status_code) == (201, 201)
    assert first.json()["id"] != second.json()["id"]
    assert first.json()["discriminator"] != second.json()["discriminator"]
    listed = api.get("/decks").json()
    assert [d["name"] for d in listed] == ["Malkavien 2022"] * 2


def test_the_client_cannot_choose_the_discriminator(api):
    response = api.post("/decks", json={"name": "x", "discriminator": "0001"})

    assert response.status_code == 422


def test_pick_avoids_the_taken_values():
    everything = {f"{n:04d}" for n in range(1, 10_000)}

    assert decks.pick_discriminator(everything - {"4242"}) == "4242"
    assert decks.pick_discriminator(set()) != "0000"


def test_the_draw_avoids_the_discriminators_of_the_same_name(api, db, monkeypatch):
    make_deck(db, "Malkavien", discriminator="0001")
    make_deck(db, "Autre", discriminator="0002")
    db.commit()
    seen = []
    real = decks.pick_discriminator

    def spy(taken):
        seen.append(set(taken))
        return real(taken)

    monkeypatch.setattr("app.services.decks.pick_discriminator", spy)

    created = api.post("/decks", json={"name": "Malkavien"}).json()

    assert seen == [{"0001"}]  # ceux de « Malkavien » seulement
    assert created["discriminator"] != "0001"


def test_the_draw_avoids_a_deleted_deck_too(api, world, db):
    delete_from_archive(api, world.deck.id)
    db.expire_all()

    taken = decks._taken_discriminators(db, "Ventrue Grinder")

    assert taken == {world.deck.discriminator}


# --- Discriminant : retry et saturation --------------------------------------


def test_creation_retries_when_the_database_refuses_the_couple(
    api, db, monkeypatch
):
    make_deck(db, "Malkavien", discriminator="0042")
    db.commit()
    # Course simulée : les deux premiers tirages retombent sur le couple pris.
    calls = sequence(monkeypatch, "0042", "0042", "0043")

    response = api.post("/decks", json={"name": "Malkavien"})

    assert response.status_code == 201
    assert response.json()["discriminator"] == "0043"
    assert len(calls) == 3
    assert len(api.get("/decks").json()) == 2


def test_creation_gives_up_after_the_attempt_limit(api, db, monkeypatch):
    make_deck(db, "Malkavien", discriminator="0042")
    db.commit()
    calls = sequence(monkeypatch, "0042")

    response = api.post("/decks", json={"name": "Malkavien"})

    assert response.status_code == 409
    assert str(decks.DISCRIMINATOR_ATTEMPTS) in response.json()["detail"]
    assert len(calls) == decks.DISCRIMINATOR_ATTEMPTS
    assert len(api.get("/decks").json()) == 1  # rien n'est resté


def test_a_name_with_every_discriminator_taken_is_a_409(api, db):
    db.execute(
        insert(Deck),
        [
            {"name": "Saturé", "discriminator": f"{n:04d}"}
            for n in range(1, 10_000)
        ],
    )
    db.commit()

    response = api.post("/decks", json={"name": "Saturé"})

    assert response.status_code == 409
    assert "9999" in response.json()["detail"]
    # Un autre nom n'est pas concerné.
    assert api.post("/decks", json={"name": "Libre"}).status_code == 201


def test_a_saturated_name_is_also_refused_on_rename(api, db):
    db.execute(
        insert(Deck),
        [
            {"name": "Saturé", "discriminator": f"{n:04d}"}
            for n in range(1, 10_000)
        ],
    )
    other = make_deck(db, "Autre")
    db.commit()

    response = api.patch(f"/decks/{other.id}", json={"name": "Saturé"})

    assert response.status_code == 409
    assert api.get(f"/decks/{other.id}").json()["name"] == "Autre"


# --- Discriminant : renommage ------------------------------------------------


def test_renaming_keeps_the_discriminator(api, db):
    deck = make_deck(db, "Alpha", discriminator="0123")
    db.commit()

    body = api.patch(f"/decks/{deck.id}", json={"name": "Beta"}).json()

    assert (body["name"], body["discriminator"]) == ("Beta", "0123")


def test_renaming_to_a_name_already_in_use_is_allowed(api, db):
    make_deck(db, "Alpha", discriminator="0001")
    deck = make_deck(db, "Beta", discriminator="0002")
    db.commit()

    response = api.patch(f"/decks/{deck.id}", json={"name": "Alpha"})

    assert response.status_code == 200
    assert response.json()["discriminator"] == "0002"


def test_renaming_onto_a_taken_couple_draws_a_new_discriminator(api, db):
    make_deck(db, "Alpha", discriminator="0001")
    deck = make_deck(db, "Beta", discriminator="0001")
    db.commit()

    response = api.patch(f"/decks/{deck.id}", json={"name": "Alpha"})

    assert response.status_code == 200
    body = response.json()
    assert body["name"] == "Alpha"
    assert body["discriminator"] != "0001"


def test_renaming_onto_a_taken_couple_of_a_deleted_deck_draws_a_new_one(
    api, world, db
):
    delete_from_archive(api, world.deck.id)
    deck = make_deck(db, "Beta", discriminator=world.deck.discriminator)
    db.commit()

    body = api.patch(f"/decks/{deck.id}", json={"name": "Ventrue Grinder"}).json()

    assert body["discriminator"] != world.deck.discriminator


def test_patching_the_same_name_changes_nothing(api, db):
    deck = make_deck(db, "Alpha", discriminator="0123")
    db.commit()

    body = api.patch(f"/decks/{deck.id}", json={"name": "Alpha"}).json()

    assert body["discriminator"] == "0123"


def test_updating_other_fields_keeps_the_discriminator(api, db):
    deck = make_deck(db, "Alpha", discriminator="0123")
    db.commit()

    body = api.patch(f"/decks/{deck.id}", json={"notes": "x"}).json()

    assert (body["notes"], body["discriminator"]) == ("x", "0123")


def test_rename_retries_when_the_database_refuses_the_kept_couple(
    api, db, monkeypatch
):
    make_deck(db, "Alpha", discriminator="0001")
    deck = make_deck(db, "Beta", discriminator="0001")
    db.commit()
    # Course simulée : le service croit le couple (Alpha, 0001) libre.
    monkeypatch.setattr(
        "app.services.decks._taken_discriminators", lambda *a, **k: set()
    )
    calls = sequence(monkeypatch, "0007")

    response = api.patch(
        f"/decks/{deck.id}", json={"name": "Alpha", "notes": "gardée"}
    )

    assert response.status_code == 200
    body = response.json()
    # Le renommage et les autres champs sont bien rejoués après le rollback.
    assert (body["name"], body["discriminator"], body["notes"]) == (
        "Alpha",
        "0007",
        "gardée",
    )
    assert len(calls) == 1


# --- Autorisation de proxy (Lot 4 : propriété du deck) ----------------------


def test_deck_is_created_with_proxy_forbidden_by_default(api):
    response = api.post("/decks", json={"name": "Sans proxy"})
    assert response.status_code == 201
    assert response.json()["proxy_allowed"] is False


def test_a_deck_can_be_created_with_proxy_allowed(api):
    response = api.post(
        "/decks", json={"name": "Avec proxy", "proxy_allowed": True}
    )
    assert response.status_code == 201
    assert response.json()["proxy_allowed"] is True


def test_disabling_proxy_is_refused_while_a_line_plays_one(api, world):
    api.patch(f"/decks/{world.deck.id}", json={"proxy_allowed": True})
    added = api.post(
        f"/decks/{world.deck.id}/cartes",
        json={
            "card_id": world.card.id,
            "language_code": "FR",
            "card_set_id": world.printing.card_set_id,
            "quantity": 1,
            "proxy_quantity": 1,
        },
    )
    assert added.status_code == 201

    response = api.patch(f"/decks/{world.deck.id}", json={"proxy_allowed": False})

    assert response.status_code == 409
    assert "proxy" in response.json()["detail"]
    # Rien n'a changé : le deck autorise toujours le proxy.
    assert api.get(f"/decks/{world.deck.id}").json()["proxy_allowed"] is True


def test_disabling_proxy_succeeds_once_no_line_uses_it(api, db, world):
    card_set_id = world.printing.card_set_id
    api.patch(f"/decks/{world.deck.id}", json={"proxy_allowed": True})
    added = api.post(
        f"/decks/{world.deck.id}/cartes",
        json={
            "card_id": world.card.id,
            "language_code": "FR",
            "card_set_id": card_set_id,
            "quantity": 1,
            "proxy_quantity": 1,
        },
    )
    assert added.status_code == 201
    removed_url = f"/decks/{world.deck.id}/cartes/{world.card.id}/FR/{card_set_id}"
    removed = api.delete(removed_url)
    assert removed.status_code == 204

    response = api.patch(f"/decks/{world.deck.id}", json={"proxy_allowed": False})

    assert response.status_code == 200
    assert response.json()["proxy_allowed"] is False


def test_stock_no_longer_accepts_proxy_allowed(api, world):
    """Lot 4 : le champ a quitté l'entrée de collection pour le deck."""
    url = f"/stock/{world.card.id}/EN/{world.printing.card_set_id}"
    response = api.patch(url, json={"proxy_allowed": True})
    assert response.status_code == 422


# --- Archivage par PATCH -----------------------------------------------------


def test_archive_by_patch_hides_the_deck_from_the_default_list(api, world):
    response = archive(api, world.deck.id)

    assert response.status_code == 200
    assert response.json()["archived_at"] is not None
    assert api.get("/decks").json() == []
    archived = api.get("/decks", params={"state": "archived"}).json()
    assert [d["name"] for d in archived] == ["Ventrue Grinder"]


def test_archiving_twice_is_idempotent_and_keeps_the_first_date(api, world):
    first = archive(api, world.deck.id)
    second = archive(api, world.deck.id)

    assert (first.status_code, second.status_code) == (200, 200)
    assert second.json()["archived_at"] == first.json()["archived_at"]
    assert second.json()["updated_at"] == first.json()["updated_at"]


def test_unarchiving_clears_the_date_and_restores_the_deck(api, world):
    archive(api, world.deck.id)

    response = unarchive(api, world.deck.id)

    assert response.status_code == 200
    body = response.json()
    assert body["archived_at"] is None
    assert body["status"] == "active"  # le statut n'a jamais bougé
    assert [d["name"] for d in api.get("/decks").json()] == ["Ventrue Grinder"]
    assert len(api.get(f"/decks/{world.deck.id}").json()["cards"]) == 1


def test_unarchiving_a_deck_that_is_not_archived_is_a_no_op(api, world):
    response = unarchive(api, world.deck.id)

    assert response.status_code == 200
    assert response.json()["archived_at"] is None


def test_archived_cannot_be_null(api, world):
    response = api.patch(f"/decks/{world.deck.id}", json={"archived": None})

    assert response.status_code == 422


def test_archiving_can_come_with_other_changes_on_a_live_deck(api, world):
    response = api.patch(
        f"/decks/{world.deck.id}", json={"archived": True, "notes": "rangé"}
    )

    assert response.status_code == 200
    body = response.json()
    assert (body["notes"], body["archived_at"] is not None) == ("rangé", True)


def test_an_archived_deck_refuses_any_other_change(api, world):
    archive(api, world.deck.id)
    url = f"/decks/{world.deck.id}"

    for payload in (
        {"name": "Autre"},
        {"notes": "x"},
        {"status": "draft"},
        {"archetype": None},
        {"archived": True, "notes": "x"},
    ):
        response = api.patch(url, json=payload)
        assert response.status_code == 409, payload
        assert "archivé" in response.json()["detail"]
    assert api.get(url).json()["name"] == "Ventrue Grinder"


def test_an_empty_patch_on_an_archived_deck_changes_nothing(api, world):
    archived = archive(api, world.deck.id).json()

    response = api.patch(f"/decks/{world.deck.id}", json={})

    assert response.status_code == 200
    assert response.json()["archived_at"] == archived["archived_at"]


def test_unarchiving_then_applying_other_fields_in_one_request(api, world):
    archive(api, world.deck.id)

    response = unarchive(api, world.deck.id, notes="réveillé", name="Renommé")

    assert response.status_code == 200
    body = response.json()
    assert body["archived_at"] is None
    assert (body["notes"], body["name"]) == ("réveillé", "Renommé")


def test_a_refused_activation_leaves_the_deck_archived(api, db):
    deck = make_deck(db)  # vide, donc illégal
    db.commit()
    archive(api, deck.id)

    response = unarchive(api, deck.id, status="active")

    assert response.status_code == 409
    assert "illégal" in response.json()["detail"]
    body = api.get(f"/decks/{deck.id}").json()
    assert (body["status"], body["archived_at"] is not None) == ("draft", True)


def test_composition_of_an_archived_deck_is_refused(api, db, world):
    archive(api, world.deck.id)
    url = f"/decks/{world.deck.id}"
    line = line_url(db, world.deck.id, world.card.id)

    assert add_line(api, db, world.deck.id, world.card.id, "FR").status_code == 409
    assert api.patch(line, json={"quantity": 1}).status_code == 409
    assert api.delete(line).status_code == 409
    assert len(api.get(url).json()["cards"]) == 1


def test_an_archived_deck_stays_readable(api, world):
    archive(api, world.deck.id)

    assert api.get(f"/decks/{world.deck.id}").status_code == 200
    assert api.get(f"/decks/{world.deck.id}/legalite").status_code == 200


def test_an_archived_deck_still_holds_its_copies(api, world):
    archive(api, world.deck.id)

    url = f"/stock/{world.card.id}/EN/{world.printing.card_set_id}"
    lowered = api.patch(url, json={"quantity_owned": 3})
    removed = api.delete(url)

    assert lowered.status_code == 409
    assert removed.status_code == 409
    assert "archivés" in removed.json()["detail"]


def test_the_old_archive_routes_are_gone(api, world):
    for action in ("archiver", "restaurer"):
        response = api.post(f"/decks/{world.deck.id}/{action}")
        assert response.status_code in (404, 405)


# --- Suppression logique -----------------------------------------------------


def test_delete_requires_the_deck_to_be_archived(api, world):
    response = api.delete(f"/decks/{world.deck.id}")

    assert response.status_code == 409
    assert "archiver" in response.json()["detail"]
    assert api.get(f"/decks/{world.deck.id}").json()["deleted_at"] is None


def test_delete_freezes_the_decklist_and_drops_the_live_lines(api, world, db):
    # Deux lignes : EN (4, aucun proxy) et FR (2, tous en proxy).
    api.patch(f"/decks/{world.deck.id}", json={"proxy_allowed": True})
    added = add_line(api, db, world.deck.id, world.card.id, "FR", 2, 2)
    assert added.status_code == 201

    delete_from_archive(api, world.deck.id)

    db.expire_all()
    frozen = db.scalars(
        select(DeletedDeckCard)
        .where(DeletedDeckCard.deck_id == world.deck.id)
        .order_by(DeletedDeckCard.language_code)
    ).all()
    assert [
        (f.card_id, f.language_code, f.quantity, f.proxy_quantity) for f in frozen
    ] == [(world.card.id, "EN", 4, 0), (world.card.id, "FR", 2, 2)]
    live = db.scalars(select(DeckCard).where(DeckCard.deck_id == world.deck.id))
    assert live.all() == []
    deck = db.get(Deck, world.deck.id)
    assert deck is not None and deck.deleted_at is not None


def test_delete_is_a_single_transaction(api, world, db, monkeypatch):
    archive(api, world.deck.id)

    def failing_commit(self):
        raise RuntimeError("panne au commit")

    monkeypatch.setattr(Session, "commit", failing_commit)
    with pytest.raises(RuntimeError):
        api.delete(f"/decks/{world.deck.id}")
    monkeypatch.undo()

    # Ni figée à moitié, ni à moitié supprimée : rien n'a été écrit.
    db.expire_all()
    assert db.get(Deck, world.deck.id).deleted_at is None
    key = (world.deck.id, world.card.id, "EN", world.printing.card_set_id)
    assert db.get(DeckCard, key) is not None
    frozen = db.scalars(select(DeletedDeckCard)).all()
    assert frozen == []


def test_delete_keeps_the_deck_row_and_its_participations(api, world, db):
    delete_from_archive(api, world.deck.id)

    db.expire_all()
    assert db.get(Participation, world.mine.id).deck_id == world.deck.id


def test_a_deck_without_cards_can_be_deleted(api, db):
    deck = make_deck(db)
    db.commit()

    delete_from_archive(api, deck.id)

    body = api.get(f"/decks/{deck.id}").json()
    assert body["deleted_at"] is not None and body["cards"] == []


def test_delete_returns_the_stock_including_proxies(api, world, db):
    api.patch(f"/decks/{world.deck.id}", json={"proxy_allowed": True})
    added = add_line(api, db, world.deck.id, world.card.id, "FR", 1, 1)
    assert added.status_code == 201
    blocked = api.patch(f"/decks/{world.deck.id}", json={"proxy_allowed": False})
    assert blocked.status_code == 409

    delete_from_archive(api, world.deck.id)

    # L'exemplaire réel (EN) et le proxy (FR) redeviennent disponibles : la
    # decklist figée ne référence plus `card_copy` (§6).
    card_set_id = world.printing.card_set_id
    response = api.patch(
        f"/stock/{world.card.id}/EN/{card_set_id}", json={"quantity_owned": 0}
    )
    assert response.status_code == 200
    db.expire_all()
    assert stock.allocated_real(db, world.card.id, "FR", card_set_id) == 0
    assert stock.proxies_allocated(db, world.card.id, "FR", card_set_id) == 0


def test_the_copies_of_a_deleted_deck_are_available_to_another_deck(api, world, db):
    other = make_deck(db, "Autre")
    db.commit()
    assert add_line(api, db, other.id, world.card.id, quantity=1).status_code == 409

    delete_from_archive(api, world.deck.id)

    assert add_line(api, db, other.id, world.card.id, quantity=4).status_code == 201


def test_a_stock_entry_used_by_a_deleted_deck_can_be_removed(api, world):
    delete_from_archive(api, world.deck.id)

    url = f"/stock/{world.card.id}/EN/{world.printing.card_set_id}"
    assert api.delete(url).status_code == 204
    assert api.get(url).status_code == 404
    # La decklist figée, elle, n'a pas bougé.
    cards = api.get(f"/decks/{world.deck.id}").json()["cards"]
    assert [(c["language_code"], c["quantity"]) for c in cards] == [("EN", 4)]


def test_a_stock_entry_used_by_a_live_deck_still_cannot_be_removed(api, world):
    url = f"/stock/{world.card.id}/EN/{world.printing.card_set_id}"
    response = api.delete(url)

    assert response.status_code == 409
    assert "ligne(s) de deck" in response.json()["detail"]


# --- Deck supprimé : lecture seule par identifiant ---------------------------


def test_a_deleted_deck_is_readable_by_id_with_its_frozen_decklist(api, db, world):
    api.patch(f"/decks/{world.deck.id}", json={"proxy_allowed": True})
    added = add_line(api, db, world.deck.id, world.card.id, "FR", 1, 1)
    assert added.status_code == 201
    before = api.get(f"/decks/{world.deck.id}").json()
    delete_from_archive(api, world.deck.id)

    response = api.get(f"/decks/{world.deck.id}")

    assert response.status_code == 200
    after = response.json()
    assert after["deleted_at"] is not None
    assert after["cards"] == before["cards"]  # même forme, même tri, mêmes cartes
    assert [c["language_code"] for c in after["cards"]] == ["EN", "FR"]
    assert after["cards"][0]["card"]["name"] == "Aabbt Kindred"
    assert (after["name"], after["discriminator"]) == (
        before["name"],
        before["discriminator"],
    )


def test_a_deleted_deck_lists_crypt_first_then_by_name_then_by_language(api, db):
    add_languages(db, "EN", "FR")
    bruno = make_card(db, "Bruno")
    alice = make_card(db, "Alice")
    library = make_card(db, "Aardvark", category=CardCategory.LIBRARY)
    for card in (bruno, alice, library):
        make_copy(db, card, quantity_owned=2)
    make_copy(db, alice, "FR", quantity_owned=1)
    deck = make_deck(db)
    db.commit()
    for card, language in (
        (library, "EN"),
        (bruno, "EN"),
        (alice, "FR"),
        (alice, "EN"),
    ):
        assert add_line(api, db, deck.id, card.id, language).status_code == 201
    delete_from_archive(api, deck.id)

    body = api.get(f"/decks/{deck.id}").json()

    assert [(c["card"]["name"], c["language_code"]) for c in body["cards"]] == [
        ("Alice", "EN"),
        ("Alice", "FR"),
        ("Bruno", "EN"),
        ("Aardvark", "EN"),
    ]
    assert body["cards"][0]["card"]["category"] == "crypt"


def test_a_deleted_deck_is_in_no_list(api, world, db):
    make_deck(db, "Vivant", status="active")
    archived = make_deck(db, "Rangé")
    db.commit()
    archive(api, archived.id)
    delete_from_archive(api, world.deck.id)

    for state in ("active", "archived", "all"):
        names = [d["name"] for d in api.get("/decks", params={"state": state}).json()]
        assert "Ventrue Grinder" not in names, state
    assert [d["name"] for d in api.get("/decks").json()] == ["Vivant"]
    assert listed(api, state="all", q="Ventrue") == []
    assert listed(api, state="all", status="active") == ["Vivant"]


def test_a_deleted_deck_refuses_every_write_with_a_clear_409(api, db, world):
    delete_from_archive(api, world.deck.id)
    url = f"/decks/{world.deck.id}"
    line = line_url(db, world.deck.id, world.card.id)

    responses = {
        "patch": api.patch(url, json={"notes": "x"}),
        "unarchive": api.patch(url, json={"archived": False}),
        "archive": api.patch(url, json={"archived": True}),
        "delete": api.delete(url),
        "add": add_line(api, db, world.deck.id, world.card.id, "FR"),
        "patch line": api.patch(line, json={"quantity": 1}),
        "delete line": api.delete(line),
    }

    for label, response in responses.items():
        assert response.status_code == 409, label
        assert "supprimé" in response.json()["detail"], label
    body = api.get(url).json()
    assert body["deleted_at"] is not None and body["notes"] is None
    assert len(body["cards"]) == 1


def test_the_legality_of_a_deleted_deck_is_a_409(api, world):
    delete_from_archive(api, world.deck.id)

    response = api.get(f"/decks/{world.deck.id}/legalite")

    assert response.status_code == 409
    assert "supprimé" in response.json()["detail"]


def test_an_unknown_deck_stays_404_everywhere(api, world):
    for method, url, body in (
        ("get", "/decks/9999", None),
        ("get", "/decks/9999/legalite", None),
        ("patch", "/decks/9999", {"archived": False}),
        ("delete", "/decks/9999", None),
        ("post", "/decks/9999/cartes", LINE),
        ("patch", "/decks/9999/cartes/1/EN/1", {"quantity": 1}),
        ("delete", "/decks/9999/cartes/1/EN/1", None),
    ):
        kwargs = {"json": body} if body else {}
        assert getattr(api, method)(url, **kwargs).status_code == 404, url


def test_a_deleted_deck_keeps_its_name_and_discriminator_reserved(
    api, world, db, monkeypatch
):
    delete_from_archive(api, world.deck.id)
    db.expire_all()
    reserved = world.deck.discriminator
    # Le tirage voit le discriminant du deck supprimé parmi les pris ; un tirage
    # qui l'ignorerait retomberait dessus et se ferait refuser par la base.
    free = "0998" if reserved == "0999" else "0999"
    calls = sequence(monkeypatch, free)

    created = api.post("/decks", json={"name": "Ventrue Grinder"})

    assert created.status_code == 201
    assert reserved in calls[0]
    assert created.json()["discriminator"] == free
    assert created.json()["discriminator"] != reserved


# --- Liste : state -----------------------------------------------------------


@pytest.fixture
def three_decks(api, db):
    """Un deck actif, un archivé, un supprimé — dans cet ordre de noms."""
    live = make_deck(db, "A vivant", status="active")
    archived = make_deck(db, "B rangé")
    deleted = make_deck(db, "C supprimé")
    db.commit()
    archive(api, archived.id)
    delete_from_archive(api, deleted.id)
    return live, archived, deleted


def listed(api, **params):
    response = api.get("/decks", params=params)
    assert response.status_code == 200
    return [d["name"] for d in response.json()]


def test_list_state_defaults_to_the_non_archived_decks(api, three_decks):
    assert listed(api) == ["A vivant"]
    assert listed(api, state="active") == ["A vivant"]


def test_list_state_archived_lists_only_the_archived_decks(api, three_decks):
    assert listed(api, state="archived") == ["B rangé"]


def test_list_state_all_lists_live_and_archived_but_never_deleted(api, three_decks):
    assert listed(api, state="all") == ["A vivant", "B rangé"]


def test_list_state_combines_with_status_and_q(api, three_decks):
    assert listed(api, state="all", status="active") == ["A vivant"]
    assert listed(api, state="all", status="draft") == ["B rangé"]
    assert listed(api, state="all", q="rangé") == ["B rangé"]
    assert listed(api, state="active", q="rangé") == []


def test_list_state_rejects_unknown_values(api):
    assert api.get("/decks", params={"state": "deleted"}).status_code == 422
    assert api.get("/decks", params={"state": "tous"}).status_code == 422


def test_the_list_orders_homonyms_by_discriminator(api, db):
    make_deck(db, "Même nom", discriminator="0200")
    make_deck(db, "Même nom", discriminator="0100")
    db.commit()

    listed_decks = api.get("/decks").json()

    assert [d["discriminator"] for d in listed_decks] == ["0100", "0200"]
