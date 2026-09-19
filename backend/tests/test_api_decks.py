"""API `/decks` : CRUD, composition, disponibilité du stock, légalité."""

import time

from app.models import CardCategory
from tests.helpers import add_languages, make_card, make_copy, make_deck


def add_line(api, deck_id, card_id, language="EN", quantity=1, proxy=0):
    return api.post(
        f"/decks/{deck_id}/cartes",
        json={
            "card_id": card_id,
            "language_code": language,
            "quantity": quantity,
            "proxy_quantity": proxy,
        },
    )


def stocked_cards(db, crypt_quantity, library_quantity):
    """Une carte de crypt et une de library, possédées en quantité voulue."""
    add_languages(db, "EN", "FR")
    crypt = make_card(db, "Crypt Card")
    library = make_card(db, "Library Card", category=CardCategory.LIBRARY)
    make_copy(db, crypt, quantity_owned=crypt_quantity)
    make_copy(db, library, quantity_owned=library_quantity)
    db.commit()
    return crypt, library


# --- CRUD des decks ---------------------------------------------------------


def test_create_deck_defaults_to_draft(api):
    response = api.post("/decks", json={"name": "Mon deck", "archetype": "Bleed"})

    assert response.status_code == 201
    body = response.json()
    assert body["name"] == "Mon deck"
    assert body["status"] == "draft"
    assert body["archetype"] == "Bleed"
    assert body["created_at"] and body["updated_at"]


def test_create_deck_with_duplicate_name_conflicts(api, world):
    response = api.post("/decks", json={"name": "Ventrue Grinder"})
    assert response.status_code == 409


def test_create_deck_validates_input(api):
    assert api.post("/decks", json={"name": ""}).status_code == 422
    assert api.post("/decks", json={}).status_code == 422
    assert api.post("/decks", json={"name": "x", "inconnu": 1}).status_code == 422


def test_list_decks_with_filters(api, db):
    make_deck(db, "Beta")
    make_deck(db, "Alpha")
    make_deck(db, "Gamma", status="active")
    db.commit()

    def listed(**params):
        return [d["name"] for d in api.get("/decks", params=params).json()]

    assert listed() == ["Alpha", "Beta", "Gamma"]
    assert listed(status="active") == ["Gamma"]
    assert listed(q="et") == ["Beta"]


def test_get_deck_returns_sorted_composition_with_cards(api, db):
    add_languages(db, "EN", "FR")
    crypt_b = make_card(db, "Bruno")
    crypt_a = make_card(db, "Alice")
    library = make_card(db, "Aardvark", category=CardCategory.LIBRARY)
    for card in (crypt_b, crypt_a, library):
        make_copy(db, card, quantity_owned=2)
    make_copy(db, crypt_a, "FR", quantity_owned=1)
    deck = make_deck(db)
    db.commit()
    for card, language in (
        (library, "EN"),
        (crypt_b, "EN"),
        (crypt_a, "FR"),
        (crypt_a, "EN"),
    ):
        assert add_line(api, deck.id, card.id, language).status_code == 201

    body = api.get(f"/decks/{deck.id}").json()

    # Crypt d'abord, puis par nom, puis par langue ; library à la fin.
    assert [(c["card"]["name"], c["language_code"]) for c in body["cards"]] == [
        ("Alice", "EN"),
        ("Alice", "FR"),
        ("Bruno", "EN"),
        ("Aardvark", "EN"),
    ]
    assert body["cards"][0]["card"]["category"] == "crypt"


def test_get_unknown_deck_is_404(api):
    assert api.get("/decks/9999").status_code == 404
    assert api.get("/decks/9999/legalite").status_code == 404
    assert api.patch("/decks/9999", json={"name": "x"}).status_code == 404
    assert api.delete("/decks/9999").status_code == 404


def test_patch_deck(api, world):
    response = api.patch(
        f"/decks/{world.deck.id}",
        json={"name": "Renommé", "archetype": None, "notes": "À revoir"},
    )

    assert response.status_code == 200
    body = response.json()
    assert (body["name"], body["archetype"], body["notes"]) == (
        "Renommé",
        None,
        "À revoir",
    )
    assert body["status"] == "active"  # inchangé


