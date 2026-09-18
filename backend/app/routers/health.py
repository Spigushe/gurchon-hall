"""Endpoint de santé : `GET /health` (sans préfixe `/api`, cf. CLAUDE.md §7)."""

from fastapi import APIRouter

from app import __version__
from app.schemas.health import HealthResponse, HealthStatus

router = APIRouter(tags=["health"])


@router.get(
    "/health",
    response_model=HealthResponse,
    operation_id="getHealth",
    summary="Vérifie la disponibilité de l'API",
    description=(
        "Sonde de connectivité : sert de test de bout en bout du squelette "
        "(Lot 0) et, plus tard, de vérification réseau côté PWA offline-first."
    ),
)
def get_health() -> HealthResponse:
    return HealthResponse(status=HealthStatus.OK, version=__version__)
