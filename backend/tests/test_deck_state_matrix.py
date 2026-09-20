"""Routes de decks : matrice état du deck x route, listes, bornes, langues.

La matrice dit, pour chaque route, ce que répond l'API selon que le deck est
vivant, archivé, supprimé ou inconnu : 404 pour l'inconnu, 409 pour un état qui
interdit l'écriture, jamais l'inverse.
"""

from datetime import UTC, datetime
from types import SimpleNamespace

import pytest

from app.models import (
    CardCategory,
    CardPrinting,
    CardPrintingOccurrence,
    PrintOccurrence,
)
from tests.helpers import add_languages, make_card, make_copy, make_deck

MAX_INT = 2**31 - 1
HUGE = 99999999999999999999
STATES = ("live", "archived", "deleted", "unknown")


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


@pytest.fixture
def by_state(api, db):
    """Un deck vivant, un archivé, un supprimé (chacun avec une ligne EN)."""
    add_languages(db, "EN", "FR")
    card = make_card(db, "Matrice")
    make_copy(db, card, "EN", quantity_owned=30)
    make_copy(db, card, "FR", quantity_owned=30)
    decks = {state: make_deck(db, f"Deck {state}") for state in STATES[:3]}
    db.commit()
    for deck in decks.values():
        assert add_line(api, deck.id, card.id).status_code == 201
    assert api.patch(f"/decks/{decks['archived'].id}", json={"archived": True})
    assert api.patch(f"/decks/{decks['deleted'].id}", json={"archived": True})
    assert api.delete(f"/decks/{decks['deleted'].id}").status_code == 204
    ids = {state: deck.id for state, deck in decks.items()} | {"unknown": 9999}
    return SimpleNamespace(ids=ids, card=card)


def line_body(language="FR", card_id=None):
    return lambda card: {
        "card_id": card_id or card.id,
        "language_code": language,
        "quantity": 1,
    }


# (méthode, chemin, corps ou fabrique de corps, statuts : vivant, archivé, supprimé,
# inconnu)
CASES = [
    ("get", "/decks/{d}", None, (200, 200, 200, 404)),
    ("get", "/decks/{d}/legalite", None, (200, 200, 409, 404)),
    ("patch", "/decks/{d}", {"notes": "x"}, (200, 409, 409, 404)),
    ("patch", "/decks/{d}", {"name": "Renommé"}, (200, 409, 409, 404)),
    ("patch", "/decks/{d}", {"status": "draft"}, (200, 409, 409, 404)),
    ("patch", "/decks/{d}", {"archived": True}, (200, 200, 409, 404)),
    ("patch", "/decks/{d}", {"archived": False}, (200, 200, 409, 404)),
    ("patch", "/decks/{d}", {}, (200, 200, 409, 404)),
    ("delete", "/decks/{d}", None, (409, 204, 409, 404)),
    ("post", "/decks/{d}/cartes", line_body("FR"), (201, 409, 409, 404)),
    ("post", "/decks/{d}/cartes", line_body("EN"), (409, 409, 409, 404)),
    ("post", "/decks/{d}/cartes", line_body("FR", 9999), (404, 409, 409, 404)),
    ("patch", "/decks/{d}/cartes/{c}/EN", {"quantity": 2}, (200, 409, 409, 404)),
    ("patch", "/decks/{d}/cartes/{c}/ES", {"quantity": 2}, (404, 409, 409, 404)),
    ("delete", "/decks/{d}/cartes/{c}/EN", None, (204, 409, 409, 404)),
    ("delete", "/decks/{d}/cartes/{c}/ES", None, (404, 409, 409, 404)),
]


