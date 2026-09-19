"""Schémas Pydantic pour l'endpoint `GET /health`."""

from enum import StrEnum

from pydantic import BaseModel, Field


class HealthStatus(StrEnum):
    """État de disponibilité rapporté par l'API."""

    OK = "ok"


class HealthResponse(BaseModel):
    """Réponse de `GET /health`."""

    status: HealthStatus = Field(description="État courant du service.")
    version: str = Field(description="Version de l'API (depuis pyproject.toml).")
