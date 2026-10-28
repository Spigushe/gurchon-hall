"""Comptes : inscription, connexion, déconnexion, compte courant (Lot 6).

**Étape A2** (`docs/lot6-plan-comptes.md`) : les quatre routes déclarées à
l'étape A1 sont ici réellement implémentées.

Ce que l'implémentation tient :

* `POST /inscription` crée un compte actif aussitôt, de rôle `user` posé par
  le serveur, et ouvre la session dans la même réponse (201 + `Set-Cookie`) ;
* `POST /connexion` rend le même 401 pour une adresse inconnue et un mauvais
  mot de passe, au même coût (`dummy_verify`, P1) ;
* `POST /deconnexion` rend 204 même sans session valide : la déconnexion est
  idempotente, et n'exige donc **pas** de session (`dependencies=REQUIRE_SESSION`
  y manque exprès — voir le corps de la route) ;
* `GET /moi` rend le compte de la session, 401 sinon.

Les adresses sont comparées sous leur forme normalisée
(`app.schemas.account.normalize_email`), déjà appliquée par les schémas.

`POST /inscription` et `POST /connexion` sont limitées en débit par adresse IP
(`app.services.rate_limit`, P1) : au-delà du seuil, slowapi lève avant que le
corps de la route ne s'exécute (429 + `Retry-After`, gérés par le handler
enregistré dans `app.main`).
"""

from fastapi import APIRouter, HTTPException, Request, Response

from app.routers.common import (
    CLEAR_SESSION_COOKIE,
    CONFLICT,
    FORBIDDEN_ORIGIN,
    SET_SESSION_COOKIE,
    TOO_MANY_REQUESTS,
    UNAUTHENTICATED,
    CurrentUser,
    DbSession,
    SessionToken,
    clear_session_cookie,
    set_session_cookie,
)
from app.schemas.account import UserLogIn, UserRead, UserSignUp
from app.schemas.errors import ErrorResponse
from app.services import auth as auth_service
from app.services.rate_limit import limiter, login_rate_limit, signup_rate_limit

router = APIRouter(tags=["comptes"])

_INVALID_CREDENTIALS = "Identifiants invalides."


@router.post(
    "/inscription",
    response_model=UserRead,
    status_code=201,
    operation_id="signUp",
    summary="Créer un compte",
    description=(
        "Inscription ouverte, sans vérification d'adresse : le compte est actif "
        "aussitôt, avec le rôle `user` (aucun champ `role` n'est accepté, tout "
        "champ inconnu rend 422), et la session est ouverte dans la même "
        "réponse. L'adresse est ramenée en minuscules. 409 si l'adresse ou le "
        "nom d'utilisateur est déjà pris. Limité en débit par adresse IP (429)."
    ),
    responses={
        201: {
            "description": "Compte créé, session ouverte.",
            "headers": SET_SESSION_COOKIE,
        },
        **CONFLICT,
        **FORBIDDEN_ORIGIN,
        **TOO_MANY_REQUESTS,
    },
)
@limiter.limit(signup_rate_limit)
def sign_up(
    request: Request, response: Response, payload: UserSignUp, db: DbSession
) -> UserRead:
    account = auth_service.create_account(
        db,
        email=payload.email,
        username=payload.username,
        password=payload.password,
    )
    session, token = auth_service.create_session(db, account)
    set_session_cookie(response, token, session.expires_at)
    return account


@router.post(
    "/connexion",
    response_model=UserRead,
    operation_id="logIn",
    summary="Ouvrir une session",
    description=(
        "Vérifie l'adresse et le mot de passe, puis pose le cookie de session "
        "(échéance fixe de 14 jours). Une adresse inconnue et un mauvais mot de "
        "passe rendent le même 401, au même coût. Limité en débit par adresse "
        "IP (429)."
    ),
    responses={
        200: {
            "description": "Session ouverte.",
            "headers": SET_SESSION_COOKIE,
        },
        401: {
            "model": ErrorResponse,
            "description": "Identifiants invalides (sans dire lequel).",
        },
        **FORBIDDEN_ORIGIN,
        **TOO_MANY_REQUESTS,
    },
)
@limiter.limit(login_rate_limit)
def log_in(
    request: Request, response: Response, payload: UserLogIn, db: DbSession
) -> UserRead:
    account = auth_service.authenticate(
        db, email=payload.email, password=payload.password
    )
    if account is None:
        raise HTTPException(status_code=401, detail=_INVALID_CREDENTIALS)
    session, token = auth_service.create_session(db, account)
    set_session_cookie(response, token, session.expires_at)
    return account


@router.post(
    "/deconnexion",
    status_code=204,
    response_class=Response,
    operation_id="logOut",
    summary="Fermer la session",
    description=(
        "Supprime la session du cookie côté serveur et efface le cookie. Rend "
        "204 dans tous les cas, même sans cookie ou avec une session déjà "
        "expirée ou révoquée : la déconnexion est idempotente."
    ),
    responses={
        204: {
            "description": "Session fermée (ou déjà absente).",
            "headers": CLEAR_SESSION_COOKIE,
        },
        **FORBIDDEN_ORIGIN,
    },
    # `SessionToken` utilise `Security(session_cookie)`, ce qui fait déclarer la
    # route comme protégée (`security: [{"sessionCookie": []}]`) par défaut,
    # alors qu'elle est publique et idempotente (204 même sans session valide,
    # `auto_error=False`). FastAPI fusionne les listes d'`openapi_extra` par
    # concaténation (`deep_dict_update`, pas un remplacement) : ajouter
    # seulement `{}` (aucune exigence) à la liste déjà générée suffit à rendre
    # l'exigence facultative, sans dupliquer l'entrée `sessionCookie`.
    openapi_extra={"security": [{}]},
)
def log_out(token: SessionToken, response: Response, db: DbSession) -> Response:
    # Pas de `dependencies=REQUIRE_SESSION` ici, volontairement : cette route
    # n'exige pas de session (elle n'a pas de 401 au contrat) puisqu'elle doit
    # rendre 204 même pour un jeton absent, inconnu ou expiré. `SessionToken`
    # lit le cookie brut, sans passer par `current_session` qui lèverait 401.
    if token is not None:
        auth_service.delete_session(db, token)
    clear_session_cookie(response)
    response.status_code = 204
    return response


@router.get(
    "/moi",
    response_model=UserRead,
    operation_id="readCurrentUser",
    summary="Compte de la session",
    responses={**UNAUTHENTICATED},
)
def read_current_user(current_user: CurrentUser) -> UserRead:
    return current_user
