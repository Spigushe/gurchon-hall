"""Routes `/tournois` et `/parties` (Lot 7, étape B2).

Couvre : la création d'une partie et sa table, le remplacement de table, chaque
refus du plan (A2 à A13) avec son code et son message, les contrôles rejoués par
une écriture voisine (mono-deck, deck de finale, classement), les bilans, les
tris et les filtres, l'isolation entre comptes.
"""

from datetime import UTC, datetime

import pytest
from sqlalchemy import select

from app.models import Participation, Player
from app.services import players
from tests.auth_helpers import log_in, make_account

PLAYED = "2026-10-24T20:00:00+02:00"
ME = {"me": True}


def _account_with_me(db, email, username):
    account = make_account(db, email=email, username=username)
    players.get_or_create_me(db, account.id, account.username)
    db.commit()
    return account


@pytest.fixture
def two_accounts(api_client_factory, db):
    a = _account_with_me(db, "jeu-a@example.com", "jeu-a")
    b = _account_with_me(db, "jeu-b@example.com", "jeu-b")
    client_a = api_client_factory()
    client_b = api_client_factory()
    log_in(client_a, "jeu-a@example.com")
    log_in(client_b, "jeu-b@example.com")
    return client_a, client_b, a, b


@pytest.fixture
def me_api(api, db):
    _account_with_me(db, "joue@example.com", "joue")
    log_in(api, "joue@example.com")
    return api


def _deck(api, name="Banu Princes"):
    response = api.post("/decks", json={"name": name})
    assert response.status_code == 201, response.text
    return response.json()["id"]


def _opponent(api, name):
    response = api.post("/joueurs", json={"name": name})
    assert response.status_code == 201, response.text
    return response.json()["id"]


def _tournament(api, **fields):
    body = {"name": "Open de Lyon", "start_date": "2026-10-24", **fields}
    response = api.post("/tournois", json=body)
    assert response.status_code == 201, response.text
    return response.json()


def _table(*, deck=None, vp=None, gw=None, seat=None, others=()):
    mine = {"player": ME, "seat": seat, "victory_points": vp, "game_win": gw}
    if deck is not None:
        mine["deck"] = {"deck_id": deck}
    return [mine, *others]


def _game(api, *, table=None, **fields):
    body = {
        "played_at": PLAYED,
        "player_count": 5,
        "participations": _table() if table is None else table,
        **fields,
    }
    return api.post("/parties", json=body)


def _round(api, tournament, number, *, deck=None, vp=None, gw=None):
    response = _game(
        api,
        tournament={"tournament_id": tournament["id"]},
        round_type="preliminary",
        round_number=number,
        table=_table(deck=deck, vp=vp, gw=gw),
    )
    assert response.status_code == 201, response.text
    return response.json()


def _final(api, tournament, *, deck=None, vp=None, gw=None):
    return _game(
        api,
        tournament={"tournament_id": tournament["id"]},
        round_type="final",
        table=_table(deck=deck, vp=vp, gw=gw),
    )


# ---------------------------------------------------------------------------
# Création d'une partie et lecture
# ---------------------------------------------------------------------------


def test_create_an_amicable_game_with_only_my_line(me_api):
    response = _game(me_api, table=_table(vp=2.5, seat=3))
    assert response.status_code == 201
    game = response.json()
    assert game["round_type"] == "casual"
    assert game["tournament_id"] is None and game["tournament_name"] is None
    assert game["me"] == {
        "deck_id": None,
        "seat": 3,
        "victory_points": 2.5,
        "game_win": None,
    }
    assert [p["is_me"] for p in game["participations"]] == [True]
    assert game["played_at"] == "2026-10-24T18:00:00Z"


def test_a_certain_game_win_is_set_by_the_server_when_left_empty(me_api):
    # 3 VP à cinq joueurs : plus de la moitié de la table et au moins 2.
    game = _game(me_api, table=_table(vp=3)).json()
    assert game["me"]["game_win"] is True


def test_an_uncertain_game_win_stays_as_declared(me_api):
    assert _game(me_api, table=_table(vp=2)).json()["me"]["game_win"] is None
    declared = _game(me_api, table=_table(vp=2, gw=True)).json()
    assert declared["me"]["game_win"] is True


def test_game_with_named_opponents_and_a_lent_deck(me_api):
    mine, lent = _deck(me_api, "Mes Banu"), _deck(me_api, "Prêtés")
    marc = _opponent(me_api, "Marc")
    others = [{"player": {"player_id": marc}, "seat": 2, "deck": {"deck_id": lent}}]
    response = _game(me_api, table=_table(deck=mine, seat=1, others=others))
    assert response.status_code == 201, response.text
    table = response.json()["participations"]
    assert [(p["seat"], p["is_me"], p["deck_id"]) for p in table] == [
        (1, True, mine),
        (2, False, lent),
    ]
    assert all(p["victory_points"] is None for p in table[1:])


def test_the_table_is_sorted_by_seat_with_unseated_lines_last(me_api):
    marc, zoe = _opponent(me_api, "Marc"), _opponent(me_api, "Zoé")
    others = [
        {"player": {"player_id": marc}},
        {"player": {"player_id": zoe}, "seat": 1},
    ]
    table = _game(me_api, table=_table(seat=3, others=others)).json()["participations"]
    assert [p["seat"] for p in table] == [1, 3, None]


def test_me_designated_by_id_is_the_same_line_as_me(me_api):
    my_id = me_api.get("/joueurs").json()[0]["id"]
    table = [{"player": ME}, {"player": {"player_id": my_id}}]
    response = _game(me_api, table=table)
    assert response.status_code == 422
    assert "plusieurs fois" in response.text


def test_get_game_and_unknown_game(me_api):
    created = _game(me_api).json()
    assert me_api.get(f"/parties/{created['id']}").json() == created
    missing = me_api.get("/parties/999999")
    assert missing.status_code == 404
    assert missing.json()["detail"] == "Partie 999999 introuvable."


def test_responses_are_not_cacheable(me_api):
    created = _game(me_api)
    assert created.headers["cache-control"] == "private, no-store"
    assert me_api.get("/tournois").headers["cache-control"] == "private, no-store"


# ---------------------------------------------------------------------------
# Refus de forme (422)
# ---------------------------------------------------------------------------


def test_a_table_without_me_is_refused(me_api):
    marc = _opponent(me_api, "Marc")
    response = _game(me_api, table=[{"player": {"player_id": marc}}])
    assert response.status_code == 422
    assert "ne contient pas ma participation" in response.text


