"""Lot Compte-rendu : comptes-rendus de tournoi (`docs/lot-compte-rendu-plan.md`).

Ce que ce fichier éprouve :

* la coupe d'une version par `PATCH /tournois/{id}` (champ `report`) : une
  version seulement si l'instantané change (P5, P6) ;
* le contenu de l'instantané : tournoi, bilan, tables dans l'ordre des sièges,
  adversaire nommé ou non, deck prêté ou adverse, listes jouées (P3), notes
  sur les adversaires selon l'option (P4), mes notes de table selon la
  sienne, cochée par défaut (A8 de la v1.2.2, `docs/v1.2.2-plan.md`) ;
* la permanence : une partie supprimée reste dans la version qui la montrait,
  un tournoi ne se supprime pas tant qu'il a un compte-rendu (P10) ;
* `/sync` : la demande voyage dans `tournament.update`, rejouable ;
* le lien (P8), la lecture publique et les versions antérieures (P9) ;
* l'isolation entre comptes.
"""

import json
import uuid
from hashlib import sha256
from types import SimpleNamespace

import pytest

from app.main import app
from app.models.enums import CardCategory
from app.schemas.sync import TournamentUpdateOperation, fingerprint
from app.services import players
from app.services.tournament_reports import _seat
from tests.auth_helpers import DEFAULT_PASSWORD, log_in, make_account
from tests.helpers import add_languages, make_card, make_card_set, make_printing

ME = {"me": True}
NOT_FOUND = "Compte-rendu introuvable."


@pytest.fixture
def w(api, db):
    account = make_account(db, email="cr@example.com", username="auteur")
    players.get_or_create_me(db, account.id, account.username)
    add_languages(db, "EN")
    crypt = make_card(db, "Anson", CardCategory.CRYPT)
    library = make_card(db, "Vessel", CardCategory.LIBRARY)
    card_set = make_card_set(db)
    for card in (crypt, library):
        make_printing(db, card, card_set)
    db.commit()
    log_in(api, "cr@example.com")
    return SimpleNamespace(
        api=api, db=db, user_id=account.id, crypt=crypt, library=library, set=card_set
    )


def _deck(w, name="Guns", **fields):
    body = {"name": name, "proxy_allowed": True, **fields}
    response = w.api.post("/decks", json=body)
    assert response.status_code == 201, response.text
    deck_id = response.json()["id"]
    for card, quantity in ((w.crypt, 12), (w.library, 60)):
        line = w.api.post(
            f"/decks/{deck_id}/cartes",
            json={
                "card_id": card.id,
                "language_code": "EN",
                "card_set_id": w.set.id,
                "quantity": quantity,
                "proxy_quantity": quantity,
            },
        )
        assert line.status_code == 201, line.text
    return deck_id


def _tournament(w, **fields):
    body = {"name": "Coupe de Lutèce", "start_date": "2026-11-14", **fields}
    response = w.api.post("/tournois", json=body)
    assert response.status_code == 201, response.text
    return response.json()["id"]


def _game(w, tournament, number, *, deck=None, others=(), notes=None, **mine):
    me = {"player": ME, "seat": 2, **mine}
    if deck is not None:
        me["deck"] = {"deck_id": deck}
    body = {
        "played_at": "2026-11-14T14:00:00+01:00",
        "player_count": 5,
        "tournament": {"tournament_id": tournament},
        "round_type": "preliminary" if number else "final",
        "round_number": number,
        "notes": notes,
        "participations": [me, *others],
    }
    response = w.api.post("/parties", json=body)
    assert response.status_code == 201, response.text
    return response.json()["id"]


def _update(w, tournament, **report):
    response = w.api.patch(
        f"/tournois/{tournament}", json={"report": {"action": "update", **report}}
    )
    assert response.status_code == 200, response.text
    return w.api.get(f"/tournois/{tournament}").json()["report"]


def _snapshot(w, tournament, number):
    response = w.api.get(f"/tournois/{tournament}/compte-rendu/versions/{number}")
    assert response.status_code == 200, response.text
    return response.json()["snapshot"]


def _numbers(report):
    return [v["number"] for v in report["versions"]]


# --------------------------------------------------------------------------
# Versions
# --------------------------------------------------------------------------


