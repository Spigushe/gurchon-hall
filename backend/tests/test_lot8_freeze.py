"""Lot 8, étape B1 : gel des versions, règle du tournoi, deck adverse, ligne sans
joueur et route `GET /decks/{id}/versions`.

Les listes de deck s'écrivent directement en base (`_put`) : le gel ne regarde
que la composition, pas le stock, et les tests n'ont pas à monter une
collection pour chaque version.
"""

import json
from pathlib import Path
from types import SimpleNamespace

import pytest
from sqlalchemy import select

from app.models import (
    Clan,
    DeckCard,
    Game,
    Tournament,
    TournamentDeckVersion,
)
from app.models.enums import CardCategory
from app.services import players
from tests.auth_helpers import log_in, make_account
from tests.helpers import add_languages, make_card, make_card_set, make_printing

ME = {"me": True}
PLAYED = "2026-11-01T14:00:00+01:00"


@pytest.fixture
def w(api, db):
    account = make_account(db, email="gel@example.com", username="gel")
    players.get_or_create_me(db, account.id, account.username)
    add_languages(db, "EN", "FR")
    crypt = make_card(db, "Vampire", CardCategory.CRYPT)
    library = make_card(db, "Sort", CardCategory.LIBRARY)
    other = make_card(db, "Autre sort", CardCategory.LIBRARY)
    first, second = make_card_set(db), make_card_set(db)
    for card in (crypt, library, other):
        make_printing(db, card, first)
        make_printing(db, card, second)
    db.commit()
    log_in(api, "gel@example.com")
    return SimpleNamespace(
        api=api,
        db=db,
        user_id=account.id,
        crypt=crypt,
        library=library,
        other=other,
        sets=(first, second),
    )


# --------------------------------------------------------------------------
# Aides
# --------------------------------------------------------------------------


def _deck(w, name="Banu Princes", **fields):
    response = w.api.post("/decks", json={"name": name, **fields})
    assert response.status_code == 201, response.text
    return response.json()["id"]


def _put(w, deck_id, card, quantity=1, *, proxy=0, lang="EN", card_set=0):
    """Pose une ligne du deck (écrase celle de même clé)."""
    key = (deck_id, card.id, lang, w.sets[card_set].id)
    line = w.db.get(DeckCard, key)
    if line is None:
        line = DeckCard(
            deck_id=deck_id,
            user_id=w.user_id,
            card_id=card.id,
            language_code=lang,
            card_set_id=w.sets[card_set].id,
        )
        w.db.add(line)
    line.quantity = quantity
    line.proxy_quantity = proxy
    w.db.commit()


def _clear(w, deck_id):
    for line in w.db.scalars(select(DeckCard).where(DeckCard.deck_id == deck_id)):
        w.db.delete(line)
    w.db.commit()


def _table(deck=None, *others, **mine):
    line = {"player": ME, **mine}
    if deck is not None:
        line["deck"] = {"deck_id": deck}
    return [line, *others]


def _game(w, deck=None, *, others=(), tournament=None, number=None, **fields):
    body = {
        "played_at": PLAYED,
        "player_count": 5,
        "participations": _table(deck, *others),
        **fields,
    }
    if tournament is not None:
        body |= {
            "tournament": {"tournament_id": tournament},
            "round_type": "preliminary" if number else "final",
            "round_number": number,
        }
    response = w.api.post("/parties", json=body)
    assert response.status_code == 201, response.text
    return response.json()


