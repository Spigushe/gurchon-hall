"""`POST /sync` et la pratique de jeu (Lot 7, étape B3).

Les douze types (`player.*`, `venue.*`, `tournament.*`, `game.*`) traversent les
services de B1 et B2 avec `allow_client_ref=True`. On vérifie ici ce que `/sync`
ajoute : le journal par genre, la résolution des références, l'upsert par nom,
l'idempotence, les trois familles de refus et le scénario de bout en bout du
plan, dans un seul lot puis étalé sur plusieurs.
"""

from uuid import uuid4

import pytest
from sqlalchemy import func, select

from app.models import Game, Player, SyncOperation, Tournament, Venue
from app.models.enums import SyncResourceKind
from app.services import players
from tests.auth_helpers import log_in, make_account

RECORDED_AT = "2026-10-24T20:00:00+02:00"
PLAYED = "2026-10-24T20:00:00+02:00"
ME = {"me": True}


def _account_with_me(db, email, username):
    account = make_account(db, email=email, username=username)
    players.get_or_create_me(db, account.id, account.username)
    db.commit()
    return account


@pytest.fixture
def two_accounts(api_client_factory, db):
    _account_with_me(db, "sync7-a@example.com", "sync7-a")
    _account_with_me(db, "sync7-b@example.com", "sync7-b")
    client_a = api_client_factory()
    client_b = api_client_factory()
    log_in(client_a, "sync7-a@example.com")
    log_in(client_b, "sync7-b@example.com")
    return client_a, client_b


@pytest.fixture
def me_api(api, db):
    _account_with_me(db, "sync7@example.com", "sync7")
    log_in(api, "sync7@example.com")
    return api


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


def deck(ref, name="Banu Princes"):
    return op("deck.create", client_ref=ref, data={"name": name})


def venue(ref, name="Bar à Dés", **data):
    return op("venue.create", client_ref=ref, data={"name": name, **data})


def player(ref, name):
    return op("player.create", client_ref=ref, data={"name": name})


def tournament(ref, venue_ref=None, **data):
    body = {
        "name": "Open de Lyon",
        "start_date": "2026-10-24",
        "deck_policy": "multi",
        "final_deck_rule": "free_choice",
        **data,
    }
    if venue_ref is not None:
        body["venue"] = {"client_ref": venue_ref}
    return op("tournament.create", client_ref=ref, data=body)


def line(deck_ref=None, player_ref=None, **fields):
    row = {"player": ME if player_ref is None else {"client_ref": player_ref}}
    if deck_ref is not None:
        row["deck"] = {"client_ref": deck_ref}
    return row | fields


def game(ref, table, tournament_ref=None, round_type="casual", number=None, **data):
    body = {
        "played_at": PLAYED,
        "player_count": 5,
        "participations": table,
        "round_type": round_type,
        **data,
    }
    if number is not None:
        body["round_number"] = number
    if tournament_ref is not None:
        body["tournament"] = {"client_ref": tournament_ref}
    return op("game.create", client_ref=ref, data=body)


def rejected(result, code):
    assert result["outcome"] == "rejected", result
    assert result["error"]["code"] == code, result
    assert result["resource"] is None


def applied(result):
    assert result["outcome"] == "applied", result
    assert result["error"] is None
    return result["resource"]


# --------------------------------------------------------------------------
# Le scénario du plan
# --------------------------------------------------------------------------


def scenario() -> list[dict]:
    """La veille hors ligne (deck), puis le tournoi du club."""
    return [
        deck("d1", "Banu Princes"),
        deck("d2", "Malkavien 2022"),
        venue("v1"),
        tournament("t1", "v1"),
        player("p1", "Marc"),
        player("p2", "Julie"),
        game(
            "g1",
            [
                line("d1", seat=1, victory_points=2.0),
                line("d2", "p1", seat=2),  # mon deck, prêté à Marc
                line(None, "p2", seat=3),
            ],
            "t1",
            "preliminary",
            1,
            venue={"client_ref": "v1"},
        ),
        game("g2", [line("d2", victory_points=1.0)], "t1", "preliminary", 2),
        game("g3", [line("d1", victory_points=2.0)], "t1", "final"),
        op(
            "game.update",
            game={"client_ref": "g1"},
            table={
                "participations": [
                    line("d1", seat=1, victory_points=3.0, game_win=True),
                    line("d2", "p1", seat=2),
                    line(None, "p2", seat=3),
                ]
            },
        ),
        op(
            "tournament.update",
            tournament={"client_ref": "t1"},
            data={"player_count": 27, "my_ranking": 3},
        ),
    ]


