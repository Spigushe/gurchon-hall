"""API `/decks` : CRUD, composition, disponibilité du stock, légalité.

Discriminant, archivage et suppression logique : `test_api_deck_lifecycle.py`.
"""

import re
import time
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import select

from app.models import Card, CardCategory, CardCopy
from app.services import decks
from tests.helpers import add_languages, make_card, make_copy, make_deck, make_printing


def card_set_id_of(db, card_id, language="EN") -> int:
    """L'extension d'une entrée de collection, pour composer chemin ou corps.

    Se rabat sur n'importe quelle impression connue de la carte si la langue
    demandée n'a pas d'entrée (cas volontaire : « carte pas dans cette langue »
    doit rester un refus du service, pas un lookup qui échoue côté test), puis
    sur `1` si la carte elle-même est inconnue de la collection — un refus
    « carte introuvable » ne dépend de toute façon pas de l'extension fournie.
    """
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


def line_url(db, deck_id, card_id, language="EN") -> str:
    card_set_id = card_set_id_of(db, card_id, language)
    return f"/decks/{deck_id}/cartes/{card_id}/{language}/{card_set_id}"


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
    assert re.fullmatch(r"\d{4}", body["discriminator"])
    assert body["archived_at"] is None and body["deleted_at"] is None
    assert body["status"] == "draft"
    assert body["archetype"] == "Bleed"
    assert body["created_at"] and body["updated_at"]


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
        assert add_line(api, db, deck.id, card.id, language).status_code == 201

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


def test_patch_deck_rejects_a_null_name_and_an_unknown_field(api, world):
    url = f"/decks/{world.deck.id}"

    assert api.patch(url, json={"name": None}).status_code == 422
    assert api.patch(url, json={"discriminator": "0001"}).status_code == 422
    assert api.patch(url, json={"status": "retired"}).status_code == 422


# --- Ajout de cartes --------------------------------------------------------


def test_add_card_returns_the_line_with_its_card(api, db):
    crypt, _ = stocked_cards(db, crypt_quantity=3, library_quantity=1)
    deck = make_deck(db)
    db.commit()

    response = add_line(api, db, deck.id, crypt.id, "en", quantity=2)

    assert response.status_code == 201
    body = response.json()
    assert (body["card_id"], body["language_code"]) == (crypt.id, "EN")
    assert (body["quantity"], body["proxy_quantity"]) == (2, 0)
    assert body["card"]["name"] == "Crypt Card"


def test_add_card_needs_to_be_in_the_collection_in_that_language(api, db):
    crypt, _ = stocked_cards(db, 3, 1)
    deck = make_deck(db)
    db.commit()

    not_in_language = add_line(api, db, deck.id, crypt.id, "FR")
    unknown_card = add_line(api, db, deck.id, 9999)

    assert not_in_language.status_code == 409
    assert "collection" in not_in_language.json()["detail"]
    assert unknown_card.status_code == 404


def test_add_card_twice_conflicts(api, db):
    crypt, _ = stocked_cards(db, 3, 1)
    deck = make_deck(db)
    db.commit()

    assert add_line(api, db, deck.id, crypt.id).status_code == 201
    assert add_line(api, db, deck.id, crypt.id).status_code == 409


def test_add_card_to_unknown_deck_is_404(api, db):
    crypt, _ = stocked_cards(db, 3, 1)
    assert add_line(api, db, 9999, crypt.id).status_code == 404


def test_add_card_in_a_real_but_unrelated_card_set_is_404(api, db, world):
    """Comme pour `/stock` (`test_api_stock.py::
    test_create_entry_in_a_real_but_unrelated_card_set_is_404`) : une
    extension réelle sans impression de la carte visée doit être un 404, et
    ce contrôle passe avant celui de « pas en collection » (409) — la carte de
    `world` a bien une entrée FR, mais pas sous cette extension-ci."""
    other_card = make_card(db, "Autre carte du deck")
    other_printing = make_printing(db, other_card)
    db.commit()

    response = api.post(
        f"/decks/{world.deck.id}/cartes",
        json={
            "card_id": world.card.id,
            "language_code": "FR",
            "card_set_id": other_printing.card_set_id,
            "quantity": 1,
        },
    )
    assert response.status_code == 404


def test_add_card_cannot_exceed_owned_copies(api, db):
    crypt, _ = stocked_cards(db, crypt_quantity=3, library_quantity=1)
    deck = make_deck(db)
    db.commit()

    response = add_line(api, db, deck.id, crypt.id, quantity=4)

    assert response.status_code == 409
    assert "insuffisants" in response.json()["detail"]


