"""API du catalogue : `/cartes`, `/bundles`, `/langues`."""

import json
from pathlib import Path

import pytest

from app.services.catalog_import import import_catalog
from tests.helpers import add_languages, make_card

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture
def catalog_in_db(db):
    vtes = json.loads((FIXTURES / "krcg_vtes.json").read_text(encoding="utf-8"))
    expansions = json.loads(
        (FIXTURES / "krcg_expansions.json").read_text(encoding="utf-8")
    )
    import_catalog(db, vtes, expansions)


def names(response):
    return [card["name"] for card in response.json()]


def test_list_cards_is_sorted_by_name(api, catalog_in_db):
    response = api.get("/cartes")

    assert response.status_code == 200
    assert names(response) == sorted(names(response))
    assert len(response.json()) == 9


def test_list_cards_search_is_case_insensitive_and_partial(api, catalog_in_db):
    assert names(api.get("/cartes", params={"q": "aabbt"})) == ["Aabbt Kindred"]
    assert names(api.get("/cartes", params={"q": "OPERATION"})) == ["419 Operation"]
    assert api.get("/cartes", params={"q": "zzzz"}).json() == []


def test_list_cards_filters_by_category_and_clan(api, catalog_in_db):
    library = api.get("/cartes", params={"category": "library"})
    assert {c["category"] for c in library.json()} == {"library"}

    ministry = api.get("/cartes").json()
    clan_id = next(c["clan"]["id"] for c in ministry if c["name"] == "Aabbt Kindred")
    by_clan = api.get("/cartes", params={"clan_id": clan_id})
    assert names(by_clan) == ["Aabbt Kindred"]


def test_list_cards_paginates(api, catalog_in_db):
    everything = names(api.get("/cartes"))
    page = api.get("/cartes", params={"limit": 2, "offset": 3})
    assert names(page) == everything[3:5]


@pytest.mark.parametrize(
    "params",
    [{"limit": 0}, {"limit": 201}, {"offset": -1}, {"category": "autre"}, {"q": ""}],
)
def test_list_cards_rejects_bad_parameters(api, params):
    assert api.get("/cartes", params=params).status_code == 422


def test_get_card_returns_the_full_sheet(api, db, catalog_in_db):
    aidan_id = next(
        c["id"] for c in api.get("/cartes", params={"q": "aidan"}).json()
    )

    response = api.get(f"/cartes/{aidan_id}")

    assert response.status_code == 200
    body = response.json()
    assert body["name"] == "Aidan Lyle"
    assert body["clan"]["name"] == "Tremere"
    assert body["capacity"] == 7
    assert {d["discipline"]["abbrev"] for d in body["discipline_links"]} == {
        "dom",
        "aus",
        "chi",
        "tha",
    }
    assert [t["name"] for t in body["types"]] == ["Vampire"]
    assert {t["language_code"] for t in body["translations"]} == {"FR", "ES"}
    sets = {p["card_set"]["abbrev"]: p for p in body["printings"]}
    assert set(sets) == {"KoT", "KoTR", "FB"}
    precon = next(
        o for o in sets["FB"]["occurrences"] if o["occurrence_type"] == "precon"
    )
    assert precon["copies"] == 1
    assert precon["bundle"]["code"] == "PTr"


def test_get_unknown_card_is_404(api):
    response = api.get("/cartes/9999")

    assert response.status_code == 404
    assert response.json() == {"detail": "Carte 9999 introuvable."}


def test_list_and_read_bundles(api, world):
    listed = api.get("/bundles")
    assert [b["code"] for b in listed.json()] == ["PS"]
    assert api.get("/bundles", params={"card_set_id": 9999}).json() == []
    assert len(api.get("/bundles", params={"q": "follow"}).json()) == 1

    content = api.get(f"/bundles/{world.bundle.id}")
    assert content.status_code == 200
    body = content.json()
    assert body["name"] == "Followers of Set"
    assert [(c["card"]["name"], c["copies"]) for c in body["cards"]] == [
        ("Aabbt Kindred", 2)
    ]


def test_bundle_content_sums_copies_and_lists_crypt_first(api, world, db):
    from app.models import (
        CardCategory,
        CardPrinting,
        CardPrintingOccurrence,
        PrintOccurrence,
    )

    library = make_card(db, "Aardvark", category=CardCategory.LIBRARY)
    printing = CardPrinting(card_id=library.id, card_set_id=world.card_set.id)
    db.add(printing)
    db.flush()
    db.add_all(
        [
            CardPrintingOccurrence(
                card_printing_id=printing.id,
                occurrence_type=PrintOccurrence.PRECON,
                bundle_id=world.bundle.id,
                copies=3,
            ),
            # Même carte, même produit, seconde occurrence : additionnée.
            CardPrintingOccurrence(
                card_printing_id=world.printing.id,
                occurrence_type=PrintOccurrence.PRECON,
                bundle_id=world.bundle.id,
                copies=1,
            ),
        ]
    )
    db.commit()

    body = api.get(f"/bundles/{world.bundle.id}").json()

    assert [(c["card"]["name"], c["copies"]) for c in body["cards"]] == [
        ("Aabbt Kindred", 3),
        ("Aardvark", 3),
    ]


def test_get_unknown_bundle_is_404(api):
    assert api.get("/bundles/9999").status_code == 404


def test_languages_are_listed_in_display_order(api, db):
    add_languages(db, "FR", "EN")
    db.commit()

    response = api.get("/langues")

    assert response.status_code == 200
    assert [(lang["code"], lang["sort_order"]) for lang in response.json()] == [
        ("FR", 1),
        ("EN", 2),
    ]


def test_create_language_normalizes_the_code(api, db):
    add_languages(db, "EN")
    db.commit()

    created = api.post("/langues", json={"code": "de", "label": "Allemand"})

    assert created.status_code == 201
    assert created.json()["code"] == "DE"
    assert "DE" in [lang["code"] for lang in api.get("/langues").json()]
    assert api.post("/langues", json={"code": "DE", "label": "x"}).status_code == 409
    assert api.post("/langues", json={"code": "", "label": "x"}).status_code == 422