def check_scenario_state(api):
    tournaments = api.get("/tournois").json()
    assert len(tournaments) == 1
    t = tournaments[0]
    assert t["player_count"] == 27 and t["my_ranking"] == 3
    assert t["venue_id"] is not None
    detail = api.get(f"/tournois/{t['id']}").json()
    assert [g["round_type"] for g in detail["games"]] == [
        "preliminary",
        "preliminary",
        "final",
    ]
    first = api.get(f"/parties/{detail['games'][0]['id']}").json()
    assert first["me"]["victory_points"] == 3.0 and first["me"]["game_win"] is True
    names = {p["id"]: p["name"] for p in api.get("/joueurs").json()}
    assert {names[p["player_id"]] for p in first["participations"]} >= {
        "Marc",
        "Julie",
    }
    assert first["venue_id"] == t["venue_id"]
    assert len(api.get("/joueurs").json()) == 3  # Moi, Marc, Julie


def test_the_plan_scenario_in_a_single_batch(me_api):
    results = send(me_api, *scenario())
    assert [r["outcome"] for r in results] == ["applied"] * 11
    check_scenario_state(me_api)


def test_the_plan_scenario_spread_over_several_batches(me_api):
    operations = scenario()
    # Un lot par étape, chacune désignant les précédentes par leur `client_ref`.
    for chunk in ([0, 1], [2, 3], [4, 5], [6], [7, 8], [9, 10]):
        results = send(me_api, *(operations[i] for i in chunk))
        assert [r["outcome"] for r in results] == ["applied"] * len(chunk), results
    check_scenario_state(me_api)


def test_the_plan_scenario_replays_identically(me_api):
    operations = scenario()
    first = send(me_api, *operations)
    second = send(me_api, *operations)
    assert [r["outcome"] for r in second] == ["replayed"] * 11
    for before, after in zip(first, second, strict=True):
        assert after["resource"] == before["resource"]
        assert after["client_ref"] == before["client_ref"]
        assert after["processed_at"] == before["processed_at"]
    created = {r["type"]: r["resource"] for r in second}
    assert created["player.create"]["player_id"] is not None
    assert created["venue.create"]["venue_id"] is not None
    assert created["tournament.create"]["tournament_id"] is not None
    assert created["game.create"]["game_id"] is not None
    assert created["game.update"]["game_id"] is not None


# --------------------------------------------------------------------------
# Journal et références par genre
# --------------------------------------------------------------------------


def test_a_creation_journals_the_id_of_its_kind_only(me_api, db):
    send(me_api, venue("v1"), tournament("t1", "v1"), player("p1", "Marc"))
    db.expire_all()
    rows = {
        row.client_ref: row
        for row in db.scalars(
            select(SyncOperation).where(SyncOperation.client_ref.is_not(None))
        )
    }
    v, t, p = rows["v1"], rows["t1"], rows["p1"]
    assert (v.resource_kind, v.venue_id) == (SyncResourceKind.VENUE, v.venue_id)
    assert v.venue_id and not (v.player_id or v.tournament_id or v.game_id)
    assert t.tournament_id and t.venue_id is None  # son lieu n'est pas le sien
    assert p.player_id and p.venue_id is None and p.tournament_id is None


def test_a_client_ref_designates_only_its_own_kind(me_api):
    results = send(
        me_api,
        venue("shared"),
        op("player.update", player={"client_ref": "shared"}, data={"name": "X"}),
        op("tournament.delete", tournament={"client_ref": "shared"}),
        op("game.delete", game={"client_ref": "shared"}),
        op("venue.update", venue={"client_ref": "shared"}, data={"city": "Lyon"}),
    )
    applied(results[0])
    for result in results[1:4]:
        rejected(result, "unresolved_client_ref")
    applied(results[4])


def test_a_game_cannot_use_a_player_ref_as_its_tournament(me_api):
    results = send(
        me_api,
        player("p1", "Marc"),
        game("g1", [line()], "p1", "preliminary", 1),
    )
    applied(results[0])
    rejected(results[1], "unresolved_client_ref")


@pytest.mark.parametrize(
    "second",
    [
        lambda ref: player(ref, "Julie"),
        lambda ref: venue(ref, "Autre lieu"),
        lambda ref: tournament(ref),
        lambda ref: game(ref, [line()]),
        lambda ref: deck(ref, "Autre deck"),
    ],
    ids=["player", "venue", "tournament", "game", "deck"],
)
@pytest.mark.parametrize("first_kind", ["venue", "deck"])
def test_a_client_ref_already_taken_is_a_conflict_not_a_500(
    me_api, db, first_kind, second
):
    first = venue("r") if first_kind == "venue" else deck("r")
    applied(send(me_api, first)[0])
    result = send(me_api, second("r"))[0]
    rejected(result, "conflict")
    assert "désigne déjà" in result["error"]["message"]
    # Rien n'a été écrit pour la seconde, et la référence reste à la première.
    assert db.scalar(select(func.count()).select_from(Tournament)) == 0
    assert db.scalar(select(func.count()).select_from(Game)) == 0


