"""Légalité d'une version jouée à une date (Lot 8, étape B3, P11).

`GET /decks/{id}/versions/{numero}/legalite?on=AAAA-MM-JJ` évalue les cinq
règles du §5 sur la liste **figée** de la version, à la date demandée : « la
liste jouée était-elle légale le jour du tournoi ? ». 401 sans session et 404
pour le deck d'un autre compte sont dans `test_lot6_authorization_matrix.py`.
"""

from datetime import UTC, date, datetime
from types import SimpleNamespace

import pytest

from app.models import DeckCard
from app.models.enums import CardCategory
from app.services import players
from tests.auth_helpers import log_in, make_account
from tests.helpers import add_languages, make_card, make_card_set, make_printing

PLAYED = "2026-11-01T14:00:00+01:00"
BAN_DAY = date(2026, 6, 1)
RELEASE_DAY = date(2026, 9, 1)


@pytest.fixture
def w(api, db):
    account = make_account(db, email="legal@example.com", username="legal")
    players.get_or_create_me(db, account.id, account.username)
    add_languages(db, "EN")
    card_set = make_card_set(db)
    cards = {
        "g2": make_card(db, "Vampire G2", CardCategory.CRYPT, group_code="G2"),
        "g4": make_card(db, "Vampire G4", CardCategory.CRYPT, group_code="G4"),
        "library": make_card(db, "Sort", CardCategory.LIBRARY),
        "banned": make_card(
            db, "Sort banni", CardCategory.LIBRARY, banned_on=BAN_DAY
        ),
        "recent": make_card(
            db, "Sort récent", CardCategory.LIBRARY, legal_from=RELEASE_DAY
        ),
    }
    for card in cards.values():
        make_printing(db, card, card_set)
    db.commit()
    log_in(api, "legal@example.com")
    return SimpleNamespace(
        api=api, db=db, user_id=account.id, card_set=card_set, **cards
    )


def _deck(w, name="Banu Princes"):
    response = w.api.post("/decks", json={"name": name})
    assert response.status_code == 201, response.text
    return response.json()["id"]


def _put(w, deck_id, card, quantity):
    key = (deck_id, card.id, "EN", w.card_set.id)
    line = w.db.get(DeckCard, key)
    if line is None:
        line = DeckCard(
            deck_id=deck_id,
            user_id=w.user_id,
            card_id=card.id,
            language_code="EN",
            card_set_id=w.card_set.id,
        )
        w.db.add(line)
    line.quantity = quantity
    line.proxy_quantity = 0
    w.db.commit()


def _play(w, deck_id, **fields):
    body = {
        "played_at": PLAYED,
        "player_count": 5,
        "participations": [{"player": {"me": True}, "deck": {"deck_id": deck_id}}],
        **fields,
    }
    response = w.api.post("/parties", json=body)
    assert response.status_code == 201, response.text
    return response.json()


def _legal_deck(w):
    """Un deck légal (12 G2, 60 cartes de bibliothèque), joué une fois : v1."""
    deck = _deck(w)
    _put(w, deck, w.g2, 12)
    _put(w, deck, w.library, 60)
    _play(w, deck)
    return deck


def _legality(w, deck, number=1, on=None):
    query = "" if on is None else f"?on={on}"
    return w.api.get(f"/decks/{deck}/versions/{number}/legalite{query}")


def test_a_legal_version_is_legal_on_the_given_day(w):
    deck = _legal_deck(w)
    response = _legality(w, deck, on="2026-10-24")
    assert response.status_code == 200, response.text
    body = response.json()
    version = w.api.get(f"/decks/{deck}/versions").json()[0]
    assert body["deck_id"] == deck
    assert body["deck_version_id"] == version["id"]
    assert body["number"] == 1
    assert body["evaluated_on"] == "2026-10-24"
    assert (body["crypt_count"], body["library_count"]) == (12, 60)
    assert body["crypt_groups"] == ["G2"]
    assert body["is_legal"] is True
    assert body["issues"] == []