@pytest.mark.parametrize(
    ("method", "path", "body", "expected"),
    CASES,
    ids=[f"{m}-{p}-{b if not callable(b) else 'line'}" for m, p, b, _ in CASES],
)
def test_every_deck_route_answers_by_deck_state(
    api, by_state, method, path, body, expected
):
    for state, status in zip(STATES, expected, strict=True):
        url = path.format(d=by_state.ids[state], c=by_state.card.id)
        payload = body(by_state.card) if callable(body) else body
        kwargs = {} if payload is None else {"json": payload}

        response = getattr(api, method)(url, **kwargs)

        assert response.status_code == status, (state, response.text)
        if status == 409 and state == "deleted":
            assert "supprimé" in response.json()["detail"], state
        if status == 409 and state in ("live", "archived"):
            assert "archiv" in response.json()["detail"] or "déjà" in (
                response.json()["detail"]
            ), state
        if status == 404 and state == "unknown":
            assert "introuvable" in response.json()["detail"]


def test_a_refused_write_on_a_deleted_deck_changes_nothing(api, by_state):
    deleted = by_state.ids["deleted"]
    before = api.get(f"/decks/{deleted}").json()

    api.patch(f"/decks/{deleted}", json={"notes": "x", "archived": False})
    add_line(api, deleted, by_state.card.id, "FR")
    api.delete(f"/decks/{deleted}/cartes/{by_state.card.id}/EN")
    api.delete(f"/decks/{deleted}")

    assert api.get(f"/decks/{deleted}").json() == before


def test_deleting_twice_is_a_409_the_second_time(api, by_state):
    archived = by_state.ids["archived"]

    assert api.delete(f"/decks/{archived}").status_code == 204
    second = api.delete(f"/decks/{archived}")

    assert second.status_code == 409
    assert "supprimé" in second.json()["detail"]


# --- Listes ------------------------------------------------------------------


def names(api, **params):
    response = api.get("/decks", params=params)
    assert response.status_code == 200
    return [d["name"] for d in response.json()]


def test_state_all_mixes_active_and_archived_sorted_by_name(api, db):
    make_deck(db, "Charlie")
    make_deck(db, "Alpha", archived_at=datetime.now(UTC))
    make_deck(db, "Bravo")
    make_deck(db, "Delta", archived_at=datetime.now(UTC))
    make_deck(
        db,
        "Aardvark",
        archived_at=datetime.now(UTC),
        deleted_at=datetime.now(UTC),
    )
    db.commit()

    assert names(api, state="all") == ["Alpha", "Bravo", "Charlie", "Delta"]
    assert names(api, state="active") == ["Bravo", "Charlie"]
    assert names(api, state="archived") == ["Alpha", "Delta"]


def test_each_deck_appears_in_exactly_one_of_active_and_archived(api, db):
    for index in range(6):
        archived_at = datetime.now(UTC) if index % 2 else None
        make_deck(db, f"Deck {index}", archived_at=archived_at)
    db.commit()

    active = names(api, state="active")
    archived = names(api, state="archived")

    assert set(active).isdisjoint(archived)
    assert sorted(active + archived) == names(api, state="all")


def test_homonyms_are_ordered_by_discriminator_then_id_in_every_state(api, db):
    make_deck(db, "Même", discriminator="0300")
    make_deck(db, "Même", discriminator="0100", archived_at=datetime.now(UTC))
    make_deck(db, "Même", discriminator="0200")
    db.commit()

    body = api.get("/decks", params={"state": "all"}).json()

    assert [d["discriminator"] for d in body] == ["0100", "0200", "0300"]
    active = api.get("/decks").json()
    assert [d["discriminator"] for d in active] == ["0200", "0300"]


def test_the_list_order_does_not_depend_on_creation_order(api, db):
    for name in ("Zed", "Mid", "Amy", "Bob"):
        make_deck(db, name)
    db.commit()

    assert names(api) == ["Amy", "Bob", "Mid", "Zed"]
    assert names(api) == names(api)  # deux lectures, même ordre


def test_status_and_state_filters_combine_over_every_state(api, db):
    make_deck(db, "A", status="active")
    make_deck(db, "B", status="active", archived_at=datetime.now(UTC))
    make_deck(db, "C", status="draft")
    make_deck(db, "D", status="draft", archived_at=datetime.now(UTC))
    db.commit()

    assert names(api, state="all", status="active") == ["A", "B"]
    assert names(api, state="all", status="draft") == ["C", "D"]
    assert names(api, state="archived", status="draft") == ["D"]
    assert names(api, state="active", status="active") == ["A"]