def test_copies_are_shared_across_decks(api, db):
    crypt, _ = stocked_cards(db, crypt_quantity=3, library_quantity=1)
    first = make_deck(db, "Premier")
    second = make_deck(db, "Second")
    db.commit()

    assert add_line(api, db, first.id, crypt.id, quantity=2).status_code == 201
    too_many = add_line(api, db, second.id, crypt.id, quantity=2)
    fits = add_line(api, db, second.id, crypt.id, quantity=1)

    assert too_many.status_code == 409
    assert "1 disponible" in too_many.json()["detail"]
    assert fits.status_code == 201


def test_proxy_needs_the_proxy_status(api, db):
    crypt, _ = stocked_cards(db, crypt_quantity=1, library_quantity=1)
    deck = make_deck(db)
    db.commit()

    refused = add_line(api, db, deck.id, crypt.id, quantity=2, proxy=1)
    assert refused.status_code == 409
    assert "proxy" in refused.json()["detail"]

    api.patch(f"/decks/{deck.id}", json={"proxy_allowed": True})
    accepted = add_line(api, db, deck.id, crypt.id, quantity=2, proxy=1)
    assert accepted.status_code == 201
    assert accepted.json()["proxy_quantity"] == 1


def test_disabling_proxy_on_a_deck_that_plays_one_is_refused(api, db):
    """Lot 4 : le refus se déplace sur le `PATCH` du deck (§11, A2). Couvert
    par `/sync` dans `test_sync_service.py::
    test_disabling_proxy_on_a_deck_that_plays_one_is_refused` ; ce test-ci
    vérifie la même règle en ligne."""
    crypt, _ = stocked_cards(db, crypt_quantity=1, library_quantity=1)
    deck = make_deck(db)
    db.commit()
    api.patch(f"/decks/{deck.id}", json={"proxy_allowed": True})
    added = add_line(api, db, deck.id, crypt.id, quantity=1, proxy=1)
    assert added.status_code == 201

    refused = api.patch(f"/decks/{deck.id}", json={"proxy_allowed": False})

    assert refused.status_code == 409
    assert "proxy" in refused.json()["detail"]
    # Refus sans effet : l'autorisation du deck n'a pas bougé.
    assert api.get(f"/decks/{deck.id}").json()["proxy_allowed"] is True

    # Une fois le proxy retiré de la ligne, la désactivation passe.
    line = line_url(db, deck.id, crypt.id)
    assert api.patch(line, json={"proxy_quantity": 0}).status_code == 200
    accepted = api.patch(f"/decks/{deck.id}", json={"proxy_allowed": False})
    assert accepted.status_code == 200


def test_a_card_can_be_played_entirely_in_proxy_with_none_owned(api, db, world):
    # `world` : la carte existe en FR à 0 exemplaire ; le deck autorise le proxy.
    api.patch(f"/decks/{world.deck.id}", json={"proxy_allowed": True})
    response = add_line(
        api, db, world.deck.id, world.card.id, "FR", quantity=3, proxy=3
    )
    assert response.status_code == 201


def test_a_deck_can_mix_languages_of_the_same_card(api, db, world):
    api.patch(f"/decks/{world.deck.id}", json={"proxy_allowed": True})
    add_line(api, db, world.deck.id, world.card.id, "FR", quantity=1, proxy=1)

    cards = api.get(f"/decks/{world.deck.id}").json()["cards"]
    assert sorted(c["language_code"] for c in cards) == ["EN", "FR"]


def test_add_card_validates_quantities(api, db):
    crypt, _ = stocked_cards(db, 3, 1)
    deck = make_deck(db)
    db.commit()

    assert add_line(api, db, deck.id, crypt.id, quantity=0).status_code == 422
    assert add_line(api, db, deck.id, crypt.id, quantity=1, proxy=2).status_code == 422


# --- Modification et retrait de lignes -------------------------------------


def test_patch_line_quantity(api, db, world):
    url = line_url(db, world.deck.id, world.card.id)
    response = api.patch(url, json={"quantity": 2})
    assert response.status_code == 200
    assert response.json()["quantity"] == 2


def test_patch_line_does_not_count_its_own_allocation(api, db, world):
    # 4 possédés, 4 déjà dans ce deck : réécrire 4 ne doit pas être refusé.
    url = line_url(db, world.deck.id, world.card.id)
    response = api.patch(url, json={"quantity": 4})
    assert response.status_code == 200