def test_the_frozen_list_is_judged_not_the_live_one(w):
    deck = _legal_deck(w)
    _put(w, deck, w.library, 20)  # retouché après la partie : illégal en vivant
    assert w.api.get(f"/decks/{deck}/legalite").json()["is_legal"] is False
    body = _legality(w, deck, on="2026-11-01").json()
    assert body["library_count"] == 60
    assert body["is_legal"] is True


def test_each_version_is_judged_on_its_own_list(w):
    deck = _legal_deck(w)
    _put(w, deck, w.g4, 1)  # G2 + G4 : groupes non adjacents
    _play(w, deck)
    v1 = _legality(w, deck, 1, on="2026-11-01").json()
    v2 = _legality(w, deck, 2, on="2026-11-01").json()
    assert v1["is_legal"] is True
    assert v2["number"] == 2
    assert v2["crypt_groups"] == ["G2", "G4"]
    assert v2["is_legal"] is False


@pytest.mark.parametrize(
    "on,legal",
    [("2026-05-31", True), ("2026-06-01", False), ("2026-11-01", False)],
)
def test_a_ban_counts_from_its_day_included(w, on, legal):
    deck = _deck(w)
    _put(w, deck, w.g2, 12)
    _put(w, deck, w.library, 59)
    _put(w, deck, w.banned, 1)
    _play(w, deck)
    body = _legality(w, deck, on=on).json()
    assert body["is_legal"] is legal
    assert [c["id"] for c in body["banned_cards"]] == ([] if legal else [w.banned.id])


@pytest.mark.parametrize(
    "on,legal",
    [("2026-08-31", False), ("2026-09-01", True)],
)
def test_a_card_is_playable_from_its_legal_date_included(w, on, legal):
    deck = _deck(w)
    _put(w, deck, w.g2, 12)
    _put(w, deck, w.library, 59)
    _put(w, deck, w.recent, 1)
    _play(w, deck)
    body = _legality(w, deck, on=on).json()
    assert body["is_legal"] is legal
    expected = [] if legal else [w.recent.id]
    assert [c["id"] for c in body["not_yet_legal_cards"]] == expected


def test_without_a_date_the_verdict_is_for_today(w):
    deck = _legal_deck(w)
    body = _legality(w, deck).json()
    assert body["evaluated_on"] == datetime.now(UTC).date().isoformat()


def test_a_deleted_deck_keeps_its_versions_readable(w):
    deck = _legal_deck(w)
    assert w.api.patch(f"/decks/{deck}", json={"archived": True}).status_code == 200
    assert w.api.delete(f"/decks/{deck}").status_code == 204
    response = _legality(w, deck, on="2026-11-01")
    assert response.status_code == 200, response.text
    assert response.json()["is_legal"] is True


def test_an_empty_version_is_judged_illegal(w):
    deck = _deck(w)
    _play(w, deck)
    body = _legality(w, deck, on="2026-11-01").json()
    assert (body["crypt_count"], body["library_count"]) == (0, 0)
    assert body["is_legal"] is False


def test_an_unknown_version_number_is_a_404(w):
    deck = _legal_deck(w)
    response = _legality(w, deck, 2)
    assert response.status_code == 404
    assert response.json()["detail"] == f"Version 2 du deck {deck} introuvable."


def test_a_never_played_deck_has_no_version_to_judge(w):
    deck = _deck(w)
    assert _legality(w, deck).status_code == 404


def test_an_unknown_deck_is_a_404_with_the_deck_message(w):
    response = _legality(w, 999999)
    assert response.status_code == 404
    assert response.json()["detail"] == "Deck 999999 introuvable."


@pytest.mark.parametrize("path", ["/versions/0/legalite", "/versions/x/legalite"])
def test_a_malformed_number_is_a_422(w, path):
    deck = _legal_deck(w)
    assert w.api.get(f"/decks/{deck}{path}").status_code == 422


@pytest.mark.parametrize("on", ["2026-13-01", "hier", "2026-11-01T10:00:00"])
def test_a_malformed_date_is_a_422(w, on):
    deck = _legal_deck(w)
    assert _legality(w, deck, on=on).status_code == 422
