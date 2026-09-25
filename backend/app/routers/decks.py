"""Decks et composition : `/decks`, `/decks/{id}/cartes`, légalité."""

from fastapi import APIRouter, Response

from app.models import DeckStatus
from app.routers.common import CONFLICT, NOT_FOUND, DbSession, PathId
from app.schemas.collection import (
    DeckCardCreate,
    DeckCardRead,
    DeckCardUpdate,
    DeckCreate,
    DeckDetailRead,
    DeckLegality,
    DeckListState,
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
    description=(
        "`state` choisit les decks listés : `active` (défaut, les non archivés), "
        "`archived` ou `all` (archivés compris). Les decks supprimés n'apparaissent "
        "jamais, quel que soit `state` ; `status` (draft, active) et `q` (sous-chaîne "
        "du nom, sans tenir compte de la casse ni des accents) filtrent en plus. "
        "Tri par nom puis discriminant."
    ),
)
def list_decks(
    db: DbSession,
    status: DeckStatus | None = None,
    q: str | None = None,
    state: DeckListState = DeckListState.ACTIVE,
):
    return decks.list_decks(db, status=status, q=q, state=state)


@router.post(
    "",
    response_model=DeckRead,
    status_code=201,
    operation_id="createDeck",
    summary="Crée un deck",
    description=(
        "Le serveur tire un discriminant de quatre chiffres (« Malkavien "
        "2022#8561 ») : deux decks peuvent porter le même nom, il n'y a jamais de "
        "409 pour un nom déjà pris. Un deck neuf est vide : le créer directement "
        "`active` est refusé (409) ; le créer en `draft`, le composer, puis "
        "l'activer. 409 aussi si aucun discriminant libre ne peut être attribué "
        "au nom (espace saturé, ou écritures concurrentes répétées)."
    ),
    responses={**CONFLICT},
)
def create_deck(payload: DeckCreate, db: DbSession):
    return decks.create_deck(db, payload)


@router.get(
    "/{deck_id}",
    response_model=DeckDetailRead,
    operation_id="getDeck",
    summary="Un deck et sa composition",
    description=(
        "Renvoie aussi les decks supprimés, en lecture seule : `deleted_at` est "
        "alors renseigné et `cards` vient de la decklist figée à la suppression "
        "(même forme et même tri qu'un deck vivant : crypt d'abord, puis nom, "
        "puis langue). Un identifiant inconnu est un 404."
    ),
    responses={**NOT_FOUND},
)
def get_deck(deck_id: PathId, db: DbSession):
    return decks.get_deck_detail(db, deck_id)


@router.patch(
    "/{deck_id}",
    response_model=DeckRead,
    operation_id="updateDeck",
    summary="Modifie un deck",
    description=(
        "`archived: true` archive le deck (`archived_at` posé s'il ne l'est pas : "
        "rejouer la requête garde la date d'origine) ; `archived: false` le sort "
        "de l'archive. Un deck archivé n'est modifiable que pour être désarchivé : "
        "tout autre champ est refusé (409) sauf si la requête contient "
        "`archived: false` (le désarchivage précède alors les autres "
        "modifications) ; `{\"archived\": true}` seul reste un 200 sans effet. "
        "Passer un deck à `active` exige qu'il soit légal (cf. "
        "`/decks/{id}/legalite`) ; sinon 409. Renommer conserve le discriminant, "
        "sauf si le couple (nom, discriminant) est déjà pris : un autre est alors "
        "tiré. Un deck supprimé n'est plus modifiable (409)."
    ),
    responses={**NOT_FOUND, **CONFLICT},
)
def update_deck(deck_id: PathId, payload: DeckUpdate, db: DbSession):
    return decks.update_deck(db, deck_id, payload)


@router.delete(
    "/{deck_id}",
    status_code=204,
    operation_id="deleteDeck",
    summary="Supprime un deck archivé (suppression logique)",
    description=(
        "Réservé aux decks archivés (409 sinon, et 409 si le deck est déjà "
        "supprimé). Suppression logique : la decklist est figée (recopiée dans "
        "la decklist du deck supprimé) et les lignes vivantes disparaissent, ce "
        "qui rend les exemplaires et les proxies au stock ; le deck et ses "
        "participations restent en base. Le deck n'apparaît plus dans aucune "
        "liste mais reste lisible par `GET /decks/{id}`."
    ),
    responses={**NOT_FOUND, **CONFLICT},
)
def delete_deck(deck_id: PathId, db: DbSession):
    decks.delete_deck(db, deck_id)
    return Response(status_code=204)


@router.get(
    "/{deck_id}/legalite",
    response_model=DeckLegality,
    operation_id="getDeckLegality",
    summary="Légalité du deck",
    description=(
        "Calculée à la demande, à la date du jour (UTC, rappelée dans "
        "`evaluated_on`) : tailles de crypt et de library, groupes adjacents, "
        "cartes bannies, cartes pas encore légales. Les seuils voyagent dans la "
        "réponse. Portée par la composition vivante : 409 pour un deck supprimé."
    ),
    responses={**NOT_FOUND, **CONFLICT},
)
def get_deck_legality(deck_id: PathId, db: DbSession):
    return decks.get_legality(db, deck_id)


@router.post(
    "/{deck_id}/cartes",
    response_model=DeckCardRead,
    status_code=201,
    operation_id="addDeckCard",
    summary="Ajoute une carte au deck",
    description=(
        "La carte doit être en collection dans la langue et l'extension "
        "demandées, avec assez d'exemplaires disponibles (hors proxies) ; sinon "
        "409. Aussi 409 si le deck est archivé ou supprimé. 404 si la carte "
        "n'a pas été imprimée dans cette extension."
    ),
    responses={**NOT_FOUND, **CONFLICT},
)
def add_deck_card(deck_id: PathId, payload: DeckCardCreate, db: DbSession):
    return decks.add_card(db, deck_id, payload)


@router.patch(
    "/{deck_id}/cartes/{card_id}/{language_code}/{card_set_id}",
    response_model=DeckCardRead,
    operation_id="updateDeckCard",
    summary="Modifie une ligne du deck",
    description=(
        "Refusé (409) si le deck est archivé ou supprimé, si le proxy n'est pas "
        "autorisé ou si les exemplaires disponibles ne suffisent pas."
    ),
    responses={**NOT_FOUND, **CONFLICT},
)
def update_deck_card(
    deck_id: PathId,
    card_id: PathId,
    language_code: str,
    card_set_id: PathId,
    payload: DeckCardUpdate,
    db: DbSession,
):
    return decks.update_card(
        db, deck_id, card_id, language_code, card_set_id, payload
    )


@router.delete(
    "/{deck_id}/cartes/{card_id}/{language_code}/{card_set_id}",
    status_code=204,
    operation_id="removeDeckCard",
    summary="Retire une carte du deck",
    description="Un deck archivé ou supprimé n'est pas modifiable (409).",
    responses={**NOT_FOUND, **CONFLICT},
)
def remove_deck_card(
    deck_id: PathId,
    card_id: PathId,
    language_code: str,
    card_set_id: PathId,
    db: DbSession,
):
    decks.remove_card(db, deck_id, card_id, language_code, card_set_id)
    return Response(status_code=204)
