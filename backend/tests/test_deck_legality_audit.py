"""Légalité et activation d'un deck : frontières de dates, variantes, combinaisons.

Complète `test_api_decks.py`. Toutes les dates d'évaluation sont explicites
(`get_legality(..., on=...)`) ou figées (`_today` remplacée) : aucun test ne
dépend de l'horloge, donc aucun ne bascule au passage de minuit UTC.
"""

from datetime import date, timedelta

import pytest

from app.models import CardCategory
from app.services import decks
from tests.helpers import add_languages, make_card, make_copy, make_deck

DAY = date(2026, 6, 15)
LIBRARY = CardCategory.LIBRARY


@pytest.fixture
def frozen_today(monkeypatch):
    """Le service croit que nous sommes le 15 juin 2026."""
    monkeypatch.setattr(decks, "_today", lambda: DAY)
    return DAY


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


def build(api, db, *specs, name="Deck"):
    """Un deck composé des cartes décrites, chacune possédée en quantité voulue.

    Une spec est un dict : `name`, `quantity`, `category` (crypt par défaut) et
    tout champ de `Card` (`group_code`, `advanced`, `banned_on`, `legal_from`).
    """
    add_languages(db, "EN", "FR")
    made = []
    for spec in specs:
        fields = dict(spec)
        quantity = fields.pop("quantity")
        category = fields.pop("category", CardCategory.CRYPT)
        card = make_card(db, fields.pop("name"), category=category, **fields)
        make_copy(db, card, quantity_owned=quantity)
        made.append((card, quantity))
    deck = make_deck(db, name)
    db.commit()
    for card, quantity in made:
        assert add_line(api, deck.id, card.id, quantity=quantity).status_code == 201
    return deck


def crypt(name="Vampire", quantity=12, group="G1", **fields):
    return {"name": name, "quantity": quantity, "group_code": group, **fields}


def library(name="Livre", quantity=60, **fields):
    return {"name": name, "quantity": quantity, "category": LIBRARY, **fields}


def legal_deck(api, db, **extra_crypt):
    return build(api, db, crypt(**extra_crypt), library())


def activate(api, deck_id, **fields):
    return api.patch(f"/decks/{deck_id}", json={"status": "active", **fields})


def issue_starting_with(body, prefix):
    (issue,) = [i for i in body["issues"] if i.startswith(prefix)]
    return issue


# --- Frontière de dates : service, date explicite ---------------------------


@pytest.mark.parametrize(
    ("offset", "banned"),
    [(-30, False), (-1, False), (0, True), (1, True), (400, True)],
)
def test_ban_boundary_is_inclusive_on_the_ban_day(api, db, offset, banned):
    deck = build(api, db, crypt(banned_on=DAY), library())

    result = decks.get_legality(db, deck.id, on=DAY + timedelta(days=offset))

    assert result.evaluated_on == DAY + timedelta(days=offset)
    assert [c.name for c in result.banned_cards] == (["Vampire"] if banned else [])
    assert result.is_legal is (not banned)
    assert result.not_yet_legal_cards == []


@pytest.mark.parametrize(
    ("offset", "early"),
    [(-400, True), (-1, True), (0, False), (1, False), (30, False)],
)
def test_legality_boundary_is_inclusive_on_the_legal_day(api, db, offset, early):
    deck = build(api, db, crypt(legal_from=DAY), library())

    result = decks.get_legality(db, deck.id, on=DAY + timedelta(days=offset))

    early_names = [c.name for c in result.not_yet_legal_cards]
    assert early_names == (["Vampire"] if early else [])
    assert result.is_legal is (not early)
    assert result.banned_cards == []


@pytest.mark.parametrize(
    ("offset", "banned", "early"),
    [
        (-11, False, True),  # avant l'entrée en légalité
        (-10, False, False),  # le jour de l'entrée : jouable
        (-1, False, False),
        (0, True, False),  # le jour du ban : banni
        (5, True, False),
    ],
)
def test_a_card_with_both_dates_follows_the_timeline(api, db, offset, banned, early):
    deck = build(
        api,
        db,
        crypt(legal_from=DAY - timedelta(days=10), banned_on=DAY),
        library(),
    )

    result = decks.get_legality(db, deck.id, on=DAY + timedelta(days=offset))

    assert bool(result.banned_cards) is banned
    assert bool(result.not_yet_legal_cards) is early
    assert result.is_legal is (not banned and not early)


def test_a_card_without_any_date_is_legal_at_any_date(api, db):
    deck = legal_deck(api, db)

    for on in (date(1990, 1, 1), DAY, date(2999, 12, 31)):
        result = decks.get_legality(db, deck.id, on=on)
        assert result.is_legal is True, on
        assert (result.banned_cards, result.not_yet_legal_cards) == ([], [])