def test_an_opponent_cannot_carry_a_result(me_api):
    marc = _opponent(me_api, "Marc")
    for result in ({"victory_points": 1}, {"game_win": False}):
        others = [{"player": {"player_id": marc}, **result}]
        response = _game(me_api, table=_table(others=others))
        assert response.status_code == 422, result
        assert "Marc" in response.text


def test_the_same_opponent_twice_and_the_same_seat_twice_are_refused(me_api):
    marc = _opponent(me_api, "Marc")
    twice = [{"player": {"player_id": marc}}, {"player": {"player_id": marc}}]
    assert "même joueur" in _game(me_api, table=_table(others=twice)).text
    zoe = _opponent(me_api, "Zoé")
    seats = [{"player": {"player_id": zoe}, "seat": 2}]
    response = _game(me_api, table=_table(seat=2, others=seats))
    assert response.status_code == 422 and "même siège" in response.text


def test_more_lines_than_players_and_a_seat_beyond_the_table(me_api):
    ids = [_opponent(me_api, f"Adversaire {n}") for n in range(2)]
    others = [{"player": {"player_id": i}} for i in ids]
    response = _game(me_api, player_count=2, table=_table(others=others))
    assert response.status_code == 422 and "3 lignes" in response.text
    response = _game(me_api, player_count=4, table=_table(seat=5))
    assert response.status_code == 422 and "Siège au-delà" in response.text


@pytest.mark.parametrize(
    ("kwargs", "fragment"),
    [
        ({"player_count": 4, "table": _table(vp=4.5)}, "4 au plus"),
        ({"table": _table(vp=1.5, gw=True)}, "Game Win avec 1,5 VP"),
        ({"table": _table(gw=True)}, "sans VP saisis"),
        ({"table": _table(vp=3, gw=False)}, "le Game Win est acquis"),
        (
            {"player_count": 4, "table": _table(vp=2.5, gw=False)},
            "le Game Win est acquis",
        ),
    ],
)
def test_vp_and_game_win_rules(me_api, kwargs, fragment):
    response = _game(me_api, **kwargs)
    assert response.status_code == 422, response.text
    assert fragment in response.text


def test_a_client_ref_is_refused_online_wherever_it_appears(me_api):
    tournament = {"client_ref": "t-1"}
    assert _game(me_api, tournament=tournament, round_type="final").status_code == 422
    assert _game(me_api, venue={"client_ref": "v-1"}).status_code == 422
    deck = [{"player": ME, "deck": {"client_ref": "d-1"}}]
    assert _game(me_api, table=deck).status_code == 422
    opponent = _table(others=[{"player": {"client_ref": "p-1"}}])
    response = _game(me_api, table=opponent)
    assert response.status_code == 422
    assert "synchronisation" in response.text
    assert me_api.post(
        "/tournois",
        json={"name": "T", "start_date": "2026-10-24", "venue": {"client_ref": "v"}},
    ).status_code == 422


def test_round_and_tournament_must_agree(me_api):
    tournament = _tournament(me_api)
    ref = {"tournament_id": tournament["id"]}
    cases = [
        {"tournament": ref},  # amicale dans un tournoi
        {"round_type": "preliminary", "round_number": 1},  # sans tournoi
        {"tournament": ref, "round_type": "preliminary"},  # sans numéro
        {"tournament": ref, "round_type": "final", "round_number": 1},
        {"round_number": 2},  # numéro sur une amicale
    ]
    for extra in cases:
        assert _game(me_api, **extra).status_code == 422, extra


def test_round_number_cannot_exceed_the_planned_round_count(me_api):
    tournament = _tournament(me_api, round_count=3)
    response = _game(
        me_api,
        tournament={"tournament_id": tournament["id"]},
        round_type="preliminary",
        round_number=4,
    )
    assert response.status_code == 422
    assert "Ronde 4 d'un tournoi en 3" in response.text


def test_bounds_of_the_schema(me_api):
    assert _game(me_api, player_count=7).status_code == 422
    assert _game(me_api, played_at="2026-10-24T20:00:00").status_code == 422
    assert _game(me_api, table=[]).status_code == 422


# ---------------------------------------------------------------------------
# 404 sur les références imbriquées, 409 de rondes et de decks
# ---------------------------------------------------------------------------


def test_unknown_references_are_404_before_anything_is_written(me_api, db):
    cases = [
        {"venue": {"venue_id": 999}},
        {"tournament": {"tournament_id": 999}, "round_type": "final"},
        {"table": [{"player": ME, "deck": {"deck_id": 999}}]},
        {"table": _table(others=[{"player": {"player_id": 999}}])},
    ]
    for extra in cases:
        response = _game(me_api, **extra)
        assert response.status_code == 404, extra
    assert db.scalars(select(Participation)).all() == []
    assert me_api.get("/parties").json() == []


def test_another_accounts_resources_are_404_never_409(two_accounts):
    api_a, api_b, _, _ = two_accounts
    deck_a = _deck(api_a)
    tournament_a = _tournament(api_a)
    venue_a = api_a.post("/lieux", json={"name": "Bar"}).json()["id"]
    marc_a = _opponent(api_a, "Marc")
    cases = [
        ({"venue": {"venue_id": venue_a}}, "Lieu"),
        (
            {
                "tournament": {"tournament_id": tournament_a["id"]},
                "round_type": "final",
            },
            "Tournoi",
        ),
        ({"table": [{"player": ME, "deck": {"deck_id": deck_a}}]}, "Deck"),
        ({"table": _table(others=[{"player": {"player_id": marc_a}}])}, "Joueur"),
    ]
    for extra, noun in cases:
        response = _game(api_b, **extra)
        assert response.status_code == 404, extra
        assert response.json()["detail"].startswith(noun)
    assert api_b.post(
        "/tournois",
        json={"name": "T", "start_date": "2026-10-24", "venue": {"venue_id": venue_a}},
    ).status_code == 404


def test_a_round_or_a_final_already_entered_is_a_conflict_with_the_message(me_api):
    tournament = _tournament(me_api)
    _round(me_api, tournament, 2)
    again = _game(
        me_api,
        tournament={"tournament_id": tournament["id"]},
        round_type="preliminary",
        round_number=2,
    )
    assert again.status_code == 409
    assert again.json()["detail"] == (
        "La ronde 2 est déjà saisie pour ce tournoi (sur un autre appareil ?)."
    )
    assert _final(me_api, tournament).status_code == 201
    second = _final(me_api, tournament)
    assert second.status_code == 409
    assert second.json()["detail"] == "La finale est déjà saisie pour ce tournoi."


