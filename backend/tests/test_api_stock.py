"""API `/stock` et versement de produits (`POST /bundles/{id}/stock`)."""

from tests.helpers import add_languages, make_card, make_copy, make_deck


def entry(api, card_id, code="EN"):
    return api.get(f"/stock/{card_id}/{code}")


def test_create_entry_returns_the_card_summary(api, db):
    add_languages(db, "EN", "FR")
    card = make_card(db, "Nefertiti")
    db.commit()

    response = api.post(
        "/stock",
        json={"card_id": card.id, "language_code": "FR", "quantity_owned": 2},
    )

    assert response.status_code == 201
    body = response.json()
    assert body["card_id"] == card.id
    assert body["language_code"] == "FR"
    assert body["quantity_owned"] == 2
    assert body["proxy_allowed"] is False
    assert body["card"]["name"] == "Nefertiti"


def test_language_code_is_case_insensitive(api, db):
    add_languages(db, "EN", "FR")
    card = make_card(db)
    db.commit()

    created = api.post("/stock", json={"card_id": card.id, "language_code": "fr"})
    assert created.status_code == 201
    assert created.json()["language_code"] == "FR"
    assert entry(api, card.id, "fr").status_code == 200


def test_create_duplicate_entry_conflicts(api, world):
    response = api.post(
        "/stock", json={"card_id": world.card.id, "language_code": "EN"}
    )
    assert response.status_code == 409
    assert "déjà en collection" in response.json()["detail"]


def test_create_entry_for_unknown_card_or_language_is_404(api, db):
    add_languages(db, "EN")
    card = make_card(db)
    db.commit()

    unknown_card = api.post("/stock", json={"card_id": 9999, "language_code": "EN"})
    unknown_language = api.post(
        "/stock", json={"card_id": card.id, "language_code": "ZZ"}
    )

    assert unknown_card.status_code == 404
    assert unknown_language.status_code == 404


def test_create_entry_rejects_negative_quantity(api, world):
    response = api.post(
        "/stock",
        json={"card_id": world.card.id, "language_code": "ES", "quantity_owned": -1},
    )
    assert response.status_code == 422


def test_zero_owned_with_proxy_is_valid(api, db):
    add_languages(db, "EN")
    card = make_card(db)
    db.commit()

    response = api.post(
        "/stock",
        json={
            "card_id": card.id,
            "language_code": "EN",
            "quantity_owned": 0,
            "proxy_allowed": True,
        },
    )
    assert response.status_code == 201


def test_list_stock_filters(api, db):
    add_languages(db, "EN", "FR")
    crypt = make_card(db, "Zebulon")
    library = make_card(db, "Blood Doll", category="library")
    make_copy(db, crypt, "EN")
    make_copy(db, crypt, "FR")
    make_copy(db, library, "EN")
    db.commit()

    everything = api.get("/stock").json()
    assert [row["card"]["name"] for row in everything] == [
        "Blood Doll",
        "Zebulon",
        "Zebulon",
    ]
    assert len(api.get("/stock", params={"language_code": "fr"}).json()) == 1
    assert len(api.get("/stock", params={"category": "library"}).json()) == 1
    (only,) = api.get("/stock", params={"q": "zeb", "language_code": "EN"}).json()
    assert only["card"]["name"] == "Zebulon"
    assert len(api.get("/stock", params={"limit": 1, "offset": 1}).json()) == 1


def test_search_treats_like_wildcards_literally(api, db):
    add_languages(db, "EN")
    make_copy(db, make_card(db, "Alpha"))
    db.commit()

    assert api.get("/stock", params={"q": "%"}).json() == []
    assert api.get("/stock", params={"q": "_lph"}).json() == []


def test_get_unknown_entry_is_404(api, world):
    assert entry(api, world.card.id, "ES").status_code == 404


def test_patch_updates_owned_quantity_and_notes(api, world):
    response = api.patch(
        f"/stock/{world.card.id}/EN",
        json={"quantity_owned": 6, "notes": "Reliure abîmée"},
    )
    assert response.status_code == 200
    assert response.json()["quantity_owned"] == 6
    assert response.json()["notes"] == "Reliure abîmée"

    cleared = api.patch(f"/stock/{world.card.id}/EN", json={"notes": None})
    assert cleared.json()["notes"] is None
    assert cleared.json()["quantity_owned"] == 6  # champ non fourni = inchangé


def test_patch_rejects_null_for_non_nullable_field(api, world):
    response = api.patch(f"/stock/{world.card.id}/EN", json={"quantity_owned": None})
    assert response.status_code == 422