def test_the_status_filter_rejects_an_archived_value(api):
    # « archived » est un état de liste, pas un statut de deck.
    assert api.get("/decks", params={"status": "archived"}).status_code == 422
    assert api.get("/decks", params={"state": "ACTIVE"}).status_code == 422


def test_the_name_filter_treats_wildcards_literally(api, db):
    for name in ("100% Bleed", "Under_score", "Back\\slash", "Plain"):
        make_deck(db, name)
    db.commit()

    assert names(api, q="%") == ["100% Bleed"]
    assert names(api, q="_") == ["Under_score"]
    assert names(api, q="\\") == ["Back\\slash"]
    assert names(api, q="100%") == ["100% Bleed"]
    assert names(api, q="%%") == []
    assert names(api, q="a_") == []


def test_the_name_filter_ignores_ascii_case_and_an_empty_filter_lists_all(api, db):
    make_deck(db, "Malkavien")
    make_deck(db, "Ventrue")
    db.commit()

    assert names(api, q="MALK") == ["Malkavien"]
    assert names(api, q="ventrue") == ["Ventrue"]
    assert names(api, q="") == ["Malkavien", "Ventrue"]


def test_the_name_filter_ignores_the_case_of_accented_letters(api, db):
    make_deck(db, "Élan vital")
    db.commit()

    assert names(api, q="élan") == ["Élan vital"]


def test_the_stock_filter_ignores_the_case_of_accented_letters(api, db):
    add_languages(db, "EN")
    make_copy(db, make_card(db, "Éloïse"))
    db.commit()

    assert len(api.get("/stock", params={"q": "éloïse"}).json()) == 1
    assert len(api.get("/stock", params={"q": "ÉLOÏSE"}).json()) == 1


# --- Noms : bornes -----------------------------------------------------------


def test_deck_name_and_archetype_length_limits(api):
    assert api.post("/decks", json={"name": "x" * 120}).status_code == 201
    assert api.post("/decks", json={"name": "x" * 121}).status_code == 422
    too_long = api.post("/decks", json={"name": "a", "archetype": "y" * 121})
    assert too_long.status_code == 422


def test_a_blank_deck_name_is_refused(api):
    assert api.post("/decks", json={"name": "   "}).status_code == 422


# --- Quantités : bornes 422 --------------------------------------------------


@pytest.mark.parametrize("bad", [MAX_INT + 1, HUGE])
def test_oversized_quantities_are_422_on_every_route(api, db, bad):
    add_languages(db, "EN")
    card = make_card(db)
    make_copy(db, card, quantity_owned=5, proxy_allowed=True)
    other = make_card(db, "Autre")
    deck = make_deck(db)
    db.commit()
    assert add_line(api, deck.id, card.id).status_code == 201

    responses = {
        "stock create": api.post(
            "/stock",
            json={"card_id": other.id, "language_code": "EN", "quantity_owned": bad},
        ),
        "stock patch": api.patch(f"/stock/{card.id}/EN", json={"quantity_owned": bad}),
        "bundle count": api.post(
            "/bundles/1/stock", json={"language_code": "EN", "count": bad}
        ),
        "line quantity": add_line(api, deck.id, other.id, quantity=bad),
        "line proxy": add_line(api, deck.id, other.id, quantity=bad, proxy=bad),
        "line patch quantity": api.patch(
            f"/decks/{deck.id}/cartes/{card.id}/EN", json={"quantity": bad}
        ),
        "line patch proxy": api.patch(
            f"/decks/{deck.id}/cartes/{card.id}/EN", json={"proxy_quantity": bad}
        ),
    }

    for label, response in responses.items():
        assert response.status_code == 422, label


@pytest.mark.parametrize("bad", [0, -1, MAX_INT + 1, HUGE])
def test_out_of_range_card_ids_in_a_body_are_422(api, db, bad):
    add_languages(db, "EN")
    deck = make_deck(db)
    db.commit()

    line = add_line(api, deck.id, bad)
    stock = api.post("/stock", json={"card_id": bad, "language_code": "EN"})

    assert line.status_code == 422
    assert stock.status_code == 422