def test_a_deleted_deck_is_refused_for_a_new_line_but_kept_on_an_old_one(me_api):
    deck, other = _deck(me_api, "À supprimer"), _deck(me_api, "Autre")
    game = _game(me_api, table=_table(deck=deck)).json()
    me_api.patch(f"/decks/{deck}", json={"archived": True})
    assert me_api.delete(f"/decks/{deck}").status_code == 204

    refused = _game(me_api, table=_table(deck=deck))
    assert refused.status_code == 409 and "supprimé" in refused.text
    lent = _table(others=[{"player": {"player_id": _opponent(me_api, "Marc")},
                           "deck": {"deck_id": deck}}])
    assert _game(me_api, table=lent).status_code == 409

    # La table existante garde son deck supprimé quand on la corrige.
    kept = me_api.put(
        f"/parties/{game['id']}/participations",
        json={"participations": _table(deck=deck, vp=1)},
    )
    assert kept.status_code == 200, kept.text
    assert kept.json()["me"]["deck_id"] == deck
    # Mais ne peut pas le reprendre une fois changé.
    switched = me_api.put(
        f"/parties/{game['id']}/participations",
        json={"participations": _table(deck=other)},
    )
    assert switched.status_code == 200
    back = me_api.put(
        f"/parties/{game['id']}/participations",
        json={"participations": _table(deck=deck)},
    )
    assert back.status_code == 409


def test_a_draft_or_archived_deck_can_be_played(me_api):
    archived = _deck(me_api, "Rangé")
    me_api.patch(f"/decks/{archived}", json={"archived": True})
    draft = _deck(me_api, "Brouillon")
    assert _game(me_api, table=_table(deck=archived)).status_code == 201
    assert _game(me_api, table=_table(deck=draft)).status_code == 201


# ---------------------------------------------------------------------------
# Remplacement de table
# ---------------------------------------------------------------------------


def test_replace_table_swaps_all_lines_and_reuses_players_and_seats(me_api, db):
    marc, zoe = _opponent(me_api, "Marc"), _opponent(me_api, "Zoé")
    game = _game(
        me_api,
        table=_table(
            seat=1, others=[{"player": {"player_id": marc}, "seat": 2}]
        ),
    ).json()
    before = game["updated_at"]

    # Mêmes joueurs, mêmes sièges, autre répartition : les INSERT ne doivent pas
    # précéder les DELETE (unicités partie/joueur et partie/siège).
    replaced = me_api.put(
        f"/parties/{game['id']}/participations",
        json={
            "participations": _table(
                seat=2,
                vp=2.5,
                others=[
                    {"player": {"player_id": marc}, "seat": 1},
                    {"player": {"player_id": zoe}, "seat": 3},
                ],
            )
        },
    )
    assert replaced.status_code == 200, replaced.text
    body = replaced.json()
    assert [(p["seat"], p["player_id"] == marc) for p in body["participations"]] == [
        (1, True),
        (2, False),
        (3, False),
    ]
    assert body["me"]["victory_points"] == 2.5
    assert body["updated_at"] > before
    assert me_api.get(f"/parties/{game['id']}").json() == body
    assert len(db.scalars(select(Participation)).all()) == 3


def test_replace_table_refusals_leave_the_old_table_untouched(me_api):
    marc = _opponent(me_api, "Marc")
    game = _game(
        me_api, table=_table(vp=1, others=[{"player": {"player_id": marc}}])
    ).json()
    refused = me_api.put(
        f"/parties/{game['id']}/participations",
        json={"participations": [{"player": {"player_id": marc}}]},
    )
    assert refused.status_code == 422
    assert me_api.get(f"/parties/{game['id']}").json() == game
    assert me_api.put(
        "/parties/999999/participations", json={"participations": _table()}
    ).status_code == 404


def test_patch_player_count_rechecks_the_existing_table(me_api):
    game = _game(me_api, table=_table(vp=4.5, seat=5), player_count=5).json()
    shrunk = me_api.patch(f"/parties/{game['id']}", json={"player_count": 4})
    assert shrunk.status_code == 422
    assert "4 au plus" in shrunk.text or "Siège au-delà" in shrunk.text
    assert me_api.get(f"/parties/{game['id']}").json()["player_count"] == 5


def test_patch_player_count_can_make_a_game_win_certain(me_api):
    game = _game(me_api, table=_table(vp=2.5), player_count=5).json()
    assert game["me"]["game_win"] is None
    updated = me_api.patch(f"/parties/{game['id']}", json={"player_count": 4}).json()
    assert updated["me"]["game_win"] is True


def test_patch_game_fields_clears_nullable_ones_and_keeps_omitted(me_api):
    venue = me_api.post("/lieux", json={"name": "Bar"}).json()["id"]
    game = _game(
        me_api, venue={"venue_id": venue}, notes="soirée", table=_table(vp=1)
    ).json()
    kept = me_api.patch(f"/parties/{game['id']}", json={"notes": None}).json()
    assert kept["notes"] is None and kept["venue_id"] == venue
    assert kept["me"]["victory_points"] == 1
    cleared = me_api.patch(f"/parties/{game['id']}", json={"venue": None}).json()
    assert cleared["venue_id"] is None


def test_patch_moves_a_game_in_and_out_of_a_tournament(me_api):
    tournament = _tournament(me_api, round_count=3)
    game = _game(me_api).json()
    ref = {"tournament_id": tournament["id"]}
    # Entrer dans un tournoi exige de dire quelle ronde.
    assert (
        me_api.patch(f"/parties/{game['id']}", json={"tournament": ref}).status_code
        == 422
    )
    moved = me_api.patch(
        f"/parties/{game['id']}",
        json={"tournament": ref, "round_type": "preliminary", "round_number": 1},
    )
    assert moved.status_code == 200, moved.text
    assert moved.json()["tournament_name"] == "Open de Lyon"
    detached = me_api.patch(
        f"/parties/{game['id']}",
        json={"tournament": None, "round_type": "casual", "round_number": None},
    )
    assert detached.status_code == 200
    assert detached.json()["tournament_id"] is None
    assert me_api.delete(f"/tournois/{tournament['id']}").status_code == 204


def test_delete_game_removes_its_table(me_api, db):
    marc = _opponent(me_api, "Marc")
    game = _game(me_api, table=_table(others=[{"player": {"player_id": marc}}])).json()
    assert me_api.delete(f"/parties/{game['id']}").status_code == 204
    assert me_api.get(f"/parties/{game['id']}").status_code == 404
    assert db.scalars(select(Participation)).all() == []
    assert db.scalars(select(Player).where(Player.id == marc)).one()
    assert me_api.delete(f"/parties/{game['id']}").status_code == 404


