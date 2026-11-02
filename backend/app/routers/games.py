"""Parties : `/parties` et `/parties/{id}/participations` (Lot 7, B2).

Sous session et scopé au compte : la partie, le tournoi, le lieu, le joueur ou le
deck d'un autre compte rend 404, avec le message d'un identifiant inconnu. Une
écriture désigne par identifiant (une `client_ref` rend 422 : seule `/sync` connaît
les références d'un objet créé hors ligne), et `{"me": true}` désigne le « Moi ».
"""

from datetime import datetime

from fastapi import APIRouter, Query, Response

from app.routers.common import (
    CONFLICT,
    FORBIDDEN_ORIGIN,
    NOT_FOUND,
    UNAUTHENTICATED,
    CurrentUser,
    DbSession,
    PathId,
    QueryId,
)
from app.schemas.play import (
    GameCreate,
    GameDetailRead,
    GameRead,
    GameTableReplace,
    GameUpdate,
)
from app.services import games

router = APIRouter(prefix="/parties", tags=["parties"], responses=UNAUTHENTICATED)

_WRITE_RULES = (
    "422 : ronde ou finale incohérente avec le tournoi, table qui ne se tient pas "
    "(exactement ma ligne, joueurs et sièges distincts), VP hors table ou par "
    "quarts, Game Win contredit par mes VP, VP ou GW sur une ligne d'adversaire. "
    "409 : ronde ou finale déjà saisie, deck supprimé, ou écriture qui contredit "
    "le tournoi (mono-deck, deck de finale, classement). 404 : une ressource "
    "désignée est inconnue ou d'un autre compte."
)


@router.get(
    "",
    response_model=list[GameRead],
    operation_id="listGames",
    summary="Liste les parties",
    description=(
        "De la plus récente à la plus ancienne. `casual` vrai : parties amicales ; "
        "faux : parties de tournoi. `deck_id` ne regarde que mon deck, pas un deck "
        "prêté. `from` et `to` sont des instants avec fuseau, bornes incluses. "
        "Chaque partie porte ma ligne en résumé et le nom de son tournoi."
    ),
)
def list_games(
    db: DbSession,
    user: CurrentUser,
    tournament_id: QueryId = None,
    casual: bool | None = None,
    deck_id: QueryId = None,
    venue_id: QueryId = None,
    played_from: datetime | None = Query(default=None, alias="from"),
    played_to: datetime | None = Query(default=None, alias="to"),
):
    return games.list_games(
        db,
        user.id,
        tournament_id=tournament_id,
        casual=casual,
        deck_id=deck_id,
        venue_id=venue_id,
        played_from=played_from,
        played_to=played_to,
    )


@router.post(
    "",
    response_model=GameDetailRead,
    status_code=201,
    operation_id="createGame",
    summary="Crée une partie, table comprise",
    description=(
        "Une partie se saisit d'une traite : sa table entière comprise, avec "
        "exactement ma ligne. Laissé vide, mon Game Win est posé par le serveur "
        "quand il est certain. " + _WRITE_RULES
    ),
    responses={**NOT_FOUND, **CONFLICT, **FORBIDDEN_ORIGIN},
)
def create_game(payload: GameCreate, db: DbSession, user: CurrentUser):
    return games.create_game(db, user.id, payload)


@router.get(
    "/{game_id}",
    response_model=GameDetailRead,
    operation_id="getGame",
    summary="Lit une partie et sa table",
    description="La table est triée par siège, les lignes sans siège en dernier.",
    responses={**NOT_FOUND},
)
def get_game(game_id: PathId, db: DbSession, user: CurrentUser):
    return games.get_game(db, user.id, game_id)


@router.patch(
    "/{game_id}",
    response_model=GameDetailRead,
    operation_id="updateGame",
    summary="Modifie une partie, hors table",
    description=(
        "Modification partielle ; `venue`, `tournament`, `round_number` et `notes` "
        "envoyés à `null` sont remis à zéro. Les règles se contrôlent sur l'état "
        "fusionné : changer `player_count` revérifie la table existante. La table "
        "se corrige par `PUT /parties/{id}/participations`. " + _WRITE_RULES
    ),
    responses={**NOT_FOUND, **CONFLICT, **FORBIDDEN_ORIGIN},
)
def update_game(game_id: PathId, payload: GameUpdate, db: DbSession, user: CurrentUser):
    return games.update_game(db, user.id, game_id, payload)


@router.put(
    "/{game_id}/participations",
    response_model=GameDetailRead,
    operation_id="replaceGameParticipations",
    summary="Remplace la table d'une partie",
    description=(
        "La table se remplace d'un bloc, jamais ligne à ligne : exactement ma "
        "ligne, les adversaires facultatifs. " + _WRITE_RULES
    ),
    responses={**NOT_FOUND, **CONFLICT, **FORBIDDEN_ORIGIN},
)
def replace_game_participations(
    game_id: PathId, payload: GameTableReplace, db: DbSession, user: CurrentUser
):
    return games.replace_table(db, user.id, game_id, payload.participations)


@router.delete(
    "/{game_id}",
    status_code=204,
    operation_id="deleteGame",
    summary="Supprime une partie",
    description=(
        "Suppression physique, table comprise. 409 si retirer une préliminaire "
        "rend illégal le deck de la finale."
    ),
    responses={**NOT_FOUND, **CONFLICT, **FORBIDDEN_ORIGIN},
)
def delete_game(game_id: PathId, db: DbSession, user: CurrentUser):
    games.delete_game(db, user.id, game_id)
    return Response(status_code=204)