def test_a_tournament_has_no_report_until_one_is_asked(w):
    tournament = _tournament(w)
    assert w.api.get(f"/tournois/{tournament}").json()["report"] is None
    response = w.api.get(f"/tournois/{tournament}/compte-rendu")
    assert response.status_code == 404
    assert response.json()["detail"] == (
        f"Compte-rendu du tournoi {tournament} introuvable."
    )


def test_update_creates_the_report_and_its_first_version(w):
    tournament = _tournament(w, notes="Premier tournoi.")
    report = _update(w, tournament)
    assert _numbers(report) == [1]
    assert report["include_opponent_notes"] is False
    assert report["include_my_notes"] is True
    assert report["show_previous_versions"] is False
    assert report["token"] is None
    snapshot = _snapshot(w, tournament, 1)
    assert snapshot["format_version"] == 1
    assert snapshot["tournament"]["name"] == "Coupe de Lutèce"
    assert snapshot["tournament"]["notes"] == "Premier tournoi."
    assert snapshot["rounds"] == []


def test_update_without_any_change_cuts_no_version(w):
    tournament = _tournament(w)
    _update(w, tournament)
    assert _numbers(_update(w, tournament)) == [1]


def test_a_changed_game_note_cuts_a_new_version_and_keeps_the_old_one(w):
    tournament = _tournament(w)
    game = _game(w, tournament, 1, notes="Avant.")
    _update(w, tournament)
    w.api.patch(f"/parties/{game}", json={"notes": "Après."})
    report = _update(w, tournament)
    assert _numbers(report) == [1, 2]
    assert _snapshot(w, tournament, 1)["rounds"][0]["notes"] == "Avant."
    assert _snapshot(w, tournament, 2)["rounds"][0]["notes"] == "Après."


def test_a_changed_tournament_field_in_the_same_write_is_seen_by_the_version(w):
    tournament = _tournament(w)
    _update(w, tournament)
    response = w.api.patch(
        f"/tournois/{tournament}",
        json={"my_ranking": 3, "player_count": 22, "report": {"action": "update"}},
    )
    assert response.status_code == 200, response.text
    snapshot = _snapshot(w, tournament, 2)
    assert snapshot["tournament"]["my_ranking"] == 3
    assert snapshot["tournament"]["player_count"] == 22


def test_a_version_touches_the_tournament_so_the_mirror_reads_it_again(w):
    tournament = _tournament(w)
    before = w.api.get(f"/tournois/{tournament}").json()["updated_at"]
    _update(w, tournament)
    assert w.api.get(f"/tournois/{tournament}").json()["updated_at"] > before


# --------------------------------------------------------------------------
# Contenu de l'instantané
# --------------------------------------------------------------------------


def test_the_snapshot_shows_the_table_in_seat_order_with_my_score(w):
    deck = _deck(w, "Guns", archetype="rush")
    lent = _deck(w, "Prêté")
    marc = w.api.post("/joueurs", json={"name": "Marc"}).json()["id"]
    tournament = _tournament(w)
    _game(
        w,
        tournament,
        1,
        deck=deck,
        victory_points=3,
        game_win=True,
        notes="Belle partie.",
        others=[
            {"player": {"player_id": marc}, "seat": 1, "notes": "Joue vite."},
            {
                "seat": 4,
                "opponent_deck_archetype": "bleed",
                "opponent_deck_name": "Nos",
            },
            {"seat": 3, "deck": {"deck_id": lent}},
        ],
    )
    _update(w, tournament)
    snapshot = _snapshot(w, tournament, 1)

    seats = snapshot["rounds"][0]["seats"]
    assert [s["seat"] for s in seats] == [1, 2, 3, 4]
    marc_line, me, lent_line, unnamed = seats
    assert marc_line["player_name"] == "Marc"
    assert marc_line["is_me"] is False
    assert marc_line["notes"] is None  # notes sur les adversaires exclues (P4)
    assert me["is_me"] is True
    assert me["player_name"] is None
    assert me["deck_id"] == deck
    assert me["deck_name"] == "Guns"
    assert me["deck_archetype"] == "rush"
    assert (me["victory_points"], me["game_win"]) == (3, True)
    assert lent_line["deck_name"] == "Prêté"
    assert lent_line["deck_id"] is None
    assert unnamed["player_name"] is None
    assert unnamed["deck_name"] == "Nos"
    assert unnamed["deck_archetype"] == "bleed"
    assert unnamed["victory_points"] is None
    assert snapshot["rounds"][0]["notes"] == "Belle partie."
    assert snapshot["summary"]["preliminary_game_wins"] == 1
    assert snapshot["summary"]["preliminary_victory_points"] == 3


