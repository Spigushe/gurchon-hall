"""Désignations et opérations `/sync` du Lot 7 : validation d'entrée seulement.

Les douze opérations sont écrites à l'étape A2 et n'entrent dans
`AnySyncOperation` qu'avec leur exécution (étape B3) : ces tests vérifient leur
forme, pas leur effet.
"""

from typing import get_args
from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.models.enums import SyncOperationType
from app.schemas import sync
from app.schemas.base import MAX_DB_INT
from app.schemas.refs import (
    DeckRef,
    GameRef,
    ParticipantRef,
    PlayerRef,
    TournamentRef,
    VenueRef,
)

IDENTIFIED_REFS = [
    (DeckRef, "deck_id"),
    (PlayerRef, "player_id"),
    (VenueRef, "venue_id"),
    (TournamentRef, "tournament_id"),
    (GameRef, "game_id"),
]


def test_deck_ref_is_still_importable_from_the_sync_schemas():
    """Né dans `app.schemas.sync` au Lot 3, il s'y importe toujours."""
    assert sync.DeckRef is DeckRef


@pytest.mark.parametrize(("ref", "field"), IDENTIFIED_REFS)
def test_a_ref_designates_by_identifier_or_by_client_ref(ref, field):
    assert getattr(ref.model_validate({field: 3}), field) == 3
    assert ref.model_validate({"client_ref": " abc "}).client_ref == "abc"


@pytest.mark.parametrize(("ref", "field"), IDENTIFIED_REFS)
@pytest.mark.parametrize("payload", ["both", "neither"])
def test_a_ref_needs_exactly_one_designation(ref, field, payload):
    body = {field: 3, "client_ref": "abc"} if payload == "both" else {}
    with pytest.raises(ValidationError):
        ref.model_validate(body)


@pytest.mark.parametrize(("ref", "field"), IDENTIFIED_REFS)
def test_ref_identifiers_are_bounded(ref, field):
    for value in (0, MAX_DB_INT + 1):
        with pytest.raises(ValidationError):
            ref.model_validate({field: value})


@pytest.mark.parametrize(("ref", "field"), IDENTIFIED_REFS)
def test_a_ref_rejects_a_blank_client_ref(ref, field):
    with pytest.raises(ValidationError):
        ref.model_validate({"client_ref": "   "})


@pytest.mark.parametrize(
    "payload",
    [{"me": True}, {"player_id": 2}, {"client_ref": "p-1"}],
)
def test_a_participant_is_me_or_a_designated_player(payload):
    ParticipantRef.model_validate(payload)


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"me": False},
        {"me": True, "player_id": 2},
        {"player_id": 2, "client_ref": "p-1"},
    ],
)
def test_a_participant_needs_exactly_one_designation(payload):
    """`me: false` ne désigne personne : on omet `me` pour un adversaire."""
    with pytest.raises(ValidationError):
        ParticipantRef.model_validate(payload)


@pytest.mark.parametrize(
    "payload",
    [
        {"player_id": 0},
        {"player_id": MAX_DB_INT + 1},
        {"client_ref": "   "},
        {"client_ref": "x" * 65},
    ],
)
def test_participant_designations_are_bounded(payload):
    with pytest.raises(ValidationError):
        ParticipantRef.model_validate(payload)


# --------------------------------------------------------------------------
# Les douze opérations
# --------------------------------------------------------------------------

ME = {"player": {"me": True}}
GAME = {
    "played_at": "2026-10-24T20:00:00+02:00",
    "player_count": 5,
    "participations": [ME],
}

