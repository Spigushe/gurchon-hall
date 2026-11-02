"""Lot 7, étape E (back) : cas que l'audit de couverture n'a pas trouvés.

Complète `test_play_routes.py` et `test_sync_lot7.py` (dont les assistants sont
réemployés) sur : VP au quart de point par la route, niveaux de championnat
sous `PATCH`, deck prêté face au mono-deck et à la finale, table réduite à ma
seule ligne, résultat d'un adversaire par `PUT` et par `/sync`, deck de finale
refusé par `/sync`, conversion « dernière ronde -> finale puis baisse de
`round_count` » par `/sync` (D2), « Moi » à travers `POST /inscription`.
"""

import pytest

from tests import test_play_routes as R
from tests import test_sync_lot7 as S
from tests.auth_helpers import log_in


@pytest.fixture
def me_api(api, db):
    S._account_with_me(db, "qa-e@example.com", "qa-e")
    log_in(api, "qa-e@example.com")
    return api


# --------------------------------------------------------------------------
# VP et niveaux, par la route
# --------------------------------------------------------------------------


@pytest.mark.parametrize("vp", [0.25, 1.3, 2.75])
def test_victory_points_off_the_half_point_grid_are_refused_by_the_route(me_api, vp):
    response = R._game(me_api, table=R._table(vp=vp))
    assert response.status_code == 422
    assert "multiple of 0.5" in response.text  # refusé dès le schéma


@pytest.mark.parametrize(
    "tier", ["national_championship", "grand_prix", "continental_championship"]
)
def test_every_championship_tier_refuses_multi_deck_on_create_and_patch(me_api, tier):
    created = me_api.post(
        "/tournois",
        json={
            "name": "T",
            "start_date": "2026-10-24",
            "deck_policy": "multi",
            "event_tier": tier,
        },
    )
    assert created.status_code == 422 and "Multi-deck interdit" in created.text
    multi = R._tournament(me_api, deck_policy="multi", name="Multi")
    patched = me_api.patch(f"/tournois/{multi['id']}", json={"event_tier": tier})
    assert patched.status_code == 422 and "Multi-deck interdit" in patched.text
    assert me_api.get(f"/tournois/{multi['id']}").json()["event_tier"] == "standard"


# --------------------------------------------------------------------------
# Decks prêtés : sans effet sur le mono-deck ni sur la finale
# --------------------------------------------------------------------------


def _lend(opponent, deck):
    return [{"player": {"player_id": opponent}, "deck": {"deck_id": deck}}]


def test_a_lent_deck_does_not_enter_the_admissible_final_decks(me_api):
    mine, lent = R._deck(me_api, "Mes Banu"), R._deck(me_api, "Prêtés")
    marc = R._opponent(me_api, "Marc")
    tournament = R._multi(me_api, "free_choice")
    first = R._game(
        me_api,
        tournament={"tournament_id": tournament["id"]},
        round_type="preliminary",
        round_number=1,
        table=R._table(deck=mine, others=_lend(marc, lent)),
    )
    assert first.status_code == 201, first.text
    detail = me_api.get(f"/tournois/{tournament['id']}").json()
    assert detail["admissible_final_decks"] == [mine]
    # Jouer le deck que Marc m'a prêté en finale reste refusé : il n'est pas à moi
    # parmi les préliminaires.
    assert R._final(me_api, tournament, deck=lent).status_code == 409
    # Et le deck prêté à un adversaire de la finale ne compte pas comme le mien.
    final = R._game(
        me_api,
        tournament={"tournament_id": tournament["id"]},
        round_type="final",
        table=R._table(deck=mine, others=_lend(marc, lent)),
    )
    assert final.status_code == 201, final.text


def test_a_lent_deck_never_becomes_the_best_deck(me_api):
    mine, lent = R._deck(me_api, "Mes Banu"), R._deck(me_api, "Prêtés")
    marc = R._opponent(me_api, "Marc")
    tournament = R._multi(me_api, "best_performing")
    for number, vp in ((1, 1), (2, 3)):
        response = R._game(
            me_api,
            tournament={"tournament_id": tournament["id"]},
            round_type="preliminary",
            round_number=number,
            table=R._table(deck=mine, vp=vp, others=_lend(marc, lent)),
        )
        assert response.status_code == 201, response.text
    detail = me_api.get(f"/tournois/{tournament['id']}").json()
    assert detail["admissible_final_decks"] == [mine]


def test_a_lent_deck_in_a_final_does_not_trip_the_mono_deck(me_api):
    mine, lent = R._deck(me_api, "Mes Banu"), R._deck(me_api, "Prêtés")
    marc = R._opponent(me_api, "Marc")
    tournament = R._tournament(me_api)  # mono
    R._round(me_api, tournament, 1, deck=mine)
    final = R._game(
        me_api,
        tournament={"tournament_id": tournament["id"]},
        round_type="final",
        table=R._table(deck=mine, others=_lend(marc, lent)),
    )
    assert final.status_code == 201, final.text


# --------------------------------------------------------------------------
# Table : réduite à ma seule ligne, résultat d'un adversaire
# --------------------------------------------------------------------------


def test_replacing_a_table_by_my_line_alone_keeps_the_opponent_in_the_carnet(me_api):
    marc = R._opponent(me_api, "Marc")
    game = R._game(
        me_api, table=R._table(vp=1, others=[{"player": {"player_id": marc}}])
    ).json()
    reduced = me_api.put(
        f"/parties/{game['id']}/participations",
        json={"participations": R._table(vp=1)},
    )
    assert reduced.status_code == 200, reduced.text
    body = reduced.json()
    assert [p["is_me"] for p in body["participations"]] == [True]
    assert body["me"]["victory_points"] == 1
    assert me_api.get(f"/joueurs/{marc}").json()["game_count"] == 0
    # Marc n'est plus à aucune table : il peut être supprimé.
    assert me_api.delete(f"/joueurs/{marc}").status_code == 204


