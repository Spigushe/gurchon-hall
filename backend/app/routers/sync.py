"""File de synchronisation hors ligne : `POST /sync`.

Le router valide le lot (Pydantic : un lot mal formé vaut 422 avant toute
écriture) et délègue à `app.services.sync`, qui journalise chaque opération et
rend un verdict par opération. La sémantique est décrite dans `app.schemas.sync`
et `docs/lot3-sync-contrat.md`.

Hors 200 et 422 de validation, deux codes sortent d'ici, et ils disent la même
chose au client offline : **rien n'a été appliqué**, le même lot se renvoie tel
quel. Le 503 quand le verrou d'écriture n'a pas été obtenu
(`WRITE_LOCK_BUSY`) ; le 401 quand la session manque ou a expiré (Lot 6) —
vérifiée une fois, avant de prendre le verrou, et jamais en cours de lot. Le
client renvoie alors le lot après reconnexion. Le 403 d'`Origin` étrangère,
commun à toutes les écritures, n'a rien appliqué non plus.
"""

from fastapi import APIRouter, HTTPException

from app.db.locking import WriteLockTimeout
from app.routers.common import (
    FORBIDDEN_ORIGIN,
    RETRY_AFTER_SECONDS,
    UNAUTHENTICATED,
    WRITE_LOCK_BUSY,
    CurrentUser,
    DbSession,
)
from app.schemas.sync import SyncRequest, SyncResult
from app.services import sync

router = APIRouter(tags=["sync"])


@router.post(
    "/sync",
    response_model=SyncResult,
    responses={**UNAUTHENTICATED, **FORBIDDEN_ORIGIN, **WRITE_LOCK_BUSY},
    operation_id="syncOperations",
    summary="Rejoue un lot d'écritures faites hors ligne",
    description=(
        "Rejoue la file d'attente du client : un lot ordonné d'opérations, "
        "chacune portant sa clé d'idempotence (`operation_id`). Le lot ne "
        "bascule jamais en bloc — chaque opération reçoit son verdict "
        "(`applied`, `replayed`, `rejected`) dans l'ordre de la requête, et un "
        "refus n'interrompt pas les suivantes. Rejouer une clé déjà tranchée "
        "rend le verdict mémorisé sans rien réappliquer ; c'est ce qui rend le "
        "versement d'un produit (`bundle.deposit`) sûr au rejeu, là où "
        "`POST /bundles/{bundle_id}/stock` additionne à chaque appel. Un deck "
        "créé hors ligne se désigne par la référence client de sa création, le "
        "serveur restant seul à attribuer identifiant et discriminant. Clés "
        "d'idempotence et références client sont propres au compte de la "
        "session : celles d'un autre compte n'existent pas. Ni 404 ni 409 ne "
        "sortent de cette route : un refus est un verdict dans le corps de la "
        "réponse 200. Un 401 (session absente ou expirée, vérifiée avant le "
        "lot) et un 503 transitoire (une écriture concurrente tient la base) "
        "disent la même chose : rien n'a été appliqué, et le lot se renvoie à "
        "l'identique, après reconnexion pour le premier."
    ),
)
def sync_operations(
    payload: SyncRequest, db: DbSession, user: CurrentUser
) -> SyncResult:
    # La session injectée ne sert qu'à retrouver le moteur : la transaction du
    # lot, exclusive, est ouverte par le service sur sa propre connexion. Le
    # compte est résolu (et la session vérifiée) avant la prise du verrou
    # d'écriture, jamais pendant le lot (Lot 6, §11).
    try:
        return sync.apply_batch(db.get_bind(), payload, user.id)
    except WriteLockTimeout as error:
        # Une écriture concurrente trop longue n'est pas un verdict sur le lot :
        # rien n'a été appliqué, le client renvoie le même lot, clés comprises.
        raise HTTPException(
            status_code=503,
            detail="Une autre écriture est en cours : renvoyer le lot tel quel.",
            headers={"Retry-After": str(RETRY_AFTER_SECONDS)},
        ) from error