def test_the_snapshot_copies_the_list_played_with_its_version_number(w):
    deck = _deck(w, "Guns")
    tournament = _tournament(w)
    _game(w, tournament, 1, deck=deck)
    _game(w, tournament, 2, deck=deck)
    _update(w, tournament)
    decks = _snapshot(w, tournament, 1)["decks"]
    assert len(decks) == 1
    assert decks[0]["deck_id"] == deck
    assert decks[0]["name"] == "Guns"
    assert decks[0]["version_number"] == 1
    assert {(c["card_id"], c["quantity"]) for c in decks[0]["cards"]} == {
        (w.crypt.id, 12),
        (w.library.id, 60),
    }


def test_rounds_come_in_order_with_the_final_last(w):
    tournament = _tournament(w)
    _game(w, tournament, None)
    _game(w, tournament, 2)
    _game(w, tournament, 1)
    _update(w, tournament)
    rounds = _snapshot(w, tournament, 1)["rounds"]
    assert [(r["round_type"], r["round_number"]) for r in rounds] == [
        ("preliminary", 1),
        ("preliminary", 2),
        ("final", None),
    ]


def test_including_opponent_notes_cuts_a_version_that_shows_them(w):
    marc = w.api.post("/joueurs", json={"name": "Marc"}).json()["id"]
    tournament = _tournament(w)
    _game(w, tournament, 1, others=[{"player": {"player_id": marc}, "notes": "Vite."}])
    _update(w, tournament)
    report = _update(w, tournament, include_opponent_notes=True)
    assert report["include_opponent_notes"] is True
    assert _numbers(report) == [1, 2]
    seats = _snapshot(w, tournament, 2)["rounds"][0]["seats"]
    assert [s["notes"] for s in seats if not s["is_me"]] == ["Vite."]
    # Omis, le réglage ne change pas.
    assert _update(w, tournament)["include_opponent_notes"] is True


def test_the_venue_shows_its_name_and_city_but_never_its_notes(w):
    venue = w.api.post(
        "/lieux", json={"name": "Le Dé Pipé", "city": "Paris", "notes": "Code 1234"}
    ).json()["id"]
    tournament = _tournament(w, venue={"venue_id": venue})
    _update(w, tournament)
    venue_part = _snapshot(w, tournament, 1)["tournament"]["venue"]
    assert venue_part == {"name": "Le Dé Pipé", "city": "Paris"}


# --------------------------------------------------------------------------
# Mes notes de table (v1.2.2, A8)
# --------------------------------------------------------------------------

MY_NOTE = "Tirage sans vampire à 1."


def _line(*, is_me, notes):
    """Une ligne de table réduite à ce que lit `_seat`."""
    return SimpleNamespace(
        seat=1,
        player=SimpleNamespace(is_me=is_me, name="Marc"),
        deck=None,
        opponent_deck_name=None,
        opponent_deck_archetype=None,
        opponent_clan=None,
        victory_points=None,
        game_win=None,
        notes=notes,
    )


@pytest.mark.parametrize(
    ("include_my_notes", "include_opponent_notes", "mine", "theirs"),
    [
        (True, False, MY_NOTE, None),
        (True, True, MY_NOTE, "Joue vite."),
        (False, False, None, None),
        (False, True, None, "Joue vite."),
    ],
)
def test_each_setting_keeps_the_notes_of_its_own_side(
    include_my_notes, include_opponent_notes, mine, theirs
):
    settings = {
        "include_my_notes": include_my_notes,
        "include_opponent_notes": include_opponent_notes,
    }
    me = _seat(_line(is_me=True, notes=MY_NOTE), **settings)
    other = _seat(_line(is_me=False, notes="Joue vite."), **settings)
    assert (me.notes, other.notes) == (mine, theirs)


