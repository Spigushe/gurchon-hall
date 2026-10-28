"""Limiteur de débit partagé (`slowapi`), Lot 6, décision P1.

Module isolé, comme chez barrins-project
(`apps/barrins_identity/app/core/rate_limit.py`) : `app.main` (enregistrement
sur `app.state.limiter` et le middleware) et `app.routers.auth` (décorateur
`@limiter.limit(...)` sur `POST /connexion` et `POST /inscription`) l'importent
tous les deux, sans dépendance circulaire.

La clé est l'adresse IP de la requête (`get_remote_address`) : des compteurs en
mémoire du processus, remis à zéro au redémarrage, non partagés entre
processus — limite acceptée pour un uvicorn à un seul processus (P1). Derrière
un proxy (Lot 11, hébergement sur l'infrastructure de Barrin), l'adresse
viendrait de `X-Forwarded-For` ; à reconfigurer à ce moment-là, pas avant.
"""

import os

from slowapi import Limiter
from slowapi.util import get_remote_address

# `headers_enabled=True` : sans lui, `Limiter._inject_headers` ne pose aucun
# en-tête (y compris `Retry-After`), silencieusement — le 429 du contrat (§ 7)
# promet `Retry-After`.
limiter = Limiter(key_func=get_remote_address, headers_enabled=True)

_DEFAULT_RATE_LIMIT = "5/minute"


def login_rate_limit() -> str:
    """Débit autorisé pour `POST /connexion`, lu à chaque appel (pas au
    chargement du module) : un test peut surcharger `LOGIN_RATE_LIMIT` par
    variable d'environnement sans redémarrer le processus."""
    return os.getenv("LOGIN_RATE_LIMIT", _DEFAULT_RATE_LIMIT)


def signup_rate_limit() -> str:
    """Débit autorisé pour `POST /inscription` (`SIGNUP_RATE_LIMIT`), même
    valeur par défaut que la connexion : l'inscription est ouverte (P2), donc
    tout aussi exposée à un essai en boucle."""
    return os.getenv("SIGNUP_RATE_LIMIT", _DEFAULT_RATE_LIMIT)