def test_the_verdict_can_be_replayed_at_two_dates_on_the_same_deck(api, db):
    deck = build(api, db, crypt(banned_on=DAY), library())

    before = decks.get_legality(db, deck.id, on=DAY - timedelta(days=1))
    after = decks.get_legality(db, deck.id, on=DAY)
    again = decks.get_legality(db, deck.id, on=DAY - timedelta(days=1))

    assert (before.is_legal, after.is_legal, again.is_legal) == (True, False, True)


def test_the_http_verdict_is_dated_by_the_service_clock(api, db, frozen_today):
    deck = legal_deck(api, db)

    body = api.get(f"/decks/{deck.id}/legalite").json()

    assert body["evaluated_on"] == DAY.isoformat()


@pytest.mark.parametrize(
    ("banned_on", "expected_banned"),
    [(DAY - timedelta(days=1), True), (DAY, True), (DAY + timedelta(days=1), False)],
)
def test_the_http_ban_boundary_follows_the_service_clock(
    api, db, frozen_today, banned_on, expected_banned
):
    deck = build(api, db, crypt(banned_on=banned_on), library())

    body = api.get(f"/decks/{deck.id}/legalite").json()

    assert bool(body["banned_cards"]) is expected_banned
    assert body["is_legal"] is (not expected_banned)


# --- Variantes d'un même nom -------------------------------------------------


def test_the_base_variant_is_designated_when_only_it_is_banned(api, db):
    deck = build(
        api,
        db,
        crypt("Theo Bell", 6, "G2", banned_on=DAY),
        crypt("Theo Bell", 6, "G2", advanced=True),
        library(),
    )

    body = decks.get_legality(db, deck.id, on=DAY).model_dump()

    (card,) = body["banned_cards"]
    assert (card["group_code"], card["advanced"]) == ("G2", False)
    (issue,) = [i for i in body["issues"] if i.startswith("Carte(s) bannie")]
    assert "Theo Bell (G2)" in issue and "Adv" not in issue


def test_only_the_banned_group_variant_is_designated(api, db):
    deck = build(
        api,
        db,
        crypt("Theo Bell", 6, "G2", banned_on=DAY),
        crypt("Theo Bell", 6, "G6"),
        library(),
    )

    body = decks.get_legality(db, deck.id, on=DAY).model_dump()

    assert [c["group_code"] for c in body["banned_cards"]] == ["G2"]
    issue = issue_starting_with(body, "Carte(s) bannie")
    assert "Theo Bell (G2)" in issue and "G6" not in issue
    assert body["crypt_groups"] == ["G2", "G6"]  # illégal aussi par les groupes


def test_only_the_early_variant_is_designated_as_not_yet_legal(api, db):
    deck = build(
        api,
        db,
        crypt("Theo Bell", 6, "G2", advanced=True, legal_from=DAY),
        crypt("Theo Bell", 6, "G2"),
        library(),
    )

    body = decks.get_legality(db, deck.id, on=DAY - timedelta(days=1)).model_dump()

    (card,) = body["not_yet_legal_cards"]
    assert (card["group_code"], card["advanced"]) == ("G2", True)
    issue = issue_starting_with(body, "Carte(s) pas encore")
    assert "Theo Bell (G2, Adv)" in issue


def test_both_variants_are_designated_when_both_are_banned(api, db):
    deck = build(
        api,
        db,
        crypt("Theo Bell", 6, "G2", banned_on=DAY),
        crypt("Theo Bell", 6, "G2", advanced=True, banned_on=DAY),
        library(),
    )

    body = decks.get_legality(db, deck.id, on=DAY).model_dump()

    assert [(c["group_code"], c["advanced"]) for c in body["banned_cards"]] == [
        ("G2", False),
        ("G2", True),
    ]
    issue = issue_starting_with(body, "Carte(s) bannie")
    assert "Theo Bell (G2), Theo Bell (G2, Adv)" in issue


def test_two_distinct_same_name_cards_only_the_banned_one_is_reported(api, db):
    banned = library("Doublon", 1, banned_on=DAY - timedelta(days=5))
    fine = library("Doublon", 1)
    deck = build(api, db, crypt(), library(), banned, fine)

    body = decks.get_legality(db, deck.id, on=DAY).model_dump()

    assert len(body["banned_cards"]) == 1


def test_two_distinct_same_name_cards_only_the_early_one_is_reported(api, db):
    early = library("Doublon", 1, legal_from=DAY + timedelta(days=5))
    fine = library("Doublon", 1)
    deck = build(api, db, crypt(), library(), early, fine)

    body = decks.get_legality(db, deck.id, on=DAY).model_dump()

    assert len(body["not_yet_legal_cards"]) == 1


