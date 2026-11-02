"""Tournois : `/tournois` (Lot 7, B2).

Sous session et scopé au compte : le tournoi ou le lieu d'un autre compte rend
404, avec le message d'un identifiant inconnu. Une écriture désigne le lieu par
son identifiant (une `client_ref` rend 422 : seule `/sync` connaît les références
d'un objet créé hors ligne).
"""

from datetime import date

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
from app.schemas.play import (
    TournamentCreate,
    TournamentDetailRead,
    TournamentRead,
    TournamentUpdate,
)
from app.services import tournaments

router = APIRouter(prefix="/tournois", tags=["tournois"], responses=UNAUTHENTICATED)


@router.get(
    "",
    response_model=list[TournamentRead],
    operation_id="listTournaments",
    summary="Liste les tournois",
    description=(
        "Du plus récent au plus ancien (date de début), chacun avec mon bilan. "
        "`q` cherche une sous-chaîne du nom, sans tenir compte de la casse ni des "
        "accents ; `from` et `to` bornent la date de début, incluses."
    ),
)
def list_tournaments(
    db: DbSession,
    user: CurrentUser,
    q: str | None = Query(default=None, min_length=1, max_length=120),
    start_from: date | None = Query(default=None, alias="from"),
    start_to: date | None = Query(default=None, alias="to"),
):
    return tournaments.list_tournaments(
        db, user.id, q=q, start_from=start_from, start_to=start_to
    )


@router.post(
    "",
    response_model=TournamentRead,
    status_code=201,
    operation_id="createTournament",
    summary="Crée un tournoi",
    description=(
        "422 si le multi-deck est demandé à un niveau qui l'interdit (championnat "
        "national, Grand Prix, championnat continental), si une règle de deck de "
        "finale accompagne un tournoi mono-deck, si la date de fin précède celle "
        "de début, ou si le classement dépasse le nombre de joueurs. 404 si le "
        "lieu est inconnu ou d'un autre compte."
    ),
    responses={**NOT_FOUND, **CONFLICT, **FORBIDDEN_ORIGIN},
)
def create_tournament(payload: TournamentCreate, db: DbSession, user: CurrentUser):
    return tournaments.create_tournament(db, user.id, payload)


@router.get(
    "/{tournament_id}",
    response_model=TournamentDetailRead,
    operation_id="getTournament",
    summary="Lit un tournoi",
    description=(
        "Le tournoi, mon bilan et mes parties dans l'ordre des rondes, finale en "
        "dernier. `admissible_final_decks` liste les decks que ma finale peut "
        "jouer en multi-deck, selon la règle annoncée ; nul quand rien n'est "
        "contrôlable."
    ),
    responses={**NOT_FOUND},
)
def get_tournament(tournament_id: PathId, db: DbSession, user: CurrentUser):
    return tournaments.get_tournament(db, user.id, tournament_id)


@router.patch(
    "/{tournament_id}",
    response_model=TournamentRead,
    operation_id="updateTournament",
    summary="Modifie un tournoi",
    description=(
        "Modification partielle ; les champs nullables envoyés à `null` sont "
        "remis à zéro. 422 sur l'état fusionné (niveau contre politique de deck, "
        "règle de finale, dates, classement contre le nombre de joueurs et ma "
        "finale). 409 si le passage en mono-deck, le changement de règle de "
        "finale ou une baisse du nombre de rondes contredit les parties déjà "
        "saisies."
    ),
    responses={**NOT_FOUND, **CONFLICT, **FORBIDDEN_ORIGIN},
)
def update_tournament(
    tournament_id: PathId, payload: TournamentUpdate, db: DbSession, user: CurrentUser
):
    return tournaments.update_tournament(db, user.id, tournament_id, payload)


@router.delete(
    "/{tournament_id}",
    status_code=204,
    operation_id="deleteTournament",
    summary="Supprime un tournoi",
    description=(
        "409 tant que le tournoi contient des parties : on les supprime ou on "
        "les détache d'abord."
    ),
    responses={**NOT_FOUND, **CONFLICT, **FORBIDDEN_ORIGIN},
)
def delete_tournament(tournament_id: PathId, db: DbSession, user: CurrentUser):
    tournaments.delete_tournament(db, user.id, tournament_id)
    return Response(status_code=204)