BODIES = {
    "player.create": {"client_ref": "p", "data": {"name": "Marc"}},
    "player.update": {"player": {"client_ref": "p"}, "data": {"name": "Marc D."}},
    "player.delete": {"player": {"player_id": 4}},
    "venue.create": {"client_ref": "v", "data": {"name": "Bar à Dés"}},
    "venue.update": {"venue": {"venue_id": 2}, "data": {"city": "Lyon"}},
    "venue.delete": {"venue": {"client_ref": "v"}},
    "tournament.create": {
        "client_ref": "t",
        "data": {
            "name": "Open d'automne",
            "start_date": "2026-10-24",
            "venue": {"client_ref": "v"},
            "deck_policy": "multi",
            "final_deck_rule": "free_choice",
        },
    },
    "tournament.update": {
        "tournament": {"client_ref": "t"},
        "data": {"player_count": 27, "my_ranking": 3},
    },
    "tournament.delete": {"tournament": {"tournament_id": 9}},
    "game.create": {
        "client_ref": "g",
        "data": GAME
        | {
            "tournament": {"client_ref": "t"},
            "round_type": "preliminary",
            "round_number": 1,
        },
    },
    "game.update": {
        "game": {"client_ref": "g"},
        "data": {},
        "table": {"participations": [{**ME, "victory_points": 3, "game_win": True}]},
    },
    "game.delete": {"game": {"game_id": 5}},
}


def envelope(kind: str) -> dict:
    return {
        "type": kind,
        "operation_id": str(uuid4()),
        "recorded_at": "2026-10-24T20:05:00+02:00",
        **BODIES[kind],
    }


def operation_class(kind: str):
    (match,) = [
        cls
        for cls in sync.LOT7_SYNC_OPERATIONS
        if get_args(cls.model_fields["type"].annotation) == (kind,)
    ]
    return match


def test_twelve_operations_one_per_new_type():
    kinds = {
        get_args(cls.model_fields["type"].annotation)[0]
        for cls in sync.LOT7_SYNC_OPERATIONS
    }
    lot7_types = {t.value for t in SyncOperationType} - {
        "stock.upsert",
        "stock.delete",
        "deck.create",
        "deck.update",
        "deck.delete",
        "deck_card.upsert",
        "deck_card.delete",
        "bundle.deposit",
    }
    assert kinds == lot7_types == set(BODIES)
    assert len(sync.LOT7_SYNC_OPERATIONS) == 12


@pytest.mark.parametrize("kind", sorted(BODIES))
def test_each_operation_accepts_its_payload(kind):
    operation_class(kind).model_validate(envelope(kind))


@pytest.mark.parametrize("kind", sorted(k for k in BODIES if k.endswith(".create")))
def test_a_creation_requires_its_client_ref(kind):
    body = envelope(kind)
    del body["client_ref"]
    with pytest.raises(ValidationError) as excinfo:
        operation_class(kind).model_validate(body)
    assert {e["loc"] for e in excinfo.value.errors()} == {("client_ref",)}


def test_the_new_operations_are_not_accepted_by_sync_yet():
    """Étape B3 : `/sync` n'accepte un type qu'avec son exécution."""
    with pytest.raises(ValidationError):
        sync.SyncRequest.model_validate({"operations": [envelope("player.create")]})


def test_a_game_update_without_table_leaves_it_alone():
    body = envelope("game.update")
    del body["table"]
    assert operation_class("game.update").model_validate(body).table is None


def test_a_game_update_may_carry_only_its_table():
    """Corriger mes VP sans toucher au reste : `data` omis vaut « rien »."""
    body = envelope("game.update")
    del body["data"]
    operation = operation_class("game.update").model_validate(body)
    assert operation.data.model_fields_set == set()
    assert "data" not in operation.model_dump(exclude_unset=True)


def test_a_game_update_table_is_the_put_body_as_is():
    """Principe du Lot 3 : la charge utile de la route, reprise telle quelle."""
    from app.schemas.play import GameTableReplace

    operation = operation_class("game.update").model_validate(envelope("game.update"))
    assert isinstance(operation.table, GameTableReplace)


def test_a_game_update_table_is_never_empty():
    body = envelope("game.update") | {"table": {"participations": []}}
    with pytest.raises(ValidationError):
        operation_class("game.update").model_validate(body)


@pytest.mark.parametrize(
    ("kind", "change"),
    [
        ("tournament.create", {"event_tier": "grand_prix"}),
        ("game.create", {"participations": [ME, ME]}),
    ],
)
def test_rules_do_not_fail_the_batch_at_the_schema(kind, change):
    """Une règle contredite donne le verdict `invalid` de cette opération, au
    service, et non un 422 qui ferait échouer tout le lot (décision du
    2026-10-29)."""
    body = envelope(kind)
    body["data"] = body["data"] | change
    operation_class(kind).model_validate(body)