# ---------------------------------------------------------------------------
# Listes : tri et filtres
# ---------------------------------------------------------------------------


def test_games_list_sorted_by_played_at_descending_and_filtered(me_api):
    deck_a, deck_b = _deck(me_api, "A"), _deck(me_api, "B")
    venue = me_api.post("/lieux", json={"name": "Bar"}).json()["id"]
    tournament = _tournament(me_api)
    marc = _opponent(me_api, "Marc")
    old = _game(
        me_api, played_at="2026-10-01T20:00:00+00:00", table=_table(deck=deck_a)
    ).json()
    mid = _game(
        me_api,
        played_at="2026-10-10T20:00:00+00:00",
        venue={"venue_id": venue},
        # deck_b prêté à Marc : ne compte pas pour le filtre `deck_id`.
        table=_table(
            deck=deck_a,
            others=[{"player": {"player_id": marc}, "deck": {"deck_id": deck_b}}],
        ),
    ).json()
    new = _game(
        me_api,
        played_at="2026-10-20T20:00:00+00:00",
        tournament={"tournament_id": tournament["id"]},
        round_type="final",
        table=_table(deck=deck_b),
    ).json()

    def ids(**params):
        response = me_api.get("/parties", params=params)
        assert response.status_code == 200, response.text
        return [g["id"] for g in response.json()]

    assert ids() == [new["id"], mid["id"], old["id"]]
    assert ids(deck_id=deck_a) == [mid["id"], old["id"]]
    assert ids(deck_id=deck_b) == [new["id"]]
    assert ids(casual="true") == [mid["id"], old["id"]]
    assert ids(casual="false") == [new["id"]]
    assert ids(tournament_id=tournament["id"]) == [new["id"]]
    assert ids(venue_id=venue) == [mid["id"]]
    assert ids(**{"from": "2026-10-10T20:00:00+00:00"}) == [new["id"], mid["id"]]
    assert ids(**{"to": "2026-10-10T20:00:00+00:00"}) == [mid["id"], old["id"]]
    listed = me_api.get("/parties").json()
    assert listed[0]["tournament_name"] == "Open de Lyon"
    assert "participations" not in listed[0]


def test_games_list_from_needs_a_timezone(me_api):
    response = me_api.get("/parties", params={"from": "2026-10-10T20:00:00"})
    assert response.status_code == 422


def test_a_games_list_does_not_query_per_game(me_api, db_engine):
    from sqlalchemy import event

    marc = _opponent(me_api, "Marc")
    for _ in range(6):
        _game(me_api, table=_table(others=[{"player": {"player_id": marc}}]))
    statements: list[str] = []
    event.listen(
        db_engine, "before_cursor_execute", lambda *a: statements.append(a[2])
    )
    assert len(me_api.get("/parties").json()) == 6
    selects = [s for s in statements if s.lstrip().upper().startswith("SELECT")]
    # Session, partie (+ tournoi joint), participations (+ joueurs joints) :
    # une poignée de requêtes, quel que soit le nombre de parties.
    assert len(selects) <= 5, selects


# ---------------------------------------------------------------------------
# Tournois : création, bilan, détail
# ---------------------------------------------------------------------------


def test_create_tournament_defaults_and_empty_summary(me_api):
    tournament = _tournament(me_api)
    assert tournament["deck_policy"] == "mono"
    assert tournament["event_tier"] == "standard"
    assert tournament["final_deck_rule"] is None
    assert tournament["player_count"] is None
    assert tournament["my_summary"] == {
        "preliminary_game_wins": 0,
        "preliminary_victory_points": 0,
        "rounds_played": 0,
        "final_victory_points": None,
        "final_game_win": None,
    }


@pytest.mark.parametrize(
    ("fields", "fragment"),
    [
        ({"deck_policy": "multi", "event_tier": "grand_prix"}, "Multi-deck interdit"),
        (
            {"deck_policy": "multi", "event_tier": "national_championship"},
            "Multi-deck interdit",
        ),
        ({"final_deck_rule": "free_choice"}, "mono-deck"),
        ({"end_date": "2026-10-23"}, "avant son début"),
        ({"player_count": 8, "my_ranking": 9}, "9e d'un tournoi de 8"),
    ],
)
def test_create_tournament_refusals(me_api, fields, fragment):
    response = me_api.post(
        "/tournois", json={"name": "T", "start_date": "2026-10-24", **fields}
    )
    assert response.status_code == 422, response.text
    assert fragment in response.text


def test_tournament_summary_and_detail_order(me_api):
    deck = _deck(me_api)
    tournament = _tournament(me_api, deck_policy="mono")
    # Saisies dans le désordre : le détail les range par ronde, finale en dernier.
    final = _final(me_api, tournament, deck=deck, vp=1.5).json()
    r2 = _round(me_api, tournament, 2, deck=deck, vp=3)
    r1 = _round(me_api, tournament, 1, deck=deck, vp=2.5)
    detail = me_api.get(f"/tournois/{tournament['id']}").json()
    assert [g["id"] for g in detail["games"]] == [r1["id"], r2["id"], final["id"]]
    assert detail["my_summary"] == {
        "preliminary_game_wins": 1,
        "preliminary_victory_points": 5.5,
        "rounds_played": 2,
        "final_victory_points": 1.5,
        "final_game_win": False,
    }
    assert detail["admissible_final_decks"] is None  # mono : rien à contrôler
    listed = me_api.get("/tournois").json()
    assert listed[0]["my_summary"] == detail["my_summary"]
    assert "games" not in listed[0]


def test_unplayed_vp_count_as_zero_in_the_summary(me_api):
    tournament = _tournament(me_api)
    _round(me_api, tournament, 1)
    summary = me_api.get(f"/tournois/{tournament['id']}").json()["my_summary"]
    assert summary["rounds_played"] == 1
    assert summary["preliminary_victory_points"] == 0


def test_tournaments_sorted_by_start_date_descending_and_filtered(me_api):
    old = _tournament(me_api, name="Élan d'automne", start_date="2026-09-01")
    new = _tournament(me_api, name="Open", start_date="2026-10-24")

    def ids(**params):
        response = me_api.get("/tournois", params=params)
        assert response.status_code == 200, response.text
        return [t["id"] for t in response.json()]

    assert ids() == [new["id"], old["id"]]
    assert ids(q="elan") == [old["id"]]
    assert ids(**{"from": "2026-10-01"}) == [new["id"]]
    assert ids(**{"to": "2026-09-01"}) == [old["id"]]


