"""Lot 8, étape B2 : `POST /sync` et les versions jouées, le deck adverse et
l'archétype fermé.

Aucun type d'opération nouveau (A5) : `game.create`, `game.update` et
`deck.*` traversent les services de B1. On vérifie ici ce que seule la file
apporte : l'ordre de la file qui fait l'ordre du gel, le drapeau
`refreeze_decklists` par `game.update`, combiné au remplacement de la table
dans la même opération (`PUT /parties/{id}/participations` n'a pas le drapeau),
le rejeu qui ne refige rien, une opération écrite avant le lot, et les refus du
deck adverse rendus en verdict d'une seule opération.

Les decks autorisent les proxies et leurs lignes sont entièrement en proxy :
le gel ne regarde que la composition, et les tests n'ont pas à monter une
collection.
"""

from types import SimpleNamespace
from uuid import uuid4

import pytest
from sqlalchemy import func, select

from app.models import Clan, DeckVersion, SyncOperation
from app.models.enums import CardCategory
from app.services import players
from tests.auth_helpers import log_in, make_account
from tests.helpers import add_languages, make_card, make_card_set, make_printing

RECORDED_AT = "2026-11-12T20:00:00+01:00"
PLAYED = "2026-11-12T20:00:00+01:00"
ME = {"me": True}


@pytest.fixture
def w(api, db):
    account = make_account(db, email="sync8@example.com", username="sync8")
    players.get_or_create_me(db, account.id, account.username)
    add_languages(db, "EN")
    crypt = make_card(db, "Vampire", CardCategory.CRYPT)
    library = make_card(db, "Sort", CardCategory.LIBRARY)
    other = make_card(db, "Autre sort", CardCategory.LIBRARY)
    card_set = make_card_set(db)
    for card in (crypt, library, other):
        make_printing(db, card, card_set)
    clan = Clan(name="Banu Haqim")
    db.add(clan)
    db.commit()
    log_in(api, "sync8@example.com")
    return SimpleNamespace(
        api=api,
        db=db,
        crypt=crypt,
        library=library,
        other=other,
        card_set=card_set,
        clan=clan.id,
    )


# --------------------------------------------------------------------------
# Aides
# --------------------------------------------------------------------------


def op(type_: str, **fields) -> dict:
    return {
        "type": type_,
        "operation_id": str(uuid4()),
        "recorded_at": RECORDED_AT,
    } | fields


def send(api, *operations: dict) -> list[dict]:
    response = api.post("/sync", json={"operations": list(operations)})
    assert response.status_code == 200, response.text
    return response.json()["results"]


def applied(result) -> dict:
    assert result["outcome"] == "applied", result
    return result["resource"]


def rejected(result, code) -> None:
    assert result["outcome"] == "rejected", result
    assert result["error"]["code"] == code, result


def deck_create(ref, name="Banu Princes", **data):
    return op(
        "deck.create",
        client_ref=ref,
        data={"name": name, "proxy_allowed": True, **data},
    )


def card(w, deck_ref, card, quantity=1):
    """Ligne entièrement en proxy, écrite par la file."""
    return op(
        "deck_card.upsert",
        deck={"client_ref": deck_ref},
        data={
            "card_id": card.id,
            "language_code": "EN",
            "card_set_id": w.card_set.id,
            "quantity": quantity,
            "proxy_quantity": quantity,
        },
    )


def mine(deck_ref=None, **fields):
    row = {"player": ME}
    if deck_ref is not None:
        row["deck"] = {"client_ref": deck_ref}
    return row | fields


def game_create(ref, table, *, tournament_ref=None, number=None, **data):
    body = {"played_at": PLAYED, "player_count": 5, "participations": table, **data}
    if tournament_ref is not None:
        body |= {
            "tournament": {"client_ref": tournament_ref},
            "round_type": "preliminary",
            "round_number": number,
        }
    return op("game.create", client_ref=ref, data=body)


def game_update(ref, data=None, table=None):
    fields = {"game": {"client_ref": ref}}
    if data is not None:
        fields["data"] = data
    if table is not None:
        fields["table"] = {"participations": table}
    return op("game.update", **fields)


def tournament_create(ref):
    return op(
        "tournament.create",
        client_ref=ref,
        data={"name": "Open", "start_date": "2026-11-12", "deck_policy": "mono"},
    )


def my_version(w, game_id) -> int | None:
    return w.api.get(f"/parties/{game_id}").json()["me"]["deck_version_number"]


def played_once(w) -> tuple[dict, dict, dict]:
    """Un deck d'une carte, puis une partie qui le joue : deck en 0, partie en 2."""
    return deck_create("d"), card(w, "d", w.crypt), game_create("g", [mine("d")])


