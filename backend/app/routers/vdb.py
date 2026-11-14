"""Lecture d'un deck VDB par son identifiant : `GET /vdb/decks/{vdb_deck_id}`.

Lot 9 (`docs/lot9-plan-import-vdb.md`, P3, A7). La route relaie l'API de VDB
(`https://vdb.im/api/deck/<id>`, non documentée) et rend la liste du deck par
identifiant VEKN : elle ne stocke rien, ne crée aucun deck et n'apparie aucun
nom. Le navigateur apparie, puis écrit le deck par la file `/sync`.

Sous session comme toute route métier (401 d'abord). Hôte et chemin sont fixés
dans le code et l'identifiant suit un motif fermé (`VDB_DECK_ID_PATTERN`) :
la route ne peut joindre aucune autre adresse. Un identifiant hors motif rend
422 sans qu'aucun appel ne parte.

**Étape A1 : contrat seulement.** La route est déclarée avec ses réponses,
pour que le contrat et le client TypeScript existent dès maintenant ; la
lecture chez VDB (`services/vdb_client.py`, délai, limite de débit, bornes de
la réponse) arrive à l'étape B1. D'ici là, le corps rend 501.
"""

from typing import Annotated

from fastapi import APIRouter, HTTPException, Path

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

router = APIRouter(prefix="/vdb", tags=["vdb"], responses=UNAUTHENTICATED)

VdbDeckIdPath = Annotated[
    str,
    Path(
        pattern=VDB_DECK_ID_PATTERN,
        max_length=VDB_DECK_ID_MAX_LENGTH,
        description=VDB_DECK_ID_DESCRIPTION,
    ),
]

# Garde provisoire, à retirer à l'étape B1 avec la lecture réelle.
PENDING_B1 = "Lecture d'un deck VDB pas encore livrée (Lot 9, étape B1)."


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
def read_vdb_deck(vdb_deck_id: VdbDeckIdPath, user: CurrentUser) -> VdbDeckRead:
    raise HTTPException(status_code=501, detail=PENDING_B1)