def test_patch_line_cannot_exceed_available_copies(api, db, world):
    url = line_url(db, world.deck.id, world.card.id)
    response = api.patch(url, json={"quantity": 5})
    assert response.status_code == 409


def test_patch_line_checks_the_merged_proxy_rule(api, db, world):
    # Le schéma ne voit que `quantity` ; la ligne a 4 exemplaires, dont 0 proxy.
    # Passer `proxy_quantity` à 5 sans toucher `quantity` dépasse la ligne.
    api.patch(f"/decks/{world.deck.id}", json={"proxy_allowed": True})

    response = api.patch(
        line_url(db, world.deck.id, world.card.id),
        json={"proxy_quantity": 5},
    )

    assert response.status_code == 422
    (error,) = response.json()["detail"]
    assert error["loc"] == ["body", "proxy_quantity"]
    assert "ne peut pas dépasser" in error["msg"]


def test_patch_line_lowering_quantity_below_existing_proxies_is_422(api, db, world):
    api.patch(f"/decks/{world.deck.id}", json={"proxy_allowed": True})
    api.patch(
        line_url(db, world.deck.id, world.card.id),
        json={"proxy_quantity": 3},
    )

    response = api.patch(
        line_url(db, world.deck.id, world.card.id), json={"quantity": 2}
    )

    assert response.status_code == 422


def test_patch_line_rejects_the_proxy_without_status(api, db, world):
    response = api.patch(
        line_url(db, world.deck.id, world.card.id),
        json={"proxy_quantity": 1},
    )
    assert response.status_code == 409


def test_patch_unknown_line_is_404(api, db, world):
    response = api.patch(
        line_url(db, world.deck.id, world.card.id, "ES"), json={"quantity": 1}
    )
    assert response.status_code == 404


def test_remove_line(api, db, world):
    url = line_url(db, world.deck.id, world.card.id)

    assert api.delete(url).status_code == 204
    assert api.get(f"/decks/{world.deck.id}").json()["cards"] == []
    assert api.delete(url).status_code == 404


def test_composition_changes_touch_the_deck_timestamp(api, db, world):
    before = api.get(f"/decks/{world.deck.id}").json()["updated_at"]
    time.sleep(0.01)

    api.patch(line_url(db, world.deck.id, world.card.id), json={"quantity": 3})

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
    assert add_line(api, db, deck.id, crypt.id, quantity=12).status_code == 201
    added_library = add_line(api, db, deck.id, library.id, quantity=library_count)
    assert added_library.status_code == 201
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
    line_path = (
        f"/decks/{deck.id}/cartes/{library_line['card_id']}"
        f"/EN/{library_line['card_set_id']}"
    )
    too_many = api.patch(line_path, json={"quantity": 91})
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


def test_active_deck_can_be_edited_even_if_now_incomplete(api, world):
    # `world.deck` est actif sans être légal (fixture Lot 1) : seul le passage
    # à « actif » est contrôlé, pas la vie d'un deck déjà actif.
    url = f"/decks/{world.deck.id}"
    for status in ("active", "draft"):
        assert api.patch(url, json={"status": status}).status_code == 200
    # Revenu en brouillon, il redevient soumis au contrôle de légalité.
    assert api.patch(url, json={"status": "active"}).status_code == 409


# --- Légalité : groupes de la crypt et cartes bannies -----------------------


def build_deck(
    api,
    db,
    crypt=(("G1", None),),
    library_banned_on=None,
    library_legal_from=None,
):
    """Deck aux tailles légales (12 en crypt, 60 en library) et aux cartes réglables.

    `crypt` : couples (group_code, banned_on), un par carte de crypt distincte,
    éventuellement suivis d'un dict de champs de carte (`name`, `advanced`,
    `legal_from`…) ; les 12 exemplaires se répartissent à parts égales (1, 2, 3
    ou 4 cartes).
    """
    add_languages(db, "EN", "FR")
    per_card = 12 // len(crypt)
    crypt_cards = []
    for index, (group_code, banned_on, *extra) in enumerate(crypt):
        fields = dict(extra[0]) if extra else {}
        card = make_card(
            db,
            fields.pop("name", f"Vampire {index}"),
            group_code=group_code,
            banned_on=banned_on,
            **fields,
        )
        make_copy(db, card, quantity_owned=per_card)
        crypt_cards.append(card)
    library = make_card(
        db,
        "Livre",
        category=CardCategory.LIBRARY,
        banned_on=library_banned_on,
        legal_from=library_legal_from,
    )
    make_copy(db, library, quantity_owned=60)
    deck = make_deck(db)
    db.commit()
    for card in crypt_cards:
        assert add_line(api, db, deck.id, card.id, quantity=per_card).status_code == 201
    assert add_line(api, db, deck.id, library.id, quantity=60).status_code == 201
    return deck