def test_a_refused_creation_does_not_reserve_its_ref(me_api):
    # Deux lots : une même référence ne figure pas deux fois dans un lot.
    first = send(me_api, tournament("t", event_tier="grand_prix"))  # multi interdit
    rejected(first[0], "invalid")
    second = send(me_api, tournament("t", deck_policy="mono", final_deck_rule=None))
    applied(second[0])


# --------------------------------------------------------------------------
# Upsert par nom
# --------------------------------------------------------------------------


def test_player_create_is_an_upsert_by_folded_name(me_api, db):
    results = send(me_api, player("a", "Éloïse"), player("b", "eloise"))
    first, second = applied(results[0]), applied(results[1])
    assert first["player_id"] == second["player_id"]
    assert (
        db.scalar(
            select(func.count()).select_from(Player).where(Player.is_me.is_(False))
        )
        == 1
    )
    # Les deux références désignent le même joueur, dans ce lot comme plus tard.
    later = send(
        me_api,
        op("player.update", player={"client_ref": "b"}, data={"name": "Éloïse D."}),
    )
    assert applied(later[0])["player_id"] == first["player_id"]
    assert me_api.get("/joueurs").json()[1]["name"] == "Éloïse D."


def test_player_create_with_the_name_of_the_me_player_is_refused(me_api, db):
    results = send(me_api, player("a", "SYNC7"), player("b", "Marc"))
    rejected(results[0], "conflict")
    assert results[0]["error"]["message"] == players.ME_NAME_TAKEN
    applied(results[1])  # le lot continue
    assert db.scalar(select(func.count()).select_from(Player)) == 2


def test_venue_create_is_an_upsert_by_folded_name(me_api, db):
    results = send(me_api, venue("a", "Café Élan"), venue("b", "cafe elan"))
    assert applied(results[0])["venue_id"] == applied(results[1])["venue_id"]
    assert db.scalar(select(func.count()).select_from(Venue)) == 1


# --------------------------------------------------------------------------
# Idempotence
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    "build",
    [
        lambda: [player("p", "Marc")],
        lambda: [venue("v")],
        lambda: [tournament("t")],
        lambda: [game("g", [line()])],
    ],
    ids=["player", "venue", "tournament", "game"],
)
def test_a_creation_replays_with_the_same_identifier(me_api, db, build):
    operations = build()
    first = send(me_api, *operations)[0]
    again = send(me_api, *operations)[0]
    assert again["outcome"] == "replayed"
    assert again["resource"] == first["resource"]
    assert again["client_ref"] == first["client_ref"]
    assert db.scalar(select(func.count()).select_from(SyncOperation)) == 1


def test_a_rejected_verdict_replays_as_the_same_refusal(me_api):
    refused = op("player.delete", player={"player_id": 999999})
    first = send(me_api, refused)[0]
    again = send(me_api, refused)[0]
    rejected(first, "not_found")
    assert again["outcome"] == "replayed"
    assert again["error"] == first["error"]


def test_a_mismatched_replay_is_refused_and_not_journalled(me_api, db):
    original = player("p", "Marc")
    send(me_api, original)
    changed = {**original, "data": {"name": "Marcel"}}
    result = send(me_api, changed)[0]
    rejected(result, "mismatched_replay")
    assert db.scalar(select(func.count()).select_from(SyncOperation)) == 1
    assert me_api.get("/joueurs").json()[1]["name"] == "Marc"


# --------------------------------------------------------------------------
# Refus : invalid, conflict, not_found, sans interrompre le lot
# --------------------------------------------------------------------------


def test_invalid_conflict_and_not_found_never_interrupt_the_batch(me_api):
    results = send(
        me_api,
        tournament("bad", event_tier="grand_prix"),  # invalid : multi interdit
        player("p1", "Marc"),
        op("player.delete", player={"client_ref": "ghost"}),  # non résolue
        op("player.delete", player={"player_id": 999999}),  # not_found
        op("venue.update", venue={"venue_id": 999999}, data={"city": "Lyon"}),
        op("tournament.delete", tournament={"tournament_id": 999999}),
        op("game.update", game={"game_id": 999999}, data={"notes": "x"}),
        op("game.delete", game={"game_id": 999999}),
        game("g1", [line(), line(None, "p1")]),
        op("player.delete", player={"client_ref": "p1"}),  # conflict : à une table
        venue("v1"),
    )
    rejected(results[0], "invalid")
    applied(results[1])
    rejected(results[2], "unresolved_client_ref")
    for result in results[3:8]:
        rejected(result, "not_found")
    applied(results[8])
    rejected(results[9], "conflict")
    assert "figure à 1 table" in results[9]["error"]["message"]
    applied(results[10])


