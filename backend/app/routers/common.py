"""Éléments partagés par les routers : session, réponses d'erreur documentées."""

import os
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Annotated

from fastapi import Depends, HTTPException, Path, Query, Response, Security
from fastapi.security import APIKeyCookie
from sqlalchemy.orm import Session

from app.db.session import get_session
from app.models.account import AuthSession, UserAccount
from app.models.enums import UserRole
from app.schemas.errors import ErrorResponse
from app.services import auth as auth_service

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

# --------------------------------------------------------------------------
# Session (Lot 6, `docs/lot6-plan-comptes.md`)
# --------------------------------------------------------------------------

SESSION_COOKIE_NAME = "__Host-gurchon_session"
"""Nom du cookie de session, celui que le contrat déclare.

Le préfixe `__Host-` fait exiger au navigateur `Secure`, `Path=/` et l'absence
de `Domain` : le cookie ne peut être ni posé ni lu par un sous-domaine voisin.
Il n'est accepté que sur un cookie `Secure` ; quand `SESSION_COOKIE_SECURE`
vaut faux (repli de développement sur un navigateur qui refuserait un cookie
`Secure` en `http://localhost`), le serveur doit donc utiliser
`INSECURE_SESSION_COOKIE_NAME` à la place — écart de configuration, pas de
contrat."""

INSECURE_SESSION_COOKIE_NAME = "gurchon_session"


def _session_cookie_secure() -> bool:
    """Lit `SESSION_COOKIE_SECURE` (vrai par défaut), une fois au chargement
    du module : le nom de cookie qu'`APIKeyCookie` déclare et celui que posent
    `set_session_cookie` / `clear_session_cookie` doivent s'accorder pour tout
    le processus, pas changer requête par requête."""
    raw = os.getenv("SESSION_COOKIE_SECURE")
    if raw is None:
        return True
    return raw.strip().lower() not in {"0", "false", "no", "off", ""}


SESSION_COOKIE_SECURE = _session_cookie_secure()
ACTIVE_SESSION_COOKIE_NAME = (
    SESSION_COOKIE_NAME if SESSION_COOKIE_SECURE else INSECURE_SESSION_COOKIE_NAME
)

session_cookie = APIKeyCookie(
    name=ACTIVE_SESSION_COOKIE_NAME,
    scheme_name="sessionCookie",
    description=(
        "Session ouverte par `POST /connexion` ou `POST /inscription` : jeton "
        "opaque dans un cookie `HttpOnly`, `Secure`, `SameSite=Lax`, posé par "
        "le serveur. Le navigateur l'envoie seul (`credentials: \"include\"`) ; "
        "le JavaScript n'y a pas accès. Échéance fixe de 14 jours après la "
        "connexion."
    ),
    # Le refus est rendu par la dépendance du projet (401 `ErrorResponse`),
    # jamais par `APIKeyCookie`, dont le code a varié selon les versions.
    auto_error=False,
)

SessionToken = Annotated[str | None, Security(session_cookie)]
"""Jeton brut lu dans le cookie, sans résolution : utile à `POST /deconnexion`
(idempotente, 204 même sans session valide) et à `current_session` ci-dessous.
Toute autre route protégée doit passer par `current_user` / `current_session`,
jamais par ce type directement."""


def _unauthenticated() -> HTTPException:
    return HTTPException(status_code=401, detail="Authentification requise.")


def current_session(
    token: SessionToken, db: DbSession, response: Response
) -> AuthSession:
    """Résout le cookie de session en ligne `auth_session`, ou lève 401.

    Contrôlée avant tout le reste (§ 11, Lot 6) : FastAPI résout les
    dépendances avant le corps de la route, donc une requête sans session
    valide ne sait jamais si la ressource visée existe. `auto_error=False` sur
    `APIKeyCookie` fait que c'est ici, et nulle part ailleurs, que le code 401
    est choisi.

    Pose aussi `Cache-Control: private, no-store` sur la réponse (§ 7) : toute
    réponse authentifiée porte cet en-tête, pour qu'une donnée d'un compte ne
    reste jamais dans le cache HTTP du navigateur au profit d'un autre compte
    connecté ensuite sur le même poste. `response` est le même objet que celui
    de la route : une dépendance peut lui ajouter des en-têtes avant même que
    le corps de la route ne s'exécute.
    """
    if token is None:
        raise _unauthenticated()
    session = auth_service.resolve_session(db, token)
    if session is None:
        raise _unauthenticated()
    response.headers["Cache-Control"] = "private, no-store"
    return session


def current_user(
    session: Annotated[AuthSession, Depends(current_session)],
) -> UserAccount:
    """Compte de la session courante.

    FastAPI met en cache la résolution d'une dépendance par requête : même
    appelée depuis plusieurs dépendances (`current_user` ici,
    `require_role` plus bas), `current_session` ne s'exécute qu'une fois.
    """
    return session.user