def _my_notes_game(w):
    """Un tournoi d'une ronde, avec une note sur ma ligne et une sur Marc."""
    marc = w.api.post("/joueurs", json={"name": "Marc"}).json()["id"]
    tournament = _tournament(w)
    body = {
        "played_at": "2026-11-14T14:00:00+01:00",
        "player_count": 4,
        "tournament": {"tournament_id": tournament},
        "round_type": "preliminary",
        "round_number": 1,
        "notes": "Table bloquée.",
        "participations": [
            {"player": ME, "seat": 1, "notes": MY_NOTE},
            {"player": {"player_id": marc}, "seat": 2, "notes": "Joue vite."},
        ],
    }
    response = w.api.post("/parties", json=body)
    assert response.status_code == 201, response.text
    return tournament


def _seat_notes(w, tournament, number):
    seats = _snapshot(w, tournament, number)["rounds"][0]["seats"]
    return [(s["is_me"], s["notes"]) for s in seats]


def test_my_table_notes_are_in_by_default(w):
    tournament = _my_notes_game(w)
    report = _update(w, tournament)
    assert report["include_my_notes"] is True
    assert _seat_notes(w, tournament, 1) == [(True, MY_NOTE), (False, None)]


def test_excluding_my_notes_cuts_a_version_without_them_and_keeps_the_old_one(w):
    tournament = _my_notes_game(w)
    _update(w, tournament)
    report = _update(w, tournament, include_my_notes=False)
    assert report["include_my_notes"] is False
    assert _numbers(report) == [1, 2]
    assert _seat_notes(w, tournament, 2) == [(True, None), (False, None)]
    # La version figée avant le changement garde ce qu'elle contenait.
    assert _seat_notes(w, tournament, 1)[0] == (True, MY_NOTE)
    # Omis, le réglage ne change pas ; l'autre case se règle à part.
    report = _update(w, tournament, include_opponent_notes=True)
    assert report["include_my_notes"] is False
    assert _seat_notes(w, tournament, 3) == [(True, None), (False, "Joue vite.")]
    read = w.api.get(f"/tournois/{tournament}/compte-rendu").json()
    assert read["include_my_notes"] is False
    # Recochée, la case rend ma note à la version suivante.
    _update(w, tournament, include_my_notes=True)
    assert _seat_notes(w, tournament, 4)[0] == (True, MY_NOTE)


def test_excluding_my_notes_at_creation_cuts_a_first_version_without_them(w):
    tournament = _my_notes_game(w)
    report = _update(w, tournament, include_my_notes=False)
    assert report["include_my_notes"] is False
    assert _numbers(report) == [1]
    assert _seat_notes(w, tournament, 1) == [(True, None), (False, None)]


def test_a_setting_change_alone_touches_the_tournament(w):
    """Sans partie, la case décochée ne change pas l'instantané : aucune
    version, mais le réglage est posé et le miroir relira le tournoi."""
    tournament = _tournament(w)
    _update(w, tournament)
    before = w.api.get(f"/tournois/{tournament}").json()["updated_at"]
    report = _update(w, tournament, include_my_notes=False)
    assert report["include_my_notes"] is False
    assert _numbers(report) == [1]
    assert w.api.get(f"/tournois/{tournament}").json()["updated_at"] > before


# --------------------------------------------------------------------------
# Permanence et suppressions
# --------------------------------------------------------------------------


def test_a_deleted_game_stays_in_the_version_that_showed_it(w):
    tournament = _tournament(w)
    game = _game(w, tournament, 1, notes="Elle restera.")
    _update(w, tournament)
    assert w.api.delete(f"/parties/{game}").status_code == 204
    assert _snapshot(w, tournament, 1)["rounds"][0]["notes"] == "Elle restera."
    assert _snapshot(w, tournament, 1)["rounds"][0]["round_number"] == 1
    assert _numbers(_update(w, tournament)) == [1, 2]
    assert _snapshot(w, tournament, 2)["rounds"] == []


def test_a_tournament_with_a_report_cannot_be_deleted(w):
    tournament = _tournament(w)
    _update(w, tournament)
    response = w.api.delete(f"/tournois/{tournament}")
    assert response.status_code == 409
    assert "compte-rendu" in response.json()["detail"]


def test_deleting_the_report_frees_the_tournament(w):
    tournament = _tournament(w)
    _update(w, tournament)
    response = w.api.patch(
        f"/tournois/{tournament}", json={"report": {"action": "delete"}}
    )
    assert response.status_code == 200, response.text
    assert w.api.get(f"/tournois/{tournament}").json()["report"] is None
    assert w.api.delete(f"/tournois/{tournament}").status_code == 204