def test_same_name_cards_count_separately_in_the_deck_sizes(api, db):
    deck = build(
        api, db, crypt("Homonyme", 6, "G1"), crypt("Homonyme", 6, "G1"), library()
    )

    body = decks.get_legality(db, deck.id, on=DAY)

    assert body.crypt_count == 12
    assert body.is_legal is True


# --- Effectifs : proxies et deux langues ------------------------------------


def test_proxies_count_in_the_deck_sizes(api, db):
    add_languages(db, "EN")
    vampire = make_card(db, "Vampire", group_code="G1")
    book = make_card(db, "Livre", category=LIBRARY)
    make_copy(db, vampire, quantity_owned=0, proxy_allowed=True)
    make_copy(db, book, quantity_owned=0, proxy_allowed=True)
    deck = make_deck(db)
    db.commit()
    assert add_line(api, deck.id, vampire.id, quantity=12, proxy=12).status_code == 201
    assert add_line(api, deck.id, book.id, quantity=60, proxy=60).status_code == 201

    result = decks.get_legality(db, deck.id, on=DAY)

    assert (result.crypt_count, result.library_count) == (12, 60)
    assert result.is_legal is True
    assert activate(api, deck.id).status_code == 200


# --- Activation : chaque règle, avec son message ----------------------------


@pytest.mark.parametrize(
    ("crypt_quantity", "library_quantity", "fragment"),
    [
        (11, 60, "Crypt trop petite : 11 carte(s), 12 minimum."),
        (0, 60, "Crypt trop petite : 0 carte(s), 12 minimum."),
        (12, 59, "Library trop petite : 59 carte(s), 60 minimum."),
        (12, 91, "Library trop grande : 91 carte(s), 90 maximum."),
    ],
)
def test_activation_is_refused_for_each_size_rule(
    api, db, frozen_today, crypt_quantity, library_quantity, fragment
):
    specs = [library(quantity=library_quantity)]
    if crypt_quantity:
        specs.insert(0, crypt(quantity=crypt_quantity))
    deck = build(api, db, *specs)

    response = activate(api, deck.id)

    assert response.status_code == 409
    detail = response.json()["detail"]
    assert detail.startswith("Un deck illégal ne peut pas être actif")
    assert fragment in detail
    assert api.get(f"/decks/{deck.id}").json()["status"] == "draft"


@pytest.mark.parametrize(("crypt_quantity", "library_quantity"), [(12, 60), (12, 90)])
def test_activation_is_accepted_on_the_size_boundaries(
    api, db, frozen_today, crypt_quantity, library_quantity
):
    deck = build(
        api, db, crypt(quantity=crypt_quantity), library(quantity=library_quantity)
    )

    assert activate(api, deck.id).status_code == 200


def test_activation_is_refused_for_non_adjacent_groups(api, db, frozen_today):
    deck = build(api, db, crypt("A", 6, "G1"), crypt("B", 6, "G3"), library())

    response = activate(api, deck.id)

    assert response.status_code == 409
    assert "Groupes de crypt incompatibles : G1, G3" in response.json()["detail"]


def test_activation_is_accepted_for_adjacent_groups_and_any(api, db, frozen_today):
    deck = build(
        api,
        db,
        crypt("A", 4, "G1"),
        crypt("B", 4, "G2"),
        crypt("C", 4, "Any"),
        library(),
    )

    assert activate(api, deck.id).status_code == 200


@pytest.mark.parametrize(
    ("banned_on", "status"),
    [
        (DAY - timedelta(days=1), 409),
        (DAY, 409),
        (DAY + timedelta(days=1), 200),
    ],
)
def test_activation_follows_the_ban_boundary(api, db, frozen_today, banned_on, status):
    deck = build(api, db, crypt(banned_on=banned_on), library())

    response = activate(api, deck.id)

    assert response.status_code == status
    if status == 409:
        assert "Carte(s) bannie(s) : Vampire (G1)." in response.json()["detail"]


@pytest.mark.parametrize(
    ("legal_from", "status"),
    [
        (DAY - timedelta(days=1), 200),
        (DAY, 200),
        (DAY + timedelta(days=1), 409),
    ],
)
def test_activation_follows_the_legal_date_boundary(
    api, db, frozen_today, legal_from, status
):
    deck = build(api, db, crypt(), library(legal_from=legal_from))

    response = activate(api, deck.id)

    assert response.status_code == status
    if status == 409:
        assert "Carte(s) pas encore légale(s) : Livre." in response.json()["detail"]


def test_activation_lists_every_broken_rule_at_once(api, db, frozen_today):
    deck = build(
        api,
        db,
        crypt("A", 5, "G1", banned_on=DAY),
        crypt("B", 5, "G4"),
        library(quantity=59, legal_from=DAY + timedelta(days=1)),
    )

    detail = activate(api, deck.id).json()["detail"]

    for fragment in (
        "Crypt trop petite : 10",
        "Groupes de crypt incompatibles : G1, G4",
        "Library trop petite : 59",
        "Carte(s) bannie(s) : A (G1)",
        "Carte(s) pas encore légale(s) : Livre",
    ):
        assert fragment in detail