def test_patch_deck_rejects_null_name_and_duplicate_name(api, world, db):
    make_deck(db, "Autre")
    db.commit()

    url = f"/decks/{world.deck.id}"
    assert api.patch(url, json={"name": None}).status_code == 422
    assert api.patch(url, json={"name": "Autre"}).status_code == 409
    # Reprendre son propre nom n'est pas un doublon.
    same = api.patch(f"/decks/{world.deck.id}", json={"name": "Ventrue Grinder"})
    assert same.status_code == 200


def test_delete_deck_removes_composition_and_frees_the_stock(api, world, db):
    # Le deck de `world` a été joué ; on retire d'abord la partie.
    db.delete(world.mine)
    db.commit()

    assert api.delete(f"/decks/{world.deck.id}").status_code == 204

    assert api.get(f"/decks/{world.deck.id}").status_code == 404
    # Plus aucun deck n'utilise l'exemplaire : le stock peut descendre à 0.
    lowered = api.patch(f"/stock/{world.card.id}/EN", json={"quantity_owned": 0})
    assert lowered.status_code == 200


def test_delete_deck_played_in_a_game_conflicts(api, world):
    response = api.delete(f"/decks/{world.deck.id}")

    assert response.status_code == 409
    assert "retired" in response.json()["detail"]
    assert api.get(f"/decks/{world.deck.id}").status_code == 200


# --- Ajout de cartes --------------------------------------------------------


def test_add_card_returns_the_line_with_its_card(api, db):
    crypt, _ = stocked_cards(db, crypt_quantity=3, library_quantity=1)
    deck = make_deck(db)
    db.commit()

    response = add_line(api, deck.id, crypt.id, "en", quantity=2)

    assert response.status_code == 201
    body = response.json()
    assert (body["card_id"], body["language_code"]) == (crypt.id, "EN")
    assert (body["quantity"], body["proxy_quantity"]) == (2, 0)
    assert body["card"]["name"] == "Crypt Card"


def test_add_card_needs_to_be_in_the_collection_in_that_language(api, db):
    crypt, _ = stocked_cards(db, 3, 1)
    deck = make_deck(db)
    db.commit()

    not_in_language = add_line(api, deck.id, crypt.id, "FR")
    unknown_card = add_line(api, deck.id, 9999)

    assert not_in_language.status_code == 409
    assert "collection" in not_in_language.json()["detail"]
    assert unknown_card.status_code == 404


def test_add_card_twice_conflicts(api, db):
    crypt, _ = stocked_cards(db, 3, 1)
    deck = make_deck(db)
    db.commit()

    assert add_line(api, deck.id, crypt.id).status_code == 201
    assert add_line(api, deck.id, crypt.id).status_code == 409


def test_add_card_to_unknown_deck_is_404(api, db):
    crypt, _ = stocked_cards(db, 3, 1)
    assert add_line(api, 9999, crypt.id).status_code == 404


def test_add_card_cannot_exceed_owned_copies(api, db):
    crypt, _ = stocked_cards(db, crypt_quantity=3, library_quantity=1)
    deck = make_deck(db)
    db.commit()

    response = add_line(api, deck.id, crypt.id, quantity=4)

    assert response.status_code == 409
    assert "insuffisants" in response.json()["detail"]


def test_copies_are_shared_across_decks(api, db):
    crypt, _ = stocked_cards(db, crypt_quantity=3, library_quantity=1)
    first = make_deck(db, "Premier")
    second = make_deck(db, "Second")
    db.commit()

    assert add_line(api, first.id, crypt.id, quantity=2).status_code == 201
    too_many = add_line(api, second.id, crypt.id, quantity=2)
    fits = add_line(api, second.id, crypt.id, quantity=1)

    assert too_many.status_code == 409
    assert "1 disponible" in too_many.json()["detail"]
    assert fits.status_code == 201


