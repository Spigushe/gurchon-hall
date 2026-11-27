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

**Lot 12** (`docs/lot12-plan-consolidation.md`, A1) : cinq routes sous
`/moi`, toutes sous session et en ligne seulement : changer son mot de passe,
lister et fermer ses sessions (étape B1), exporter son compte (étape B2,
`app.services.account_export`). Depuis B1, la connexion et
l'inscription notent l'appareil (`User-Agent`, A2) sur la session qu'elles
ouvrent, et le changement de mot de passe est limité en débit comme elles.

**v1.2.2** (`docs/v1.2.2-plan.md`, A10) : `PATCH /moi` règle le nom à afficher
dans les comptes-rendus (`display_name`), sous session, en ligne seulement.
"""

from fastapi import APIRouter, HTTPException, Request, Response

from app.routers.common import (
    CLEAR_SESSION_COOKIE,
    CONFLICT,
    FORBIDDEN_ORIGIN,
    NOT_FOUND,
    SET_SESSION_COOKIE,
    TOO_MANY_REQUESTS,
    UNAUTHENTICATED,
    CurrentSession,
    CurrentUser,
    DbSession,
    PathId,
    SessionToken,
    clear_session_cookie,
    no_content,
    set_session_cookie,
)
from app.schemas.account import (
    PasswordChange,
    SessionRead,
    UserLogIn,
    UserRead,
    UserSignUp,
    UserUpdate,
)
from app.schemas.account_export import AccountExport
from app.schemas.errors import ErrorResponse
from app.services import account_export as export_service
from app.services import auth as auth_service
from app.services.rate_limit import (
    limiter,
    login_rate_limit,
    password_change_rate_limit,
    signup_rate_limit,
)

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
    session, token = auth_service.create_session(
        db, account, user_agent=request.headers.get("user-agent")
    )
    set_session_cookie(response, token, session.expires_at)
    return account


@router.post(
    "/connexion",
    response_model=UserRead,
    operation_id="logIn",
    summary="Ouvrir une session",
    description=(
        "Vérifie l'identifiant (adresse e-mail ou nom d'utilisateur, dans "
        "`identifier` ; `email` reste accepté) et le mot de passe, puis pose le "
        "cookie de session (14 jours sans usage, 90 jours au plus) et note "
        "l'appareil (`User-Agent`). Un identifiant inconnu et un mauvais mot de "
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
        db, login=payload.login, password=payload.password
    )
    if account is None:
        raise HTTPException(status_code=401, detail=_INVALID_CREDENTIALS)
    session, token = auth_service.create_session(
        db, account, user_agent=request.headers.get("user-agent")
    )
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


@router.patch(
    "/moi",
    response_model=UserRead,
    operation_id="updateCurrentUser",
    summary="Modifier son compte",
    description=(
        "Modification partielle du compte de la session (v1.2.2) : "
        "aujourd'hui le seul nom à afficher dans les comptes-rendus "
        "(`display_name`), rogné, 64 caractères au plus, sur une seule ligne "
        "(un caractère de contrôle rend 422) ; `null`, une chaîne "
        "vide ou blanche l'efface, un champ omis ne change pas. Tout autre "
        "champ rend 422 : ni l'adresse, ni le nom d'utilisateur, ni le rôle "
        "ne se modifient ici. Le nom entre dans la prochaine version coupée "
        "d'un compte-rendu, jamais dans une version déjà figée. En ligne "
        "seulement, hors `/sync`."
    ),
    responses={**UNAUTHENTICATED, **FORBIDDEN_ORIGIN},
)
def update_current_user(
    payload: UserUpdate, current_user: CurrentUser, db: DbSession
) -> UserRead:
    return auth_service.update_account(db, current_user, payload)


# ---------------------------------------------------------------------------
# Lot 12 : mot de passe, sessions, export (`docs/lot12-plan-consolidation.md`)
# ---------------------------------------------------------------------------


_CONTENT_DISPOSITION = {
    "Content-Disposition": {
        "description": (
            "`attachment; filename=\"gurchon-hall-<username>-<AAAA-MM-JJ>.json\"` :"
            " le navigateur enregistre le fichier au lieu de l'afficher."
        ),
        "schema": {"type": "string"},
    }
}


@router.post(
    "/moi/mot-de-passe",
    status_code=204,
    response_class=Response,
    operation_id="changePassword",
    summary="Changer son mot de passe",
    description=(
        "Vérifie le mot de passe actuel, pose le nouveau (mêmes règles qu'à "
        "l'inscription) et ferme toutes les **autres** sessions du compte, dans "
        "une transaction ; la session de la requête reste ouverte (P2). Un "
        "mot de passe actuel incorrect rend **422** « Mot de passe actuel "
        "incorrect. », jamais 401 : la session, elle, est valide. Limité en "
        "débit par adresse IP (429). En ligne seulement, hors `/sync`."
    ),
    responses={
        204: {"description": "Mot de passe changé, autres sessions fermées."},
        **UNAUTHENTICATED,
        **FORBIDDEN_ORIGIN,
        **TOO_MANY_REQUESTS,
    },
)
@limiter.limit(password_change_rate_limit)
def change_password(
    request: Request,
    response: Response,
    payload: PasswordChange,
    session: CurrentSession,
    db: DbSession,
) -> Response:
    auth_service.change_password(
        db,
        session.user,
        current_password=payload.current_password,
        new_password=payload.new_password,
        keep_session_id=session.id,
    )
    return no_content(response)


@router.get(
    "/moi/sessions",
    response_model=list[SessionRead],
    operation_id="listSessions",
    summary="Sessions ouvertes du compte",
    description=(
        "Sessions non expirées du compte, la session de la requête en tête "
        "(`current`), puis par dernière utilisation décroissante. Ni jeton ni "
        "empreinte : l'appareil se reconnaît à `user_agent`, noté à la "
        "connexion (P1)."
    ),
    responses={**UNAUTHENTICATED},
)
def list_sessions(session: CurrentSession, db: DbSession) -> list[SessionRead]:
    return auth_service.list_sessions(db, session)


@router.delete(
    "/moi/sessions",
    status_code=204,
    response_class=Response,
    operation_id="revokeOtherSessions",
    summary="Fermer toutes les autres sessions",
    description=(
        "Ferme toutes les sessions du compte sauf celle de la requête. "
        "Idempotente : 204 même s'il n'y en avait aucune autre."
    ),
    responses={
        204: {"description": "Autres sessions fermées."},
        **UNAUTHENTICATED,
        **FORBIDDEN_ORIGIN,
    },
)
def revoke_other_sessions(
    session: CurrentSession, db: DbSession, response: Response
) -> Response:
    auth_service.revoke_other_sessions(db, session)
    return no_content(response)


@router.delete(
    "/moi/sessions/{session_id}",
    status_code=204,
    response_class=Response,
    operation_id="revokeSession",
    summary="Fermer une session",
    description=(
        "Ferme une autre session du compte : l'appareil qui la tenait reçoit "
        "401 à sa requête suivante. 404 pour une session inconnue, expirée ou "
        "d'un autre compte, avec le même message. **409 pour la session de la "
        "requête** : elle se ferme par `POST /deconnexion`, seul chemin qui "
        "fait purger la base locale du compte."
    ),
    responses={
        204: {"description": "Session fermée."},
        **UNAUTHENTICATED,
        **FORBIDDEN_ORIGIN,
        **NOT_FOUND,
        **CONFLICT,
    },
)
def revoke_session(
    session_id: PathId, session: CurrentSession, db: DbSession, response: Response
) -> Response:
    auth_service.revoke_session(db, session, session_id)
    return no_content(response)


@router.get(
    "/moi/export",
    response_model=AccountExport,
    operation_id="exportAccount",
    summary="Exporter toutes ses données",
    description=(
        "Toutes les données du compte en un fichier JSON lisible sans la base "
        "(P3) : compte, collection, decks archivés et supprimés avec leurs "
        "lignes et leurs versions jouées, joueurs, lieux, tournois et parties "
        "avec leurs tables. Ni hachage, ni session, ni journal de "
        "synchronisation. Fabriqué depuis la base, en ligne seulement : une "
        "saisie encore en file n'y figure pas. Servi en pièce jointe."
    ),
    responses={
        200: {
            "description": "Export du compte, en pièce jointe.",
            "headers": _CONTENT_DISPOSITION,
        },
        **UNAUTHENTICATED,
    },
)
def export_account(
    user: CurrentUser, db: DbSession, response: Response
) -> AccountExport:
    export = export_service.export_account(db, user)
    filename = export_service.export_filename(user.username, export.exported_at)
    # Posé sur la `Response` injectée, que FastAPI fusionne avec la réponse
    # qu'il fabrique, comme le `Cache-Control` et le cookie renouvelé de la
    # dépendance de session.
    response.headers["Content-Disposition"] = f'attachment; filename="{filename}"'
    return export