def test_refusals_carry_the_message_of_the_online_route(me_api):
    results = send(
        me_api,
        player("p1", "Marc"),
        game("g1", [line(), line(None, "p1")]),
        op("player.delete", player={"client_ref": "p1"}),
    )
    online = me_api.delete(f"/joueurs/{results[0]['resource']['player_id']}")
    assert online.status_code == 409
    assert results[2]["error"]["message"] == online.json()["detail"]


def test_the_players_and_venues_deletion_rules(me_api, db):
    results = send(
        me_api,
        venue("v1"),
        tournament("t1", "v1"),
        op("venue.delete", venue={"client_ref": "v1"}),  # conflict : sert
        op("tournament.delete", tournament={"client_ref": "t1"}),
        op("venue.delete", venue={"client_ref": "v1"}),  # désormais libre
    )
    rejected(results[2], "conflict")
    applied(results[3])
    applied(results[4])
    assert db.scalar(select(func.count()).select_from(Venue)) == 0
    assert db.scalar(select(func.count()).select_from(Tournament)) == 0


def test_the_me_player_is_renamed_but_never_deleted(me_api):
    me_id = me_api.get("/joueurs").json()[0]["id"]
    results = send(
        me_api,
        op("player.update", player={"player_id": me_id}, data={"name": "Moi-même"}),
        op("player.delete", player={"player_id": me_id}),
    )
    applied(results[0])
    rejected(results[1], "conflict")


def test_tournament_rules_on_stored_games_are_conflicts(me_api):
    results = send(
        me_api,
        deck("d1", "A"),
        deck("d2", "B"),
        tournament("t1"),
        game("g1", [line("d1")], "t1", "preliminary", 1),
        game("g2", [line("d2")], "t1", "preliminary", 2),
        op(
            "tournament.update",
            tournament={"client_ref": "t1"},
            data={"deck_policy": "mono", "final_deck_rule": None},
        ),
        op("tournament.delete", tournament={"client_ref": "t1"}),
        game("g3", [line("d1")], "t1", "preliminary", 2),  # ronde déjà saisie
    )
    for result in results[:5]:
        applied(result)
    rejected(results[5], "conflict")  # deux decks joués : plus mono
    rejected(results[6], "conflict")  # contient des parties
    rejected(results[7], "conflict")


def test_a_game_with_a_bad_table_is_invalid_and_leaves_nothing(me_api, db):
    results = send(
        me_api,
        player("p1", "Marc"),
        game("g1", [line(), line()]),  # deux fois « Moi »
        game("g2", [line(victory_points=5.5)]),  # plus de VP que la table n'en a
        game("g3", [line()]),
    )
    applied(results[0])
    rejected(results[1], "invalid")
    rejected(results[2], "invalid")
    applied(results[3])
    assert db.scalar(select(func.count()).select_from(Game)) == 1


def test_a_refused_game_update_changes_nothing(me_api):
    created = send(me_api, game("g1", [line(victory_points=1.0)]))
    game_id = applied(created[0])["game_id"]
    results = send(
        me_api,
        op(
            "game.update",
            game={"client_ref": "g1"},
            data={"notes": "modifiée"},
            table={"participations": [line(), line()]},
        ),
    )
    rejected(results[0], "invalid")
    detail = me_api.get(f"/parties/{game_id}").json()
    assert detail["notes"] is None
    assert detail["me"]["victory_points"] == 1.0


def test_game_update_fields_alone_and_game_delete(me_api):
    created = send(me_api, game("g1", [line(victory_points=1.0)]))
    game_id = applied(created[0])["game_id"]
    results = send(
        me_api,
        op("game.update", game={"client_ref": "g1"}, data={"notes": "Belle partie"}),
        op("game.update", game={"game_id": game_id}, data={}),
    )
    assert applied(results[0])["game_id"] == game_id
    applied(results[1])
    detail = me_api.get(f"/parties/{game_id}").json()
    assert detail["notes"] == "Belle partie"
    assert detail["me"]["victory_points"] == 1.0  # la table n'a pas bougé
    applied(send(me_api, op("game.delete", game={"client_ref": "g1"}))[0])
    assert me_api.get(f"/parties/{game_id}").status_code == 404


# --------------------------------------------------------------------------
# Compléments de couverture (relecture QA de B3)
# --------------------------------------------------------------------------


def journal(db, ref=None, type_=None):
    db.expire_all()
    stmt = select(SyncOperation)
    if ref is not None:
        stmt = stmt.where(SyncOperation.client_ref == ref)
    return list(db.scalars(stmt))


_ID_COLUMNS = ("deck_id", "player_id", "venue_id", "tournament_id", "game_id")


def filled_columns(entry) -> set[str]:
    return {c for c in _ID_COLUMNS if getattr(entry, c) is not None}