def test_proxy_needs_the_proxy_status(api, db):
    crypt, _ = stocked_cards(db, crypt_quantity=1, library_quantity=1)
    deck = make_deck(db)
    db.commit()

    refused = add_line(api, deck.id, crypt.id, quantity=2, proxy=1)
    assert refused.status_code == 409
    assert "proxy" in refused.json()["detail"]

    api.patch(f"/stock/{crypt.id}/EN", json={"proxy_allowed": True})
    accepted = add_line(api, deck.id, crypt.id, quantity=2, proxy=1)
    assert accepted.status_code == 201
    assert accepted.json()["proxy_quantity"] == 1


def test_a_card_can_be_played_entirely_in_proxy_with_none_owned(api, world):
    # `world` : la carte existe en FR à 0 exemplaire, proxy autorisé.
    response = add_line(api, world.deck.id, world.card.id, "FR", quantity=3, proxy=3)
    assert response.status_code == 201


def test_a_deck_can_mix_languages_of_the_same_card(api, world):
    add_line(api, world.deck.id, world.card.id, "FR", quantity=1, proxy=1)

    cards = api.get(f"/decks/{world.deck.id}").json()["cards"]
    assert sorted(c["language_code"] for c in cards) == ["EN", "FR"]


def test_add_card_validates_quantities(api, db):
    crypt, _ = stocked_cards(db, 3, 1)
    deck = make_deck(db)
    db.commit()

    assert add_line(api, deck.id, crypt.id, quantity=0).status_code == 422
    assert add_line(api, deck.id, crypt.id, quantity=1, proxy=2).status_code == 422


# --- Modification et retrait de lignes -------------------------------------


def test_patch_line_quantity(api, world):
    response = api.patch(
        f"/decks/{world.deck.id}/cartes/{world.card.id}/EN", json={"quantity": 2}
    )
    assert response.status_code == 200
    assert response.json()["quantity"] == 2


def test_patch_line_does_not_count_its_own_allocation(api, world):
    # 4 possédés, 4 déjà dans ce deck : réécrire 4 ne doit pas être refusé.
    response = api.patch(
        f"/decks/{world.deck.id}/cartes/{world.card.id}/EN", json={"quantity": 4}
    )
    assert response.status_code == 200


def test_patch_line_cannot_exceed_available_copies(api, world):
    response = api.patch(
        f"/decks/{world.deck.id}/cartes/{world.card.id}/EN", json={"quantity": 5}
    )
    assert response.status_code == 409


def test_patch_line_checks_the_merged_proxy_rule(api, world):
    # Le schéma ne voit que `quantity` ; la ligne a 4 exemplaires, dont 0 proxy.
    # Passer `proxy_quantity` à 5 sans toucher `quantity` dépasse la ligne.
    api.patch(f"/stock/{world.card.id}/EN", json={"proxy_allowed": True})

    response = api.patch(
        f"/decks/{world.deck.id}/cartes/{world.card.id}/EN",
        json={"proxy_quantity": 5},
    )

    assert response.status_code == 422
    (error,) = response.json()["detail"]
    assert error["loc"] == ["body", "proxy_quantity"]
    assert "ne peut pas dépasser" in error["msg"]


def test_patch_line_lowering_quantity_below_existing_proxies_is_422(api, world):
    api.patch(f"/stock/{world.card.id}/EN", json={"proxy_allowed": True})
    api.patch(
        f"/decks/{world.deck.id}/cartes/{world.card.id}/EN",
        json={"proxy_quantity": 3},
    )

    response = api.patch(
        f"/decks/{world.deck.id}/cartes/{world.card.id}/EN", json={"quantity": 2}
    )

    assert response.status_code == 422


def test_patch_line_rejects_the_proxy_without_status(api, world):
    response = api.patch(
        f"/decks/{world.deck.id}/cartes/{world.card.id}/EN",
        json={"proxy_quantity": 1},
    )
    assert response.status_code == 409


def test_patch_unknown_line_is_404(api, world):
    response = api.patch(
        f"/decks/{world.deck.id}/cartes/{world.card.id}/ES", json={"quantity": 1}
    )
    assert response.status_code == 404


