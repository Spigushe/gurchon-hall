"""Catalogue en lecture seule, produits et langues.

Chemins en français, comme au §7 du CLAUDE.md ; noms de schémas et d'opérations
en anglais technique.
"""

from fastapi import APIRouter, Query

from app.models import CardCategory
from app.routers.common import CONFLICT, NOT_FOUND, DbSession
from app.schemas.catalog import BundleContentRead, CardRead, CardSummary
from app.schemas.collection import BundleDeposit, CardCopyRead
from app.schemas.reference import BundleRead, LanguageCreate, LanguageRead
from app.services import catalog, stock

router = APIRouter(tags=["catalogue"])


@router.get(
    "/cartes",
    response_model=list[CardSummary],
    operation_id="listCards",
    summary="Recherche dans le catalogue",
    description=(
        "Cartes du catalogue VEKN, triées par nom. `q` cherche dans le nom "
        "anglais (sous-chaîne, sans tenir compte de la casse)."
    ),
)
def list_cards(
    db: DbSession,
    q: str | None = Query(default=None, min_length=1, max_length=80),
    category: CardCategory | None = None,
    clan_id: int | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
):
    return catalog.list_cards(
        db, q=q, category=category, clan_id=clan_id, limit=limit, offset=offset
    )


@router.get(
    "/cartes/{card_id}",
    response_model=CardRead,
    operation_id="getCard",
    summary="Fiche complète d'une carte",
    responses={**NOT_FOUND},
)
def get_card(card_id: int, db: DbSession):
    return catalog.get_card(db, card_id)


@router.get(
    "/bundles",
    response_model=list[BundleRead],
    operation_id="listBundles",
    summary="Produits (précons, boîtes)",
)
def list_bundles(
    db: DbSession,
    card_set_id: int | None = None,
    q: str | None = Query(default=None, min_length=1, max_length=60),
):
    return catalog.list_bundles(db, card_set_id=card_set_id, q=q)


@router.get(
    "/bundles/{bundle_id}",
    response_model=BundleContentRead,
    operation_id="getBundle",
    summary="Contenu d'un produit",
    responses={**NOT_FOUND},
)
def get_bundle(bundle_id: int, db: DbSession):
    return catalog.get_bundle_content(db, bundle_id)


@router.post(
    "/bundles/{bundle_id}/stock",
    response_model=list[CardCopyRead],
    operation_id="depositBundle",
    summary="Verser un produit dans la collection",
    description=(
        "Ajoute le contenu du produit au stock, dans la langue indiquée. Les "
        "quantités s'additionnent à l'existant. Non idempotent : deux appels "
        "versent deux produits."
    ),
    responses={**NOT_FOUND, **CONFLICT},
)
def deposit_bundle(bundle_id: int, payload: BundleDeposit, db: DbSession):
    return stock.deposit_bundle(db, bundle_id, payload)


@router.get(
    "/langues",
    response_model=list[LanguageRead],
    operation_id="listLanguages",
    summary="Langues d'exemplaires",
)
def list_languages(db: DbSession):
    return catalog.list_languages(db)


@router.post(
    "/langues",
    response_model=LanguageRead,
    status_code=201,
    operation_id="createLanguage",
    summary="Ajouter une langue",
    responses={**CONFLICT},
)
def create_language(payload: LanguageCreate, db: DbSession):
    return catalog.create_language(db, payload)