@pytest.mark.parametrize("bad", [0, -1])
def test_non_positive_line_quantities_are_422(api, db, bad):
    add_languages(db, "EN")
    card = make_card(db)
    make_copy(db, card, quantity_owned=3)
    deck = make_deck(db)
    db.commit()
    assert add_line(api, deck.id, card.id).status_code == 201

    assert add_line(api, deck.id, card.id, "EN", bad).status_code == 422
    patched = api.patch(f"/decks/{deck.id}/cartes/{card.id}/EN", json={"quantity": bad})
    assert patched.status_code == 422


def test_a_negative_proxy_quantity_is_422(api, db):
    add_languages(db, "EN")
    card = make_card(db)
    make_copy(db, card, quantity_owned=3, proxy_allowed=True)
    deck = make_deck(db)
    db.commit()

    assert add_line(api, deck.id, card.id, quantity=1, proxy=-1).status_code == 422


def test_a_stock_entry_accepts_zero_and_the_upper_bound(api, db):
    add_languages(db, "EN", "FR")
    first = make_card(db)
    second = make_card(db, "Autre")
    db.commit()

    zero = api.post("/stock", json={"card_id": first.id, "language_code": "EN"})
    top = api.post(
        "/stock",
        json={"card_id": second.id, "language_code": "EN", "quantity_owned": MAX_INT},
    )

    assert zero.status_code == 201 and zero.json()["quantity_owned"] == 0
    assert top.status_code == 201 and top.json()["quantity_owned"] == MAX_INT
    lowered = api.patch(f"/stock/{second.id}/EN", json={"quantity_owned": 0})
    assert lowered.status_code == 200


def test_a_bundle_deposit_cannot_push_the_stock_past_the_bound(api, world):
    before = api.get(f"/stock/{world.card.id}/EN").json()["quantity_owned"]

    response = api.post(
        f"/bundles/{world.bundle.id}/stock",
        json={"language_code": "EN", "count": MAX_INT},
    )

    assert response.status_code == 409
    # Transaction annulée : l'entrée existante n'a pas bougé.
    after = api.get(f"/stock/{world.card.id}/EN").json()["quantity_owned"]
    assert after == before


def test_a_refused_bundle_deposit_creates_and_changes_nothing(api, db, world):
    # Second contenu du produit, absent du stock : sa ligne serait créée.
    other = make_card(db, "Autre du produit")
    printing = CardPrinting(card_id=other.id, card_set_id=world.card_set.id)
    db.add(printing)
    db.flush()
    db.add(
        CardPrintingOccurrence(
            card_printing_id=printing.id,
            occurrence_type=PrintOccurrence.PRECON,
            bundle_id=world.bundle.id,
            copies=2,
        )
    )
    db.commit()
    # Seule l'entrée déjà possédée (4 + 2 x count) dépasse le plafond.
    count = (MAX_INT - 3) // 2

    response = api.post(
        f"/bundles/{world.bundle.id}/stock",
        json={"language_code": "EN", "count": count},
    )

    assert response.status_code == 409
    assert api.get(f"/stock/{world.card.id}/EN").json()["quantity_owned"] == 4
    assert api.get(f"/stock/{other.id}/EN").status_code == 404