def test_remove_line(api, world):
    url = f"/decks/{world.deck.id}/cartes/{world.card.id}/EN"

    assert api.delete(url).status_code == 204
    assert api.get(f"/decks/{world.deck.id}").json()["cards"] == []
    assert api.delete(url).status_code == 404


def test_composition_changes_touch_the_deck_timestamp(api, world):
    before = api.get(f"/decks/{world.deck.id}").json()["updated_at"]
    time.sleep(0.01)

    api.patch(
        f"/decks/{world.deck.id}/cartes/{world.card.id}/EN", json={"quantity": 3}
    )

    assert api.get(f"/decks/{world.deck.id}").json()["updated_at"] > before


# --- Légalité et statut -----------------------------------------------------


def test_legality_of_an_incomplete_deck(api, world):
    response = api.get(f"/decks/{world.deck.id}/legalite")

    assert response.status_code == 200
    body = response.json()
    assert body["deck_id"] == world.deck.id
    assert (body["crypt_count"], body["library_count"]) == (4, 0)
    thresholds = (body["crypt_minimum"], body["library_minimum"])
    assert thresholds + (body["library_maximum"],) == (12, 60, 90)
    assert body["is_legal"] is False
    assert len(body["issues"]) == 2


def test_legality_of_an_empty_deck(api, db):
    deck = make_deck(db)
    db.commit()

    body = api.get(f"/decks/{deck.id}/legalite").json()

    counts = (body["crypt_count"], body["library_count"])
    assert counts == (0, 0)
    assert body["is_legal"] is False


def make_legal_deck(api, db, library_count=60):
    crypt, library = stocked_cards(db, crypt_quantity=12, library_quantity=90)
    deck = make_deck(db)
    db.commit()
    assert add_line(api, deck.id, crypt.id, quantity=12).status_code == 201
    assert add_line(api, deck.id, library.id, quantity=library_count).status_code == 201
    return deck


def test_legality_counts_quantities_and_proxies(api, db):
    deck = make_legal_deck(api, db)

    body = api.get(f"/decks/{deck.id}/legalite").json()

    assert (body["crypt_count"], body["library_count"]) == (12, 60)
    assert body["is_legal"] is True
    assert body["issues"] == []


def test_legality_upper_bound_of_the_library(api, db):
    deck = make_legal_deck(api, db, library_count=90)
    assert api.get(f"/decks/{deck.id}/legalite").json()["is_legal"] is True

    lines = api.get(f"/decks/{deck.id}").json()["cards"]
    library_line = next(c for c in lines if c["card"]["category"] == "library")
    # 91 cartes : la possession (90) l'interdit avant même la règle du deck.
    too_many = api.patch(
        f"/decks/{deck.id}/cartes/{library_line['card_id']}/EN",
        json={"quantity": 91},
    )
    assert too_many.status_code == 409


def test_legal_deck_can_become_active(api, db):
    deck = make_legal_deck(api, db)

    response = api.patch(f"/decks/{deck.id}", json={"status": "active"})

    assert response.status_code == 200
    assert response.json()["status"] == "active"


def test_illegal_deck_cannot_become_active(api, db):
    deck = make_deck(db)
    db.commit()

    response = api.patch(f"/decks/{deck.id}", json={"status": "active"})

    assert response.status_code == 409
    assert "illégal" in response.json()["detail"]
    assert api.get(f"/decks/{deck.id}").json()["status"] == "draft"


def test_creating_an_active_deck_requires_legality(api):
    response = api.post("/decks", json={"name": "Vide", "status": "active"})

    assert response.status_code == 409
    assert api.get("/decks").json() == []  # rien n'a été créé


def test_active_deck_can_be_edited_and_retired_even_if_now_incomplete(api, world):
    # `world.deck` est actif sans être légal (fixture Lot 1) : seul le passage
    # à « actif » est contrôlé, pas la vie d'un deck déjà actif.
    url = f"/decks/{world.deck.id}"
    for status in ("active", "retired", "draft"):
        assert api.patch(url, json={"status": status}).status_code == 200