def seat_line(w, game_id, seat) -> dict:
    lines = w.api.get(f"/parties/{game_id}").json()["participations"]
    return next(p for p in lines if p["seat"] == seat)


def version_count(w, deck_id) -> int:
    w.db.expire_all()
    query = select(func.count()).select_from(DeckVersion)
    return w.db.scalar(query.where(DeckVersion.deck_id == deck_id))


def version_cards(w, deck_id, number) -> dict[int, int]:
    versions = w.api.get(f"/decks/{deck_id}/versions").json()
    version = next(v for v in versions if v["number"] == number)
    return {c["card_id"]: c["quantity"] for c in version["cards"]}


# --------------------------------------------------------------------------
# L'ordre de la file fait l'ordre du gel
# --------------------------------------------------------------------------


def test_a_game_takes_the_list_of_its_place_in_the_queue(w):
    """Au club, la partie ; dans le train, le deck retouché : la partie garde
    la liste d'avant la retouche, même envoyée dans le même lot."""
    results = send(
        w.api,
        deck_create("d"),
        card(w, "d", w.crypt),
        game_create("g", [mine("d")]),
        card(w, "d", w.library, 2),
    )
    deck_id = applied(results[0])["deck_id"]
    game_id = applied(results[2])["game_id"]
    applied(results[3])
    assert my_version(w, game_id) == 1
    assert version_cards(w, deck_id, 1) == {w.crypt.id: 1}
    assert version_count(w, deck_id) == 1


def test_the_same_order_holds_across_batches(w):
    first = send(w.api, *played_once(w))
    deck_id = applied(first[0])["deck_id"]
    game_id = applied(first[2])["game_id"]
    applied(send(w.api, card(w, "d", w.library))[0])
    second = send(w.api, game_create("g2", [mine("d")]))
    later = applied(second[0])["game_id"]
    assert (my_version(w, game_id), my_version(w, later)) == (1, 2)
    assert version_cards(w, deck_id, 2) == {w.crypt.id: 1, w.library.id: 1}


# --------------------------------------------------------------------------
# Rejeu et opération d'avant le lot
# --------------------------------------------------------------------------


def test_a_replayed_game_creation_refreezes_nothing(w):
    """Le rejeu rend le verdict mémorisé : le deck a changé depuis, la partie
    garde sa version et aucune n'est créée."""
    creation = game_create("g", [mine("d")])
    first = send(w.api, deck_create("d"), card(w, "d", w.crypt), creation)
    deck_id = applied(first[0])["deck_id"]
    game_id = applied(first[2])["game_id"]
    applied(send(w.api, card(w, "d", w.library))[0])

    (replay,) = send(w.api, creation)
    assert replay["outcome"] == "replayed"
    assert replay["resource"]["game_id"] == game_id
    assert my_version(w, game_id) == 1
    assert version_count(w, deck_id) == 1


def test_a_replayed_refreeze_refreezes_nothing(w):
    first = send(w.api, *played_once(w))
    deck_id = applied(first[0])["deck_id"]
    game_id = applied(first[2])["game_id"]
    applied(send(w.api, card(w, "d", w.library))[0])
    refreeze = game_update("g", {"refreeze_decklists": True})
    applied(send(w.api, refreeze)[0])
    assert my_version(w, game_id) == 2

    applied(send(w.api, card(w, "d", w.other))[0])
    (replay,) = send(w.api, refreeze)
    assert replay["outcome"] == "replayed"
    assert my_version(w, game_id) == 2
    assert version_count(w, deck_id) == 2


def test_an_operation_written_before_the_lot_applies_and_replays(w):
    """Une opération de partie sans aucun champ du Lot 8 : la création fige,
    la modification de notes garde la version, et le rejeu reste un rejeu."""
    creation = game_create("g", [mine("d", seat=1), {"player": {"client_ref": "p"}}])
    notes = game_update("g", {"notes": "table finale"})
    results = send(
        w.api,
        deck_create("d"),
        card(w, "d", w.crypt),
        op("player.create", client_ref="p", data={"name": "Mikael"}),
        creation,
        card(w, "d", w.library),
        notes,
    )
    for result in results:
        applied(result)
    game_id = results[3]["resource"]["game_id"]
    detail = w.api.get(f"/parties/{game_id}").json()
    assert detail["me"]["deck_version_number"] == 1
    assert detail["notes"] == "table finale"
    opponent = next(p for p in detail["participations"] if p["seat"] is None)
    assert opponent["opponent_deck_name"] is None
    assert opponent["opponent_deck_archetype"] is None

    replays = send(w.api, creation, notes)
    assert [r["outcome"] for r in replays] == ["replayed", "replayed"]