def test_deleting_a_missing_report_does_nothing(w):
    tournament = _tournament(w)
    response = w.api.patch(
        f"/tournois/{tournament}", json={"report": {"action": "delete"}}
    )
    assert response.status_code == 200


@pytest.mark.parametrize("setting", ["include_opponent_notes", "include_my_notes"])
@pytest.mark.parametrize("value", [True, False])
def test_note_settings_go_with_update_only(w, setting, value):
    tournament = _tournament(w)
    response = w.api.patch(
        f"/tournois/{tournament}",
        json={"report": {"action": "delete", setting: value}},
    )
    assert response.status_code == 422
    assert f"{setting} ne vaut qu'avec action=update." in response.text


# --------------------------------------------------------------------------
# /sync
# --------------------------------------------------------------------------


def _sync(w, operations):
    response = w.api.post("/sync", json={"operations": operations})
    assert response.status_code == 200, response.text
    return response.json()["results"]


def _report_operation(tournament, operation_id=None, **report):
    return {
        "operation_id": operation_id or str(uuid.uuid4()),
        "recorded_at": "2026-11-14T20:00:00Z",
        "type": "tournament.update",
        "tournament": {"tournament_id": tournament},
        "data": {"report": {"action": "update", **report}},
    }


def test_the_request_travels_in_tournament_update_and_replays_safely(w):
    tournament = _tournament(w)
    operation = _report_operation(tournament, include_opponent_notes=True)
    first = _sync(w, [operation])
    assert first[0]["outcome"] == "applied", first
    again = _sync(w, [operation])
    assert again[0]["outcome"] == "replayed"
    report = w.api.get(f"/tournois/{tournament}").json()["report"]
    assert _numbers(report) == [1]
    assert report["include_opponent_notes"] is True


def test_my_notes_setting_travels_in_tournament_update_and_replays_safely(w):
    tournament = _my_notes_game(w)
    operation = _report_operation(tournament, include_my_notes=False)
    assert _sync(w, [operation])[0]["outcome"] == "applied"
    assert _sync(w, [operation])[0]["outcome"] == "replayed"
    report = w.api.get(f"/tournois/{tournament}").json()["report"]
    assert report["include_my_notes"] is False
    assert _numbers(report) == [1]
    assert _seat_notes(w, tournament, 1)[0] == (True, None)


def test_an_operation_written_before_v122_keeps_its_fingerprint():
    """Une demande en file d'avant la v1.2.2 n'a pas le champ : `exclude_unset`
    le laisse hors de l'empreinte, et le rejeu reste un rejeu."""
    body = {
        "operation_id": "6f1d2a4e-0e9e-4a1a-9a0f-2f7b3c4d5e6f",
        "recorded_at": "2026-11-14T20:00:00Z",
        "type": "tournament.update",
        "tournament": {"tournament_id": 7},
        "data": {"report": {"action": "update", "include_opponent_notes": True}},
    }
    operation = TournamentUpdateOperation.model_validate(body)
    legacy = json.dumps(body, sort_keys=True, separators=(",", ":"))
    assert fingerprint(operation) == sha256(legacy.encode("utf-8")).hexdigest()
    report = body["data"]["report"] | {"include_my_notes": True}
    with_setting = TournamentUpdateOperation.model_validate(
        body | {"data": {"report": report}}
    )
    assert fingerprint(operation) != fingerprint(with_setting)


def test_replaying_an_operation_without_the_field_leaves_the_setting_alone(w):
    tournament = _my_notes_game(w)
    legacy = _report_operation(tournament)
    assert _sync(w, [legacy])[0]["outcome"] == "applied"
    off = _report_operation(tournament, include_my_notes=False)
    assert _sync(w, [off])[0]["outcome"] == "applied"
    # Réponse perdue : la file renvoie l'ancienne opération, telle quelle.
    assert _sync(w, [legacy])[0]["outcome"] == "replayed"
    report = w.api.get(f"/tournois/{tournament}").json()["report"]
    assert report["include_my_notes"] is False
    assert _numbers(report) == [1, 2]


