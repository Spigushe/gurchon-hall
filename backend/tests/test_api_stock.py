"""API `/stock` et versement de produits (`POST /bundles/{id}/stock`)."""

from tests.helpers import add_languages, make_card, make_copy, make_deck, make_printing


def entry(api, card_id, code="EN", *, card_set_id):
    return api.get(f"/stock/{card_id}/{code}/{card_set_id}")


def test_create_entry_returns_the_card_summary(api, db):
    add_languages(db, "EN", "FR")
    card = make_card(db, "Nefertiti")
    printing = make_printing(db, card)
    db.commit()

    response = api.post(
        "/stock",
        json={
            "card_id": card.id,
            "language_code": "FR",
            "card_set_id": printing.card_set_id,
            "quantity_owned": 2,
        },
    )

    assert response.status_code == 201
    body = response.json()
    assert body["card_id"] == card.id
    assert body["language_code"] == "FR"
    assert body["quantity_owned"] == 2
    assert body["card"]["name"] == "Nefertiti"


def test_language_code_is_case_insensitive(api, db):
    add_languages(db, "EN", "FR")
    card = make_card(db)
    printing = make_printing(db, card)
    db.commit()

    created = api.post(
        "/stock",
        json={
            "card_id": card.id,
            "language_code": "fr",
            "card_set_id": printing.card_set_id,
        },
    )
    assert created.status_code == 201
    assert created.json()["language_code"] == "FR"
    found = entry(api, card.id, "fr", card_set_id=printing.card_set_id)
    assert found.status_code == 200


def test_create_duplicate_entry_conflicts(api, world):
    response = api.post(
        "/stock",
        json={
            "card_id": world.card.id,
            "language_code": "EN",
            "card_set_id": world.printing.card_set_id,
        },
    )
    assert response.status_code == 409
    assert "déjà en collection" in response.json()["detail"]


def test_create_entry_for_unknown_card_or_language_is_404(api, db):
    add_languages(db, "EN")
    card = make_card(db)
    db.commit()

    unknown_card = api.post(
        "/stock",
        json={"card_id": 9999, "language_code": "EN", "card_set_id": 1},
    )
    unknown_language = api.post(
        "/stock",
        json={"card_id": card.id, "language_code": "ZZ", "card_set_id": 1},
    )

    assert unknown_card.status_code == 404
    assert unknown_language.status_code == 404


def test_create_entry_for_a_card_set_missing_a_printing_is_404(api, world):
    """Lot 4, D2 : le couple (carte, extension) doit être une impression réelle,
    en ligne comme par `/sync`. Le contrôle applicatif (`catalog.get_printing`)
    passe avant celui de « déjà en collection »."""
    response = api.post(
        "/stock",
        json={
            "card_id": world.card.id,
            "language_code": "EN",
            "card_set_id": world.printing.card_set_id + 1,
        },
    )
    assert response.status_code == 404


def test_create_entry_in_a_real_but_unrelated_card_set_is_404(api, db, world):
    """Distinct du test précédent : ici l'extension existe bel et bien au
    catalogue (une autre carte y est imprimée), mais pas `world.card`. Une
    extension inconnue et une extension réelle sans impression de la carte
    doivent toutes deux être un 404, jamais une confusion avec une autre
    carte du même identifiant d'extension."""
    other_card = make_card(db, "Autre carte du catalogue")
    other_printing = make_printing(db, other_card)
    db.commit()

    response = api.post(
        "/stock",
        json={
            "card_id": world.card.id,
            "language_code": "EN",
            "card_set_id": other_printing.card_set_id,
        },
    )
    assert response.status_code == 404


def test_create_entry_rejects_a_blank_language_code(api, world):
    """Blanc = saisie vide (422), pas langue absente du référentiel (404).

    Le 404 était trompeur : il désignait une ressource manquante là où c'est la
    charge utile qui est fautive, et un client offline qui rejoue sa file ne
    peut pas distinguer les deux.
    """
    for blank in ("   ", "\t", "\n", "   "):
        response = api.post(
            "/stock",
            json={
                "card_id": world.card.id,
                "language_code": blank,
                "card_set_id": world.printing.card_set_id,
            },
        )
        assert response.status_code == 422, blank
        assert response.json()["detail"][0]["loc"] == ["body", "language_code"]


def test_create_entry_trims_the_language_code(api, db):
    """Un code collé avec ses espaces désigne bien la langue, sans 404."""
    add_languages(db, "EN", "FR")
    card = make_card(db)
    printing = make_printing(db, card)
    db.commit()

    response = api.post(
        "/stock",
        json={
            "card_id": card.id,
            "language_code": "  fr  ",
            "card_set_id": printing.card_set_id,
        },
    )

    assert response.status_code == 201
    assert response.json()["language_code"] == "FR"


def test_deposit_bundle_rejects_a_blank_language_code(api, world):
    response = api.post(
        f"/bundles/{world.bundle.id}/stock", json={"language_code": "  "}
    )

    assert response.status_code == 422
    assert response.json()["detail"][0]["loc"] == ["body", "language_code"]


def test_create_entry_rejects_negative_quantity(api, world):
    response = api.post(
        "/stock",
        json={
            "card_id": world.card.id,
            "language_code": "ES",
            "card_set_id": world.printing.card_set_id,
            "quantity_owned": -1,
        },
    )
    assert response.status_code == 422


def test_zero_owned_is_valid(api, db):
    """Une entrée à 0 exemplaire est le cas normal d'une carte jouée en proxy
    (l'autorisation, elle, vit sur le deck — Lot 4)."""
    add_languages(db, "EN")
    card = make_card(db)
    printing = make_printing(db, card)
    db.commit()

    response = api.post(
        "/stock",
        json={
            "card_id": card.id,
            "language_code": "EN",
            "card_set_id": printing.card_set_id,
            "quantity_owned": 0,
        },
    )
    assert response.status_code == 201


