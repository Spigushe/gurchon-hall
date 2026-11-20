"""Liens publics vers une decklist (Lot 13, `docs/lot13-plan-partage.md`, A1).

Cinq opérations :

* `GET /decks/{id}/partages`, `POST /decks/{id}/partages` — les liens d'un
  deck, sous session ; 404 pour le deck d'un autre compte, comme toute route
  de deck ;
* `GET /moi/partages`, `DELETE /moi/partages` — tous les liens du compte, et
  les trois purges, seul moyen de révoquer (P5). Sous `/moi` et non sous le
  deck : un deck supprimé refuse toute écriture, et ses figés doivent pouvoir
  se purger ;
* `GET /listes/{token}` — **publique**, sans session ni cookie : la seule
  route du contrat qui lit une donnée privée sans session, derrière un jeton
  de huit caractères (P3, A4).

**Étape A1** : les cinq routes sont au contrat, avec leurs schémas et leurs
réponses. Leur corps rend **501** tant que les étapes B1 (service des liens,
routes sous session, purges) et B2 (route publique : limite de débit, cache,
404 uniforme) ne sont pas livrées, après le contrôle de session, la
validation du corps, du chemin et de la requête, et le contrôle croisé de
`scope` et `share_id`. Ces gardes sont à retirer avec leurs tests
(`test_lot13_contract.py`).
"""

from typing import Annotated

from fastapi import APIRouter, HTTPException, Path, Query, Response
from pydantic import Field

from app.models.share import SHARE_TOKEN_LENGTH
from app.routers.common import (
    CONFLICT,
    FORBIDDEN_ORIGIN,
    NOT_FOUND,
    TOO_MANY_REQUESTS,
    UNAUTHENTICATED,
    CurrentUser,
    DbSession,
    PathId,
)
from app.schemas.base import MAX_DB_INT
from app.schemas.share import (
    PURGE_MAX_SHARES,
    SHARE_TOKEN_DESCRIPTION,
    SHARE_TOKEN_PATTERN,
    DeckShareCreate,
    DeckShareRead,
    SharedDecklistRead,
    SharePurgeResult,
    SharePurgeScope,
)
from app.services.errors import InvalidRequestError

router = APIRouter(tags=["partages"])

ShareTokenPath = Annotated[
    str,
    Path(
        pattern=SHARE_TOKEN_PATTERN,
        min_length=SHARE_TOKEN_LENGTH,
        max_length=SHARE_TOKEN_LENGTH,
        description=SHARE_TOKEN_DESCRIPTION,
    ),
]

ShareIds = Annotated[
    list[Annotated[int, Field(ge=1, le=MAX_DB_INT)]] | None,
    Query(
        min_length=1,
        max_length=PURGE_MAX_SHARES,
        description=(
            "Liens à purger, répété (`share_id=3&share_id=7`), de 1 à 200, avec "
            "`scope=selected` seulement : 422 s'il manque, ou s'il accompagne "
            "une autre portée."
        ),
    ),
]

_PUBLIC_LIST_HEADERS = {
    "Cache-Control": {
        "description": (
            "`public, max-age=60` : une purge prend effet en une minute au plus "
            "(A4). Jamais `private` : la réponse ne dépend d'aucune session."
        ),
        "schema": {"type": "string"},
    },
    "X-Robots-Tag": {
        "description": "`noindex` : une liste partagée ne s'indexe pas.",
        "schema": {"type": "string"},
    },
}


def _not_yet_delivered(step: str) -> HTTPException:
    """Garde provisoire de l'étape A1 : la route est au contrat, son corps
    vient à l'étape `step`. À retirer à B1 et B2."""
    return HTTPException(
        status_code=501,
        detail=f"Route pas encore livrée (Lot 13, étape {step}).",
    )


def check_purge_selection(
    scope: SharePurgeScope, share_ids: list[int] | None
) -> list[int]:
    """Contrôle croisé de `scope` et `share_id` (A1), en 422 au format de
    FastAPI : une sélection exige ses liens, les deux autres portées les
    refusent. Rend la sélection sans doublon, dans l'ordre reçu."""
    if scope is SharePurgeScope.SELECTED:
        if not share_ids:
            raise InvalidRequestError(
                "share_id est obligatoire avec scope=selected (1 à 200 liens).",
                loc=("query", "share_id"),
            )
        return list(dict.fromkeys(share_ids))
    if share_ids:
        raise InvalidRequestError(
            f"share_id ne vaut qu'avec scope=selected, pas avec scope={scope.value}.",
            loc=("query", "share_id"),
        )
    return []


