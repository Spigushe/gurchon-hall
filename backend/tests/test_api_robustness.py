"""Robustesse de l'API : bornes d'identifiants, courses d'écriture, ordre stable.

Les courses sont simulées : on neutralise la vérification préalable du service
(le « vérifier » du « vérifier puis écrire ») pour que la base seule refuse
l'écriture, comme le ferait une requête concurrente passée entre les deux.
"""

import pytest
from sqlalchemy import event
from sqlalchemy.orm import Session

from app.models import (
    CardCategory,
    CardCopy,
    CardPrinting,
    CardPrintingOccurrence,
    Language,
    PrintOccurrence,
)
from tests.helpers import add_languages, make_card, make_copy, make_deck

MAX_INT = 2**31 - 1
HUGE = 99999999999999999999

LINE = {"quantity": 1}


# --- Bornes des identifiants -------------------------------------------------


@pytest.mark.parametrize(
    ("method", "url", "body"),
    [
        ("get", "/cartes/{bad}", None),
        ("get", "/bundles/{bad}", None),
        ("post", "/bundles/{bad}/stock", {"language_code": "EN"}),
        ("get", "/stock/{bad}/EN/1", None),
        ("patch", "/stock/{bad}/EN/1", {"quantity_owned": 1}),
        ("delete", "/stock/{bad}/EN/1", None),
        # `card_set_id` (Lot 4) est le même type borné que les autres
        # identifiants du chemin : un `bad` sur cette position rend 422 aussi.
        ("get", "/stock/1/EN/{bad}", None),
        ("delete", "/stock/1/EN/{bad}", None),
        ("patch", "/decks/1/cartes/1/EN/{bad}", LINE),
        ("delete", "/decks/1/cartes/1/EN/{bad}", None),
        ("get", "/decks/{bad}", None),
        ("patch", "/decks/{bad}", {"name": "x"}),
        ("delete", "/decks/{bad}", None),
        ("get", "/decks/{bad}/legalite", None),
        (
            "post",
            "/decks/{bad}/cartes",
            {"card_id": 1, "language_code": "EN", "card_set_id": 1, "quantity": 1},
        ),
        ("patch", "/decks/{bad}/cartes/1/EN/1", LINE),
        ("patch", "/decks/1/cartes/{bad}/EN/1", LINE),
        ("delete", "/decks/{bad}/cartes/1/EN/1", None),
        ("delete", "/decks/1/cartes/{bad}/EN/1", None),
    ],
)
@pytest.mark.parametrize("bad", [0, -1, MAX_INT + 1, HUGE])
def test_out_of_range_path_ids_are_422(api, method, url, body, bad):
    kwargs = {"json": body} if body else {}
    response = getattr(api, method)(url.format(bad=bad), **kwargs)

    assert response.status_code == 422
    assert any(err["loc"][0] == "path" for err in response.json()["detail"])


@pytest.mark.parametrize(
    "url",
    [
        f"/cartes/{HUGE}",
        f"/decks/{HUGE}",
        "/decks/0",
    ],
)
def test_issue_examples_are_422(api, url):
    assert api.get(url).status_code == 422


@pytest.mark.parametrize(
    "url",
    [
        "/cartes/9999",
        f"/cartes/{MAX_INT}",
        "/bundles/9999",
        "/stock/9999/EN",
        "/decks/9999",
        f"/decks/{MAX_INT}",
        "/decks/9999/legalite",
    ],
)
def test_valid_but_unknown_ids_stay_404(api, db, url):
    add_languages(db, "EN")
    db.commit()

    assert api.get(url).status_code == 404


@pytest.mark.parametrize(
    "query",
    [
        "/cartes?clan_id=0",
        f"/cartes?clan_id={MAX_INT + 1}",
        f"/cartes?clan_id={HUGE}",
        "/bundles?card_set_id=0",
        f"/bundles?card_set_id={HUGE}",
    ],
)
def test_out_of_range_id_filters_are_422(api, query):
    assert api.get(query).status_code == 422