def test_unknown_tournament_is_404(me_api):
    for response in (
        me_api.get("/tournois/999999"),
        me_api.patch("/tournois/999999", json={"notes": "x"}),
        me_api.delete("/tournois/999999"),
    ):
        assert response.status_code == 404
        assert response.json()["detail"] == "Tournoi 999999 introuvable."


# ---------------------------------------------------------------------------
# Mono-deck (A7)
# ---------------------------------------------------------------------------


def test_mono_deck_refuses_a_second_deck_by_name(me_api):
    first, second = _deck(me_api, "Banu Princes"), _deck(me_api, "Toreador")
    tournament = _tournament(me_api)
    _round(me_api, tournament, 1, deck=first)
    response = _game(
        me_api,
        tournament={"tournament_id": tournament["id"]},
        round_type="preliminary",
        round_number=2,
        table=_table(deck=second),
    )
    assert response.status_code == 409
    assert "Banu Princes#" in response.text and "Toreador#" in response.text


def test_mono_deck_ignores_rounds_without_deck_and_lent_decks(me_api):
    mine, lent = _deck(me_api, "Mes Banu"), _deck(me_api, "Prêtés")
    marc = _opponent(me_api, "Marc")
    tournament = _tournament(me_api)
    _round(me_api, tournament, 1, deck=mine)
    _round(me_api, tournament, 2)
    others = [{"player": {"player_id": marc}, "deck": {"deck_id": lent}}]
    response = _game(
        me_api,
        tournament={"tournament_id": tournament["id"]},
        round_type="preliminary",
        round_number=3,
        table=_table(deck=mine, others=others),
    )
    assert response.status_code == 201, response.text


def test_replacing_a_table_deck_is_checked_against_the_tournament(me_api):
    first, second = _deck(me_api, "A"), _deck(me_api, "B")
    tournament = _tournament(me_api)
    _round(me_api, tournament, 1, deck=first)
    r2 = _round(me_api, tournament, 2, deck=first)
    response = me_api.put(
        f"/parties/{r2['id']}/participations",
        json={"participations": _table(deck=second)},
    )
    assert response.status_code == 409


def test_switching_to_mono_with_two_decks_is_a_conflict(me_api):
    first, second = _deck(me_api, "A"), _deck(me_api, "B")
    tournament = _tournament(me_api, deck_policy="multi")
    _round(me_api, tournament, 1, deck=first)
    _round(me_api, tournament, 2, deck=second)
    response = me_api.patch(
        f"/tournois/{tournament['id']}", json={"deck_policy": "mono"}
    )
    assert response.status_code == 409
    assert me_api.get(f"/tournois/{tournament['id']}").json()["deck_policy"] == "multi"


def test_switching_to_mono_with_one_deck_works(me_api):
    deck = _deck(me_api)
    tournament = _tournament(me_api, deck_policy="multi", final_deck_rule="free_choice")
    _round(me_api, tournament, 1, deck=deck)
    # La règle de finale ne vaut qu'en multi : la retirer est un 422 si on l'oublie.
    assert (
        me_api.patch(
            f"/tournois/{tournament['id']}", json={"deck_policy": "mono"}
        ).status_code
        == 422
    )
    done = me_api.patch(
        f"/tournois/{tournament['id']}",
        json={"deck_policy": "mono", "final_deck_rule": None},
    )
    assert done.status_code == 200 and done.json()["deck_policy"] == "mono"


# ---------------------------------------------------------------------------
# Multi-deck et deck de finale (A11)
# ---------------------------------------------------------------------------


def _multi(api, rule):
    return _tournament(api, deck_policy="multi", final_deck_rule=rule)


def test_free_choice_final_must_use_a_preliminary_deck(me_api):
    first, second, outsider = (_deck(me_api, n) for n in ("A", "B", "Hors tournoi"))
    tournament = _multi(me_api, "free_choice")
    _round(me_api, tournament, 1, deck=first)
    _round(me_api, tournament, 2, deck=second)
    detail = me_api.get(f"/tournois/{tournament['id']}").json()
    assert detail["admissible_final_decks"] == sorted([first, second])
    refused = _final(me_api, tournament, deck=outsider)
    assert refused.status_code == 409
    assert "Hors tournoi#" in refused.text and "A#" in refused.text
    assert _final(me_api, tournament, deck=second).status_code == 201


def test_best_performing_final_must_use_the_best_round_deck(me_api):
    weak, strong = _deck(me_api, "Faible"), _deck(me_api, "Fort")
    tournament = _multi(me_api, "best_performing")
    _round(me_api, tournament, 1, deck=weak, vp=1)
    _round(me_api, tournament, 2, deck=strong, vp=3)
    assert (
        me_api.get(f"/tournois/{tournament['id']}").json()["admissible_final_decks"]
        == [strong]
    )
    refused = _final(me_api, tournament, deck=weak)
    assert refused.status_code == 409
    assert "meilleur deck" in refused.text and "Fort#" in refused.text
    assert _final(me_api, tournament, deck=strong).status_code == 201


def test_best_performing_ties_admit_both_decks(me_api):
    a, b = _deck(me_api, "A"), _deck(me_api, "B")
    tournament = _multi(me_api, "best_performing")
    _round(me_api, tournament, 1, deck=a, vp=2)
    _round(me_api, tournament, 2, deck=b, vp=2)
    assert _final(me_api, tournament, deck=a).status_code == 201


def test_an_unknown_rule_or_missing_decks_never_refuse_a_final(me_api):
    a, b = _deck(me_api, "A"), _deck(me_api, "B")
    no_rule = _tournament(me_api, deck_policy="multi", name="Sans règle")
    _round(me_api, no_rule, 1, deck=a)
    assert _final(me_api, no_rule, deck=b).status_code == 201
    free = _multi(me_api, "free_choice")
    _round(me_api, free, 1, deck=a)
    _round(me_api, free, 2)  # ronde sans deck : rien n'est contrôlable
    assert _final(me_api, free, deck=b).status_code == 201