def test_patch_cannot_drop_below_what_decks_use(api, world):
    # Le deck de `world` consomme 4 exemplaires EN réels.
    below = api.patch(f"/stock/{world.card.id}/EN", json={"quantity_owned": 3})
    exact = api.patch(f"/stock/{world.card.id}/EN", json={"quantity_owned": 4})

    assert below.status_code == 409
    assert "alloués" in below.json()["detail"]
    assert exact.status_code == 200


def test_proxies_in_decks_do_not_count_against_owned_quantity(api, world):
    # 4 EN dans le deck dont 3 proxies : un seul exemplaire réel est consommé.
    api.patch(f"/stock/{world.card.id}/EN", json={"proxy_allowed": True})
    api.patch(
        f"/decks/{world.deck.id}/cartes/{world.card.id}/EN",
        json={"proxy_quantity": 3},
    )

    assert (
        api.patch(f"/stock/{world.card.id}/EN", json={"quantity_owned": 1}).status_code
        == 200
    )
    assert (
        api.patch(f"/stock/{world.card.id}/EN", json={"quantity_owned": 0}).status_code
        == 409
    )


def test_patch_cannot_forbid_proxy_still_used_in_a_deck(api, world):
    added = api.post(
        f"/decks/{world.deck.id}/cartes",
        json={
            "card_id": world.card.id,
            "language_code": "FR",
            "quantity": 1,
            "proxy_quantity": 1,
        },
    )
    assert added.status_code == 201

    response = api.patch(f"/stock/{world.card.id}/FR", json={"proxy_allowed": False})

    assert response.status_code == 409
    assert "proxy" in response.json()["detail"]


def test_delete_entry(api, db):
    add_languages(db, "EN")
    card = make_card(db)
    make_copy(db, card)
    db.commit()

    assert api.delete(f"/stock/{card.id}/EN").status_code == 204
    assert entry(api, card.id).status_code == 404
    assert api.delete(f"/stock/{card.id}/EN").status_code == 404


def test_delete_entry_used_by_a_deck_conflicts(api, world):
    response = api.delete(f"/stock/{world.card.id}/EN")

    assert response.status_code == 409
    assert entry(api, world.card.id).status_code == 200


def test_deposit_bundle_adds_its_content_to_the_stock(api, world):
    # Le produit de `world` contient la carte en 2 exemplaires ; la carte est
    # déjà possédée en 4 exemplaires EN.
    response = api.post(
        f"/bundles/{world.bundle.id}/stock",
        json={"language_code": "en", "count": 3},
    )

    assert response.status_code == 200
    (row,) = response.json()
    assert row["card_id"] == world.card.id
    assert row["quantity_owned"] == 4 + 2 * 3
    assert entry(api, world.card.id).json()["quantity_owned"] == 10


def test_deposit_bundle_creates_missing_entries(api, world):
    # Aucune entrée en ES : elle doit être créée, avec le contenu du produit.
    add = api.post("/langues", json={"code": "ES", "label": "Espagnol"})
    assert add.status_code == 201

    response = api.post(
        f"/bundles/{world.bundle.id}/stock", json={"language_code": "ES"}
    )

    assert response.status_code == 200
    assert [(r["language_code"], r["quantity_owned"]) for r in response.json()] == [
        ("ES", 2)
    ]


def test_deposit_bundle_errors(api, world, db):
    missing_bundle = api.post("/bundles/9999/stock", json={"language_code": "EN"})
    missing_language = api.post(
        f"/bundles/{world.bundle.id}/stock", json={"language_code": "ZZ"}
    )
    bad_count = api.post(
        f"/bundles/{world.bundle.id}/stock",
        json={"language_code": "EN", "count": 0},
    )

    assert missing_bundle.status_code == 404
    assert missing_language.status_code == 404
    assert bad_count.status_code == 422


def test_deposit_bundle_without_known_content_conflicts(api, world, db):
    from app.models import Bundle

    empty = Bundle(card_set_id=world.card_set.id, code="VIDE")
    db.add(empty)
    db.commit()

    response = api.post(f"/bundles/{empty.id}/stock", json={"language_code": "EN"})

    assert response.status_code == 409


def test_stock_is_untouched_by_an_unrelated_deck(api, db):
    add_languages(db, "EN")
    card = make_card(db)
    make_copy(db, card, quantity_owned=2)
    make_deck(db)
    db.commit()

    assert entry(api, card.id).json()["quantity_owned"] == 2