def test_id_filters_accept_the_upper_bound(api):
    assert api.get(f"/cartes?clan_id={MAX_INT}").json() == []
    assert api.get(f"/bundles?card_set_id={MAX_INT}").json() == []


# --- Borne haute de `offset` (sinon OverflowError sqlite -> 500) -------------


@pytest.mark.parametrize("route", ["/cartes", "/stock"])
def test_offset_accepts_the_upper_bound(api, route):
    response = api.get(f"{route}?offset={MAX_INT}")

    assert response.status_code == 200
    assert response.json() == []


@pytest.mark.parametrize("route", ["/cartes", "/stock"])
@pytest.mark.parametrize("offset", [MAX_INT + 1, 10**24, -1])
def test_offset_beyond_the_bound_is_422(api, route, offset):
    assert api.get(f"{route}?offset={offset}").status_code == 422


# --- Déclaration des codes d'erreur -----------------------------------------


def test_remove_deck_card_declares_and_returns_409_on_an_archived_deck(api, world):
    api.patch(f"/decks/{world.deck.id}", json={"archived": True})

    card_set_id = world.printing.card_set_id
    delete_url = f"/decks/{world.deck.id}/cartes/{world.card.id}/EN/{card_set_id}"
    response = api.delete(delete_url)

    assert response.status_code == 409
    declared = api.get("/openapi.json").json()["paths"]
    operation = declared[
        "/decks/{deck_id}/cartes/{card_id}/{language_code}/{card_set_id}"
    ]["delete"]
    assert {"404", "409"} <= set(operation["responses"])


# --- Courses : la base refuse, le service répond 409 ------------------------


def hide_from_get(monkeypatch, *models):
    """`Session.get` ignore ces modèles : la vérification préalable « passe »."""
    real = Session.get

    def fake(self, entity, ident, *args, **kwargs):
        if entity in models:
            return None
        return real(self, entity, ident, *args, **kwargs)

    monkeypatch.setattr(Session, "get", fake)


def test_create_deck_race_on_the_couple_is_409(api, world, monkeypatch):
    # Le service croit le couple (nom, discriminant) libre ; la base le refuse,
    # à chaque essai : il abandonne avec un 409, sans rien laisser derrière lui.
    monkeypatch.setattr(
        "app.services.decks._taken_discriminators", lambda *args, **kwargs: set()
    )
    monkeypatch.setattr(
        "app.services.decks.pick_discriminator",
        lambda taken: world.deck.discriminator,
    )

    response = api.post("/decks", json={"name": "Ventrue Grinder"})

    assert response.status_code == 409
    assert len(api.get("/decks").json()) == 1


def test_update_deck_race_on_the_couple_is_409(api, world, db, monkeypatch):
    # « Autre » porte le même discriminant que « Ventrue Grinder » : renommé, il
    # garderait un couple déjà pris. Le service, aveugle, ne le voit pas ; la
    # base refuse chaque essai, jusqu'au renoncement.
    other = make_deck(db, "Autre", discriminator=world.deck.discriminator)
    db.commit()
    monkeypatch.setattr(
        "app.services.decks._taken_discriminators", lambda *args, **kwargs: set()
    )
    monkeypatch.setattr(
        "app.services.decks.pick_discriminator",
        lambda taken: world.deck.discriminator,
    )

    response = api.patch(f"/decks/{other.id}", json={"name": "Ventrue Grinder"})

    assert response.status_code == 409
    monkeypatch.undo()
    unchanged = api.get(f"/decks/{other.id}").json()
    assert unchanged["name"] == "Autre"
    assert unchanged["discriminator"] == world.deck.discriminator


def test_create_stock_entry_race_is_409(api, world, monkeypatch):
    hide_from_get(monkeypatch, CardCopy)

    response = api.post(
        "/stock",
        json={
            "card_id": world.card.id,
            "language_code": "EN",
            "card_set_id": world.printing.card_set_id,
        },
    )

    assert response.status_code == 409


