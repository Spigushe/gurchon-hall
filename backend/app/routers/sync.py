"""File de synchronisation hors ligne : `POST /sync`.

Le router valide le lot (Pydantic : un lot mal formé vaut 422 avant toute
écriture) et délègue à `app.services.sync`, qui journalise chaque opération et
rend un verdict par opération. La sémantique est décrite dans `app.schemas.sync`
et `docs/lot3-sync-contrat.md`.

Un seul code hors 200 sort d'ici en plus des 422 de validation : le 503 rendu
quand le verrou d'écriture n'a pas été obtenu. Il est au contrat
(`WRITE_LOCK_BUSY`) parce qu'un client offline doit savoir le distinguer d'un
refus : rien n'a été appliqué, et le même lot se renvoie tel quel.
"""

from fastapi import APIRouter, HTTPException

from app.db.locking import WriteLockTimeout
from app.routers.common import RETRY_AFTER_SECONDS, WRITE_LOCK_BUSY, DbSession
from app.schemas.sync import SyncRequest, SyncResult
from app.services import sync

router = APIRouter(tags=["sync"])


@router.post(
    "/sync",
    response_model=SyncResult,
    responses=WRITE_LOCK_BUSY,
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
        "serveur restant seul à attribuer identifiant et discriminant. Ni 404 "
        "ni 409 ne sortent de cette route : un refus est un verdict dans le "
        "corps de la réponse 200. Le seul autre code est un 503 transitoire, "
        "quand une écriture concurrente tient la base — rien n'a alors été "
        "appliqué, et le lot se renvoie à l'identique."
    ),
)
def sync_operations(payload: SyncRequest, db: DbSession) -> SyncResult:
    # La session injectée ne sert qu'à retrouver le moteur : la transaction du
    # lot, exclusive, est ouverte par le service sur sa propre connexion.
    try:
        return sync.apply_batch(db.get_bind(), payload)
    except WriteLockTimeout as error:
        # Une écriture concurrente trop longue n'est pas un verdict sur le lot :
        # rien n'a été appliqué, le client renvoie le même lot, clés comprises.
        raise HTTPException(
            status_code=503,
            detail="Une autre écriture est en cours : renvoyer le lot tel quel.",
            headers={"Retry-After": str(RETRY_AFTER_SECONDS)},
        ) from error
