"""Joueurs : `/joueurs` (Lot 7, B1).

Sous session et scopé au compte : le joueur d'un autre compte rend 404, avec le
message d'un identifiant inconnu. Le « Moi » est créé par le serveur (A1) :
aucune route ne le crée ni ne le supprime, `is_me` n'est jamais accepté.
"""

from fastapi import APIRouter, Query, Response

from app.routers.common import (
    CONFLICT,
    FORBIDDEN_ORIGIN,
    NOT_FOUND,
    UNAUTHENTICATED,
    CurrentUser,
    DbSession,
    PathId,
)
from app.schemas.play import PlayerCreate, PlayerRead, PlayerUpdate
from app.services import players

router = APIRouter(prefix="/joueurs", tags=["joueurs"], responses=UNAUTHENTICATED)


@router.get(
    "",
    response_model=list[PlayerRead],
    operation_id="listPlayers",
    summary="Liste les joueurs",
    description=(
        "Le « Moi » en tête, puis les adversaires par nom (sans tenir compte de la "
        "casse ni des accents). `q` cherche une sous-chaîne du nom, de la même "
        "façon. `game_count` compte les tables où le joueur figure."
    ),
)
def list_players(
    db: DbSession,
    user: CurrentUser,
    q: str | None = Query(default=None, min_length=1, max_length=80),
):
    return players.list_players(db, user.id, q=q)


@router.post(
    "",
    response_model=PlayerRead,
    status_code=201,
    operation_id="createPlayer",
    summary="Crée un adversaire",
    description=(
        "409 si un joueur du compte porte déjà ce nom, casse et accents ignorés "
        "(« Marc » et « marc » sont le même joueur), ou si c'est celui du « Moi ». "
        "Le « Moi » n'est pas créable : il existe déjà."
    ),
    responses={**CONFLICT, **FORBIDDEN_ORIGIN},
)
def create_player(payload: PlayerCreate, db: DbSession, user: CurrentUser):
    return players.create_player(db, user.id, payload)


@router.get(
    "/{player_id}",
    response_model=PlayerRead,
    operation_id="getPlayer",
    summary="Lit un joueur",
    responses={**NOT_FOUND},
)
def get_player(player_id: PathId, db: DbSession, user: CurrentUser):
    return players.get_player(db, user.id, player_id)


@router.patch(
    "/{player_id}",
    response_model=PlayerRead,
    operation_id="updatePlayer",
    summary="Renomme un joueur",
    description=(
        "Le « Moi » se renomme aussi. 409 si le nouveau nom, casse et accents "
        "ignorés, est celui d'un autre joueur du compte."
    ),
    responses={**NOT_FOUND, **CONFLICT, **FORBIDDEN_ORIGIN},
)
def update_player(
    player_id: PathId, payload: PlayerUpdate, db: DbSession, user: CurrentUser
):
    return players.update_player(db, user.id, player_id, payload)


@router.delete(
    "/{player_id}",
    status_code=204,
    operation_id="deletePlayer",
    summary="Supprime un adversaire",
    description=(
        "409 pour le « Moi » (jamais supprimé) et pour un joueur qui figure encore "
        "à une table : on le retire d'abord de ces parties."
    ),
    responses={**NOT_FOUND, **CONFLICT, **FORBIDDEN_ORIGIN},
)
def delete_player(player_id: PathId, db: DbSession, user: CurrentUser):
    players.delete_player(db, user.id, player_id)
    return Response(status_code=204)