def legality(api, deck):
    response = api.get(f"/decks/{deck.id}/legalite")
    assert response.status_code == 200
    return response.json()


def names(cards):
    return [card["name"] for card in cards]


def test_adjacent_groups_are_legal(api, db):
    deck = build_deck(api, db, crypt=[("G1", None), ("G2", None)])

    body = legality(api, deck)

    assert body["is_legal"] is True
    assert body["issues"] == []
    assert body["crypt_groups"] == ["G1", "G2"]


def test_non_adjacent_groups_are_illegal(api, db):
    deck = build_deck(api, db, crypt=[("G2", None), ("G4", None)])

    body = legality(api, deck)

    assert body["is_legal"] is False
    assert body["crypt_groups"] == ["G2", "G4"]
    (issue,) = body["issues"]
    assert "Groupes de crypt incompatibles" in issue and "G2, G4" in issue


def test_any_group_is_neutral(api, db):
    deck = build_deck(api, db, crypt=[("G2", None), ("Any", None), ("G3", None)])

    body = legality(api, deck)

    assert body["is_legal"] is True
    assert body["crypt_groups"] == ["G2", "G3"]  # « Any » n'y figure pas


def test_a_crypt_of_any_only_has_no_group_and_is_legal(api, db):
    deck = build_deck(api, db, crypt=[("Any", None)])

    body = legality(api, deck)

    assert body["is_legal"] is True
    assert body["crypt_groups"] == []


def test_deck_without_any_group_code_is_legal(api, db):
    deck = build_deck(api, db, crypt=[(None, None)])

    body = legality(api, deck)

    assert body["is_legal"] is True
    assert body["crypt_groups"] == []
    assert body["banned_cards"] == []


def test_three_groups_are_illegal_even_when_consecutive(api, db):
    deck = build_deck(api, db, crypt=[("G1", None), ("G2", None), ("G3", None)])

    body = legality(api, deck)

    assert body["is_legal"] is False
    assert body["crypt_groups"] == ["G1", "G2", "G3"]
    assert "G1, G2, G3" in body["issues"][0]


def test_crypt_groups_are_listed_once_and_sorted(api, db):
    deck = build_deck(
        api, db, crypt=[("G3", None), ("G2", None), ("G3", None), ("G2", None)]
    )

    assert legality(api, deck)["crypt_groups"] == ["G2", "G3"]


def test_crypt_card_banned_in_the_past_makes_the_deck_illegal(api, db):
    past = date.today() - timedelta(days=2)
    deck = build_deck(api, db, crypt=[("G1", past)])

    body = legality(api, deck)

    assert body["is_legal"] is False
    assert names(body["banned_cards"]) == ["Vampire 0"]
    (issue,) = body["issues"]
    assert "bannie" in issue and "Vampire 0" in issue


def test_crypt_card_banned_today_is_already_banned(api, db, monkeypatch):
    # Horloge figée : le test ne bascule pas au passage de minuit UTC.
    today = date(2026, 6, 15)
    monkeypatch.setattr(decks, "_today", lambda: today)
    deck = build_deck(api, db, crypt=[("G1", today)])

    body = legality(api, deck)

    assert body["is_legal"] is False
    assert names(body["banned_cards"]) == ["Vampire 0"]


def test_crypt_card_banned_in_the_future_is_still_legal(api, db):
    future = date.today() + timedelta(days=2)
    deck = build_deck(api, db, crypt=[("G1", future)])

    body = legality(api, deck)

    assert body["is_legal"] is True
    assert body["banned_cards"] == []


def test_banned_library_card_counts_too(api, db):
    deck = build_deck(api, db, library_banned_on=date.today() - timedelta(days=2))

    body = legality(api, deck)

    assert body["is_legal"] is False
    assert names(body["banned_cards"]) == ["Livre"]
    assert "Livre" in body["issues"][0]


def test_banned_cards_are_listed_sorted_across_crypt_and_library(api, db):
    past = date.today() - timedelta(days=2)
    deck = build_deck(
        api,
        db,
        crypt=[("G1", past), ("G1", None), ("G1", past)],
        library_banned_on=past,
    )

    body = legality(api, deck)

    assert names(body["banned_cards"]) == ["Livre", "Vampire 0", "Vampire 2"]
    assert len(body["issues"]) == 1  # une seule ligne pour toutes les bannies


