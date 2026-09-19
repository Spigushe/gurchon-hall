"""Éléments partagés par les routers : session, réponses d'erreur documentées."""

from typing import Annotated

from fastapi import Depends
from sqlalchemy.orm import Session

from app.db.session import get_session
from app.schemas.errors import ErrorResponse

DbSession = Annotated[Session, Depends(get_session)]

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