def test_a_refused_activation_changes_nothing_about_the_deck(api, db, frozen_today):
    deck = build(api, db, crypt(quantity=11), library())
    before = api.get(f"/decks/{deck.id}").json()

    response = activate(api, deck.id, notes="ne doit pas passer")

    assert response.status_code == 409
    assert api.get(f"/decks/{deck.id}").json() == before


# --- Un deck actif reste actif -----------------------------------------------


def test_an_active_deck_stays_active_when_a_removal_makes_it_illegal(
    api, db, frozen_today
):
    deck = legal_deck(api, db)
    assert activate(api, deck.id).status_code == 200
    library_id = api.get(f"/decks/{deck.id}").json()["cards"][1]["card_id"]

    assert api.delete(f"/decks/{deck.id}/cartes/{library_id}/EN").status_code == 204

    body = api.get(f"/decks/{deck.id}").json()
    assert body["status"] == "active"
    verdict = api.get(f"/decks/{deck.id}/legalite").json()
    assert verdict["is_legal"] is False
    assert verdict["library_count"] == 0
    # Rester actif reste possible ; on peut même le renommer, l'annoter, l'archiver.
    assert activate(api, deck.id).status_code == 200
    assert api.patch(f"/decks/{deck.id}", json={"notes": "cassé"}).status_code == 200
    assert api.patch(f"/decks/{deck.id}", json={"archived": True}).status_code == 200


def test_an_illegal_active_deck_that_goes_back_to_draft_cannot_return(
    api, db, frozen_today
):
    deck = legal_deck(api, db)
    activate(api, deck.id)
    library_id = api.get(f"/decks/{deck.id}").json()["cards"][1]["card_id"]
    api.delete(f"/decks/{deck.id}/cartes/{library_id}/EN")

    assert api.patch(f"/decks/{deck.id}", json={"status": "draft"}).status_code == 200
    assert activate(api, deck.id).status_code == 409


def test_a_ban_date_reached_later_does_not_deactivate_a_deck(api, db, monkeypatch):
    deck = build(api, db, crypt(banned_on=DAY + timedelta(days=1)), library())
    monkeypatch.setattr(decks, "_today", lambda: DAY)
    assert activate(api, deck.id).status_code == 200

    monkeypatch.setattr(decks, "_today", lambda: DAY + timedelta(days=1))

    assert api.get(f"/decks/{deck.id}").json()["status"] == "active"
    assert api.get(f"/decks/{deck.id}/legalite").json()["is_legal"] is False


# --- PATCH combinant statut et archivage ------------------------------------


def test_activating_and_archiving_in_one_patch_on_a_legal_deck(api, db, frozen_today):
    deck = legal_deck(api, db)

    response = activate(api, deck.id, archived=True)

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "active" and body["archived_at"] is not None


def test_activating_and_archiving_an_illegal_deck_applies_neither(api, db):
    deck = build(api, db, crypt(quantity=11), library())

    response = activate(api, deck.id, archived=True)

    assert response.status_code == 409
    body = api.get(f"/decks/{deck.id}").json()
    assert body["status"] == "draft" and body["archived_at"] is None


def test_unarchiving_and_activating_a_legal_archived_deck(api, db, frozen_today):
    deck = legal_deck(api, db)
    api.patch(f"/decks/{deck.id}", json={"archived": True})

    response = activate(api, deck.id, archived=False)

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "active" and body["archived_at"] is None


def test_activating_while_staying_archived_is_refused_even_when_legal(
    api, db, frozen_today
):
    deck = legal_deck(api, db)
    api.patch(f"/decks/{deck.id}", json={"archived": True})

    for archived in (True, None):
        fields = {} if archived is None else {"archived": archived}
        response = activate(api, deck.id, **fields)
        assert response.status_code == 409, fields
        assert "archivé" in response.json()["detail"]
    assert api.get(f"/decks/{deck.id}").json()["status"] == "draft"


def test_unarchiving_and_activating_an_illegal_deck_leaves_it_archived(api, db):
    deck = build(api, db, crypt(quantity=11), library())
    api.patch(f"/decks/{deck.id}", json={"archived": True})

    response = activate(api, deck.id, archived=False)

    assert response.status_code == 409
    body = api.get(f"/decks/{deck.id}").json()
    assert body["archived_at"] is not None and body["status"] == "draft"


def test_demoting_and_archiving_an_active_deck_in_one_patch(api, db, frozen_today):
    deck = legal_deck(api, db)
    activate(api, deck.id)

    response = api.patch(
        f"/decks/{deck.id}", json={"status": "draft", "archived": True}
    )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "draft" and body["archived_at"] is not None
