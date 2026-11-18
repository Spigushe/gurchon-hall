"""Lot 12, étape B4 : tris repliés côté API (A7).

`GET /cartes`, `GET /stock` et `GET /decks` rangeaient les noms dans la
collation binaire de SQLite : majuscules avant minuscules, « Élan » après
« Zoé ». Ils trient désormais par nom replié (`fold_text`), puis par nom brut,
puis par leurs clés propres. L'ordre attendu vient d'une table de cas commune
avec le miroir local (`tests/fixtures/folded_sort_cases.json`, reprise par
`compareFolded` côté client à l'étape C1) ; l'export du compte (B2) suit la
même règle.
"""

import json
from pathlib import Path

import pytest

from app.db.folding import fold_text
from app.models.collection import DeckCard
from tests.helpers import (
    add_languages,
    login_default_account,
    make_card,
    make_copy,
    make_deck,
    make_printing,
)

CASES_FILE = Path(__file__).parent / "fixtures" / "folded_sort_cases.json"
CASES = json.loads(CASES_FILE.read_text(encoding="utf-8"))["cases"]


def _ids(case):
    return case["description"]


def _printed_card(db, name, **fields):
    """Une carte et son impression : `GET /cartes` exige une impression (D2b)."""
    card = make_card(db, name=name, **fields)
    make_printing(db, card)
    return card


@pytest.fixture
def api(api, db):
    """`api` authentifié : `/stock` et `/decks` exigent une session (Lot 6)."""
    return login_default_account(api, db)


# --- La table elle-même ------------------------------------------------------


def test_the_table_has_cases_and_each_has_its_three_keys():
    assert len(CASES) >= 8
    for case in CASES:
        assert set(case) == {"description", "names", "expected"}
        assert sorted(case["names"]) == sorted(case["expected"])
        assert len(set(case["names"])) == len(case["names"])


def test_the_table_differs_from_the_binary_order_somewhere():
    """Sans un cas où l'ordre binaire se trompe, la table ne prouverait rien."""
    assert any(sorted(case["names"]) != case["expected"] for case in CASES)


def test_the_table_keeps_to_the_basic_multilingual_plane():
    """Au-delà, JavaScript (UTF-16) et SQLite (UTF-8) ne rangent plus pareil."""
    for case in CASES:
        for name in case["names"]:
            assert all(ord(char) <= 0xFFFF for char in name), name


@pytest.mark.parametrize("case", CASES, ids=_ids)
def test_the_rule_in_python_gives_the_expected_order(case):
    """Clé de la règle, écrite une fois en Python : repli, puis nom brut."""
    ordered = sorted(case["names"], key=lambda name: (fold_text(name), name))
    assert ordered == case["expected"]


# --- Les trois listes de l'API ----------------------------------------------


@pytest.mark.parametrize("case", CASES, ids=_ids)
def test_cards_are_listed_in_folded_order(api, db, case):
    for name in case["names"]:
        _printed_card(db, name)
    db.commit()

    response = api.get("/cartes", params={"limit": 200})

    assert response.status_code == 200
    assert [card["name"] for card in response.json()] == case["expected"]


@pytest.mark.parametrize("case", CASES, ids=_ids)
def test_stock_is_listed_in_folded_order(api, db, case):
    add_languages(db, "EN")
    for name in case["names"]:
        make_copy(db, make_card(db, name=name))
    db.commit()

    response = api.get("/stock", params={"limit": 200})

    assert response.status_code == 200
    assert [entry["card"]["name"] for entry in response.json()] == case["expected"]


@pytest.mark.parametrize("case", CASES, ids=_ids)
def test_decks_are_listed_in_folded_order(api, db, case):
    for name in case["names"]:
        make_deck(db, name=name)
    db.commit()

    response = api.get("/decks")

    assert response.status_code == 200
    assert [deck["name"] for deck in response.json()] == case["expected"]


# --- Les clés suivantes restent en place -------------------------------------


def test_a_same_name_still_falls_back_on_the_group_then_the_id(api, db):
    second = _printed_card(db, "Theo Bell", group_code="6")
    first = _printed_card(db, "Theo Bell", group_code="2")
    db.commit()

    listed = api.get("/cartes").json()

    assert [card["id"] for card in listed] == [first.id, second.id]


def test_a_same_deck_name_still_falls_back_on_the_discriminator(api, db):
    late = make_deck(db, name="Banu Princes", discriminator="9000")
    early = make_deck(db, name="banu princes", discriminator="0001")
    same = make_deck(db, name="Banu Princes", discriminator="0002")
    db.commit()

    listed = api.get("/decks").json()

    # Nom brut avant le discriminant : « Banu » (B majuscule) passe devant
    # « banu », puis les deux « Banu Princes » par discriminant.
    assert [deck["id"] for deck in listed] == [same.id, late.id, early.id]


def test_stock_of_one_card_still_falls_back_on_the_language(api, db):
    add_languages(db, "EN", "FR")
    card = make_card(db, name="Élan vital")
    make_copy(db, card, language_code="FR")
    make_copy(db, card, language_code="EN")
    make_copy(db, make_card(db, name="Zoé"))
    make_copy(db, make_card(db, name="Dame"))
    db.commit()

    listed = api.get("/stock").json()

    assert [(e["card"]["name"], e["language_code"]) for e in listed] == [
        ("Dame", "EN"),
        ("Élan vital", "EN"),
        ("Élan vital", "FR"),
        ("Zoé", "EN"),
    ]


def test_the_search_still_filters_before_the_sort(api, db):
    for name in ("Zoé", "Élan", "Dame", "élan"):
        _printed_card(db, name)
    db.commit()

    found = api.get("/cartes", params={"q": "ELAN"}).json()

    assert [card["name"] for card in found] == ["Élan", "élan"]


# --- L'export du compte -------------------------------------------------------


def test_the_account_export_lists_the_collection_in_folded_order(api, db):
    add_languages(db, "EN")
    case = next(c for c in CASES if c["names"] == ["Zoé", "Élan", "Dame"])
    for name in case["names"]:
        make_copy(db, make_card(db, name=name))
    db.commit()

    exported = api.get("/moi/export").json()

    assert [e["card_name"] for e in exported["collection"]] == case["expected"]


def test_the_account_export_lists_deck_lines_in_folded_order(api, db):
    add_languages(db, "EN")
    deck = make_deck(db, name="Ordre", proxy_allowed=True)
    for name in ("abbot", "Bastet", "Abbot"):
        card = make_card(db, name=name)
        printing = make_printing(db, card)
        db.add(
            DeckCard(
                user_id=deck.user_id,
                deck_id=deck.id,
                card_id=card.id,
                language_code="EN",
                card_set_id=printing.card_set_id,
                quantity=1,
                proxy_quantity=1,
            )
        )
    db.commit()

    exported = api.get("/moi/export").json()
    lines = next(d for d in exported["decks"] if d["name"] == "Ordre")["cards"]

    assert [line["card_name"] for line in lines] == ["Abbot", "abbot", "Bastet"]
