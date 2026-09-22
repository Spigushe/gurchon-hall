"""Éléments partagés par les routers : session, réponses d'erreur documentées."""

from typing import Annotated

from fastapi import Depends, Path, Query
from sqlalchemy.orm import Session

from app.db.session import get_session
from app.schemas.errors import ErrorResponse

DbSession = Annotated[Session, Depends(get_session)]

# Plus grand entier que SQLite range sans débordement côté pilote (2**31 - 1) :
# au-delà, l'identifiant ne peut désigner aucune ligne, et le laisser passer
# ferait lever un OverflowError (500) au lieu d'un refus 422 lisible.
MAX_DB_INT = 2**31 - 1

# Identifiant de ressource dans le chemin, et filtre d'identifiant en requête.
PathId = Annotated[int, Path(ge=1, le=MAX_DB_INT)]
QueryId = Annotated[int | None, Query(ge=1, le=MAX_DB_INT)]

# Déclarés dans le contrat pour que le client TS type les erreurs métier. Le 422
# n'est pas listé : FastAPI le documente déjà (HTTPValidationError), et les
# refus 422 du service ont la même forme.
NOT_FOUND = {404: {"model": ErrorResponse, "description": "Ressource introuvable."}}
CONFLICT = {
    409: {
        "model": ErrorResponse,
        "description": "Conflit avec l'état des données (doublon, stock, règle).",
    }
}

RETRY_AFTER_SECONDS = 1
"""Délai conseillé au client avant de renvoyer une requête refusée pour cause de
verrou d'écriture. Une seconde : le verrou couvre le temps d'un lot, pas plus."""

# Seule `POST /sync` prend le verrou d'écriture (`app.db.locking`), mais la
# réponse vit ici avec les autres. Ce n'est pas un verdict métier : c'est une
# indisponibilité passagère, rien n'a été appliqué, et le client rejoue à
# l'identique — ses clés d'idempotence le rendent sûr.
WRITE_LOCK_BUSY = {
    503: {
        "model": ErrorResponse,
        "description": (
            "Une autre écriture tient la base : rien n'a été appliqué. Erreur "
            "transitoire, jamais un refus — la requête se renvoie telle quelle, "
            "après le délai de l'en-tête `Retry-After`."
        ),
        "headers": {
            "Retry-After": {
                "description": (
                    "Délai conseillé avant de renvoyer la requête, en secondes."
                ),
                "required": True,
                "schema": {"type": "integer", "minimum": 0},
            }
        },
    }
}