def test_a_game_queued_before_the_request_is_in_the_version(w):
    """L'ordre de la file fait l'ordre : la partie saisie avant « Mettre à
    jour » est dans la version (P5)."""
    tournament = _tournament(w)
    game = {
        "operation_id": str(uuid.uuid4()),
        "recorded_at": "2026-11-14T19:00:00Z",
        "type": "game.create",
        "client_ref": str(uuid.uuid4()),
        "data": {
            "played_at": "2026-11-14T14:00:00+01:00",
            "player_count": 4,
            "tournament": {"tournament_id": tournament},
            "round_type": "preliminary",
            "round_number": 1,
            "notes": "Saisie au club.",
            "participations": [{"player": ME}],
        },
    }
    results = _sync(w, [game, _report_operation(tournament)])
    assert [r["outcome"] for r in results] == ["applied", "applied"], results
    assert _snapshot(w, tournament, 1)["rounds"][0]["notes"] == "Saisie au club."


def test_deleting_a_tournament_with_a_report_is_a_conflict_by_sync(w):
    tournament = _tournament(w)
    _update(w, tournament)
    results = _sync(
        w,
        [
            {
                "operation_id": str(uuid.uuid4()),
                "recorded_at": "2026-11-14T20:00:00Z",
                "type": "tournament.delete",
                "tournament": {"tournament_id": tournament},
            }
        ],
    )
    assert results[0]["outcome"] == "rejected"
    assert results[0]["error"]["code"] == "conflict"


# --------------------------------------------------------------------------
# Lien et lecture publique
# --------------------------------------------------------------------------


@pytest.fixture
def shared(w):
    deck = _deck(w, "Guns", archetype="rush")
    tournament = _tournament(w)
    game = _game(w, tournament, 1, deck=deck, notes="v1")
    _update(w, tournament)
    w.api.patch(f"/parties/{game}", json={"notes": "v2"})
    _update(w, tournament)
    response = w.api.post(f"/tournois/{tournament}/compte-rendu/lien")
    assert response.status_code == 200, response.text
    w.tournament = tournament
    w.token = response.json()["token"]
    return w


def test_sharing_before_any_report_is_a_404(w):
    tournament = _tournament(w)
    assert w.api.post(f"/tournois/{tournament}/compte-rendu/lien").status_code == 404


def test_sharing_draws_a_token_once(shared):
    assert len(shared.token) == 8
    again = shared.api.post(f"/tournois/{shared.tournament}/compte-rendu/lien")
    assert again.json()["token"] == shared.token


def test_the_public_page_shows_the_latest_version_without_a_session(
    shared, api_client_factory
):
    visitor = api_client_factory()
    response = visitor.get(f"/comptes-rendus/{shared.token}")
    assert response.status_code == 200, response.text
    assert response.headers["Cache-Control"] == "public, max-age=60"
    assert response.headers["X-Robots-Tag"] == "noindex"
    assert "set-cookie" not in response.headers
    body = response.json()
    assert body["author"] == "auteur"
    assert (body["number"], body["latest_number"]) == (2, 2)
    assert [v["number"] for v in body["versions"]] == [2]
    assert body["snapshot"]["rounds"][0]["notes"] == "v2"
    cards = {card["id"] for card in body["cards"]}
    assert cards == {shared.crypt.id, shared.library.id}


def test_a_previous_version_is_hidden_unless_the_owner_allows_it(
    shared, api_client_factory
):
    visitor = api_client_factory()
    hidden = visitor.get(f"/comptes-rendus/{shared.token}/versions/1")
    assert hidden.status_code == 404
    assert hidden.json()["detail"] == NOT_FOUND
    latest = visitor.get(f"/comptes-rendus/{shared.token}/versions/2")
    assert latest.status_code == 200

    settings = shared.api.patch(
        f"/tournois/{shared.tournament}/compte-rendu",
        json={"show_previous_versions": True},
    )
    assert settings.json()["show_previous_versions"] is True
    shown = visitor.get(f"/comptes-rendus/{shared.token}/versions/1")
    assert shown.status_code == 200
    assert shown.json()["snapshot"]["rounds"][0]["notes"] == "v1"
    assert [v["number"] for v in shown.json()["versions"]] == [1, 2]
    assert visitor.get(f"/comptes-rendus/{shared.token}/versions/9").status_code == 404


