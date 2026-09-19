"""Collection possédée : `/stock`, une entrée par carte et par langue."""

from fastapi import APIRouter, Query, Response

from app.models import CardCategory
from app.routers.common import CONFLICT, NOT_FOUND, DbSession
from app.schemas.collection import CardCopyCreate, CardCopyRead, CardCopyUpdate
from app.services import stock

router = APIRouter(prefix="/stock", tags=["stock"])


@router.get(
    "",
    response_model=list[CardCopyRead],
    operation_id="listStock",
    summary="Liste la collection",
)
def list_stock(
    db: DbSession,
    language_code: str | None = None,
    category: CardCategory | None = None,
    q: str | None = Query(default=None, min_length=1, max_length=80),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
):
    return stock.list_stock(
        db,
        language_code=language_code,
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
    summary="Déclare une carte dans une langue",
    responses={**NOT_FOUND, **CONFLICT},
)
def create_stock_entry(payload: CardCopyCreate, db: DbSession):
    return stock.create_copy(db, payload)


@router.get(
    "/{card_id}/{language_code}",
    response_model=CardCopyRead,
    operation_id="getStockEntry",
    summary="Lit une entrée de collection",
    responses={**NOT_FOUND},
)
def get_stock_entry(card_id: int, language_code: str, db: DbSession):
    return stock.get_copy(db, card_id, language_code)


@router.patch(
    "/{card_id}/{language_code}",
    response_model=CardCopyRead,
    operation_id="updateStockEntry",
    summary="Modifie une entrée de collection",
    responses={**NOT_FOUND, **CONFLICT},
)
def update_stock_entry(
    card_id: int, language_code: str, payload: CardCopyUpdate, db: DbSession
):
    return stock.update_copy(db, card_id, language_code, payload)


@router.delete(
    "/{card_id}/{language_code}",
    status_code=204,
    operation_id="deleteStockEntry",
    summary="Retire une entrée de collection",
    description="Refusé (409) tant que des decks utilisent l'entrée.",
    responses={**NOT_FOUND, **CONFLICT},
)
def delete_stock_entry(card_id: int, language_code: str, db: DbSession):
    stock.delete_copy(db, card_id, language_code)
    return Response(status_code=204)