def test_a_game_creation_journals_its_own_id_only(me_api, db):
    send(
        me_api,
        venue("v1"),
        tournament("t1", "v1"),
        game("g1", [line()], "t1", "preliminary", 1, venue={"client_ref": "v1"}),
    )
    (entry,) = journal(db, "g1")
    assert filled_columns(entry) == {"game_id"}


def test_updates_and_deletes_journal_the_column_of_their_kind_only(me_api, db):
    send(
        me_api,
        venue("v1"),
        tournament("t1", "v1"),
        player("p1", "Marc"),
        game("g1", [line(), line(None, "p1")], "t1", "preliminary", 1),
    )
    operations = [
        op("player.update", player={"client_ref": "p1"}, data={"name": "Marcel"}),
        op("venue.update", venue={"client_ref": "v1"}, data={"city": "Lyon"}),
        op("tournament.update", tournament={"client_ref": "t1"}, data={"notes": "x"}),
        op("game.update", game={"client_ref": "g1"}, data={"notes": "x"}),
    ]
    results = send(me_api, *operations)
    expected = ["player_id", "venue_id", "tournament_id", "game_id"]
    for operation, column, result in zip(operations, expected, results, strict=True):
        applied(result)
        (entry,) = [
            e for e in journal(db) if e.operation_id == operation["operation_id"]
        ]
        assert filled_columns(entry) == {column}, operation["type"]
    deletions = [
        op("game.delete", game={"client_ref": "g1"}),
        op("tournament.delete", tournament={"client_ref": "t1"}),
        op("player.delete", player={"client_ref": "p1"}),
        op("venue.delete", venue={"client_ref": "v1"}),
    ]
    results = send(me_api, *deletions)
    for deletion, column, result in zip(
        deletions, ["game_id", "tournament_id", "player_id", "venue_id"], results,
        strict=True,
    ):
        applied(result)
        key = deletion["operation_id"]
        (entry,) = [e for e in journal(db) if e.operation_id == key]
        assert filled_columns(entry) == {column}, deletion["type"]


def test_a_line_cannot_use_a_venue_ref_as_deck_nor_a_deck_ref_as_player(me_api):
    results = send(
        me_api,
        venue("v1"),
        deck("d1"),
        game("g1", [line("v1")]),
        game("g2", [line(None, "d1")]),
    )
    applied(results[0])
    applied(results[1])
    rejected(results[2], "unresolved_client_ref")
    rejected(results[3], "unresolved_client_ref")


def test_a_game_cannot_use_a_game_ref_as_its_tournament(me_api):
    results = send(
        me_api,
        game("g1", [line()]),
        game("g2", [line()], "g1", "preliminary", 1),
    )
    applied(results[0])
    rejected(results[1], "unresolved_client_ref")


@pytest.mark.parametrize("first_kind", ["player", "tournament", "venue", "deck"])
def test_a_second_creation_under_a_taken_ref_writes_nothing(me_api, db, first_kind):
    firsts = {
        "player": lambda: player("r", "Marc"),
        "tournament": lambda: tournament("r"),
        "venue": lambda: venue("r"),
        "deck": lambda: deck("r"),
    }
    seconds = [
        player("r", "Julie"),
        venue("r", "Autre lieu"),
        tournament("r", name="Autre tournoi"),
        game("r", [line()]),
        deck("r", "Autre deck"),
    ]
    applied(send(me_api, firsts[first_kind]())[0])

    def counts():
        from app.models import Deck, Participation

        return [
            db.scalar(select(func.count()).select_from(model))
            for model in (Player, Venue, Deck, Tournament, Game, Participation)
        ]

    before = counts()
    for second in seconds:
        result = send(me_api, second)[0]
        rejected(result, "conflict")
        assert "désigne déjà" in result["error"]["message"]
    db.expire_all()
    assert counts() == before


def test_a_refused_player_does_not_reserve_its_ref(me_api):
    first = send(me_api, player("r", "SYNC7"))  # le nom du « Moi »
    rejected(first[0], "conflict")
    applied(send(me_api, player("r", "Marc"))[0])


def test_a_refused_game_does_not_reserve_its_ref(me_api):
    rejected(send(me_api, game("r", [line(), line()]))[0], "invalid")
    applied(send(me_api, game("r", [line()]))[0])
    # La référence désigne désormais la partie valide.
    applied(send(me_api, op("game.delete", game={"client_ref": "r"}))[0])