@router.get(
    "/decks/{deck_id}/partages",
    response_model=list[DeckShareRead],
    operation_id="listDeckShares",
    summary="Liens publics d'un deck",
    description=(
        "Les liens du deck, du plus récent au plus ancien, chacun avec son "
        "jeton. Lisible pour un deck supprimé, qui ne garde que ses liens "
        "figés (les vivants sont révoqués avec lui, P5). En ligne seulement, "
        "hors du miroir."
    ),
    responses={**UNAUTHENTICATED, **NOT_FOUND},
)
def list_deck_shares(deck_id: PathId, db: DbSession, user: CurrentUser):
    raise _not_yet_delivered("B1")


@router.post(
    "/decks/{deck_id}/partages",
    response_model=DeckShareRead,
    status_code=201,
    operation_id="createDeckShare",
    summary="Crée un lien public vers la liste d'un deck",
    description=(
        "Tire un jeton de huit caractères et crée un lien `live` (suit le deck) "
        "ou `frozen` (copie la liste courante, ou la version jouée "
        "`deck_version_number`, avec le nom, l'archétype et, si "
        "`show_notes`, les notes du moment). Un deck archivé se partage ; un "
        "deck supprimé, non (409). 404 pour un deck inconnu ou d'un autre "
        "compte, et pour un numéro de version que le deck n'a pas ; 422 pour "
        "`deck_version_number` sur un lien vivant. En ligne seulement, hors "
        "`/sync` : le serveur fige la liste qu'il connaît (P4)."
    ),
    responses={**UNAUTHENTICATED, **FORBIDDEN_ORIGIN, **NOT_FOUND, **CONFLICT},
)
def create_deck_share(
    deck_id: PathId, payload: DeckShareCreate, db: DbSession, user: CurrentUser
):
    raise _not_yet_delivered("B1")


@router.get(
    "/moi/partages",
    response_model=list[DeckShareRead],
    operation_id="listMyShares",
    summary="Tous les liens publics du compte",
    description=(
        "Tous les liens du compte, decks supprimés compris, du plus récent au "
        "plus ancien, chacun avec l'état de son deck (`deck.archived_at`, "
        "`deck.deleted_at`) : l'écran Compte les groupe par deck et range à "
        "part ceux des decks supprimés (P5)."
    ),
    responses={**UNAUTHENTICATED},
)
def list_my_shares(db: DbSession, user: CurrentUser):
    raise _not_yet_delivered("B1")


@router.delete(
    "/moi/partages",
    response_model=SharePurgeResult,
    operation_id="purgeShares",
    summary="Purge des liens publics",
    description=(
        "Seul moyen de révoquer un lien (P5) ; un lien purgé rend 404 à sa "
        "lecture publique, dans la minute (cache). `scope=selected` : les liens "
        "`share_id`, tous refusés si l'un est inconnu ou d'un autre compte "
        "(404 « Lien N introuvable. ») ou vise un deck supprimé (409), rien "
        "n'étant alors purgé. `scope=deleted_decks` : les liens figés des decks "
        "supprimés. `scope=all` : tous les liens du compte. Ces deux dernières "
        "sont idempotentes (`revoked` à 0 au second appel). Rend le nombre de "
        "liens purgés."
    ),
    responses={**UNAUTHENTICATED, **FORBIDDEN_ORIGIN, **NOT_FOUND, **CONFLICT},
)
def purge_shares(
    db: DbSession,
    user: CurrentUser,
    scope: Annotated[
        SharePurgeScope,
        Query(
            description=(
                "`selected` (les liens `share_id`), `deleted_decks` (les liens "
                "des decks supprimés) ou `all` (tous)."
            )
        ),
    ],
    share_id: ShareIds = None,
):
    check_purge_selection(scope, share_id)
    raise _not_yet_delivered("B1")


@router.get(
    "/listes/{token}",
    response_model=SharedDecklistRead,
    operation_id="readSharedDecklist",
    summary="Lit une liste partagée (publique)",
    description=(
        "**Publique** : ni session ni cookie, et un cookie envoyé n'y change "
        "rien. Nom du deck sans discriminant, archétype, nom d'utilisateur du "
        "propriétaire, notes si le lien les montre, et cartes entières avec "
        "leurs quantités ; jamais de langue, d'extension, de proxy ni rien de "
        "la collection. 422 pour un jeton hors motif, avant toute lecture ; "
        "429 au-delà de la limite de débit par adresse IP ; 404 « Liste "
        "introuvable. », le même pour un jeton inconnu, purgé ou dont le deck "
        "a été supprimé (lien vivant)."
    ),
    responses={
        200: {"description": "La liste partagée.", "headers": _PUBLIC_LIST_HEADERS},
        **NOT_FOUND,
        **TOO_MANY_REQUESTS,
    },
)
def read_shared_decklist(token: ShareTokenPath, db: DbSession, response: Response):
    raise _not_yet_delivered("B2")