def test_create_language_race_is_409(api, db, monkeypatch):
    add_languages(db, "EN")
    db.commit()
    hide_from_get(monkeypatch, Language)

    response = api.post("/langues", json={"code": "EN", "label": "Anglais"})

    assert response.status_code == 409


def test_deposit_bundle_race_on_a_new_entry_is_409(api, world, db, monkeypatch):
    real = Session.scalars

    def blind_to_stock(self, statement, *args, **kwargs):
        descriptions = getattr(statement, "column_descriptions", None)
        if descriptions and descriptions[0].get("entity") is CardCopy:
            return iter(())
        return real(self, statement, *args, **kwargs)

    monkeypatch.setattr(Session, "scalars", blind_to_stock)

    response = api.post(
        f"/bundles/{world.bundle.id}/stock", json={"language_code": "EN"}
    )

    assert response.status_code == 409
    monkeypatch.undo()
    stock_url = f"/stock/{world.card.id}/EN/{world.bundle.card_set_id}"
    assert api.get(stock_url).json()["quantity_owned"] == 4


# --- Versement d'un produit : requêtes groupées -----------------------------


def add_to_bundle(db, world, name, category, copies):
    card = make_card(db, name, category=category)
    printing = CardPrinting(card_id=card.id, card_set_id=world.card_set.id)
    db.add(printing)
    db.flush()
    db.add(
        CardPrintingOccurrence(
            card_printing_id=printing.id,
            occurrence_type=PrintOccurrence.PRECON,
            bundle_id=world.bundle.id,
            copies=copies,
        )
    )
    return card


def test_deposit_bundle_mixes_existing_and_new_entries(api, world, db):
    library = add_to_bundle(db, world, "Bibliothèque", CardCategory.LIBRARY, 3)
    crypt = add_to_bundle(db, world, "Ancien", CardCategory.CRYPT, 1)
    # Sous la même extension que le produit : c'est là que le versement range
    # ses cartes (Lot 4), donc là qu'il faut déjà en posséder pour fusionner.
    make_copy(db, library, "EN", quantity_owned=5, card_set_id=world.card_set.id)
    db.commit()

    response = api.post(
        f"/bundles/{world.bundle.id}/stock", json={"language_code": "EN", "count": 2}
    )

    assert response.status_code == 200
    rows = response.json()
    # Crypt d'abord, puis par nom ; les quantités s'additionnent à l'existant.
    assert [(r["card"]["name"], r["quantity_owned"]) for r in rows] == [
        ("Aabbt Kindred", 4 + 2 * 2),
        ("Ancien", 2),
        ("Bibliothèque", 5 + 3 * 2),
    ]
    by_id = {r["card_id"]: r for r in rows}
    assert by_id[crypt.id]["notes"] is None


def test_deposit_bundle_query_count_does_not_grow_with_the_bundle(
    api, world, db, db_engine
):
    statements = []

    @event.listens_for(db_engine, "before_cursor_execute")
    def count_statement(conn, cursor, statement, *rest):
        statements.append(statement)

    def deposit():
        statements.clear()
        response = api.post(
            f"/bundles/{world.bundle.id}/stock", json={"language_code": "EN"}
        )
        assert response.status_code == 200
        return len(statements)

    baseline = deposit()
    for index in range(6):
        add_to_bundle(db, world, f"Carte {index}", CardCategory.LIBRARY, 1)
    db.commit()

    assert deposit() <= baseline + 1  # pas de requête par carte


# --- Ordre stable de la liste du stock --------------------------------------


def test_list_stock_breaks_ties_by_card_id_then_language(api, db):
    add_languages(db, "EN", "FR")
    first = make_card(db, "Homonyme")
    second = make_card(db, "Homonyme")
    for card in (second, first):
        for code in ("FR", "EN"):
            make_copy(db, card, code, quantity_owned=1)
    db.commit()

    rows = api.get("/stock").json()

    assert [(r["card_id"], r["language_code"]) for r in rows] == [
        (first.id, "EN"),
        (first.id, "FR"),
        (second.id, "EN"),
        (second.id, "FR"),
    ]