def test_unresolved_message_agrees_with_the_gender_of_the_kind(me_api):
    results = send(
        me_api,
        op("game.delete", game={"client_ref": "x"}),
        op("tournament.delete", tournament={"client_ref": "x"}),
        op("venue.update", venue={"client_ref": "x"}, data={"city": "Lyon"}),
        op("player.delete", player={"client_ref": "x"}),
    )
    messages = [r["error"]["message"] for r in results]
    assert messages[0].startswith("Aucune partie n'a été créée sous")
    assert messages[1].startswith("Aucun tournoi n'a été créé sous")
    assert messages[2].startswith("Aucun lieu n'a été créé sous")
    assert messages[3].startswith("Aucun joueur n'a été créé sous")


def test_a_partial_replay_replays_the_settled_and_applies_the_rest(me_api):
    first_two = [venue("v1"), player("p1", "Marc")]
    first = send(me_api, *first_two)
    third = tournament("t1", "v1")
    results = send(me_api, *first_two, third)
    assert [r["outcome"] for r in results] == ["replayed", "replayed", "applied"]
    assert results[0]["resource"] == first[0]["resource"]
    assert results[1]["resource"] == first[1]["resource"]


@pytest.mark.parametrize(
    "original, changed",
    [
        (venue("x", "Bar"), lambda o: {**o, "data": {"name": "Autre"}}),
        (tournament("x"), lambda o: {**o, "data": {**o["data"], "name": "Autre"}}),
        (
            game("x", [line()]),
            lambda o: {**o, "data": {**o["data"], "player_count": 4}},
        ),
    ],
    ids=["venue", "tournament", "game"],
)
def test_a_mismatched_replay_is_refused_for_every_creation(
    me_api, db, original, changed
):
    send(me_api, original)
    result = send(me_api, changed(original))[0]
    rejected(result, "mismatched_replay")
    assert len(journal(db)) == 1


def test_a_player_upsert_replays_after_a_rename_and_after_a_deletion(me_api):
    create = player("p", "Marc")
    created = applied(send(me_api, create)[0])
    send(
        me_api,
        op("player.update", player={"client_ref": "p"}, data={"name": "Marcel"}),
    )
    again = send(me_api, create)[0]
    assert again["outcome"] == "replayed"
    assert again["resource"] == {**created} or again["resource"] == created
    applied(send(me_api, op("player.delete", player={"client_ref": "p"}))[0])
    last = send(me_api, create)[0]
    assert last["outcome"] == "replayed"
    assert last["resource"] == created
    assert [p["name"] for p in me_api.get("/joueurs").json()] == ["sync7"]


def test_player_create_upserts_against_a_player_made_online(me_api):
    online = me_api.post("/joueurs", json={"name": "Marc"})
    assert online.status_code == 201, online.text
    result = send(me_api, player("p", "marc"))[0]
    assert applied(result)["player_id"] == online.json()["id"]
    assert len(me_api.get("/joueurs").json()) == 2


def test_a_full_batch_mixing_the_four_kinds_applies_then_replays(me_api):
    operations = []
    for i in range(40):
        operations += [
            venue(f"v{i}", f"Lieu {i}"),
            player(f"p{i}", f"Joueur {i}"),
            tournament(f"t{i}", f"v{i}", name=f"Tournoi {i}"),
            game(f"g{i}", [line(), line(None, f"p{i}")], f"t{i}", "preliminary", 1),
            op("player.update", player={"client_ref": f"p{i}"}, data={"name": f"J{i}"}),
        ]
    assert len(operations) == 200
    first = send(me_api, *operations)
    assert [r["outcome"] for r in first] == ["applied"] * 200
    second = send(me_api, *operations)
    assert [r["outcome"] for r in second] == ["replayed"] * 200
    assert [r["resource"] for r in second] == [r["resource"] for r in first]


def test_an_invalid_game_leaves_no_game_participation_nor_player(me_api, db):
    from app.models import Participation

    players_before = db.scalar(select(func.count()).select_from(Player))
    result = send(me_api, game("g", [{"player": ME}, {"player": ME}]))[0]
    rejected(result, "invalid")
    db.expire_all()
    assert db.scalar(select(func.count()).select_from(Player)) == players_before
    assert db.scalar(select(func.count()).select_from(Game)) == 0
    assert db.scalar(select(func.count()).select_from(Participation)) == 0


def test_game_update_without_data_nor_table_is_applied(me_api):
    created = send(me_api, game("g", [line(victory_points=1.0)]))
    game_id = applied(created[0])["game_id"]
    result = send(me_api, op("game.update", game={"client_ref": "g"}))[0]
    assert applied(result)["game_id"] == game_id
    assert me_api.get(f"/parties/{game_id}").json()["me"]["victory_points"] == 1.0


