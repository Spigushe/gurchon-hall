"""Lieux de jeu : `/lieux` (Lot 7, B1).

Sous session et scopé au compte : le lieu d'un autre compte rend 404, avec le
message d'un identifiant inconnu.
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
from app.schemas.reference import VenueCreate, VenueRead, VenueUpdate
from app.services import venues

router = APIRouter(prefix="/lieux", tags=["lieux"], responses=UNAUTHENTICATED)


@router.get(
    "",
    response_model=list[VenueRead],
    operation_id="listVenues",
    summary="Liste les lieux",
    description=(
        "Par nom, sans tenir compte de la casse ni des accents ; `q` cherche une "
        "sous-chaîne du nom de la même façon. `game_count` et `tournament_count` "
        "sont calculés par le serveur."
    ),
)
def list_venues(
    db: DbSession,
    user: CurrentUser,
    q: str | None = Query(default=None, min_length=1, max_length=120),
):
    return venues.list_venues(db, user.id, q=q)


@router.post(
    "",
    response_model=VenueRead,
    status_code=201,
    operation_id="createVenue",
    summary="Crée un lieu",
    description=(
        "409 si un lieu du compte porte déjà ce nom, casse et accents ignorés."
    ),
    responses={**CONFLICT, **FORBIDDEN_ORIGIN},
)
def create_venue(payload: VenueCreate, db: DbSession, user: CurrentUser):
    return venues.create_venue(db, user.id, payload)


@router.get(
    "/{venue_id}",
    response_model=VenueRead,
    operation_id="getVenue",
    summary="Lit un lieu",
    responses={**NOT_FOUND},
)
def get_venue(venue_id: PathId, db: DbSession, user: CurrentUser):
    return venues.get_venue(db, user.id, venue_id)


@router.patch(
    "/{venue_id}",
    response_model=VenueRead,
    operation_id="updateVenue",
    summary="Modifie un lieu",
    description=(
        "Modification partielle ; `city` et `notes` acceptent `null` pour effacer. "
        "409 si le nouveau nom, casse et accents ignorés, est celui d'un autre lieu."
    ),
    responses={**NOT_FOUND, **CONFLICT, **FORBIDDEN_ORIGIN},
)
def update_venue(
    venue_id: PathId, payload: VenueUpdate, db: DbSession, user: CurrentUser
):
    return venues.update_venue(db, user.id, venue_id, payload)


@router.delete(
    "/{venue_id}",
    status_code=204,
    operation_id="deleteVenue",
    summary="Supprime un lieu",
    description="409 tant qu'une partie ou un tournoi se déroule dans ce lieu.",
    responses={**NOT_FOUND, **CONFLICT, **FORBIDDEN_ORIGIN},
)
def delete_venue(venue_id: PathId, db: DbSession, user: CurrentUser):
    venues.delete_venue(db, user.id, venue_id)
    return Response(status_code=204)
