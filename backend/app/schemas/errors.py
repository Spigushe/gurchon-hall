"""Schéma des erreurs métier (404 et 409).

Les 422 de validation gardent le format standard de FastAPI
(`HTTPValidationError`) : le service produit la même forme pour ses propres
refus, cf. `app.services.errors`.
"""

from pydantic import BaseModel, Field


class ErrorResponse(BaseModel):
    """Corps d'une réponse d'erreur métier."""

    detail: str = Field(description="Explication lisible de l'échec.")
