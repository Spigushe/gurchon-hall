"""Application FastAPI du suivi VtES.

Lot 0 : squelette + endpoint de santé uniquement. Les ressources métier
(`/cartes`, `/stock`, `/decks`, `/parties`, `/tournois`, `/participations`,
`/sync`, cf. CLAUDE.md §7) arrivent au Lot 1.
"""

import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import __version__
from app.routers.health import router as health_router

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