@pytest.mark.parametrize(
    "bad",
    [
        game("bad", [line()], played_at="9999-12-31T23:59:59-12:00"),
        game("bad", [line()], played_at="0001-01-01T00:00:00+14:00"),
        game("bad", []),
        op(
            "game.update",
            game={"game_id": 1},
            table={"participations": []},
        ),
        op("game.update", game={"game_id": 1}, data={"played_at": None}),
    ],
    ids=["too-late", "too-early", "empty-table", "empty-update-table", "null-date"],
)
def test_some_operations_are_a_422_that_cancels_the_whole_batch(me_api, db, bad):
    response = me_api.post(
        "/sync", json={"operations": [player("p", "Marc"), bad]}
    )
    assert response.status_code == 422, response.text
    db.expire_all()
    assert journal(db) == []
    assert db.scalar(select(func.count()).select_from(Player)) == 1  # le « Moi »


# --------------------------------------------------------------------------
# Isolation entre comptes
# --------------------------------------------------------------------------


def test_references_and_keys_never_cross_accounts(two_accounts, db):
    a, b = two_accounts
    shared_key = str(uuid4())
    first = send(
        a,
        {**player("pa", "Marc"), "operation_id": shared_key},
        venue("va"),
        tournament("ta"),
    )
    ids = [applied(r) for r in first]

    # Les références d'A ne désignent rien pour B.
    results = send(
        b,
        op("player.update", player={"client_ref": "pa"}, data={"name": "Pirate"}),
        op("venue.delete", venue={"client_ref": "va"}),
        op("tournament.update", tournament={"client_ref": "ta"}, data={"notes": "x"}),
        game("gb", [line("deck-de-a")]),
    )
    for result in results[:3]:
        rejected(result, "unresolved_client_ref")
    rejected(results[3], "unresolved_client_ref")

    # Les identifiants d'A rendent 404 pour B, comme un identifiant inconnu.
    results = send(
        b,
        op("player.delete", player={"player_id": ids[0]["player_id"]}),
        op("venue.delete", venue={"venue_id": ids[1]["venue_id"]}),
        op("tournament.delete", tournament={"tournament_id": ids[2]["tournament_id"]}),
        op("game.delete", game={"game_id": 1}),
    )
    for result in results:
        rejected(result, "not_found")
    assert any(
        r["error"]["message"] == f"Joueur {ids[0]['player_id']} introuvable."
        for r in results
    )

    # Une clé d'A est neuve pour B, une référence d'A est libre pour B.
    mine = send(b, {**player("pa", "Marc"), "operation_id": shared_key})[0]
    assert mine["outcome"] == "applied"
    assert mine["resource"]["player_id"] != ids[0]["player_id"]
    # Et rien n'a changé chez A.
    assert [p["name"] for p in a.get("/joueurs").json()][1] == "Marc"
    assert len(a.get("/lieux").json()) == 1
    assert len(a.get("/tournois").json()) == 1


def test_another_accounts_real_game_is_not_found_like_an_unknown_one(two_accounts):
    a, b = two_accounts
    real = applied(send(a, game("ga", [line()]))[0])["game_id"]
    unknown = 999999
    results = send(
        b,
        op("game.delete", game={"game_id": real}),
        op("game.update", game={"game_id": real}, data={"notes": "pirate"}),
        op("game.delete", game={"game_id": unknown}),
        op("game.update", game={"game_id": unknown}, data={"notes": "pirate"}),
    )
    for result in results:
        rejected(result, "not_found")
    normalized = [
        r["error"]["message"].replace(str(unknown), "N").replace(str(real), "N")
        for r in results
    ]
    assert normalized[0] == normalized[2] and normalized[1] == normalized[3]
    assert a.get(f"/parties/{real}").json()["notes"] is None


def test_another_accounts_venue_and_tournament_are_not_found_in_a_game(two_accounts):
    a, b = two_accounts
    venue_id = applied(send(a, venue("va"))[0])["venue_id"]
    tournament_id = applied(send(a, tournament("ta"))[0])["tournament_id"]
    unknown = 999999

    def attempt(**refs):
        return send(
            b,
            op(
                "game.create",
                client_ref=str(uuid4()),
                data={
                    "played_at": PLAYED,
                    "player_count": 5,
                    "participations": [{"player": ME}],
                    **refs,
                },
            ),
        )[0]

    cases = [
        (attempt(venue={"venue_id": venue_id}), attempt(venue={"venue_id": unknown})),
        (
            attempt(tournament={"tournament_id": tournament_id}),
            attempt(tournament={"tournament_id": unknown}),
        ),
    ]
    for foreign, missing in cases:
        rejected(foreign, "not_found")
        rejected(missing, "not_found")
        assert foreign["error"]["message"].replace(
            str(venue_id), "N"
        ).replace(str(tournament_id), "N") == missing["error"]["message"].replace(
            str(unknown), "N"
        )
    assert b.get("/parties").json() == []


