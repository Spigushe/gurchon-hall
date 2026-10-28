"""Application FastAPI du suivi VtES.

Lot 0 : squelette + `/health`. Lot 2 : catalogue (`/cartes`, `/bundles`,
`/langues`), collection (`/stock`) et decks (`/decks`). Lot 3 : `/sync`, la
file de synchronisation hors ligne (cf. `app.routers.sync` et
`app.services.sync`). Les parties et les tournois (CLAUDE.md §7) arrivent au
Lot 4.
"""

import os

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from app import __version__
from app.routers.auth import router as auth_router
from app.routers.catalog import router as catalog_router
from app.routers.decks import router as decks_router
from app.routers.health import router as health_router
from app.routers.stock import router as stock_router
from app.routers.sync import router as sync_router
from app.services.errors import DomainError, InvalidRequestError
from app.services.rate_limit import limiter

# Origines autorisées par défaut : le serveur de dev Vite (front React) sur
# localhost et 127.0.0.1, port 5173 (`npm run dev`) ou 4173 (`npm run preview`,
# nécessaire pour tester l'installabilité PWA : le service worker ne précache
# pas en mode dev). Configurable via la variable d'environnement
# BACKEND_CORS_ORIGINS (liste séparée par des virgules) — à positionner
# explicitement en production avec l'origine réelle du front. Ne jamais
# utiliser "*" : on veut une liste d'origines fermée, pas un CORS permissif.
_DEFAULT_DEV_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:4173",
    "http://127.0.0.1:4173",
]


def _allowed_origins() -> list[str]:
    raw = os.getenv("BACKEND_CORS_ORIGINS")
    if raw is None:
        return _DEFAULT_DEV_ORIGINS
    return [origin.strip() for origin in raw.split(",") if origin.strip()]


# Méthodes d'écriture (Lot 6) : vérifiées contre l'en-tête `Origin`, en plus du
# CORS. `SameSite=Lax` (cookie de session, `app.routers.common`) ne protège pas
# d'un sous-domaine voisin, qui est du même site ; le CORS, lui, ne s'applique
# qu'aux requêtes *cross-origin* et ne voit jamais une requête same-site. Ce
# contrôle couvre le cas qui échappe aux deux.
_WRITE_METHODS = {"POST", "PATCH", "DELETE"}


app = FastAPI(
    title="Suivi VtES API",
    description=(
        "API du suivi de pratique VtES (collection EN/FR, decks, parties, "
        "tournois). Pilote d'une PWA offline-first destinée à être portée sur "
        "barrins-project."
    ),
    version=__version__,
)

# Limitation de débit (slowapi, Lot 6, P1) : `app.state.limiter` est ce que
# lisent le décorateur `@limiter.limit(...)` (routes de connexion et
# d'inscription, `app.routers.auth`) et le middleware ci-dessous, qui applique
# effectivement la limite avant d'atteindre la route.
app.state.limiter = limiter
app.add_middleware(SlowAPIMiddleware)


@app.exception_handler(RateLimitExceeded)
async def handle_rate_limit_exceeded(
    request: Request, error: RateLimitExceeded
) -> JSONResponse:
    """429, dans le format `ErrorResponse` du contrat plutôt que celui, propre à
    slowapi, de `_rate_limit_exceeded_handler`. `_inject_headers` pose
    `Retry-After` (et les en-têtes `X-RateLimit-*`) à partir de l'état déjà
    calculé par le middleware pour cette requête.

    `_inject_headers` est une API privée de slowapi (préfixée `_`), fragile à
    une montée de version : vérifié sur `slowapi` 0.1.10 (`backend/uv.lock`),
    il n'existe aucune API publique équivalente sur `Limiter` (seules
    `_inject_headers` et `_inject_asgi_headers` posent ces en-têtes). Le propre
    gestionnaire par défaut de slowapi,
    `slowapi.extension._rate_limit_exceeded_handler`, fait exactement le même
    appel pour la même raison — ce n'est donc pas un détour, mais le seul
    chemin que la bibliothèque elle-même emprunte. À revérifier si `slowapi`
    est mis à jour au-delà de la plage fixée par `pyproject.toml`."""
    response = JSONResponse(
        status_code=429,
        content={"detail": "Trop de tentatives ; réessayer plus tard."},
    )
    limiter_state = request.state.view_rate_limit
    return request.app.state.limiter._inject_headers(response, limiter_state)


@app.middleware("http")
async def enforce_allowed_origin_on_writes(request: Request, call_next):
    """403 si l'en-tête `Origin` d'une écriture ne fait partie d'aucune
    origine autorisée (Lot 6). Absent, l'en-tête n'est pas contrôlé : un
    client non navigateur (script, CLI, `/sync` rejoué par un service) n'en
    envoie pas, et rien ici ne peut le distinguer d'une requête légitime."""
    if request.method in _WRITE_METHODS:
        origin = request.headers.get("origin")
        if origin is not None and origin not in _allowed_origins():
            return JSONResponse(
                status_code=403,
                content={"detail": "Origine non autorisée pour une écriture."},
            )
    return await call_next(request)


app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    # Retry-After accompagne les 503 de POST /sync (cf. docs/lot3-sync-contrat.md)
    # et les 429 ci-dessus : sans expose_headers, un navigateur cross-origin ne
    # peut pas le lire.
    expose_headers=["Retry-After"],
)

app.include_router(health_router)
app.include_router(auth_router)
app.include_router(catalog_router)
app.include_router(stock_router)
app.include_router(decks_router)
app.include_router(sync_router)


@app.exception_handler(DomainError)
async def handle_domain_error(request: Request, error: DomainError) -> JSONResponse:
    """Traduit une erreur métier en réponse, dans le format déclaré au contrat."""
    if isinstance(error, InvalidRequestError):
        # Même forme que les 422 de validation Pydantic de FastAPI.
        detail = [{"type": "value_error", "loc": list(error.loc), "msg": error.message}]
    else:
        detail = error.message
    return JSONResponse(status_code=error.status_code, content={"detail": detail})
