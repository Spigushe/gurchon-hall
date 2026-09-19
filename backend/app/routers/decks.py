"""Decks et composition : `/decks`, `/decks/{id}/cartes`."""

from fastapi import APIRouter, Response

from app.models import DeckStatus
from app.routers.common import CONFLICT, NOT_FOUND, DbSession
from app.schemas.collection import (
    DeckCardCreate,
    DeckCardRead,
    DeckCardUpdate,
    DeckCreate,
    DeckDetailRead,
    DeckLegality,
    DeckRead,
    DeckUpdate,
)
from app.services import decks

router = APIRouter(prefix="/decks", tags=["decks"])


@router.get(
    "",
    response_model=list[DeckRead],
    operation_id="listDecks",
    summary="Liste les decks",
)
def list_decks(db: DbSession, status: DeckStatus | None = None, q: str | None = None):
    return decks.list_decks(db, status=status, q=q)


@router.post(
    "",
    response_model=DeckRead,
    status_code=201,
    operation_id="createDeck",
    summary="Crée un deck",
    responses={**CONFLICT},
)
def create_deck(payload: DeckCreate, db: DbSession):
    return decks.create_deck(db, payload)


@router.get(
    "/{deck_id}",
    response_model=DeckDetailRead,
    operation_id="getDeck",
    summary="Un deck et sa composition",
    responses={**NOT_FOUND},
)
def get_deck(deck_id: int, db: DbSession):
    return decks.get_deck_detail(db, deck_id)


@router.patch(
    "/{deck_id}",
    response_model=DeckRead,
    operation_id="updateDeck",
    summary="Modifie un deck",
    description=(
        "Passer un deck à `active` exige qu'il soit légal (crypt ≥ 12, "
        "library 60–90) ; sinon 409."
    ),
    responses={**NOT_FOUND, **CONFLICT},
)
def update_deck(deck_id: int, payload: DeckUpdate, db: DbSession):
    return decks.update_deck(db, deck_id, payload)


@router.delete(
    "/{deck_id}",
    status_code=204,
    operation_id="deleteDeck",
    summary="Supprime un deck et sa composition",
    responses={**NOT_FOUND},
)
def delete_deck(deck_id: int, db: DbSession):
    decks.delete_deck(db, deck_id)
    return Response(status_code=204)


@router.get(
    "/{deck_id}/legalite",
    response_model=DeckLegality,
    operation_id="getDeckLegality",
    summary="Légalité du deck",
    description="Calculée à la demande ; les seuils voyagent dans la réponse.",
    responses={**NOT_FOUND},
)
def get_deck_legality(deck_id: int, db: DbSession):
    return decks.get_legality(db, deck_id)


@router.post(
    "/{deck_id}/cartes",
    response_model=DeckCardRead,
    status_code=201,
    operation_id="addDeckCard",
    summary="Ajoute une carte au deck",
    description=(
        "La carte doit être en collection dans la langue demandée, avec assez "
        "d'exemplaires disponibles (hors proxies) ; sinon 409."
    ),
    responses={**NOT_FOUND, **CONFLICT},
)
def add_deck_card(deck_id: int, payload: DeckCardCreate, db: DbSession):
    return decks.add_card(db, deck_id, payload)


@router.patch(
    "/{deck_id}/cartes/{card_id}/{language_code}",
    response_model=DeckCardRead,
    operation_id="updateDeckCard",
    summary="Modifie une ligne du deck",
    responses={**NOT_FOUND, **CONFLICT},
)
def update_deck_card(
    deck_id: int,
    card_id: int,
    language_code: str,
    payload: DeckCardUpdate,
    db: DbSession,
):
    return decks.update_card(db, deck_id, card_id, language_code, payload)


@router.delete(
    "/{deck_id}/cartes/{card_id}/{language_code}",
    status_code=204,
    operation_id="removeDeckCard",
    summary="Retire une carte du deck",
    responses={**NOT_FOUND},
)
def remove_deck_card(deck_id: int, card_id: int, language_code: str, db: DbSession):
    decks.remove_card(db, deck_id, card_id, language_code)
    return Response(status_code=204)