def test_editing_a_preliminary_is_refused_when_it_breaks_the_final(me_api):
    weak, strong = _deck(me_api, "Faible"), _deck(me_api, "Fort")
    tournament = _multi(me_api, "best_performing")
    _round(me_api, tournament, 1, deck=weak, vp=1)
    r2 = _round(me_api, tournament, 2, deck=strong, vp=3)
    assert _final(me_api, tournament, deck=strong).status_code == 201
    # Passer la ronde 2 à 0 VP rendrait `weak` le meilleur deck.
    response = me_api.put(
        f"/parties/{r2['id']}/participations",
        json={"participations": _table(deck=strong, vp=0)},
    )
    assert response.status_code == 409
    assert "Faible#" in response.text
    # Retirer la préliminaire qui portait le deck de la finale est refusé aussi.
    assert me_api.delete(f"/parties/{r2['id']}").status_code == 409


def test_changing_the_final_rule_after_the_final_is_checked(me_api):
    a, b = _deck(me_api, "A"), _deck(me_api, "B")
    tournament = _multi(me_api, "free_choice")
    _round(me_api, tournament, 1, deck=a, vp=1)
    _round(me_api, tournament, 2, deck=b, vp=3)
    assert _final(me_api, tournament, deck=a).status_code == 201
    response = me_api.patch(
        f"/tournois/{tournament['id']}", json={"final_deck_rule": "best_performing"}
    )
    assert response.status_code == 409 and "B#" in response.text
    ok = me_api.patch(f"/tournois/{tournament['id']}", json={"final_deck_rule": None})
    assert ok.status_code == 200


def test_moving_a_game_between_tournaments_checks_both(me_api):
    a, b = _deck(me_api, "A"), _deck(me_api, "B")
    source = _multi(me_api, "free_choice")
    _round(me_api, source, 1, deck=a)
    r2 = _round(me_api, source, 2, deck=b)
    assert _final(me_api, source, deck=b).status_code == 201
    target = _tournament(me_api, name="Mono", deck_policy="mono")
    _round(me_api, target, 1, deck=a)
    # Vers un mono-deck qui joue autre chose : refusé côté destination.
    into = me_api.patch(
        f"/parties/{r2['id']}", json={"tournament": {"tournament_id": target["id"]},
                                       "round_number": 2},
    )
    assert into.status_code == 409
    # Hors de la source : le deck B n'y est plus joué en préliminaires, la finale
    # le jouait.
    out = me_api.patch(
        f"/parties/{r2['id']}",
        json={"tournament": None, "round_type": "casual", "round_number": None},
    )
    assert out.status_code == 409 and "B#" in out.text


def test_a_multi_deck_tier_can_no_longer_be_reached_by_patch(me_api):
    tournament = _tournament(me_api, deck_policy="multi")
    response = me_api.patch(
        f"/tournois/{tournament['id']}", json={"event_tier": "continental_championship"}
    )
    assert response.status_code == 422 and "Multi-deck interdit" in response.text
    mono = _tournament(me_api, name="Mono")
    ok = me_api.patch(f"/tournois/{mono['id']}", json={"event_tier": "grand_prix"})
    assert ok.status_code == 200 and ok.json()["event_tier"] == "grand_prix"
    back = me_api.patch(f"/tournois/{mono['id']}", json={"deck_policy": "multi"})
    assert back.status_code == 422


# ---------------------------------------------------------------------------
# Classement (A12), nombre de rondes, suppression (A9)
# ---------------------------------------------------------------------------


def test_my_ranking_is_bounded_by_player_count_and_by_my_final(me_api):
    tournament = _tournament(me_api, player_count=8)
    url = f"/tournois/{tournament['id']}"
    assert me_api.patch(url, json={"my_ranking": 9}).status_code == 422
    assert me_api.patch(url, json={"my_ranking": 7}).status_code == 200
    # Une finale jouée : le classement d'un finaliste va de 1 à 5.
    refused = _final(me_api, tournament, vp=1)
    assert refused.status_code == 409 and "7e" in refused.text
    assert me_api.patch(url, json={"my_ranking": 3}).status_code == 200
    assert _final(me_api, tournament, vp=1).status_code == 201
    assert me_api.patch(url, json={"my_ranking": 6}).status_code == 422


def test_a_final_game_win_implies_first_place(me_api):
    tournament = _tournament(me_api, player_count=20, my_ranking=2)
    refused = _final(me_api, tournament, vp=3)  # GW certain posé par le serveur
    assert refused.status_code == 409 and "Game Win" in refused.text
    url = f"/tournois/{tournament['id']}"
    assert me_api.patch(url, json={"my_ranking": 1}).status_code == 200
    final = _final(me_api, tournament, vp=3)
    assert final.status_code == 201
    assert me_api.patch(url, json={"my_ranking": 2}).status_code == 422
    # Gagner sans GW reste possible : le contrôle ne vaut que dans un sens.
    other = _tournament(me_api, name="Autre", player_count=20, my_ranking=1)
    assert _final(me_api, other, vp=1.5).status_code == 201


def test_editing_the_final_rechecks_the_ranking_and_deleting_it_frees_it(me_api):
    tournament = _tournament(me_api, player_count=20)
    final = _final(me_api, tournament, vp=1).json()
    url = f"/tournois/{tournament['id']}"
    assert me_api.patch(url, json={"my_ranking": 1}).status_code == 200
    # Corriger la finale en victoire certaine est cohérent avec la place 1.
    assert me_api.put(
        f"/parties/{final['id']}/participations",
        json={"participations": _table(vp=3)},
    ).status_code == 200
    assert me_api.delete(f"/parties/{final['id']}").status_code == 204
    assert me_api.patch(url, json={"my_ranking": 12}).status_code == 200


def test_round_count_cannot_drop_below_a_round_already_entered(me_api):
    tournament = _tournament(me_api, round_count=4)
    _round(me_api, tournament, 3)
    url = f"/tournois/{tournament['id']}"
    refused = me_api.patch(url, json={"round_count": 2})
    assert refused.status_code == 409 and "ronde 3" in refused.text
    assert me_api.patch(url, json={"round_count": 3}).status_code == 200
    assert me_api.patch(url, json={"round_count": None}).status_code == 200


def test_delete_tournament_is_refused_while_it_has_games(me_api):
    tournament = _tournament(me_api)
    game = _round(me_api, tournament, 1)
    _round(me_api, tournament, 2)
    refused = me_api.delete(f"/tournois/{tournament['id']}")
    assert refused.status_code == 409
    assert refused.json()["detail"] == (
        "Ce tournoi contient 2 parties : supprimez-les ou détachez-les du "
        "tournoi d'abord."
    )
    me_api.delete(f"/parties/{game['id']}")
    one = me_api.delete(f"/tournois/{tournament['id']}")
    assert one.status_code == 409 and "1 partie :" in one.json()["detail"]


