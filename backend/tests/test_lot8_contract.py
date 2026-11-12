"""Lot 8, étape A2 : le contrat des versions jouées et du deck adverse.

Ce que ce fichier fige, en attendant le service de B1 :

* l'archétype fermé des decks (P5), en ligne comme par `/sync` (A5 : une
  opération en file avec un archétype libre fait refuser le lot en 422) ;
* la forme des champs nouveaux d'une ligne de table (P5, P6) et du drapeau de
  regel (P3), et l'empreinte inchangée d'une opération écrite avant le lot ;
* les lectures : version jouée et deck adverse d'une ligne, version d'un deck
  dans un tournoi (A9) ;
* ce que le service de B1 enregistre : ligne sans joueur, deck adverse, regel
  (les gardes provisoires de A2 ont été retirées).
"""

from uuid import uuid4

import pytest
from pydantic import ValidationError
from sqlalchemy import select

from app.models import (
    Clan,
    DeckArchetype,
    DeckVersion,
    DeckVersionCard,
    Participation,
    TournamentDeckVersion,
)
from app.schemas.base import MAX_DB_INT
from app.schemas.collection import DeckCreate, DeckUpdate
from app.schemas.play import (
    GameUpdate,
    ParticipationCreate,
    TournamentDeckVersionRead,
)
from app.schemas.sync import GameUpdateOperation, fingerprint
from app.services import players
from tests.auth_helpers import log_in, make_account
from tests.helpers import make_card

ME = {"me": True}
PLAYED = "2026-11-01T14:00:00+01:00"
RECORDED_AT = "2026-11-01T20:00:00+01:00"
ARCHETYPES = ["bleed", "vote", "wall", "toolbox", "rush", "combo"]


@pytest.fixture
def me_api(api, db):
    account = make_account(db, email="lot8@example.com", username="lot8")
    players.get_or_create_me(db, account.id, account.username)
    db.commit()
    log_in(api, "lot8@example.com")
    return api


def _deck(api, **fields):
    response = api.post("/decks", json={"name": "Banu Princes", **fields})
    assert response.status_code == 201, response.text
    return response.json()


def _game(api, participations, **fields):
    body = {
        "played_at": PLAYED,
        "player_count": 5,
        "participations": participations,
        **fields,
    }
    return api.post("/parties", json=body)


def _op(type_: str, **fields) -> dict:
    return {
        "type": type_,
        "operation_id": str(uuid4()),
        "recorded_at": RECORDED_AT,
    } | fields


# --------------------------------------------------------------------------
# Archétype fermé (P5)
# --------------------------------------------------------------------------


def test_the_contract_lists_the_six_archetypes_in_order(api):
    schemas = api.get("/openapi.json").json()["components"]["schemas"]
    assert schemas["DeckArchetype"]["enum"] == ARCHETYPES
    assert [member.value for member in DeckArchetype] == ARCHETYPES


@pytest.mark.parametrize("schema", [DeckCreate, DeckUpdate])
@pytest.mark.parametrize("value", [*ARCHETYPES, None])
def test_a_deck_accepts_each_archetype_or_none(schema, value):
    payload = {"archetype": value} | ({"name": "D"} if schema is DeckCreate else {})
    assert schema.model_validate(payload).archetype == value


@pytest.mark.parametrize("schema", [DeckCreate, DeckUpdate])
@pytest.mark.parametrize("value", ["Vote", " vote", "stealth bleed", "", "aggro"])
def test_a_deck_refuses_any_other_archetype(schema, value):
    """Pas de repli de casse ni de rognage côté contrat : le client envoie le
    code. Seule R13 a replié les anciennes valeurs, une fois."""
    payload = {"archetype": value} | ({"name": "D"} if schema is DeckCreate else {})
    with pytest.raises(ValidationError):
        schema.model_validate(payload)


def test_a_free_text_archetype_is_refused_online(me_api):
    created = me_api.post("/decks", json={"name": "D", "archetype": "Vote"})
    assert created.status_code == 422
    deck = _deck(me_api, archetype="wall")
    assert deck["archetype"] == "wall"
    patched = me_api.patch(f"/decks/{deck['id']}", json={"archetype": "Bleed"})
    assert patched.status_code == 422


