"""Application FastAPI du suivi VtES.

Lot 0 : squelette + `/health`. Lot 2 : catalogue (`/cartes`, `/bundles`,
`/langues`), collection (`/stock`) et decks (`/decks`). Les parties, tournois
et `/sync` (CLAUDE.md §7) arrivent aux lots suivants.
"""

import os

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app import __version__
from app.routers.catalog import router as catalog_router
from app.routers.decks import router as decks_router
from app.routers.health import router as health_router
from app.routers.stock import router as stock_router
from app.services.errors import DomainError, InvalidRequestError

# Origines autorisées par défaut : le serveur de dev Vite (front React), sur
# localhost et 127.0.0.1. Configurable via la variable d'environnement
# BACKEND_CORS_ORIGINS (liste séparée par des virgules) — à positionner
# explicitement en production avec l'origine réelle du front. Ne jamais
# utiliser "*" : on veut une liste d'origines fermée, pas un CORS permissif.
_DEFAULT_DEV_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]


def _allowed_origins() -> list[str]:
    raw = os.getenv("BACKEND_CORS_ORIGINS")
    if raw is None:
        return _DEFAULT_DEV_ORIGINS
    return [origin.strip() for origin in raw.split(",") if origin.strip()]


app = FastAPI(
    title="Suivi VtES API",
    description=(
        "API du suivi de pratique VtES (collection EN/FR, decks, parties, "
        "tournois). Pilote d'une PWA offline-first destinée à être portée sur "
        "barrins-project."
    ),
    version=__version__,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins(),
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health_router)
app.include_router(catalog_router)
app.include_router(stock_router)
app.include_router(decks_router)


@app.exception_handler(DomainError)
async def handle_domain_error(request: Request, error: DomainError) -> JSONResponse:
    """Traduit une erreur métier en réponse, dans le format déclaré au contrat."""
    if isinstance(error, InvalidRequestError):
        # Même forme que les 422 de validation Pydantic de FastAPI.
        detail = [{"type": "value_error", "loc": list(error.loc), "msg": error.message}]
    else:
        detail = error.message
    return JSONResponse(status_code=error.status_code, content={"detail": detail})