@pytest.mark.parametrize("result", [{"victory_points": 1}, {"game_win": True}])
def test_an_opponent_result_is_refused_when_replacing_a_table(me_api, result):
    marc = R._opponent(me_api, "Marc")
    game = R._game(me_api).json()
    response = me_api.put(
        f"/parties/{game['id']}/participations",
        json={
            "participations": R._table(
                others=[{"player": {"player_id": marc}, **result}]
            )
        },
    )
    assert response.status_code == 422 and "Marc" in response.text
    assert len(me_api.get(f"/parties/{game['id']}").json()["participations"]) == 1


def test_an_opponent_result_is_invalid_by_sync(me_api):
    results = S.send(
        me_api,
        S.player("p1", "Marc"),
        S.game("g1", [S.line(), S.line(None, "p1", victory_points=1.0)]),
        S.game("g2", [S.line(), S.line(None, "p1", game_win=False)]),
    )
    S.applied(results[0])
    S.rejected(results[1], "invalid")
    S.rejected(results[2], "invalid")
    assert me_api.get("/parties").json() == []


# --------------------------------------------------------------------------
# /sync : deck de finale refusé, conversion dernière ronde -> finale
# --------------------------------------------------------------------------


def test_a_final_deck_outside_the_preliminaries_is_a_conflict_by_sync(me_api):
    results = S.send(
        me_api,
        S.deck("d1", "A"),
        S.deck("d2", "B"),
        S.deck("d3", "Hors tournoi"),
        S.tournament("t1"),  # multi, free_choice
        S.game("g1", [S.line("d1")], "t1", "preliminary", 1),
        S.game("g2", [S.line("d2")], "t1", "preliminary", 2),
        S.game("g3", [S.line("d3")], "t1", "final"),
        S.game("g4", [S.line("d2")], "t1", "final"),
    )
    for result in results[:6]:
        S.applied(result)
    S.rejected(results[6], "conflict")
    assert "Hors tournoi#" in results[6]["error"]["message"]
    S.applied(results[7])


def _three_rounds_then(*tail):
    return [
        S.deck("d1", "A"),
        S.tournament("t1", deck_policy="mono", final_deck_rule=None, round_count=3),
        S.game("g1", [S.line("d1")], "t1", "preliminary", 1),
        S.game("g2", [S.line("d1")], "t1", "preliminary", 2),
        S.game("g3", [S.line("d1")], "t1", "preliminary", 3),
        *tail,
    ]


CONVERT = S.op(
    "game.update",
    game={"client_ref": "g3"},
    data={"round_type": "final", "round_number": None},
)
LOWER = S.op(
    "tournament.update", tournament={"client_ref": "t1"}, data={"round_count": 2}
)


def test_last_round_turned_final_then_round_count_lowered_is_applied_by_sync(me_api):
    """Ordre nominal de D2 : la conversion d'abord, la baisse ensuite."""
    results = S.send(me_api, *_three_rounds_then(CONVERT, LOWER))
    assert [r["outcome"] for r in results] == ["applied"] * 7, results
    (tournament,) = me_api.get("/tournois").json()
    assert tournament["round_count"] == 2
    detail = me_api.get(f"/tournois/{tournament['id']}").json()
    assert [(g["round_type"], g["round_number"]) for g in detail["games"]] == [
        ("preliminary", 1),
        ("preliminary", 2),
        ("final", None),
    ]


def test_lowering_round_count_before_the_conversion_is_refused_by_sync(me_api):
    """Ordre inverse : la baisse est refusée tant que la ronde 3 existe ; la
    conversion qui suit s'applique seule, et rien n'est appliqué à moitié."""
    inverse_lower = S.op(
        "tournament.update", tournament={"client_ref": "t1"}, data={"round_count": 2}
    )
    inverse_convert = S.op(
        "game.update",
        game={"client_ref": "g3"},
        data={"round_type": "final", "round_number": None},
    )
    results = S.send(me_api, *_three_rounds_then(inverse_lower, inverse_convert))
    for result in results[:5]:
        S.applied(result)
    S.rejected(results[5], "conflict")
    assert "ronde 3" in results[5]["error"]["message"]
    S.applied(results[6])
    (tournament,) = me_api.get("/tournois").json()
    assert tournament["round_count"] == 3
    detail = me_api.get(f"/tournois/{tournament['id']}").json()
    assert [g["round_type"] for g in detail["games"]] == [
        "preliminary",
        "preliminary",
        "final",
    ]


def test_the_nominal_conversion_replays_as_replayed(me_api):
    batch = _three_rounds_then(CONVERT, LOWER)
    S.send(me_api, *batch)
    assert [r["outcome"] for r in S.send(me_api, *batch)] == ["replayed"] * 7


# --------------------------------------------------------------------------
# « Moi » : un seul, à l'inscription
# --------------------------------------------------------------------------


def test_sign_up_by_the_route_creates_exactly_one_me(api):
    response = api.post(
        "/inscription",
        json={
            "email": "nouveau@example.com",
            "username": "nouveau",
            "password": "Mot-de-passe-12!",
        },
    )
    assert response.status_code == 201, response.text
    players = api.get("/joueurs").json()
    assert [(p["name"], p["is_me"]) for p in players] == [("nouveau", True)]
    # Se reconnecter n'en crée pas un second.
    api.post("/deconnexion")
    again = api.post(
        "/connexion",
        json={"email": "nouveau@example.com", "password": "Mot-de-passe-12!"},
    )
    assert again.status_code == 200
    assert len(api.get("/joueurs").json()) == 1