def test_group_and_ban_problems_are_reported_together(api, db):
    past = date.today() - timedelta(days=2)
    deck = build_deck(api, db, crypt=[("G1", past), ("G4", None)])

    body = legality(api, deck)

    assert body["is_legal"] is False
    assert len(body["issues"]) == 2
    assert "Groupes" in body["issues"][0]
    assert "bannie" in body["issues"][1]


def test_non_adjacent_groups_block_the_activation(api, db):
    deck = build_deck(api, db, crypt=[("G2", None), ("G4", None)])

    response = api.patch(f"/decks/{deck.id}", json={"status": "active"})

    assert response.status_code == 409
    assert "illégal" in response.json()["detail"]
    assert "G2, G4" in response.json()["detail"]
    assert api.get(f"/decks/{deck.id}").json()["status"] == "draft"


def test_a_banned_card_blocks_the_activation(api, db):
    deck = build_deck(api, db, crypt=[("G1", date.today() - timedelta(days=2))])

    response = api.patch(f"/decks/{deck.id}", json={"status": "active"})

    assert response.status_code == 409
    assert "illégal" in response.json()["detail"]
    assert "Vampire 0" in response.json()["detail"]
    assert api.get(f"/decks/{deck.id}").json()["status"] == "draft"


def test_a_future_ban_does_not_block_the_activation(api, db):
    deck = build_deck(api, db, crypt=[("G1", date.today() + timedelta(days=2))])

    response = api.patch(f"/decks/{deck.id}", json={"status": "active"})

    assert response.status_code == 200


def test_deck_without_group_code_can_become_active(api, db):
    deck = build_deck(api, db, crypt=[(None, None)])

    response = api.patch(f"/decks/{deck.id}", json={"status": "active"})

    assert response.status_code == 200
    assert response.json()["status"] == "active"


def test_creating_an_active_deck_is_refused_when_illegal_for_groups(api):
    # Un deck neuf est vide, donc illégal : le refus vaut pour toutes les règles,
    # la création avec `active` passe par le même contrôle que le PATCH.
    response = api.post("/decks", json={"name": "Neuf", "status": "active"})

    assert response.status_code == 409
    assert api.get("/decks").json() == []


# --- Légalité : cartes fautives, variantes, cartes pas encore légales --------


def test_banned_cards_come_as_card_summaries_with_group_and_advanced(api, db):
    past = date.today() - timedelta(days=2)
    deck = build_deck(
        api,
        db,
        crypt=[
            ("G2", past, {"name": "Theo Bell", "advanced": True}),
            ("G2", None, {"name": "Theo Bell"}),
            ("G3", None, {"name": "Theo Bell"}),
        ],
    )

    body = legality(api, deck)

    # Trois « Theo Bell » au deck : seule la variante avancée est bannie.
    (card,) = body["banned_cards"]
    assert (card["name"], card["group_code"], card["advanced"]) == (
        "Theo Bell",
        "G2",
        True,
    )
    assert {"id", "vekn_id", "category", "clan"} <= set(card)
    (issue,) = body["issues"]
    assert "Theo Bell (G2, Adv)" in issue
    assert "Theo Bell (G3)" not in issue


def test_two_variants_of_a_name_are_told_apart_by_group(api, db):
    past = date.today() - timedelta(days=2)
    deck = build_deck(
        api,
        db,
        crypt=[
            ("G3", past, {"name": "Theo Bell"}),
            ("G2", past, {"name": "Theo Bell"}),
        ],
    )

    body = legality(api, deck)

    # Triées par nom puis groupe ; chaque variante nommée dans le message.
    assert [c["group_code"] for c in body["banned_cards"]] == ["G2", "G3"]
    assert "Theo Bell (G2), Theo Bell (G3)" in body["issues"][0]


def test_a_card_owned_in_two_languages_is_reported_once(api, db):
    past = date.today() - timedelta(days=2)
    deck = build_deck(api, db, crypt=[("G1", past)])
    crypt = api.get(f"/decks/{deck.id}").json()["cards"][0]["card"]
    make_copy(db, db.get(Card, crypt["id"]), "FR", quantity_owned=1)
    db.commit()
    assert add_line(api, db, deck.id, crypt["id"], "FR").status_code == 201

    body = legality(api, deck)

    assert body["crypt_count"] == 13
    assert names(body["banned_cards"]) == ["Vampire 0"]