CurrentUser = Annotated[UserAccount, Depends(current_user)]
CurrentSession = Annotated[AuthSession, Depends(current_session)]

REQUIRE_SESSION = [Depends(current_user)]
"""À passer en `dependencies=` d'une route protégée qui n'a besoin que du
contrôle d'accès (401), sans utiliser le compte courant. Une route qui a
besoin du compte lui-même (scoping, Lot 6 étape A3) injecte `CurrentUser`
directement plutôt que de dupliquer la vérification."""


def require_role(min_role: UserRole) -> Callable[[CurrentUser], UserAccount]:
    """Fabrique une dépendance qui exige un rôle d'au moins `min_role`.

    Patron de barrins-project (`apps/barrins_identity/app/dependencies/auth.py`,
    `apps/barrins_api/app/core/roles.py`) : compare des **niveaux**
    (`role.level`), jamais des noms, pour qu'un rôle intermédiaire puisse
    s'insérer plus tard sans toucher cette fonction. 403 (« Droits
    insuffisants. ») si le rôle est trop faible — ce refus porte sur la
    **route**, jamais sur une ressource d'un autre compte, qui reste un 404
    (§ 11).
    """

    def _check(user: CurrentUser) -> UserAccount:
        if user.role.level < min_role.level:
            raise HTTPException(status_code=403, detail="Droits insuffisants.")
        return user

    return _check


UNAUTHENTICATED = {
    401: {
        "model": ErrorResponse,
        "description": (
            "Authentification requise : pas de session, ou session inconnue, "
            "expirée ou révoquée. Contrôlée avant tout le reste — sans session, "
            "on n'apprend rien de l'existence d'une ressource."
        ),
    }
}

FORBIDDEN_ORIGIN = {
    403: {
        "model": ErrorResponse,
        "description": (
            "Écriture refusée : l'en-tête `Origin` ne fait pas partie des "
            "origines autorisées. Ne porte sur aucune ressource ; une donnée d'un "
            "autre compte, elle, rend toujours 404."
        ),
    }
}

FORBIDDEN_ROLE_OR_ORIGIN = {
    403: {
        "model": ErrorResponse,
        "description": (
            "Droits insuffisants (rôle `admin` requis), ou en-tête `Origin` "
            "étranger aux origines autorisées. Porte sur la route, jamais sur "
            "une ressource."
        ),
    }
}

TOO_MANY_REQUESTS = {
    429: {
        "model": ErrorResponse,
        "description": (
            "Trop de tentatives depuis cette adresse IP : réessayer après le "
            "délai de l'en-tête `Retry-After`."
        ),
        "headers": {
            "Retry-After": {
                "description": "Délai avant une nouvelle tentative, en secondes.",
                "required": True,
                "schema": {"type": "integer", "minimum": 0},
            }
        },
    }
}

SET_SESSION_COOKIE = {
    "Set-Cookie": {
        "description": (
            "Cookie de session (`__Host-gurchon_session`), `HttpOnly`, `Secure`, "
            "`SameSite=Lax`, `Path=/`, `Max-Age` égal à la durée restante de la "
            "session. Le jeton ne circule que là, jamais dans un corps."
        ),
        "schema": {"type": "string"},
    }
}

CLEAR_SESSION_COOKIE = {
    "Set-Cookie": {
        "description": "Efface le cookie de session (`Max-Age=0`).",
        "schema": {"type": "string"},
    }
}


def _naive_utcnow() -> datetime:
    """Même convention que `app.services.auth` : UTC naïf, comparable aux
    colonnes date-heure du modèle sans lever de `TypeError`."""
    return datetime.now(UTC).replace(tzinfo=None)


def set_session_cookie(response: Response, token: str, expires_at: datetime) -> None:
    """Pose le cookie de session sur `response` (`POST /inscription`,
    `POST /connexion`). `Max-Age` est la durée **restante** jusqu'à
    `expires_at`, jamais la durée totale : rejouer la pose d'un cookie sur une
    session déjà vieille de quelques jours ne doit pas lui redonner 14 jours
    pleins.
    """
    max_age = max(0, int((expires_at - _naive_utcnow()).total_seconds()))
    response.set_cookie(
        key=ACTIVE_SESSION_COOKIE_NAME,
        value=token,
        max_age=max_age,
        path="/",
        secure=SESSION_COOKIE_SECURE,
        httponly=True,
        samesite="lax",
    )


def clear_session_cookie(response: Response) -> None:
    """Efface le cookie de session (`POST /deconnexion`), mêmes attributs que
    ceux posés par `set_session_cookie` : un cookie s'efface par les mêmes
    `Path` / `Secure` / `SameSite` que ceux avec lesquels il a été créé."""
    response.delete_cookie(
        key=ACTIVE_SESSION_COOKIE_NAME,
        path="/",
        secure=SESSION_COOKIE_SECURE,
        httponly=True,
        samesite="lax",
    )


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