def test_patch_tournament_fields_and_venue(me_api):
    venue = me_api.post("/lieux", json={"name": "Bar"}).json()["id"]
    tournament = _tournament(me_api, notes="n")
    url = f"/tournois/{tournament['id']}"
    updated = me_api.patch(
        url, json={"venue": {"venue_id": venue}, "player_count": 27, "notes": None}
    ).json()
    assert updated["venue_id"] == venue and updated["player_count"] == 27
    assert updated["notes"] is None and updated["name"] == "Open de Lyon"
    assert me_api.patch(url, json={"venue": None}).json()["venue_id"] is None
    assert me_api.patch(url, json={"venue": {"venue_id": 999}}).status_code == 404
    assert me_api.patch(url, json={"end_date": "2026-10-01"}).status_code == 422
    assert me_api.patch(url, json={}).status_code == 200


# ---------------------------------------------------------------------------
# Compteurs du Carnet et suppression d'un joueur après remplacement de table
# ---------------------------------------------------------------------------


def test_carnet_counters_follow_games_and_tables(me_api):
    marc = _opponent(me_api, "Marc")
    venue = me_api.post("/lieux", json={"name": "Bar"}).json()["id"]
    tournament = _tournament(me_api)
    game = _game(
        me_api,
        venue={"venue_id": venue},
        table=_table(others=[{"player": {"player_id": marc}}]),
    ).json()
    assert me_api.get(f"/joueurs/{marc}").json()["game_count"] == 1
    assert me_api.get(f"/lieux/{venue}").json()["game_count"] == 1
    assert me_api.delete(f"/joueurs/{marc}").status_code == 409
    me_api.put(
        f"/parties/{game['id']}/participations", json={"participations": _table()}
    )
    assert me_api.delete(f"/joueurs/{marc}").status_code == 204
    me_api.patch(f"/tournois/{tournament['id']}", json={"venue": {"venue_id": venue}})
    assert me_api.get(f"/lieux/{venue}").json()["tournament_count"] == 1


# ---------------------------------------------------------------------------
# Isolation entre comptes
# ---------------------------------------------------------------------------


def test_every_route_renders_a_plain_404_for_another_accounts_rows(two_accounts):
    api_a, api_b, _, _ = two_accounts
    tournament = _tournament(api_a)
    game = _game(api_a).json()
    for response, noun, ident in (
        (api_b.get(f"/parties/{game['id']}"), "Partie", game["id"]),
        (
            api_b.patch(f"/parties/{game['id']}", json={"notes": "x"}),
            "Partie",
            game["id"],
        ),
        (
            api_b.put(
                f"/parties/{game['id']}/participations",
                json={"participations": _table()},
            ),
            "Partie",
            game["id"],
        ),
        (api_b.delete(f"/parties/{game['id']}"), "Partie", game["id"]),
        (api_b.get(f"/tournois/{tournament['id']}"), "Tournoi", tournament["id"]),
        (
            api_b.patch(f"/tournois/{tournament['id']}", json={"notes": "x"}),
            "Tournoi",
            tournament["id"],
        ),
        (api_b.delete(f"/tournois/{tournament['id']}"), "Tournoi", tournament["id"]),
    ):
        assert response.status_code == 404, response.request.url
        assert response.json()["detail"] == f"{noun} {ident} introuvable."


def test_lists_never_show_the_other_accounts_rows_and_each_has_its_own_me(
    two_accounts,
):
    api_a, api_b, _, _ = two_accounts
    _tournament(api_a)
    _game(api_a)
    assert api_b.get("/tournois").json() == []
    assert api_b.get("/parties").json() == []
    mine = _game(api_b)
    assert mine.status_code == 201
    assert len(api_a.get("/parties").json()) == 1


def test_a_game_of_b_is_not_counted_in_a_deck_filter_of_a(two_accounts):
    api_a, api_b, _, _ = two_accounts
    deck_a = _deck(api_a)
    _game(api_a, table=_table(deck=deck_a))
    listed = api_a.get("/parties", params={"deck_id": deck_a}).json()
    assert [g["me"]["deck_id"] for g in listed] == [deck_a]
    assert api_b.get("/parties", params={"deck_id": deck_a}).json() == []


def test_the_me_player_is_created_on_demand_for_an_old_account(api, db):
    make_account(db, email="ancien@example.com", username="ancien")
    log_in(api, "ancien@example.com")
    response = _game(api)
    assert response.status_code == 201, response.text
    assert [p.name for p in db.scalars(select(Player)) if p.is_me] == ["ancien"]


def test_played_at_is_stored_as_the_same_instant(me_api, db):
    game = _game(me_api, played_at="2026-10-24T23:30:00+02:00").json()
    stored = datetime.fromisoformat(game["played_at"].replace("Z", "+00:00"))
    assert stored == datetime(2026, 10, 24, 21, 30, tzinfo=UTC)


# ---------------------------------------------------------------------------
# Corrections de la relecture de B2
# ---------------------------------------------------------------------------

EXTREME_LOW = "0001-01-01T00:00:00+14:00"
EXTREME_HIGH = "9999-12-31T23:59:59-05:00"
MAX_INT = 2**31 - 1


@pytest.mark.parametrize("name", ["from", "to"])
@pytest.mark.parametrize("value", [EXTREME_LOW, EXTREME_HIGH])
def test_unrepresentable_instants_in_the_query_are_422(me_api, name, value):
    response = me_api.get("/parties", params={name: value})
    assert response.status_code == 422, response.text
    assert response.json()["detail"][0]["loc"] == ["query", name]


@pytest.mark.parametrize("value", [EXTREME_LOW, EXTREME_HIGH])
def test_unrepresentable_instants_in_the_body_are_422(me_api, value):
    assert _game(me_api, played_at=value).status_code == 422
    game = _game(me_api).json()
    patched = me_api.patch(f"/parties/{game['id']}", json={"played_at": value})
    assert patched.status_code == 422


def test_a_client_ref_is_refused_online_on_every_write_route(me_api):
    game = _game(me_api).json()
    tournament = _tournament(me_api)
    responses = [
        me_api.patch(f"/parties/{game['id']}", json={"venue": {"client_ref": "v"}}),
        me_api.patch(
            f"/parties/{game['id']}", json={"tournament": {"client_ref": "t"}}
        ),
        me_api.put(
            f"/parties/{game['id']}/participations",
            json={"participations": [{"player": ME, "deck": {"client_ref": "d"}}]},
        ),
        me_api.put(
            f"/parties/{game['id']}/participations",
            json={"participations": _table(others=[{"player": {"client_ref": "p"}}])},
        ),
        me_api.patch(
            f"/tournois/{tournament['id']}", json={"venue": {"client_ref": "v"}}
        ),
    ]
    for response in responses:
        assert response.status_code == 422, response.text
        assert "synchronisation" in response.text


