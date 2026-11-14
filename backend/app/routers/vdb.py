"""Lecture d'un deck VDB par son identifiant : `GET /vdb/decks/{vdb_deck_id}`.

Lot 9 (`docs/lot9-plan-import-vdb.md`, P3, A7). La route relaie l'API de VDB
(`https://vdb.im/api/deck/<id>`, non documentée) et rend la liste du deck par
identifiant VEKN : elle ne stocke rien, ne crée aucun deck et n'apparie aucun
nom. Le navigateur apparie, puis écrit le deck par la file `/sync`.

Sous session comme toute route métier (401 d'abord). Hôte et chemin sont fixés
dans le code et l'identifiant suit un motif fermé (`VDB_DECK_ID_PATTERN`) :
la route ne peut joindre aucune autre adresse. Un identifiant hors motif rend
422 sans qu'aucun appel ne parte.

La lecture elle-même (délai, taille bornée, forme vérifiée, aucune
redirection suivie) est dans `app.services.vdb_client` ; la route traduit ses
deux erreurs, 404 pour un deck que VDB ne connaît pas, 502 pour tout le reste.
Elle est limitée en débit par adresse IP (`VDB_RATE_LIMIT`, 20 par minute par
défaut) : le contrôle de slowapi passe après la session et le motif, si bien
qu'un appel refusé en 401 ou en 422 ne compte pas. La lecture réseau est une
dépendance (`get_vdb_fetcher`) que les tests remplacent. `request` et
`response` ne servent qu'à slowapi, qui lit l'une et pose ses en-têtes
`X-RateLimit-*` sur l'autre.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path, Request, Response

from app.routers.common import (
    BAD_GATEWAY,
    NOT_FOUND,
    TOO_MANY_REQUESTS,
    UNAUTHENTICATED,
    CurrentUser,
)
from app.schemas.vdb import (
    VDB_DECK_ID_DESCRIPTION,
    VDB_DECK_ID_MAX_LENGTH,
    VDB_DECK_ID_PATTERN,
    VdbDeckRead,
)
from app.services.rate_limit import limiter, vdb_rate_limit
from app.services.vdb_client import (
    VdbDeckNotFoundError,
    VdbFetcher,
    VdbUnavailableError,
    default_fetcher,
    read_vdb_deck,
)

router = APIRouter(prefix="/vdb", tags=["vdb"], responses=UNAUTHENTICATED)

VdbDeckIdPath = Annotated[
    str,
    Path(
        pattern=VDB_DECK_ID_PATTERN,
        max_length=VDB_DECK_ID_MAX_LENGTH,
        description=VDB_DECK_ID_DESCRIPTION,
    ),
]

VDB_DECK_NOT_FOUND = "Deck VDB introuvable."


def get_vdb_fetcher() -> VdbFetcher:
    """Lecture réseau de la route : réelle, ou simulée sous `VDB_STUB_DIR`.
    Les tests la remplacent par `app.dependency_overrides`."""
    return default_fetcher()


VdbFetch = Annotated[VdbFetcher, Depends(get_vdb_fetcher)]


@router.get(
    "/decks/{vdb_deck_id}",
    response_model=VdbDeckRead,
    operation_id="readVdbDeck",
    summary="Lit un deck VDB par son identifiant",
    description=(
        "Va chercher le deck `vdb_deck_id` chez VDB (`https://vdb.im/api/deck/"
        "<id>`, adresse fixée par le serveur) et rend son nom, son auteur, sa "
        "description et ses cartes par identifiant VEKN, sans rien enregistrer "
        "ni apparier. En ligne seulement : hors connexion, une liste exportée "
        "de VDB s'importe dans le navigateur. 404 quand VDB ne connaît pas le "
        "deck ; 502 quand VDB est injoignable, dépasse le délai ou rend une "
        "réponse inattendue ; 429 au-delà de la limite de débit ; 422 pour un "
        "identifiant hors motif, sans appel sortant."
    ),
    responses={**NOT_FOUND, **TOO_MANY_REQUESTS, **BAD_GATEWAY},
)
@limiter.limit(vdb_rate_limit)
def read_vdb_deck_route(
    request: Request,
    response: Response,
    vdb_deck_id: VdbDeckIdPath,
    user: CurrentUser,
    fetch: VdbFetch,
) -> VdbDeckRead:
    try:
        return read_vdb_deck(vdb_deck_id, fetch=fetch)
    except VdbDeckNotFoundError as error:
        raise HTTPException(status_code=404, detail=VDB_DECK_NOT_FOUND) from error
    except VdbUnavailableError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error