def _tournament(w, **fields):
    response = w.api.post(
        "/tournois", json={"name": "Open", "start_date": "2026-11-01", **fields}
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def _multi(w):
    return _tournament(w, deck_policy="multi", final_deck_rule="free_choice")


def _version_of(w, game_id, deck_id=None):
    """(id, numéro) de la version de ma ligne, ou de la ligne qui joue `deck_id`."""
    detail = w.api.get(f"/parties/{game_id}").json()
    lines = detail["participations"]
    if deck_id is not None:
        lines = [p for p in lines if p["deck_id"] == deck_id]
    line = lines[0] if deck_id is not None else detail["me"]
    return line["deck_version_id"], line["deck_version_number"]


def _number(w, game_id, deck_id=None):
    return _version_of(w, game_id, deck_id)[1]


def _updated_at(w, game_id):
    w.db.expire_all()
    return w.db.get(Game, game_id).updated_at


def _rows(w, tournament_id):
    w.db.expire_all()
    return list(
        w.db.scalars(
            select(TournamentDeckVersion)
            .where(TournamentDeckVersion.tournament_id == tournament_id)
            .order_by(TournamentDeckVersion.deck_id)
        )
    )


def _frozen_by(w, tournament_id, deck_id):
    row = next((r for r in _rows(w, tournament_id) if r.deck_id == deck_id), None)
    return None if row is None else row.frozen_by_game_id


def _patch(w, game_id, **fields):
    response = w.api.patch(f"/parties/{game_id}", json=fields)
    assert response.status_code == 200, response.text
    return response.json()


def _replace(w, game_id, table):
    response = w.api.put(
        f"/parties/{game_id}/participations", json={"participations": table}
    )
    assert response.status_code == 200, response.text
    return response.json()


# --------------------------------------------------------------------------
# Gel
# --------------------------------------------------------------------------


def test_an_identical_list_reuses_the_latest_version(w):
    deck = _deck(w)
    _put(w, deck, w.crypt, 12)
    first = _game(w, deck)
    second = _game(w, deck)
    assert _version_of(w, first["id"]) == _version_of(w, second["id"])
    assert _number(w, first["id"]) == 1
    assert len(w.api.get(f"/decks/{deck}/versions").json()) == 1


def test_a_changed_list_takes_the_next_number(w):
    deck = _deck(w)
    _put(w, deck, w.crypt, 12)
    first = _game(w, deck)
    _put(w, deck, w.library, 3)
    second = _game(w, deck)
    _put(w, deck, w.library, 4)
    third = _game(w, deck)
    assert [_number(w, g["id"]) for g in (first, second, third)] == [1, 2, 3]


def test_a_quantity_change_alone_is_a_new_version(w):
    deck = _deck(w)
    _put(w, deck, w.crypt, 12)
    first = _game(w, deck)
    _put(w, deck, w.crypt, 11)
    assert _number(w, _game(w, deck)["id"]) == 2
    assert _number(w, first["id"]) == 1


def test_printing_language_and_proxy_changes_do_not_make_a_version(w):
    deck = _deck(w, proxy_allowed=True)
    _put(w, deck, w.library, 2, lang="EN", card_set=0)
    first = _game(w, deck)
    # Même total de la carte, autre impression, autre langue, un proxy.
    _clear(w, deck)
    _put(w, deck, w.library, 1, lang="FR", card_set=1, proxy=1)
    _put(w, deck, w.library, 1, lang="EN", card_set=0)
    second = _game(w, deck)
    assert _version_of(w, first["id"]) == _version_of(w, second["id"])


def test_an_empty_deck_gets_a_version_without_cards_reused_while_empty(w):
    deck = _deck(w)
    first = _game(w, deck)
    second = _game(w, deck)
    assert _version_of(w, first["id"]) == _version_of(w, second["id"])
    (version,) = w.api.get(f"/decks/{deck}/versions").json()
    assert version["cards"] == []
    assert (version["crypt_count"], version["library_count"]) == (0, 0)


def test_a_deleted_deck_is_frozen_from_its_frozen_list(w):
    deck = _deck(w)
    _put(w, deck, w.crypt, 12)
    game = _game(w, deck)
    _put(w, deck, w.library, 5)  # retouché après la partie
    assert w.api.patch(f"/decks/{deck}", json={"archived": True}).status_code == 200
    assert w.api.delete(f"/decks/{deck}").status_code == 204
    _patch(w, game["id"], refreeze_decklists=True)
    assert _number(w, game["id"]) == 2
    versions = w.api.get(f"/decks/{deck}/versions").json()
    assert {c["card_id"]: c["quantity"] for c in versions[1]["cards"]} == {
        w.crypt.id: 12,
        w.library.id: 5,
    }


def test_a_game_edited_without_changing_the_deck_keeps_its_version(w):
    deck = _deck(w)
    _put(w, deck, w.crypt, 12)
    game = _game(w, deck)
    _put(w, deck, w.library, 5)
    _patch(w, game["id"], notes="relue", played_at="2026-11-02T14:00:00+01:00")
    _patch(w, game["id"], player_count=4)
    assert _number(w, game["id"]) == 1


def test_replacing_the_table_keeps_the_version_per_deck(w):
    deck = _deck(w)
    _put(w, deck, w.crypt, 12)
    game = _game(w, deck)
    _put(w, deck, w.library, 5)
    _replace(w, game["id"], _table(deck, seat=2, victory_points=1))
    assert _number(w, game["id"]) == 1
    # Un deck qui entre dans la table se fige sur la liste courante.
    other = _deck(w, "Autre")
    _put(w, other, w.crypt, 12)
    _replace(w, game["id"], _table(deck, {"seat": 1, "deck": {"deck_id": other}}))
    assert _number(w, game["id"], deck) == 1
    assert _number(w, game["id"], other) == 1


def test_a_loaned_deck_follows_the_same_rule(w):
    mine, loaned = _deck(w), _deck(w, "Prêté")
    _put(w, mine, w.crypt, 12)
    _put(w, loaned, w.crypt, 12)
    other_line = {"seat": 2, "deck": {"deck_id": loaned}}
    game = _game(w, mine, others=[other_line])
    assert _number(w, game["id"], loaned) == 1
    _put(w, loaned, w.library, 5)
    _replace(w, game["id"], _table(mine, other_line))
    assert _number(w, game["id"], loaned) == 1
    # Une autre partie du même prêté, après la retouche, prend la suivante.
    second = _game(w, mine, others=[other_line])
    assert _number(w, second["id"], loaned) == 2


def test_the_same_deck_on_two_lines_of_a_game_has_one_version(w):
    deck = _deck(w)
    _put(w, deck, w.crypt, 12)
    game = _game(w, deck, others=[{"seat": 2, "deck": {"deck_id": deck}}])
    versions = {p["deck_version_id"] for p in game["participations"]}
    assert len(versions) == 1 and None not in versions


# --------------------------------------------------------------------------
# Drapeau `refreeze_decklists`, en amicale
# --------------------------------------------------------------------------


def test_refreeze_in_a_casual_game_refreezes_it_alone_and_touches_updated_at(w):
    deck = _deck(w)
    _put(w, deck, w.crypt, 12)
    first, second = _game(w, deck), _game(w, deck)
    before = _updated_at(w, first["id"])
    _put(w, deck, w.library, 5)
    _patch(w, first["id"], refreeze_decklists=True)
    assert _number(w, first["id"]) == 2
    assert _number(w, second["id"]) == 1
    assert _updated_at(w, first["id"]) > before


def test_refreeze_on_a_game_without_deck_is_accepted_without_effect(w):
    game = _game(w)
    assert _patch(w, game["id"], refreeze_decklists=True)["me"]["deck_id"] is None


def test_refreeze_with_an_unchanged_list_keeps_the_latest_version(w):
    deck = _deck(w)
    _put(w, deck, w.crypt, 12)
    game = _game(w, deck)
    _patch(w, game["id"], refreeze_decklists=True)
    assert _number(w, game["id"]) == 1


FREEZE_CASES = json.loads(
    (Path(__file__).parent / "fixtures" / "decklist_freeze_cases.json").read_text(
        encoding="utf-8"
    )
)["cases"]


def _put_list(w, deck_id, lines):
    _clear(w, deck_id)
    for line in lines:
        _put(
            w,
            deck_id,
            getattr(w, line["card"]),
            line["quantity"],
            proxy=line.get("proxy", 0),
            card_set=line.get("set", 0),
        )


@pytest.mark.parametrize("case", FREEZE_CASES, ids=[c["name"] for c in FREEZE_CASES])
def test_refreeze_follows_the_shared_case_table(w, case):
    """Table commune avec `freezeOutcome` (client) : ce que le serveur fait d'un
    regel est ce que la confirmation annonce."""
    deck = _deck(w, proxy_allowed=True)
    games = []
    for number, lines in enumerate(case["versions"], start=1):
        _put_list(w, deck, lines)
        games.append(_game(w, deck)["id"])
        assert _number(w, games[-1]) == number
    _put_list(w, deck, case["current"])
    game_id = games[case["played"] - 1]
    _patch(w, game_id, refreeze_decklists=True)

    number = _number(w, game_id)
    known = len(case["versions"])
    created = len(w.api.get(f"/decks/{deck}/versions").json()) > known
    kind = "new" if created else ("same" if number == case["played"] else "reuse")
    assert {"kind": kind, "number": number} == case["expected"]


# --------------------------------------------------------------------------
# Règle du tournoi
# --------------------------------------------------------------------------


def test_a_deck_edited_between_two_rounds_keeps_the_first_rounds_version(w):
    tournament, deck = _tournament(w), _deck(w)
    _put(w, deck, w.crypt, 12)
    one = _game(w, deck, tournament=tournament, number=1)
    _put(w, deck, w.library, 5)
    two = _game(w, deck, tournament=tournament, number=2)
    final = _game(w, deck, tournament=tournament)
    assert [_number(w, g["id"]) for g in (one, two, final)] == [1, 1, 1]
    assert len(w.api.get(f"/decks/{deck}/versions").json()) == 1
    (row,) = _rows(w, tournament)
    assert row.frozen_by_game_id == one["id"]


def test_round_two_entered_before_round_one_fixes_the_version(w):
    tournament, deck = _tournament(w), _deck(w)
    _put(w, deck, w.crypt, 12)
    two = _game(w, deck, tournament=tournament, number=2)
    _put(w, deck, w.library, 5)
    one = _game(w, deck, tournament=tournament, number=1)
    assert _version_of(w, one["id"]) == _version_of(w, two["id"])
    assert _frozen_by(w, tournament, deck) == two["id"]


def test_a_multi_deck_tournament_has_one_version_per_deck(w):
    tournament = _multi(w)
    first, second = _deck(w, "A"), _deck(w, "B")
    _put(w, first, w.crypt, 12)
    _put(w, second, w.library, 5)
    g1 = _game(w, first, tournament=tournament, number=1)
    _put(w, first, w.library, 1)
    g2 = _game(w, second, tournament=tournament, number=2)
    g3 = _game(w, first, tournament=tournament, number=3)
    assert _number(w, g3["id"]) == 1 == _number(w, g1["id"]) == _number(w, g2["id"])
    assert [r.deck_id for r in _rows(w, tournament)] == sorted([first, second])


def test_a_game_entering_a_tournament_takes_the_tournaments_version(w):
    tournament, deck = _tournament(w), _deck(w)
    _put(w, deck, w.crypt, 12)
    in_tournament = _game(w, deck, tournament=tournament, number=1)
    _put(w, deck, w.library, 5)
    casual = _game(w, deck)
    assert _number(w, casual["id"]) == 2
    _patch(
        w,
        casual["id"],
        tournament={"tournament_id": tournament},
        round_type="preliminary",
        round_number=2,
    )
    assert _version_of(w, casual["id"]) == _version_of(w, in_tournament["id"])


def test_a_game_entering_a_tournament_without_the_deck_fixes_its_own_version(w):
    tournament, deck = _tournament(w), _deck(w)
    _put(w, deck, w.crypt, 12)
    casual = _game(w, deck)
    _put(w, deck, w.library, 5)  # la liste courante est postérieure à la partie
    _patch(
        w,
        casual["id"],
        tournament={"tournament_id": tournament},
        round_type="preliminary",
        round_number=1,
    )
    assert _number(w, casual["id"]) == 1
    assert _frozen_by(w, tournament, deck) == casual["id"]
    # Une ronde suivante prend la version du tournoi, pas la liste courante.
    assert _number(w, _game(w, deck, tournament=tournament, number=2)["id"]) == 1


def test_a_game_leaving_a_tournament_keeps_its_version(w):
    tournament, deck = _tournament(w), _deck(w)
    _put(w, deck, w.crypt, 12)
    game = _game(w, deck, tournament=tournament, number=1)
    _put(w, deck, w.library, 5)
    _patch(w, game["id"], tournament=None, round_type="casual", round_number=None)
    assert _number(w, game["id"]) == 1
    assert _rows(w, tournament) == []


def test_refreeze_in_a_tournament_refreezes_every_game_for_that_deck_only(w):
    tournament = _multi(w)
    first, second = _deck(w, "A"), _deck(w, "B")
    _put(w, first, w.crypt, 12)
    _put(w, second, w.library, 5)
    g1 = _game(w, first, tournament=tournament, number=1)
    g2 = _game(w, second, tournament=tournament, number=2)
    g3 = _game(w, first, tournament=tournament, number=3)
    stamps = {g["id"]: _updated_at(w, g["id"]) for g in (g1, g2, g3)}
    w.db.expire_all()
    tournament_stamp = w.db.get(Tournament, tournament).updated_at
    _put(w, first, w.library, 1)
    _put(w, second, w.library, 6)
    _patch(w, g3["id"], refreeze_decklists=True)
    assert [_number(w, g["id"]) for g in (g1, g3)] == [2, 2]
    assert _number(w, g2["id"]) == 1  # l'autre deck ne bouge pas
    assert _updated_at(w, g1["id"]) > stamps[g1["id"]]
    assert _updated_at(w, g3["id"]) > stamps[g3["id"]]
    assert _updated_at(w, g2["id"]) == stamps[g2["id"]]
    w.db.expire_all()
    assert w.db.get(Tournament, tournament).updated_at == tournament_stamp
    assert _frozen_by(w, tournament, first) == g3["id"]
    detail = w.api.get(f"/tournois/{tournament}").json()
    by_deck = {row["deck_id"]: row for row in detail["deck_versions"]}
    assert by_deck[first]["deck_version_number"] == 2
    assert by_deck[first]["frozen_by_game_id"] == g3["id"]
    assert by_deck[second]["deck_version_number"] == 1


def test_the_tournament_detail_lists_versions_sorted_by_deck(w):
    tournament = _multi(w)
    decks = [_deck(w, name) for name in ("C", "A", "B")]
    for number, deck in enumerate(reversed(decks), start=1):
        _game(w, deck, tournament=tournament, number=number)
    rows = w.api.get(f"/tournois/{tournament}").json()["deck_versions"]
    assert [row["deck_id"] for row in rows] == sorted(decks)


def test_a_tournament_without_game_has_no_version(w):
    tournament = _tournament(w)
    assert w.api.get(f"/tournois/{tournament}").json()["deck_versions"] == []


# --- frozen_by_game_id passe à la partie suivante ---------------------------


def _two_rounds(w):
    tournament = _multi(w)
    deck, other = _deck(w), _deck(w, "Autre")
    _put(w, deck, w.crypt, 12)
    first = _game(w, deck, tournament=tournament, number=1)
    second = _game(w, deck, tournament=tournament, number=2)
    assert _frozen_by(w, tournament, deck) == first["id"]
    return tournament, deck, other, first, second


def test_deleting_the_freezing_game_hands_the_row_to_the_next_one(w):
    tournament, deck, _, first, second = _two_rounds(w)
    version = _version_of(w, second["id"])
    assert w.api.delete(f"/parties/{first['id']}").status_code == 204
    assert _frozen_by(w, tournament, deck) == second["id"]
    assert _version_of(w, second["id"]) == version
    assert w.api.delete(f"/parties/{second['id']}").status_code == 204
    assert _rows(w, tournament) == []
    assert w.api.delete(f"/tournois/{tournament}").status_code == 204


def test_the_successor_is_the_lowest_game_id_even_through_a_loan(w):
    tournament, deck, other, first, second = _two_rounds(w)
    third = _game(
        w,
        other,
        others=[{"seat": 2, "deck": {"deck_id": deck}}],
        tournament=tournament,
        number=3,
    )
    assert w.api.delete(f"/parties/{first['id']}").status_code == 204
    assert _frozen_by(w, tournament, deck) == second["id"]
    assert w.api.delete(f"/parties/{second['id']}").status_code == 204
    assert _frozen_by(w, tournament, deck) == third["id"]


def test_a_game_leaving_the_tournament_hands_the_row_over(w):
    tournament, deck, _, first, second = _two_rounds(w)
    _patch(w, first["id"], tournament=None, round_type="casual", round_number=None)
    assert _frozen_by(w, tournament, deck) == second["id"]


@pytest.mark.parametrize(
    "variant", ["other_deck", "no_deck", "no_loan_line"], ids=str
)
def test_a_table_replaced_without_the_deck_hands_the_row_over(w, variant):
    tournament, deck, other, first, second = _two_rounds(w)
    tables = {
        "other_deck": _table(other),
        "no_deck": _table(None),
        "no_loan_line": _table(other, seat=1),
    }
    _replace(w, first["id"], tables[variant])
    assert _frozen_by(w, tournament, deck) == second["id"]
    assert w.api.delete(f"/parties/{second['id']}").status_code == 204
    assert [r.deck_id for r in _rows(w, tournament)] == (
        [other] if variant != "no_deck" else []
    )


def test_a_deck_changed_on_the_only_game_removes_the_row(w):
    tournament = _multi(w)
    deck, other = _deck(w), _deck(w, "Autre")
    game = _game(w, deck, tournament=tournament, number=1)
    _replace(w, game["id"], _table(other))
    assert [r.deck_id for r in _rows(w, tournament)] == [other]


# --------------------------------------------------------------------------
# Deck supprimé (précisions, point 3)
# --------------------------------------------------------------------------


def _delete_deck(w, deck):
    assert w.api.patch(f"/decks/{deck}", json={"archived": True}).status_code == 200
    assert w.api.delete(f"/decks/{deck}").status_code == 204


def test_a_deleted_deck_stays_accepted_where_the_game_already_played_it(w):
    deck = _deck(w)
    _put(w, deck, w.crypt, 12)
    loan = {"seat": 2, "deck": {"deck_id": deck}}
    game = _game(w, None, others=[loan])
    _delete_deck(w, deck)
    # Le deck est joué par une ligne prêtée : il reste accepté sur une autre.
    _replace(w, game["id"], _table(deck, seat=1))
    assert _number(w, game["id"]) == 1
    refused = w.api.post(
        "/parties",
        json={"played_at": PLAYED, "player_count": 5, "participations": _table(deck)},
    )
    assert refused.status_code == 409


# --------------------------------------------------------------------------
# Champs adverses
# --------------------------------------------------------------------------


def _opponent(w, name="Mikael"):
    return w.api.post("/joueurs", json={"name": name}).json()["id"]


def _clan(w, name="Banu Haqim"):
    clan = Clan(name=name)
    w.db.add(clan)
    w.db.commit()
    return clan.id


def _post(w, table):
    return w.api.post(
        "/parties",
        json={"played_at": PLAYED, "player_count": 5, "participations": table},
    )


def test_opponent_deck_fields_are_recorded_and_read_back(w):
    clan = _clan(w)
    opponent = _opponent(w)
    response = _post(
        w,
        [
            {"player": ME},
            {
                "player": {"player_id": opponent},
                "seat": 2,
                "opponent_deck_name": "Banu bleed",
                "opponent_deck_archetype": "bleed",
                "opponent_clan_id": clan,
            },
        ],
    )
    assert response.status_code == 201, response.text
    line = next(p for p in response.json()["participations"] if p["seat"] == 2)
    assert (
        line["opponent_deck_name"],
        line["opponent_deck_archetype"],
        line["opponent_clan_id"],
    ) == ("Banu bleed", "bleed", clan)
    read = w.api.get(f"/parties/{response.json()['id']}").json()
    assert any(p["opponent_clan_id"] == clan for p in read["participations"])


@pytest.mark.parametrize(
    "field,value",
    [
        ("opponent_deck_name", "Mon deck"),
        ("opponent_deck_archetype", "rush"),
    ],
)
def test_opponent_fields_are_refused_on_my_line(w, field, value):
    response = _post(w, [{"player": ME, field: value}])
    assert response.status_code == 422
    assert "Le deck adverse" in response.text


def test_opponent_clan_is_refused_on_my_line_and_on_a_loaned_deck_line(w):
    clan = _clan(w)
    deck = _deck(w)
    assert _post(w, [{"player": ME, "opponent_clan_id": clan}]).status_code == 422
    loaned = {
        "player": {"player_id": _opponent(w)},
        "deck": {"deck_id": deck},
        "opponent_deck_name": "x",
    }
    assert _post(w, [{"player": ME}, loaned]).status_code == 422
    unnamed = {"deck": {"deck_id": deck}, "opponent_clan_id": clan}
    assert _post(w, [{"player": ME}, unnamed]).status_code == 422


def test_an_unknown_opponent_clan_is_a_404(w):
    response = _post(w, [{"player": ME}, {"seat": 2, "opponent_clan_id": 99999}])
    assert response.status_code == 404
    assert response.json()["detail"] == "Clan 99999 introuvable."


def test_opponent_fields_are_recorded_by_a_table_replacement(w):
    game = _post(w, [{"player": ME}]).json()
    updated = _replace(
        w,
        game["id"],
        [{"player": ME}, {"seat": 3, "opponent_deck_archetype": "combo"}],
    )
    assert "combo" in [p["opponent_deck_archetype"] for p in updated["participations"]]


# --------------------------------------------------------------------------
# Ligne sans joueur
# --------------------------------------------------------------------------


def test_an_unnamed_line_is_accepted_with_a_seat(w):
    assert _post(w, [{"player": ME}, {"seat": 2}]).status_code == 201


def test_an_unnamed_line_is_accepted_with_a_loaned_deck(w):
    deck = _deck(w)
    response = _post(w, [{"player": ME}, {"deck": {"deck_id": deck}}])
    assert response.status_code == 201, response.text
    unnamed = next(p for p in response.json()["participations"] if not p["is_me"])
    assert unnamed["player_id"] is None and unnamed["deck_version_number"] == 1


@pytest.mark.parametrize(
    "field,value",
    [("opponent_deck_name", "Un deck"), ("opponent_deck_archetype", "vote")],
)
def test_an_unnamed_line_is_accepted_with_a_single_opponent_field(w, field, value):
    assert _post(w, [{"player": ME}, {field: value}]).status_code == 201


def test_an_unnamed_line_is_accepted_with_only_a_clan(w):
    clan = _clan(w)
    assert _post(w, [{"player": ME}, {"opponent_clan_id": clan}]).status_code == 201


@pytest.mark.parametrize("line", [{}, {"notes": "des notes seules"}])
def test_an_empty_unnamed_line_is_refused(w, line):
    response = _post(w, [{"player": ME}, line])
    assert response.status_code == 422
    assert "Un adversaire non nommé" in response.text


def test_an_unnamed_line_cannot_carry_victory_points(w):
    response = _post(w, [{"player": ME}, {"seat": 2, "victory_points": 1}])
    assert response.status_code == 422


def test_two_unnamed_lines_share_a_table(w):
    response = _post(w, [{"player": ME}, {"seat": 2}, {"seat": 3}])
    assert response.status_code == 201, response.text
    assert [p["player_id"] for p in response.json()["participations"]].count(None) == 2
    # Le même siège deux fois reste refusé.
    assert _post(w, [{"player": ME}, {"seat": 2}, {"seat": 2}]).status_code == 422


def test_exactly_one_me_is_read_on_lines_that_have_a_player(w):
    assert _post(w, [{"seat": 2}, {"seat": 3}]).status_code == 422
    assert _post(w, [{"player": ME}, {"player": ME, "seat": 2}]).status_code == 422
    # Un joueur nommé deux fois reste refusé ; l'absence de joueur ne compte pas.
    mikael = _opponent(w)
    twice = [{"player": ME}, {"player": {"player_id": mikael}}] * 1
    twice.append({"player": {"player_id": mikael}, "seat": 3})
    assert _post(w, twice).status_code == 422


def test_the_unnamed_line_keeps_its_version_through_a_table_replacement(w):
    deck = _deck(w)
    _put(w, deck, w.crypt, 12)
    game = _post(w, [{"player": ME}, {"deck": {"deck_id": deck}}]).json()
    _put(w, deck, w.library, 5)
    updated = _replace(w, game["id"], [{"player": ME}, {"deck": {"deck_id": deck}}])
    unnamed = next(p for p in updated["participations"] if not p["is_me"])
    assert unnamed["deck_version_number"] == 1


# --------------------------------------------------------------------------
# Route des versions
# --------------------------------------------------------------------------


def test_versions_come_by_ascending_number_with_cards_by_card_id(w):
    deck = _deck(w)
    _put(w, deck, w.library, 3)
    _put(w, deck, w.crypt, 12)
    _game(w, deck)
    _put(w, deck, w.other, 2)
    _game(w, deck)
    response = w.api.get(f"/decks/{deck}/versions")
    assert response.status_code == 200
    first, second = response.json()
    assert (first["number"], second["number"]) == (1, 2)
    assert first["deck_id"] == deck
    assert [c["card_id"] for c in first["cards"]] == sorted(
        [w.crypt.id, w.library.id]
    )
    assert [c["card_id"] for c in second["cards"]] == sorted(
        [w.crypt.id, w.library.id, w.other.id]
    )
    assert (first["crypt_count"], first["library_count"]) == (12, 3)
    assert (second["crypt_count"], second["library_count"]) == (12, 5)
    assert first["created_at"].endswith("Z")


def test_a_deck_never_played_has_no_version(w):
    deck = _deck(w)
    _put(w, deck, w.crypt, 12)
    assert w.api.get(f"/decks/{deck}/versions").json() == []


def test_a_deleted_decks_versions_stay_readable(w):
    deck = _deck(w)
    _put(w, deck, w.crypt, 12)
    _game(w, deck)
    _delete_deck(w, deck)
    (version,) = w.api.get(f"/decks/{deck}/versions").json()
    assert version["crypt_count"] == 12


def test_an_unknown_deck_has_no_versions_route(w):
    response = w.api.get("/decks/999999/versions")
    assert response.status_code == 404
    assert response.json()["detail"] == "Deck 999999 introuvable."


def test_another_accounts_deck_versions_are_a_404(w, api_client_factory, db):
    deck = _deck(w)
    _game(w, deck)
    make_account(db, email="autre-gel@example.com", username="autre-gel")
    db.commit()
    other = api_client_factory()
    log_in(other, "autre-gel@example.com")
    response = other.get(f"/decks/{deck}/versions")
    assert response.status_code == 404
    assert response.json()["detail"] == f"Deck {deck} introuvable."


# --------------------------------------------------------------------------
# Trous comblés par la QA de B1
# --------------------------------------------------------------------------


def test_a_game_moving_between_tournaments_takes_the_target_version(w):
    first_tournament, second_tournament = _tournament(w), _tournament(w, name="Bis")
    deck = _deck(w)
    _put(w, deck, w.crypt, 12)
    in_first = _game(w, deck, tournament=first_tournament, number=1)
    _put(w, deck, w.library, 5)
    in_second = _game(w, deck, tournament=second_tournament, number=1)
    assert _number(w, in_first["id"]) == 1
    assert _number(w, in_second["id"]) == 2  # le second tournoi fige la liste du jour
    _put(w, deck, w.other, 2)
    _patch(
        w,
        in_first["id"],
        tournament={"tournament_id": second_tournament},
        round_type="preliminary",
        round_number=2,
    )
    assert _version_of(w, in_first["id"]) == _version_of(w, in_second["id"])
    assert _rows(w, first_tournament) == []
    assert _frozen_by(w, second_tournament, deck) == in_second["id"]


def test_refreeze_in_a_tournament_covers_a_loaned_deck(w):
    tournament = _multi(w)
    mine, loaned = _deck(w, "Mien"), _deck(w, "Prêté")
    _put(w, mine, w.crypt, 12)
    _put(w, loaned, w.library, 5)
    loan = {"seat": 2, "deck": {"deck_id": loaned}}
    g1 = _game(w, mine, others=[loan], tournament=tournament, number=1)
    g2 = _game(w, mine, others=[loan], tournament=tournament, number=2)
    _put(w, loaned, w.other, 2)
    _patch(w, g2["id"], refreeze_decklists=True)
    assert _number(w, g1["id"], loaned) == 2
    assert _number(w, g2["id"], loaned) == 2
    assert _number(w, g1["id"], mine) == 1
    assert _frozen_by(w, tournament, loaned) == g2["id"]


def test_refreeze_in_the_same_write_as_a_move_into_a_tournament(w):
    tournament, deck = _tournament(w), _deck(w)
    _put(w, deck, w.crypt, 12)
    in_tournament = _game(w, deck, tournament=tournament, number=1)
    casual = _game(w, deck)
    _put(w, deck, w.library, 5)
    _patch(
        w,
        casual["id"],
        tournament={"tournament_id": tournament},
        round_type="preliminary",
        round_number=2,
        refreeze_decklists=True,
    )
    assert _number(w, casual["id"]) == 2
    assert _number(w, in_tournament["id"]) == 2
    assert _frozen_by(w, tournament, deck) == casual["id"]


def test_refreeze_of_a_deleted_deck_in_a_tournament_uses_its_frozen_list(w):
    tournament, deck = _tournament(w), _deck(w)
    _put(w, deck, w.crypt, 12)
    one = _game(w, deck, tournament=tournament, number=1)
    two = _game(w, deck, tournament=tournament, number=2)
    _put(w, deck, w.library, 5)
    _delete_deck(w, deck)
    _patch(w, two["id"], refreeze_decklists=True)
    assert _number(w, one["id"]) == _number(w, two["id"]) == 2
    versions = w.api.get(f"/decks/{deck}/versions").json()
    assert {c["card_id"]: c["quantity"] for c in versions[1]["cards"]} == {
        w.crypt.id: 12,
        w.library.id: 5,
    }


def test_a_tournament_refreeze_with_an_unchanged_list_touches_nothing(w):
    tournament, deck = _tournament(w), _deck(w)
    _put(w, deck, w.crypt, 12)
    one = _game(w, deck, tournament=tournament, number=1)
    two = _game(w, deck, tournament=tournament, number=2)
    stamp = _updated_at(w, one["id"])
    _patch(w, two["id"], refreeze_decklists=True)
    assert _updated_at(w, one["id"]) == stamp
    assert _number(w, one["id"]) == 1