def test_another_accounts_resource_in_a_body_is_404_on_updates(two_accounts):
    api_a, api_b, _, _ = two_accounts
    deck_a = _deck(api_a)
    tournament_a = _tournament(api_a)
    venue_a = api_a.post("/lieux", json={"name": "Bar"}).json()["id"]
    marc_a = _opponent(api_a, "Marc")
    game_b = _game(api_b).json()
    tournament_b = _tournament(api_b)
    ref = {"tournament_id": tournament_a["id"]}
    path = f"/parties/{game_b['id']}"
    responses = [
        api_b.patch(path, json={"venue": {"venue_id": venue_a}}),
        api_b.patch(path, json={"tournament": ref, "round_type": "final"}),
        api_b.put(
            f"{path}/participations",
            json={"participations": [{"player": ME, "deck": {"deck_id": deck_a}}]},
        ),
        api_b.put(
            f"{path}/participations",
            json={
                "participations": _table(others=[{"player": {"player_id": marc_a}}])
            },
        ),
        api_b.patch(
            f"/tournois/{tournament_b['id']}", json={"venue": {"venue_id": venue_a}}
        ),
    ]
    for response in responses:
        assert response.status_code == 404, response.text


def test_round_already_entered_is_refused_on_patch_and_on_a_move(me_api):
    tournament = _tournament(me_api)
    other = _tournament(me_api, name="Autre")
    _round(me_api, tournament, 1)
    r2 = _round(me_api, tournament, 2)
    taken = me_api.patch(f"/parties/{r2['id']}", json={"round_number": 1})
    assert taken.status_code == 409
    assert "La ronde 1 est déjà saisie" in taken.json()["detail"]
    # Échanger deux numéros passe par un numéro intermédiaire libre.
    free = me_api.patch(f"/parties/{r2['id']}", json={"round_number": 3})
    assert free.status_code == 200
    _round(me_api, other, 3)
    moved = me_api.patch(
        f"/parties/{r2['id']}", json={"tournament": {"tournament_id": other["id"]}}
    )
    assert moved.status_code == 409
    assert "La ronde 3 est déjà saisie" in moved.json()["detail"]


def test_leaving_a_tournament_names_the_context_of_the_final_deck(me_api):
    weak, strong = _deck(me_api, "Faible"), _deck(me_api, "Fort")
    tournament = _multi(me_api, "best_performing")
    _round(me_api, tournament, 1, deck=weak, vp=1)
    r2 = _round(me_api, tournament, 2, deck=strong, vp=3)
    assert _final(me_api, tournament, deck=strong).status_code == 201
    prefix = "Retirer cette ronde changerait le deck attendu en finale : "
    detach = me_api.patch(
        f"/parties/{r2['id']}",
        json={"tournament": None, "round_type": "casual", "round_number": None},
    )
    assert detach.status_code == 409
    assert detach.json()["detail"].startswith(prefix)
    assert "Faible#" in detach.json()["detail"]
    deleted = me_api.delete(f"/parties/{r2['id']}")
    assert deleted.status_code == 409
    assert deleted.json()["detail"].startswith(prefix)


@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        ("get", "/parties/{id}", None),
        ("get", "/tournois/{id}", None),
        ("put", "/parties/{id}/participations", {"participations": _table()}),
        ("delete", "/tournois/{id}", None),
    ],
)
def test_path_ids_beyond_max_db_int_are_422(me_api, method, path, body):
    kwargs = {} if body is None else {"json": body}
    call = getattr(me_api, method)
    assert call(path.format(id=MAX_INT + 1), **kwargs).status_code == 422
    assert call(path.format(id=MAX_INT), **kwargs).status_code == 404


def test_values_beyond_max_db_int_are_422(me_api):
    tournament = _tournament(me_api)
    for name in ("tournament_id", "deck_id", "venue_id"):
        assert me_api.get("/parties", params={name: MAX_INT + 1}).status_code == 422
    assert _game(me_api, round_number=MAX_INT + 1).status_code == 422
    too_many_rounds = {
        "name": "T",
        "start_date": "2026-10-24",
        "round_count": MAX_INT + 1,
    }
    assert me_api.post("/tournois", json=too_many_rounds).status_code == 422
    patched = me_api.patch(
        f"/tournois/{tournament['id']}", json={"player_count": MAX_INT + 1}
    )
    assert patched.status_code == 422
    assert _game(me_api, venue={"venue_id": MAX_INT + 1}).status_code == 422


def test_tournament_filter_from_after_to_is_an_empty_list(me_api):
    _tournament(me_api, start_date="2026-10-24")
    params = {"from": "2026-12-01", "to": "2026-01-01"}
    response = me_api.get("/tournois", params=params)
    assert response.status_code == 200 and response.json() == []


def test_a_kept_deleted_deck_on_an_unchanged_opponent_line_is_still_accepted(me_api):
    lent = _deck(me_api, "Prêté")
    marc = _opponent(me_api, "Marc")
    others = [{"player": {"player_id": marc}, "deck": {"deck_id": lent}}]
    game = _game(me_api, table=_table(others=others)).json()
    me_api.patch(f"/decks/{lent}", json={"archived": True})
    assert me_api.delete(f"/decks/{lent}").status_code == 204
    kept = me_api.put(
        f"/parties/{game['id']}/participations",
        json={"participations": _table(vp=1, others=others)},
    )
    assert kept.status_code == 200, kept.text


def test_a_game_without_my_line_raises_an_explicit_error(me_api, db):
    """Limite connue, gardée par l'utilisateur : l'invariant « une partie a ma
    ligne » (A2) est tenu par les services ; une partie qui y échapperait (SQL
    direct) lève une `RuntimeError` claire, pas une erreur de validation."""
    from app.models import Game, UserAccount

    user_id = db.scalar(
        select(UserAccount.id).where(UserAccount.email == "joue@example.com")
    )
    game = Game(user_id=user_id, played_at=datetime(2026, 10, 1, 20), player_count=4)
    db.add(game)
    db.commit()
    with pytest.raises(RuntimeError, match="n'a pas de ligne « Moi »"):
        me_api.get(f"/parties/{game.id}")