@pytest.mark.parametrize(
    "build",
    [
        lambda: venue("v"),
        lambda: tournament("t"),
        lambda: game("g", [line()]),
        lambda: deck("d"),
    ],
    ids=["venue", "tournament", "game", "deck"],
)
def test_another_accounts_operation_id_is_new_for_every_type(two_accounts, build):
    a, b = two_accounts
    original = build()
    first = send(a, original)[0]
    mine = send(b, original)[0]
    assert first["outcome"] == "applied"
    assert mine["outcome"] == "applied"  # ni replayed ni mismatched_replay
    assert mine["resource"] != first["resource"]


def test_a_game_cannot_use_another_accounts_player_or_deck_by_id(two_accounts):
    a, b = two_accounts
    foreign_player = applied(send(a, player("pa", "Marc"))[0])["player_id"]
    foreign_deck = applied(send(a, deck("da"))[0])["deck_id"]
    results = send(
        b,
        op(
            "game.create",
            client_ref="g",
            data={
                "played_at": PLAYED,
                "player_count": 5,
                "participations": [
                    {"player": ME},
                    {"player": {"player_id": foreign_player}},
                ],
            },
        ),
        op(
            "game.create",
            client_ref="g2",
            data={
                "played_at": PLAYED,
                "player_count": 5,
                "participations": [{"player": ME, "deck": {"deck_id": foreign_deck}}],
            },
        ),
    )
    rejected(results[0], "not_found")
    rejected(results[1], "not_found")


# --------------------------------------------------------------------------
# Identifiants jamais réattribués (R11, architecte-contrat)
# --------------------------------------------------------------------------
#
# Régression du défaut corrigé par la révision R11 : sans `AUTOINCREMENT`,
# SQLite redonnait à la ligne suivante l'identifiant de la dernière ligne
# supprimée, et la `client_ref` (ou l'identifiant d'un miroir périmé) d'une
# ressource supprimée désignait en silence la suivante.


def test_the_ref_of_a_deleted_player_never_reaches_the_next_one(me_api):
    marc = applied(send(me_api, player("marc", "Marc"))[0])["player_id"]
    applied(send(me_api, op("player.delete", player={"client_ref": "marc"}))[0])
    julie = applied(send(me_api, player("julie", "Julie"))[0])["player_id"]
    assert julie != marc

    by_ref, by_id = send(
        me_api,
        op("player.update", player={"client_ref": "marc"}, data={"name": "Marcel"}),
        op("player.update", player={"player_id": marc}, data={"name": "Marcel"}),
    )

    rejected(by_ref, "not_found")
    rejected(by_id, "not_found")
    names = {p["id"]: p["name"] for p in me_api.get("/joueurs").json()}
    assert names[julie] == "Julie"
    assert "Marcel" not in names.values()


def test_the_ref_of_a_deleted_game_never_reaches_the_next_one(me_api):
    first = applied(send(me_api, game("g1", [line(victory_points=1.0)]))[0])["game_id"]
    applied(send(me_api, op("game.delete", game={"client_ref": "g1"}))[0])
    second = applied(
        send(me_api, game("g2", [line(victory_points=2.0)], notes="la bonne"))[0]
    )["game_id"]
    assert second != first

    by_ref, by_id = send(
        me_api,
        op("game.update", game={"client_ref": "g1"}, data={"notes": "écrasée"}),
        op("game.update", game={"game_id": first}, data={"notes": "écrasée"}),
    )

    rejected(by_ref, "not_found")
    rejected(by_id, "not_found")
    kept = me_api.get(f"/parties/{second}").json()
    assert kept["notes"] == "la bonne"
    assert kept["me"]["victory_points"] == 2.0


def test_the_ref_of_a_deleted_venue_or_tournament_never_reaches_the_next_one(
    me_api,
):
    old_venue = applied(send(me_api, venue("v1", "Bar à Dés"))[0])["venue_id"]
    old_tournament = applied(send(me_api, tournament("t1"))[0])["tournament_id"]
    send(
        me_api,
        op("tournament.delete", tournament={"client_ref": "t1"}),
        op("venue.delete", venue={"client_ref": "v1"}),
    )
    new_venue = applied(send(me_api, venue("v2", "Club"))[0])["venue_id"]
    new_tournament = applied(send(me_api, tournament("t2", name="Coupe"))[0])[
        "tournament_id"
    ]
    assert new_venue != old_venue and new_tournament != old_tournament

    venue_update, tournament_update = send(
        me_api,
        op("venue.update", venue={"client_ref": "v1"}, data={"city": "Lyon"}),
        op("tournament.update", tournament={"client_ref": "t1"}, data={"notes": "x"}),
    )

    rejected(venue_update, "not_found")
    rejected(tournament_update, "not_found")
    assert me_api.get("/tournois").json()[0]["notes"] is None
    assert [v["city"] for v in me_api.get("/lieux").json()] == [None]