def test_stock_entry_no_longer_accepts_proxy_allowed(api, db):
    """Lot 4 : l'autorisation de proxy a quitté l'entrée de collection."""
    add_languages(db, "EN")
    card = make_card(db)
    printing = make_printing(db, card)
    db.commit()

    response = api.post(
        "/stock",
        json={
            "card_id": card.id,
            "language_code": "EN",
            "card_set_id": printing.card_set_id,
            "proxy_allowed": True,
        },
    )
    assert response.status_code == 422


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
    found = entry(api, world.card.id, "ES", card_set_id=world.printing.card_set_id)
    assert found.status_code == 404


def test_patch_updates_owned_quantity_and_notes(api, world):
    url = f"/stock/{world.card.id}/EN/{world.printing.card_set_id}"
    response = api.patch(
        url,
        json={"quantity_owned": 6, "notes": "Reliure abîmée"},
    )
    assert response.status_code == 200
    assert response.json()["quantity_owned"] == 6
    assert response.json()["notes"] == "Reliure abîmée"

    cleared = api.patch(url, json={"notes": None})
    assert cleared.json()["notes"] is None
    assert cleared.json()["quantity_owned"] == 6  # champ non fourni = inchangé


def test_patch_rejects_null_for_non_nullable_field(api, world):
    url = f"/stock/{world.card.id}/EN/{world.printing.card_set_id}"
    response = api.patch(url, json={"quantity_owned": None})
    assert response.status_code == 422


def test_patch_cannot_drop_below_what_decks_use(api, world):
    # Le deck de `world` consomme 4 exemplaires EN réels.
    url = f"/stock/{world.card.id}/EN/{world.printing.card_set_id}"
    below = api.patch(url, json={"quantity_owned": 3})
    exact = api.patch(url, json={"quantity_owned": 4})

    assert below.status_code == 409
    assert "alloués" in below.json()["detail"]
    assert exact.status_code == 200


def test_proxies_in_decks_do_not_count_against_owned_quantity(api, world):
    # 4 EN dans le deck dont 3 proxies : un seul exemplaire réel est consommé.
    card_set_id = world.printing.card_set_id
    api.patch(f"/decks/{world.deck.id}", json={"proxy_allowed": True})
    api.patch(
        f"/decks/{world.deck.id}/cartes/{world.card.id}/EN/{card_set_id}",
        json={"proxy_quantity": 3},
    )

    url = f"/stock/{world.card.id}/EN/{card_set_id}"
    assert api.patch(url, json={"quantity_owned": 1}).status_code == 200
    assert api.patch(url, json={"quantity_owned": 0}).status_code == 409


def test_patch_no_longer_accepts_proxy_allowed(api, world):
    """Lot 4 : l'autorisation de proxy est une propriété du deck, pas de
    l'entrée de collection (cf. `test_disabling_proxy_is_refused_while_a_line_
    plays_one` dans `test_api_deck_lifecycle.py` pour le refus équivalent, côté
    deck)."""
    url = f"/stock/{world.card.id}/FR/{world.printing.card_set_id}"
    response = api.patch(url, json={"proxy_allowed": False})
    assert response.status_code == 422


def test_delete_entry(api, db):
    add_languages(db, "EN")
    card = make_card(db)
    copy = make_copy(db, card)
    db.commit()

    url = f"/stock/{card.id}/EN/{copy.card_set_id}"
    assert api.delete(url).status_code == 204
    assert entry(api, card.id, card_set_id=copy.card_set_id).status_code == 404
    assert api.delete(url).status_code == 404


def test_delete_entry_used_by_a_deck_conflicts(api, world):
    url = f"/stock/{world.card.id}/EN/{world.printing.card_set_id}"
    response = api.delete(url)

    assert response.status_code == 409
    found = entry(api, world.card.id, card_set_id=world.printing.card_set_id)
    assert found.status_code == 200


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
    found = entry(api, world.card.id, card_set_id=world.printing.card_set_id)
    assert found.json()["quantity_owned"] == 10


def test_deposit_bundle_does_not_touch_the_same_card_under_another_extension(api, db, world):
    """Lot 4 : chaque carte du produit est rangée sous l'extension du produit
    (`bundle.card_set_id`), jamais sous une autre extension où la même carte
    et langue seraient déjà possédées."""
    other_printing = make_printing(db, world.card)
    other_copy = make_copy(
        db, world.card, "EN", quantity_owned=5, card_set_id=other_printing.card_set_id
    )
    db.commit()

    response = api.post(
        f"/bundles/{world.bundle.id}/stock",
        json={"language_code": "EN", "count": 1},
    )

    assert response.status_code == 200
    # L'entrée sous l'extension du produit (déjà existante, 4 possédés) reçoit
    # les 2 exemplaires du précon...
    under_bundle = entry(api, world.card.id, card_set_id=world.printing.card_set_id)
    assert under_bundle.json()["quantity_owned"] == 4 + 2
    # ...et l'entrée sous l'autre extension reste totalement intacte.
    elsewhere = entry(api, world.card.id, card_set_id=other_copy.card_set_id)
    assert elsewhere.json()["quantity_owned"] == 5


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
    copy = make_copy(db, card, quantity_owned=2)
    make_deck(db)
    db.commit()

    found = entry(api, card.id, card_set_id=copy.card_set_id)
    assert found.json()["quantity_owned"] == 2
