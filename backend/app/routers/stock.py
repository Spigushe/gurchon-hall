"""Collection possédée : `/stock`, une entrée par carte, langue et extension.

Depuis le Lot 6, toutes les routes exigent une session et ne voient que la
collection du compte : une même clé (carte, langue, extension) existe
indépendamment dans chaque compte, et le compte vient de la session, jamais du
chemin.
"""

from fastapi import APIRouter, Query, Response

from app.models import CardCategory
from app.routers.common import (
    CONFLICT,
    FORBIDDEN_ORIGIN,
    MAX_DB_INT,
    NOT_FOUND,
    UNAUTHENTICATED,
    CurrentUser,
    DbSession,
    PathId,
    QueryId,
)
from app.schemas.collection import CardCopyCreate, CardCopyRead, CardCopyUpdate
from app.services import stock

router = APIRouter(
    prefix="/stock",
    tags=["stock"],
    responses=UNAUTHENTICATED,
)


@router.get(
    "",
    response_model=list[CardCopyRead],
    operation_id="listStock",
    summary="Liste la collection",
    description=(
        "`q` cherche dans le nom anglais de la carte (sous-chaîne, sans tenir "
        "compte de la casse ni des accents)."
    ),
)
def list_stock(
    db: DbSession,
    user: CurrentUser,
    language_code: str | None = None,
    card_set_id: QueryId = None,
    category: CardCategory | None = None,
    q: str | None = Query(default=None, min_length=1, max_length=80),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0, le=MAX_DB_INT),
):
    return stock.list_stock(
        db,
        user.id,
        language_code=language_code,
        card_set_id=card_set_id,
        category=category,
        q=q,
        limit=limit,
        offset=offset,
    )


@router.post(
    "",
    response_model=CardCopyRead,
    status_code=201,
    operation_id="createStockEntry",
    summary="Déclare une carte dans une langue et une extension",
    description=(
        "404 si la carte, la langue ou l'extension est inconnue, ou si la carte "
        "n'a pas été imprimée dans cette extension. 409 si l'entrée existe déjà."
    ),
    responses={**NOT_FOUND, **CONFLICT, **FORBIDDEN_ORIGIN},
)
def create_stock_entry(payload: CardCopyCreate, db: DbSession, user: CurrentUser):
    return stock.create_copy(db, user.id, payload)


@router.get(
    "/{card_id}/{language_code}/{card_set_id}",
    response_model=CardCopyRead,
    operation_id="getStockEntry",
    summary="Lit une entrée de collection",
    responses={**NOT_FOUND},
)
def get_stock_entry(
    card_id: PathId,
    language_code: str,
    card_set_id: PathId,
    db: DbSession,
    user: CurrentUser,
):
    return stock.get_copy(db, user.id, card_id, language_code, card_set_id)


@router.patch(
    "/{card_id}/{language_code}/{card_set_id}",
    response_model=CardCopyRead,
    operation_id="updateStockEntry",
    summary="Modifie une entrée de collection",
    responses={**NOT_FOUND, **CONFLICT, **FORBIDDEN_ORIGIN},
)
def update_stock_entry(
    card_id: PathId,
    language_code: str,
    card_set_id: PathId,
    payload: CardCopyUpdate,
    db: DbSession,
    user: CurrentUser,
):
    return stock.update_copy(db, user.id, card_id, language_code, card_set_id, payload)


@router.delete(
    "/{card_id}/{language_code}/{card_set_id}",
    status_code=204,
    operation_id="deleteStockEntry",
    summary="Retire une entrée de collection",
    description=(
        "Refusé (409) tant qu'un deck vivant consomme des exemplaires réels de "
        "l'entrée. Une ligne de deck entièrement jouée en proxy n'en consomme "
        "aucun : elle ne retient pas l'entrée."
    ),
    responses={**NOT_FOUND, **CONFLICT, **FORBIDDEN_ORIGIN},
)
def delete_stock_entry(
    card_id: PathId,
    language_code: str,
    card_set_id: PathId,
    db: DbSession,
    user: CurrentUser,
):
    stock.delete_copy(db, user.id, card_id, language_code, card_set_id)
    return Response(status_code=204)