def test_a_bundle_deposit_reaching_exactly_the_bound_is_accepted(api, world):
    # Le précon compte 2 exemplaires : de 1 possédé, (MAX - 1) / 2 produits
    # amènent l'entrée exactement à MAX.
    api.patch(f"/stock/{world.card.id}/FR", json={"quantity_owned": 1})

    response = api.post(
        f"/bundles/{world.bundle.id}/stock",
        json={"language_code": "FR", "count": (MAX_INT - 1) // 2},
    )

    assert response.status_code == 200
    assert [row["quantity_owned"] for row in response.json()] == [MAX_INT]
    # Un produit de plus dépasse : 409, et l'entrée reste au plafond.
    again = api.post(
        f"/bundles/{world.bundle.id}/stock",
        json={"language_code": "FR", "count": 1},
    )
    assert again.status_code == 409
    assert api.get(f"/stock/{world.card.id}/FR").json()["quantity_owned"] == MAX_INT


# --- Langues : casse et espaces ---------------------------------------------


def test_language_codes_are_normalised_in_paths_and_bodies(api, db):
    add_languages(db, "EN", "FR")
    card = make_card(db)
    make_copy(db, card, "EN", quantity_owned=2)
    make_copy(db, card, "FR", quantity_owned=2, proxy_allowed=True)
    deck = make_deck(db)
    db.commit()

    padded = add_line(api, deck.id, card.id, " fr ", quantity=2, proxy=1)
    assert padded.status_code == 201
    assert padded.json()["language_code"] == "FR"
    assert add_line(api, deck.id, card.id, "en").json()["language_code"] == "EN"
    # Le même code en autre casse est la même ligne, pas une seconde.
    assert add_line(api, deck.id, card.id, "Fr").status_code == 409

    patched = api.patch(f"/decks/{deck.id}/cartes/{card.id}/fr", json={"quantity": 1})
    assert patched.status_code == 200
    assert patched.json()["language_code"] == "FR"
    assert api.delete(f"/decks/{deck.id}/cartes/{card.id}/en").status_code == 204
    cards = api.get(f"/decks/{deck.id}").json()["cards"]
    assert [(c["language_code"], c["quantity"]) for c in cards] == [("FR", 1)]


def test_lowercase_language_in_a_stock_path_reaches_the_same_entry(api, db):
    add_languages(db, "EN", "FR")
    card = make_card(db)
    make_copy(db, card, "FR", quantity_owned=2)
    db.commit()

    assert api.get(f"/stock/{card.id}/fr").json()["language_code"] == "FR"
    patched = api.patch(f"/stock/{card.id}/fr", json={"quantity_owned": 3})
    assert patched.json()["quantity_owned"] == 3
    assert api.delete(f"/stock/{card.id}/fr").status_code == 204


@pytest.mark.parametrize("code", ["ZZ", "ABCDEFGHIJKLMNOP", "e n"])
def test_an_unknown_language_in_a_line_path_is_a_404_not_a_500(api, db, code):
    add_languages(db, "EN")
    card = make_card(db)
    make_copy(db, card, quantity_owned=2)
    deck = make_deck(db)
    db.commit()
    assert add_line(api, deck.id, card.id).status_code == 201

    line = f"/decks/{deck.id}/cartes/{card.id}/{code}"
    patched = api.patch(line, json={"quantity": 1})
    removed = api.delete(line)

    assert (patched.status_code, removed.status_code) == (404, 404)


def test_an_unknown_language_in_a_body_is_a_409_not_a_500(api, db):
    add_languages(db, "EN")
    card = make_card(db)
    make_copy(db, card, quantity_owned=2)
    deck = make_deck(db)
    db.commit()

    response = add_line(api, deck.id, card.id, "ZZ")

    assert response.status_code == 409


# --- Homonymes dans un deck --------------------------------------------------


def test_two_same_name_cards_are_two_lines_and_read_the_same_live_or_deleted(api, db):
    add_languages(db, "EN")
    first = make_card(db, "Theo Bell", group_code="G6")
    second = make_card(db, "Theo Bell", group_code="G2")
    library = make_card(db, "Bibliothèque", category=CardCategory.LIBRARY)
    for card in (first, second, library):
        make_copy(db, card, quantity_owned=2)
    deck = make_deck(db)
    db.commit()
    for card in (second, first, library):
        assert add_line(api, deck.id, card.id, quantity=2).status_code == 201
    live = api.get(f"/decks/{deck.id}").json()["cards"]

    assert api.patch(f"/decks/{deck.id}", json={"archived": True}).status_code == 200
    assert api.delete(f"/decks/{deck.id}").status_code == 204
    frozen = api.get(f"/decks/{deck.id}").json()["cards"]

    assert len(live) == 3
    assert {c["card_id"] for c in live if c["card"]["name"] == "Theo Bell"} == {
        first.id,
        second.id,
    }
    assert frozen == live  # même contenu, même ordre, y compris entre homonymes