def test_the_flag_left_out_and_the_flag_off_do_not_refreeze(w):
    first = send(w.api, *played_once(w))
    game_id = applied(first[2])["game_id"]
    applied(send(w.api, card(w, "d", w.library))[0])
    for data in ({"notes": "x"}, {"refreeze_decklists": False}, None):
        applied(send(w.api, game_update("g", data))[0])
        assert my_version(w, game_id) == 1


# --------------------------------------------------------------------------
# Drapeau `refreeze_decklists`
# --------------------------------------------------------------------------


def test_refreeze_by_sync_freezes_the_current_list_and_touches_updated_at(w):
    first = send(w.api, *played_once(w))
    deck_id = applied(first[0])["deck_id"]
    game_id = applied(first[2])["game_id"]
    before = w.api.get(f"/parties/{game_id}").json()["updated_at"]
    applied(send(w.api, card(w, "d", w.library))[0])

    (result,) = send(w.api, game_update("g", {"refreeze_decklists": True}))
    assert applied(result)["game_id"] == game_id
    detail = w.api.get(f"/parties/{game_id}").json()
    assert detail["me"]["deck_version_number"] == 2
    assert detail["updated_at"] > before
    assert version_cards(w, deck_id, 2) == {w.crypt.id: 1, w.library.id: 1}


def test_refreeze_in_a_tournament_by_sync_realigns_every_round(w):
    results = send(
        w.api,
        deck_create("d"),
        card(w, "d", w.crypt),
        tournament_create("t"),
        game_create("r1", [mine("d")], tournament_ref="t", number=1),
        card(w, "d", w.library),
        game_create("r2", [mine("d")], tournament_ref="t", number=2),
        game_update("r2", {"refreeze_decklists": True}),
    )
    for result in results:
        applied(result)
    r1, r2 = (results[i]["resource"]["game_id"] for i in (3, 5))
    assert (my_version(w, r1), my_version(w, r2)) == (2, 2)
    detail = w.api.get(f"/tournois/{results[2]['resource']['tournament_id']}").json()
    (row,) = detail["deck_versions"]
    assert (row["deck_version_number"], row["frozen_by_game_id"]) == (2, r2)


def test_a_table_replacement_and_the_flag_in_one_update(w):
    """La combinaison que seule la file permet : la table change de deck et le
    drapeau s'applique ensuite, sur l'état final. Le deck gardé de la table
    d'avant est refigé ; le deck nouveau se fige à sa liste courante."""
    results = send(
        w.api,
        deck_create("a", "Alpha"),
        card(w, "a", w.crypt),
        deck_create("b", "Beta"),
        card(w, "b", w.other),
        op("player.create", client_ref="p", data={"name": "Mikael"}),
        game_create("g", [mine("a")]),
        card(w, "a", w.library),
        game_update(
            "g",
            {"refreeze_decklists": True},
            [mine("a"), {"player": {"client_ref": "p"}, "deck": {"client_ref": "b"}}],
        ),
    )
    for result in results:
        applied(result)
    alpha, beta = results[0]["resource"]["deck_id"], results[2]["resource"]["deck_id"]
    game_id = results[5]["resource"]["game_id"]
    lines = {
        p["deck_id"]: p["deck_version_number"]
        for p in w.api.get(f"/parties/{game_id}").json()["participations"]
    }
    assert lines == {alpha: 2, beta: 1}
    assert version_cards(w, alpha, 2) == {w.crypt.id: 1, w.library.id: 1}


def test_a_table_replacement_without_the_flag_keeps_the_version(w):
    results = send(
        w.api,
        deck_create("d"),
        card(w, "d", w.crypt),
        game_create("g", [mine("d")]),
        card(w, "d", w.library),
        game_update("g", table=[mine("d", seat=3)]),
    )
    for result in results:
        applied(result)
    assert my_version(w, results[2]["resource"]["game_id"]) == 1


def test_a_refused_refreeze_writes_no_version(w):
    """Le refus revient au point de sauvegarde : la table fautive n'est pas
    écrite, et le gel qui l'accompagnait non plus."""
    first = send(w.api, *played_once(w))
    deck_id = applied(first[0])["deck_id"]
    game_id = applied(first[2])["game_id"]
    applied(send(w.api, card(w, "d", w.library))[0])

    (result,) = send(
        w.api,
        game_update("g", {"refreeze_decklists": True}, [mine("d"), {"notes": "seul"}]),
    )
    rejected(result, "invalid")
    assert my_version(w, game_id) == 1
    assert version_count(w, deck_id) == 1