def test_crypt_card_not_yet_legal_makes_the_deck_illegal(api, db):
    future = date.today() + timedelta(days=2)
    deck = build_deck(api, db, crypt=[("G1", None, {"legal_from": future})])

    body = legality(api, deck)

    assert body["is_legal"] is False
    assert names(body["not_yet_legal_cards"]) == ["Vampire 0"]
    assert body["banned_cards"] == []
    (issue,) = body["issues"]
    assert "pas encore légale" in issue and "Vampire 0" in issue


def test_library_card_not_yet_legal_counts_too(api, db):
    deck = build_deck(api, db, library_legal_from=date.today() + timedelta(days=2))

    body = legality(api, deck)

    assert body["is_legal"] is False
    assert names(body["not_yet_legal_cards"]) == ["Livre"]


def test_card_legal_since_the_past_or_without_date_is_legal(api, db):
    past = date.today() - timedelta(days=2)
    deck = build_deck(api, db, crypt=[("G1", None, {"legal_from": past})])

    body = legality(api, deck)

    assert body["is_legal"] is True
    assert body["not_yet_legal_cards"] == []


def test_card_becoming_legal_today_is_already_legal(api, db, monkeypatch):
    today = date(2026, 6, 15)
    monkeypatch.setattr(decks, "_today", lambda: today)
    deck = build_deck(api, db, crypt=[("G1", None, {"legal_from": today})])

    body = legality(api, deck)

    assert body["not_yet_legal_cards"] == []
    assert body["is_legal"] is True


def test_not_yet_legal_cards_are_sorted_and_summarised_once(api, db):
    future = date.today() + timedelta(days=2)
    deck = build_deck(
        api,
        db,
        crypt=[("G1", None, {"legal_from": future, "name": "Zed"}), ("G1", None)],
        library_legal_from=future,
    )

    body = legality(api, deck)

    assert names(body["not_yet_legal_cards"]) == ["Livre", "Zed"]
    assert len(body["issues"]) == 1


def test_a_card_can_be_banned_and_not_yet_legal_reported_separately(api, db):
    past = date.today() - timedelta(days=2)
    future = date.today() + timedelta(days=2)
    deck = build_deck(
        api,
        db,
        crypt=[("G1", past), ("G1", None, {"legal_from": future})],
    )

    body = legality(api, deck)

    assert names(body["banned_cards"]) == ["Vampire 0"]
    assert names(body["not_yet_legal_cards"]) == ["Vampire 1"]
    assert len(body["issues"]) == 2


def test_a_not_yet_legal_card_blocks_the_activation(api, db):
    future = date.today() + timedelta(days=2)
    deck = build_deck(api, db, crypt=[("G1", None, {"legal_from": future})])

    response = api.patch(f"/decks/{deck.id}", json={"status": "active"})

    assert response.status_code == 409
    assert "pas encore légale" in response.json()["detail"]
    assert api.get(f"/decks/{deck.id}").json()["status"] == "draft"


def test_legality_is_dated(api, db, monkeypatch):
    monkeypatch.setattr(decks, "_today", lambda: date(2026, 6, 15))
    deck = build_deck(api, db)

    assert legality(api, deck)["evaluated_on"] == "2026-06-15"


def test_legality_is_dated_by_the_utc_day_by_default(api, db):
    deck = build_deck(api, db)
    before = datetime.now(UTC).date()

    evaluated = date.fromisoformat(legality(api, deck)["evaluated_on"])

    # Encadré par deux lectures de l'horloge : robuste au passage de minuit UTC.
    assert before <= evaluated <= datetime.now(UTC).date()


def test_the_service_evaluates_at_the_requested_date(api, db):
    deck = build_deck(
        api,
        db,
        crypt=[
            (
                "G1",
                date(2015, 6, 1),
                {"legal_from": date(2010, 1, 1)},
            )
        ],
    )

    before = decks.get_legality(db, deck.id, on=date(2005, 1, 1))
    between = decks.get_legality(db, deck.id, on=date(2012, 1, 1))
    after = decks.get_legality(db, deck.id, on=date(2015, 6, 1))

    assert before.evaluated_on == date(2005, 1, 1)
    assert names([c.model_dump() for c in before.not_yet_legal_cards]) == ["Vampire 0"]
    assert (between.banned_cards, between.not_yet_legal_cards) == ([], [])
    assert between.is_legal is True
    assert [c.name for c in after.banned_cards] == ["Vampire 0"]
    assert after.is_legal is False