def test_a_purged_link_answers_404_and_a_new_share_draws_a_new_token(
    shared, api_client_factory
):
    revoked = shared.api.delete(f"/tournois/{shared.tournament}/compte-rendu/lien")
    assert revoked.json()["token"] is None
    visitor = api_client_factory()
    assert visitor.get(f"/comptes-rendus/{shared.token}").status_code == 404
    again = shared.api.post(f"/tournois/{shared.tournament}/compte-rendu/lien")
    assert again.json()["token"] not in (None, shared.token)


@pytest.mark.parametrize("token", ["court", "aB3x-9pQ", "trop-long-jeton"])
def test_a_malformed_token_is_a_422(api_client_factory, token):
    assert api_client_factory().get(f"/comptes-rendus/{token}").status_code == 422


def test_an_unknown_token_is_the_same_404(api_client_factory, w):
    response = api_client_factory().get("/comptes-rendus/zzzzzzzz")
    assert response.status_code == 404
    assert response.json()["detail"] == NOT_FOUND


def test_my_reports_list_the_tournaments_with_their_link(shared):
    listed = shared.api.get("/moi/comptes-rendus").json()
    assert listed == [
        {
            "tournament_id": shared.tournament,
            "tournament_name": "Coupe de Lutèce",
            "start_date": "2026-11-14",
            "token": shared.token,
            "latest_number": 2,
        }
    ]


# --------------------------------------------------------------------------
# Isolation
# --------------------------------------------------------------------------


@pytest.fixture
def stranger_api(api_client_factory, db):
    make_account(db, email="autre@example.com", username="autre")
    db.commit()
    client = api_client_factory()
    log_in(client, "autre@example.com", DEFAULT_PASSWORD)
    return client


def test_another_account_sees_nothing_of_the_report(shared, stranger_api):
    base = f"/tournois/{shared.tournament}/compte-rendu"
    assert stranger_api.get(base).status_code == 404
    assert stranger_api.get(f"{base}/versions/1").status_code == 404
    settings = {"show_previous_versions": True}
    assert stranger_api.patch(base, json=settings).status_code == 404
    assert stranger_api.post(f"{base}/lien").status_code == 404
    assert stranger_api.delete(f"{base}/lien").status_code == 404
    assert stranger_api.get("/moi/comptes-rendus").json() == []


# --------------------------------------------------------------------------
# Export du compte (A7)
# --------------------------------------------------------------------------


def test_the_export_carries_the_reports_but_never_their_token(shared):
    response = shared.api.get("/moi/export")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["format_version"] == 3
    assert shared.token not in response.text
    (report,) = body["tournament_reports"]
    assert report["tournament_id"] == shared.tournament
    assert report["include_opponent_notes"] is False
    assert report["include_my_notes"] is True
    assert report["shared"] is True
    assert [v["number"] for v in report["versions"]] == [1, 2]
    assert report["versions"][1]["snapshot"]["rounds"][0]["notes"] == "v2"


def test_the_export_carries_an_excluded_my_notes_setting(shared):
    _update(shared, shared.tournament, include_my_notes=False)
    body = shared.api.get("/moi/export").json()
    assert body["format_version"] == 3  # champ ajouté : la forme ne change pas
    (report,) = body["tournament_reports"]
    assert report["include_my_notes"] is False


# --------------------------------------------------------------------------
# Contrat (v1.2.2, A8)
# --------------------------------------------------------------------------


def _component(name):
    return app.openapi()["components"]["schemas"][name]


@pytest.mark.parametrize("name", ["TournamentReportRead", "ExportedTournamentReport"])
def test_the_my_notes_setting_is_always_read(name):
    component = _component(name)
    assert component["properties"]["include_my_notes"]["type"] == "boolean"
    assert "include_my_notes" in component["required"]


def test_the_my_notes_setting_is_optional_and_nullable_in_the_request():
    component = _component("TournamentReportRequest")
    field = component["properties"]["include_my_notes"]
    assert {variant.get("type") for variant in field["anyOf"]} == {"boolean", "null"}
    assert component["required"] == ["action"]


def test_the_contract_keeps_seventy_operations_on_45_paths():
    paths = app.openapi()["paths"]
    methods = {"get", "post", "put", "patch", "delete"}
    count = sum(1 for item in paths.values() for method in item if method in methods)
    assert (count, len(paths)) == (70, 45)