# --------------------------------------------------------------------------
# Deck adverse et ligne sans joueur
# --------------------------------------------------------------------------


def test_an_opponent_deck_and_an_unnamed_line_go_through_the_queue(w):
    (result,) = send(
        w.api,
        game_create(
            "g",
            [
                mine(seat=1),
                {
                    "seat": 2,
                    "opponent_deck_name": "Banu bleed",
                    "opponent_deck_archetype": "bleed",
                    "opponent_clan_id": w.clan,
                },
            ],
        ),
    )
    game_id = applied(result)["game_id"]
    line = seat_line(w, game_id, 2)
    assert line["player_id"] is None
    assert (
        line["opponent_deck_name"],
        line["opponent_deck_archetype"],
        line["opponent_clan_id"],
    ) == ("Banu bleed", "bleed", w.clan)


def test_opponent_fields_are_rewritten_by_a_table_replacement(w):
    results = send(
        w.api,
        game_create("g", [mine(), {"seat": 2, "opponent_deck_archetype": "wall"}]),
        game_update(
            "g", table=[mine(), {"seat": 2, "opponent_deck_archetype": "vote"}]
        ),
    )
    game_id = applied(results[0])["game_id"]
    applied(results[1])
    line = seat_line(w, game_id, 2)
    assert line["opponent_deck_archetype"] == "vote"


@pytest.mark.parametrize(
    ("table", "code"),
    [
        ([mine(opponent_deck_name="Le mien")], "invalid"),
        ([mine(), {"player": {"client_ref": "p"}, "deck": {"client_ref": "d"},
                   "opponent_deck_archetype": "rush"}], "invalid"),
        ([mine(), {"seat": 2, "opponent_clan_id": 999_999}], "not_found"),
        ([mine(), {"notes": "seul"}], "invalid"),
        ([mine(), {"seat": 2, "victory_points": 1}], "invalid"),
    ],
    ids=["on-my-line", "on-a-loaned-deck", "unknown-clan", "notes-only", "vp-unnamed"],
)
def test_opponent_refusals_are_one_operation_and_the_batch_goes_on(w, table, code):
    results = send(
        w.api,
        deck_create("d"),
        op("player.create", client_ref="p", data={"name": "Mikael"}),
        game_create("g", table),
        deck_create("suite", "Suite"),
    )
    applied(results[0])
    applied(results[1])
    rejected(results[2], code)
    applied(results[3])
    assert w.api.get("/parties").json() == []


def test_a_queued_line_carrying_a_version_fails_the_whole_batch(w):
    """Le client n'écrit jamais de version : le schéma la refuse, comme toute
    borne, et le lot entier part en 422."""
    response = w.api.post(
        "/sync",
        json={
            "operations": [
                deck_create("d"),
                game_create("g", [mine("d") | {"deck_version_id": 1}]),
            ]
        },
    )
    assert response.status_code == 422
    assert w.api.get("/decks").json() == []


# --------------------------------------------------------------------------
# Archétype fermé dans `deck.*`
# --------------------------------------------------------------------------


@pytest.mark.parametrize("value", ["bleed", "vote", "wall", "toolbox", "rush", "combo"])
def test_deck_create_and_update_carry_a_closed_archetype(w, value):
    results = send(
        w.api,
        deck_create("d", archetype=value),
        op("deck.update", deck={"client_ref": "d"}, data={"archetype": None}),
    )
    deck_id = applied(results[0])["deck_id"]
    applied(results[1])
    assert w.api.get(f"/decks/{deck_id}").json()["archetype"] is None
    update = op("deck.update", deck={"client_ref": "d"}, data={"archetype": value})
    applied(send(w.api, update)[0])
    assert w.api.get(f"/decks/{deck_id}").json()["archetype"] == value


@pytest.mark.parametrize("value", ["Vote", "stealth bleed", " bleed", ""])
def test_a_queued_free_text_archetype_in_deck_update_fails_the_batch(w, value, db):
    (created,) = send(w.api, deck_create("d"))
    applied(created)
    before = db.scalar(select(func.count()).select_from(SyncOperation))
    response = w.api.post(
        "/sync",
        json={
            "operations": [
                deck_create("autre", "Autre"),
                op("deck.update", deck={"client_ref": "d"}, data={"archetype": value}),
            ]
        },
    )
    assert response.status_code == 422
    assert [d["name"] for d in w.api.get("/decks").json()] == ["Banu Princes"]
    db.expire_all()
    assert db.scalar(select(func.count()).select_from(SyncOperation)) == before