def test_a_queued_free_text_archetype_fails_the_whole_batch(me_api):
    """A5 : une opération écrite avant le lot avec un archétype libre fait
    refuser le lot en 422, sans verdict ; la bissection du client l'isole."""
    response = me_api.post(
        "/sync",
        json={
            "operations": [
                _op("deck.create", client_ref="ref-a", data={"name": "A"}),
                _op(
                    "deck.create",
                    client_ref="ref-b",
                    data={"name": "B", "archetype": "Stealth bleed"},
                ),
            ]
        },
    )
    assert response.status_code == 422
    assert me_api.get("/decks").json() == []


# --------------------------------------------------------------------------
# Ligne de table : forme des champs nouveaux (P5, P6)
# --------------------------------------------------------------------------


def test_a_table_line_has_no_required_field_any_more():
    """Une ligne peut ne désigner aucun joueur (P6) ; « un siège ou un deck »
    se contrôle au service, pour que `/sync` rende un verdict et non un 422."""
    line = ParticipationCreate.model_validate({})
    assert line.player is None
    assert line.opponent_deck_name is None
    assert line.opponent_deck_archetype is None
    assert line.opponent_clan_id is None


@pytest.mark.parametrize(
    ("field", "value", "valid"),
    [
        ("opponent_deck_name", "x" * 120, True),
        ("opponent_deck_name", "x" * 121, False),
        ("opponent_deck_archetype", "bleed", True),
        ("opponent_deck_archetype", "Bleed", False),
        ("opponent_clan_id", 1, True),
        ("opponent_clan_id", 0, False),
        ("opponent_clan_id", MAX_DB_INT, True),
        ("opponent_clan_id", MAX_DB_INT + 1, False),
    ],
)
def test_opponent_fields_are_bounded(field, value, valid):
    if valid:
        line = ParticipationCreate.model_validate({field: value})
        assert getattr(line, field) == value
    else:
        with pytest.raises(ValidationError):
            ParticipationCreate.model_validate({field: value})


def test_a_client_never_writes_a_deck_version():
    """La version est figée par le serveur (P3) : le champ n'existe pas en
    écriture, et `extra="forbid"` le refuse."""
    with pytest.raises(ValidationError):
        ParticipationCreate.model_validate({"player": ME, "deck_version_id": 1})


# --------------------------------------------------------------------------
# Regel (P3) et file d'avant le lot (A5)
# --------------------------------------------------------------------------


def test_refreeze_is_off_unless_asked():
    update = GameUpdate.model_validate({"notes": "x"})
    assert update.refreeze_decklists is False
    assert "refreeze_decklists" not in update.model_fields_set


def test_an_operation_written_before_the_lot_keeps_its_fingerprint():
    """L'empreinte suit `exclude_unset` : le champ nouveau, absent de
    l'opération en file, n'y entre pas, et le rejeu reste un rejeu."""
    body = {
        "type": "game.update",
        "operation_id": "6f1d2a4e-0e9e-4a1a-9a0f-2f7b3c4d5e6f",
        "recorded_at": RECORDED_AT,
        "game": {"game_id": 1},
        "data": {"notes": "table finale"},
    }
    operation = GameUpdateOperation.model_validate(body)
    assert "refreeze_decklists" not in operation.model_dump(exclude_unset=True)["data"]
    with_flag = GameUpdateOperation.model_validate(
        body | {"data": {"notes": "table finale", "refreeze_decklists": True}}
    )
    assert fingerprint(operation) != fingerprint(with_flag)


# --------------------------------------------------------------------------
# Lectures
# --------------------------------------------------------------------------


def _my_line(db, game_id: int) -> Participation:
    return next(
        p
        for p in db.scalars(
            select(Participation).where(Participation.game_id == game_id)
        )
        if p.is_me
    )


def test_a_table_line_reads_its_version_and_the_opponent_deck(me_api, db):
    """Version et deck adverse posés en base (le service les écrira à B1) :
    la lecture les rend, en détail comme en résumé, et une ligne sans joueur
    se lit avec `player_id` nul."""
    deck = _deck(me_api)
    mine_line = {"player": ME, "deck": {"deck_id": deck["id"]}, "seat": 1}
    created = _game(me_api, [mine_line])
    assert created.status_code == 201, created.text
    game = created.json()

    card = make_card(db)
    clan = Clan(name="Banu Haqim")
    db.add(clan)
    mine = _my_line(db, game["id"])
    version = DeckVersion(user_id=mine.user_id, deck_id=deck["id"], number=3)
    version.cards.append(DeckVersionCard(card_id=card.id, quantity=12))
    db.add(version)
    db.flush()
    mine.deck_version_id = version.id
    db.add(
        Participation(
            user_id=mine.user_id,
            game_id=game["id"],
            seat=2,
            opponent_deck_name="Banu bleed",
            opponent_deck_archetype=DeckArchetype.BLEED,
            opponent_clan_id=clan.id,
        )
    )
    db.commit()

    detail = me_api.get(f"/parties/{game['id']}").json()
    assert detail["me"]["deck_version_id"] == version.id
    assert detail["me"]["deck_version_number"] == 3
    me_line, unnamed = detail["participations"]
    assert me_line["deck_version_number"] == 3
    assert unnamed["player_id"] is None
    assert unnamed["is_me"] is False
    assert unnamed["deck_version_id"] is None
    assert unnamed["opponent_deck_name"] == "Banu bleed"
    assert unnamed["opponent_deck_archetype"] == "bleed"
    assert unnamed["opponent_clan_id"] == clan.id
    listed = me_api.get("/parties").json()
    assert listed[0]["me"]["deck_version_number"] == 3


def test_a_tournament_deck_version_reads_its_number_and_the_freezing_game(
    me_api, db
):
    deck = _deck(me_api)
    tournament = me_api.post(
        "/tournois", json={"name": "Open", "start_date": "2026-11-01"}
    ).json()
    game = _game(
        me_api,
        [{"player": ME, "deck": {"deck_id": deck["id"]}}],
        tournament={"tournament_id": tournament["id"]},
        round_type="preliminary",
        round_number=2,
    ).json()
    row = db.get(TournamentDeckVersion, (tournament["id"], deck["id"]))
    assert TournamentDeckVersionRead.model_validate(row).model_dump() == {
        "deck_id": deck["id"],
        "deck_version_id": row.deck_version_id,
        "deck_version_number": 1,
        "frozen_by_game_id": game["id"],
    }
    detail = me_api.get(f"/tournois/{tournament['id']}").json()
    assert detail["deck_versions"] == [
        TournamentDeckVersionRead.model_validate(row).model_dump()
    ]


# --------------------------------------------------------------------------
# Ce que B1 enregistre (les gardes provisoires de A2 sont retirées)
# --------------------------------------------------------------------------


def test_an_unnamed_line_with_a_seat_is_recorded(me_api):
    response = _game(me_api, [{"player": ME}, {"seat": 2}])
    assert response.status_code == 201, response.text
    assert [p["player_id"] is None for p in response.json()["participations"]] == [
        True,
        False,
    ]


def test_an_opponent_deck_is_recorded(me_api):
    opponent = me_api.post("/joueurs", json={"name": "Mikael"}).json()
    response = _game(
        me_api,
        [
            {"player": ME},
            {
                "player": {"player_id": opponent["id"]},
                "opponent_deck_archetype": "wall",
            },
        ],
    )
    assert response.status_code == 201, response.text
    archetypes = [
        p["opponent_deck_archetype"] for p in response.json()["participations"]
    ]
    assert sorted(a or "" for a in archetypes) == ["", "wall"]


def test_refreeze_is_accepted(me_api):
    game = _game(me_api, [{"player": ME}]).json()
    for flag in (True, False):
        response = me_api.patch(
            f"/parties/{game['id']}", json={"refreeze_decklists": flag}
        )
        assert response.status_code == 200, response.text


def test_through_sync_an_unnamed_line_without_content_is_one_refused_operation(
    me_api,
):
    """Le schéma accepte la ligne : le refus est le verdict d'une seule
    opération, et le reste du lot s'applique."""
    response = me_api.post(
        "/sync",
        json={
            "operations": [
                _op(
                    "game.create",
                    client_ref="ref-partie",
                    data={
                        "played_at": PLAYED,
                        "player_count": 4,
                        "participations": [{"player": ME}, {"notes": "seul"}],
                    },
                ),
                _op("deck.create", client_ref="ref-deck", data={"name": "Suite"}),
            ]
        },
    )
    assert response.status_code == 200, response.text
    first, second = response.json()["results"]
    assert (first["outcome"], first["error"]["code"]) == ("rejected", "invalid")
    assert second["outcome"] == "applied"
