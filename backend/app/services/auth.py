"""Authentification : mots de passe et sessions (Lot 6, étape A2).

Deux familles de fonctions, indépendantes du transport HTTP (les routers s'en
chargent, `docs/lot6-plan-comptes.md`) :

* **mots de passe** — hachage Argon2id (`argon2-cffi`), coûts de
  barrins-project (P1), surchargeables par variable d'environnement ;
  `dummy_verify` égalise le temps de réponse quand l'adresse de connexion ne
  correspond à aucun compte ;
* **sessions** — un jeton opaque (`secrets.token_urlsafe(32)`), dont seule
  l'empreinte SHA-256 est stockée (`AuthSession.token_hash`, D1) ; créer,
  résoudre, supprimer une session, et purger les sessions expirées.

Lot 12 (`docs/lot12-plan-consolidation.md`, étape B1) : une session n'a plus
une échéance fixe. Elle expire après `SESSION_IDLE_DAYS` jours sans usage
(14 par défaut) et au plus tard `SESSION_MAX_DAYS` jours après la connexion
(90 par défaut) ; `renew_session` la prolonge au plus une fois par jour (P10,
A10). S'y ajoutent le changement de mot de passe depuis l'application, qui
ferme les autres sessions du compte (P2, A3), la liste des sessions et leur
fermeture une à une ou toutes sauf la courante (P1), et l'appareil noté à
l'ouverture (`user_agent`, A2).

Rien ici ne lit de cookie ni ne lève de `HTTPException` : c'est le rôle de
`app.routers.common` (dépendances `current_session` / `current_user`) et des
routes elles-mêmes. Ce module est aussi celui que réutilise
`scripts/manage_accounts.py`, qui n'a pas de requête HTTP à sa disposition.
"""

import hashlib
import os
import secrets
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from email_validator import EmailNotValidError, validate_email
from sqlalchemy import delete, func, select
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.models.account import (
    SESSION_LIFETIME,
    USER_AGENT_MAX_LENGTH,
    AuthSession,
    UserAccount,
)
from app.models.enums import UserRole
from app.schemas.account import SessionRead, UserUpdate, normalize_email
from app.services import players
from app.services.errors import ConflictError, InvalidRequestError, NotFoundError
from app.services.persistence import integrity_as_conflict

# ---------------------------------------------------------------------------
# Mots de passe (P1)
# ---------------------------------------------------------------------------


def _env_int(name: str, default: int) -> int:
    """Lit un entier dans l'environnement ; la valeur par défaut sinon.

    Appelé une fois, au chargement du module (`_hasher` ci-dessous) : les
    coûts Argon2 d'un processus en cours ne changent jamais, contrairement au
    débit de `app.services.rate_limit`, qu'un test peut vouloir faire varier
    sans redémarrer.
    """
    raw = os.getenv(name)
    if raw is None or not raw.strip():
        return default
    return int(raw)


ARGON2_MEMORY_COST_KIB = _env_int("ARGON2_MEMORY_COST_KIB", 65536)
ARGON2_TIME_COST = _env_int("ARGON2_TIME_COST", 3)
ARGON2_PARALLELISM = _env_int("ARGON2_PARALLELISM", 4)

# Un seul `PasswordHasher`, construit une fois au chargement du module : les
# coûts sont fixes pour la durée du processus (P1). `needs_rehash` permet de
# les faire évoluer, à chaque connexion réussie, sans migration de données.
_hasher = PasswordHasher(
    memory_cost=ARGON2_MEMORY_COST_KIB,
    time_cost=ARGON2_TIME_COST,
    parallelism=ARGON2_PARALLELISM,
)


def hash_password(plain: str) -> str:
    """Empreinte Argon2id d'un mot de passe en clair (chaîne au format PHC)."""
    return _hasher.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    """Vérifie un mot de passe contre son empreinte.

    Ne lève jamais : une empreinte invalide ou malformée (dont `!`, le mot de
    passe inutilisable du compte historique, D6) rend simplement `False`.
    """
    try:
        return _hasher.verify(hashed, plain)
    except (VerificationError, InvalidHashError):
        return False


def needs_rehash(hashed: str) -> bool:
    """Vrai si `hashed` a été produit avec des coûts plus faibles que les
    coûts courants (après un ajustement d'`ARGON2_*`). Comme `verify_password`,
    ne lève pas sur une empreinte invalide : appelé seulement après une
    vérification réussie, mais défensif quand même."""
    try:
        return _hasher.check_needs_rehash(hashed)
    except InvalidHashError:
        return False


# Empreinte factice, calculée une fois au chargement du module : `dummy_verify`
# fait passer Argon2 sur une entrée connue quand l'adresse de connexion ne
# correspond à aucun compte, pour qu'un compte inconnu et un mauvais mot de
# passe coûtent le même temps de réponse (pas d'oracle de connexion, P1).
_DUMMY_HASH = _hasher.hash("mot-de-passe-factice-pour-egaliser-le-temps")


def dummy_verify(plain: str) -> None:
    """Vérification factice, pour égaliser le temps de réponse (P1)."""
    try:
        _hasher.verify(_DUMMY_HASH, plain)
    except (VerificationError, InvalidHashError):
        pass


# ---------------------------------------------------------------------------
# Comptes
# ---------------------------------------------------------------------------


def create_account(
    db: Session,
    *,
    email: str,
    username: str,
    password: str,
    role: UserRole = UserRole.USER,
) -> UserAccount:
    """Crée un compte ; 409 si l'adresse ou le nom est déjà pris.

    `email` et `username` sont supposés déjà validés et normalisés par
    l'appelant (schémas Pydantic côté API, `app.schemas.account`, ou la même
    normalisation côté script) : ce service ne revalide que leur unicité,
    jamais leur forme. Crée aussi le joueur « Moi » (nom = `username`, A1).
    Vérification préalable (message précis, email d'abord
    comme chez barrins-project) puis `integrity_as_conflict` en filet, pour la
    course entre deux inscriptions concurrentes.
    """
    existing_email = db.scalar(select(UserAccount).where(UserAccount.email == email))
    if existing_email is not None:
        raise ConflictError(f"L'adresse {email!r} est déjà utilisée.")
    existing_username = db.scalar(
        select(UserAccount).where(UserAccount.username == username)
    )
    if existing_username is not None:
        raise ConflictError(f"Le nom d'utilisateur {username!r} est déjà pris.")
    account = UserAccount(
        email=email,
        username=username,
        password_hash=hash_password(password),
        role=role,
    )
    db.add(account)
    # Le « Moi » naît avec le compte, dans la même transaction (Lot 7, A1) :
    # jamais de compte sans lui, ni de « Moi » sans compte.
    with integrity_as_conflict(
        db, "L'adresse ou le nom d'utilisateur est déjà pris."
    ):
        db.flush()
        players.get_or_create_me(db, account.id, account.username)
        db.commit()
    db.refresh(account)
    return account


def _login_email(value: str) -> str | None:
    """Forme canonique d'une adresse saisie à la connexion, ou `None` si ce
    n'est pas une adresse valide.

    Même normalisation que `EmailAddress` (`email-validator`, puis
    `normalize_email`), sans lever : une adresse mal formée désigne un compte
    introuvable, pas une requête invalide.
    """
    try:
        parts = validate_email(value, check_deliverability=False)
    except EmailNotValidError:
        return None
    return normalize_email(parts.normalized)


def find_login_account(db: Session, login: str) -> UserAccount | None:
    """Le compte que désigne l'identifiant saisi à la connexion, ou `None`.

    Une saisie qui contient « @ » est une adresse, puisqu'un nom d'utilisateur
    n'en contient jamais (`USERNAME_PATTERN`). Sinon c'est un nom : d'abord à
    la casse près, puis sans la casse s'il ne désigne alors qu'un seul compte
    (un clavier de téléphone met souvent une majuscule initiale, et l'unicité
    des noms étant sensible à la casse, « Alice » et « alice » peuvent
    coexister : dans ce cas seule la forme exacte connecte). Les noms sont en
    ASCII, si bien que `lower()` de SQLite suffit.
    """
    if "@" in login:
        email = _login_email(login)
        if email is None:
            return None
        return db.scalar(select(UserAccount).where(UserAccount.email == email))
    exact = db.scalar(select(UserAccount).where(UserAccount.username == login))
    if exact is not None:
        return exact
    matches = db.scalars(
        select(UserAccount)
        .where(func.lower(UserAccount.username) == login.lower())
        .limit(2)
    ).all()
    return matches[0] if len(matches) == 1 else None


def authenticate(db: Session, *, login: str, password: str) -> UserAccount | None:
    """Vérifie un identifiant (adresse ou nom d'utilisateur) et un mot de
    passe ; rend le compte, ou `None`.

    Un identifiant inconnu et un mauvais mot de passe rendent tous deux
    `None` : c'est à l'appelant (le router) de produire le même 401 dans les
    deux cas, sans jamais distinguer lequel. `dummy_verify` n'est appelé que
    dans le premier cas, pour égaliser le temps de réponse (P1). Fait évoluer
    l'empreinte au passage (`needs_rehash`) si les coûts ont changé depuis.
    """
    account = find_login_account(db, login)
    if account is None:
        dummy_verify(password)
        return None
    if not verify_password(password, account.password_hash):
        return None
    if needs_rehash(account.password_hash):
        account.password_hash = hash_password(password)
        db.add(account)
        db.commit()
    return account


def set_password(db: Session, account: UserAccount, password: str) -> None:
    """Change le mot de passe d'un compte et révoque toutes ses sessions.

    Une seule transaction : le nouveau secret et la révocation valent
    ensemble, ou pas du tout (`scripts/manage_accounts.py set-password`).
    """
    account.password_hash = hash_password(password)
    db.add(account)
    db.execute(delete(AuthSession).where(AuthSession.user_id == account.id))
    db.commit()


WRONG_CURRENT_PASSWORD = "Mot de passe actuel incorrect."


def change_password(
    db: Session,
    account: UserAccount,
    *,
    current_password: str,
    new_password: str,
    keep_session_id: int,
) -> None:
    """Change le mot de passe depuis l'application (`POST /moi/mot-de-passe`).

    Vérifie l'actuel, pose le nouveau et ferme toutes les sessions du compte
    **sauf** `keep_session_id`, celle de la requête (P2) : on reste connecté
    là où l'on vient de changer le secret, les autres appareils devront se
    reconnecter (leur file attend sans dommage, Lot 6). Une seule transaction,
    comme `set_password`, qui reste celui du script et ferme tout.

    Un actuel faux lève `InvalidRequestError` (422), jamais un 401 : le client
    lit un 401 comme une session perdue (A1). Le nouveau mot de passe a déjà
    passé la règle de l'inscription au schéma (`NewPassword`).
    """
    if not verify_password(current_password, account.password_hash):
        raise InvalidRequestError(
            WRONG_CURRENT_PASSWORD, loc=("body", "current_password")
        )
    account.password_hash = hash_password(new_password)
    db.add(account)
    db.execute(
        delete(AuthSession).where(
            AuthSession.user_id == account.id,
            AuthSession.id != keep_session_id,
        )
    )
    db.commit()


def update_account(
    db: Session, account: UserAccount, changes: UserUpdate
) -> UserAccount:
    """Applique `PATCH /moi` (v1.2.2, A10) : les seuls champs envoyés.

    `display_name` arrive déjà rogné, et nul s'il était vide (`UserUpdate`).
    Pas de verrou d'écriture : une seule ligne, du seul compte de la session,
    et aucun invariant entre plusieurs lignes. Le nom ne touche aucun
    compte-rendu existant ; il entrera dans la prochaine version coupée
    (A11).
    """
    for name, value in changes.model_dump(exclude_unset=True).items():
        setattr(account, name, value)
    db.add(account)
    db.commit()
    db.refresh(account)
    return account


# ---------------------------------------------------------------------------
# Sessions (D1)
# ---------------------------------------------------------------------------

_TOKEN_BYTES = 32


def naive_utcnow() -> datetime:
    """Instant UTC **naïf**, dans la même convention de stockage que les
    colonnes date-heure du modèle (`app.models.types.UtcDateTime`) : comparer
    directement une valeur relue (naïve) à un instant *aware* lèverait une
    `TypeError`.

    Seule horloge des sessions, ici comme dans `app.routers.common` (`Max-Age`
    du cookie) : un test simule le temps en remplaçant cette seule fonction.
    """
    return datetime.now(UTC).replace(tzinfo=None)


# --- Durées (Lot 12, P10, A10) ----------------------------------------------

DEFAULT_SESSION_IDLE_DAYS = SESSION_LIFETIME.days
"""Jours sans usage au bout desquels une session expire (14)."""

DEFAULT_SESSION_MAX_DAYS = 90
"""Jours après la connexion au-delà desquels une session expire, même utilisée
chaque jour (« trois mois au plus », P10)."""

SESSION_RENEWAL_INTERVAL = timedelta(hours=24)
"""Écart minimal entre deux renouvellements d'une même session : une requête
authentifiée écrit au plus une fois par jour et par session (A10)."""

RENEWAL_BUSY_TIMEOUT_MS = 250
"""Attente du verrou d'écriture accordée au renouvellement, en millisecondes,
au lieu des 5 s du pilote : si un lot `/sync` tient la base, une lecture ne
doit pas attendre pour une écriture qui peut se faire le lendemain (A10)."""


class SessionSettingsError(RuntimeError):
    """`SESSION_IDLE_DAYS` ou `SESSION_MAX_DAYS` mal réglé : l'API refuse de
    démarrer (`app.main`, lifespan), comme contre une base en retard."""


def _env_days(name: str, default: int) -> int:
    """Nombre de jours lu dans l'environnement, à chaque appel (un test peut
    le faire varier sans redémarrer, comme les débits de `rate_limit`)."""
    raw = os.getenv(name)
    if raw is None or not raw.strip():
        return default
    try:
        value = int(raw)
    except ValueError:
        raise SessionSettingsError(
            f"{name} doit être un nombre entier de jours, pas {raw!r}."
        ) from None
    if value < 1:
        raise SessionSettingsError(f"{name} doit valoir au moins 1 jour, pas {value}.")
    return value


def session_idle() -> timedelta:
    """Durée sans usage au bout de laquelle une session expire, et durée
    initiale d'une session neuve (`SESSION_IDLE_DAYS`)."""
    return timedelta(days=_env_days("SESSION_IDLE_DAYS", DEFAULT_SESSION_IDLE_DAYS))


def session_max() -> timedelta:
    """Durée de vie maximale d'une session, comptée depuis la connexion
    (`SESSION_MAX_DAYS`)."""
    return timedelta(days=_env_days("SESSION_MAX_DAYS", DEFAULT_SESSION_MAX_DAYS))


def check_session_settings() -> None:
    """Lève `SessionSettingsError` si les durées sont illisibles ou si la
    durée sans usage dépasse le plafond : une session neuve naîtrait alors
    au-delà de sa propre limite. Appelé au démarrage de l'API."""
    idle, maximum = session_idle(), session_max()
    if idle > maximum:
        raise SessionSettingsError(
            f"SESSION_IDLE_DAYS ({idle.days}) dépasse SESSION_MAX_DAYS "
            f"({maximum.days}) : une session expirerait après son plafond."
        )


# --- Appareil (Lot 12, A2) --------------------------------------------------


def clean_user_agent(raw: str | None) -> str | None:
    """`User-Agent` prêt à ranger dans `auth_session.user_agent`.

    Les caractères non imprimables (contrôle, format, séparateurs de ligne)
    sont retirés, les espaces de bord rognés, le tout coupé à
    `USER_AGENT_MAX_LENGTH`. Un en-tête absent ou vide rend `None`
    (« appareil inconnu »). L'en-tête se falsifie : il aide à reconnaître une
    session, il ne prouve rien.
    """
    if raw is None:
        return None
    printable = "".join(char for char in raw if char.isprintable())
    cleaned = printable.strip()[:USER_AGENT_MAX_LENGTH].rstrip()
    return cleaned or None


def generate_session_token() -> str:
    """Jeton opaque de session : 32 octets aléatoires, encodés en base64url."""
    return secrets.token_urlsafe(_TOKEN_BYTES)


def hash_session_token(token: str) -> str:
    """Empreinte SHA-256 d'un jeton de session, hexadécimale.

    SHA-256 simple et non Argon2 : le jeton a 256 bits d'entropie, un hachage
    lent ne protégerait de rien et coûterait de la mémoire à chaque requête
    authentifiée (P1).
    """
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def purge_expired_sessions(db: Session, user_id: int | None = None) -> int:
    """Supprime les sessions expirées (d'un compte, ou de tous), rend le
    nombre de lignes supprimées. Appelé à la connexion d'un compte, et par la
    commande CLI `purge-sessions` (sans `user_id`, pour toute la base)."""
    stmt = delete(AuthSession).where(AuthSession.expires_at <= naive_utcnow())
    if user_id is not None:
        stmt = stmt.where(AuthSession.user_id == user_id)
    result = db.execute(stmt)
    db.commit()
    return result.rowcount or 0


def create_session(
    db: Session, user: UserAccount, *, user_agent: str | None = None
) -> tuple[AuthSession, str]:
    """Ouvre une session pour `user` : purge d'abord ses sessions expirées,
    puis pose l'échéance initiale, `session_idle()` (14 jours par défaut),
    que l'usage repoussera (`renew_session`). `user_agent` est l'en-tête brut
    de la requête de connexion ou d'inscription, nettoyé ici
    (`clean_user_agent`). Rend la ligne et le jeton en clair — c'est la seule
    fois où il existe ailleurs que dans la tête du client, le temps de le
    poser en cookie."""
    purge_expired_sessions(db, user.id)
    token = generate_session_token()
    created_at = naive_utcnow()
    session = AuthSession(
        user_id=user.id,
        token_hash=hash_session_token(token),
        created_at=created_at,
        expires_at=created_at + min(session_idle(), session_max()),
        user_agent=clean_user_agent(user_agent),
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return session, token


def resolve_session(db: Session, token: str) -> AuthSession | None:
    """Résout un jeton en session valide, ou `None` (inconnue ou expirée).

    Une session trouvée mais expirée est supprimée au passage (purge
    paresseuse) : elle ne doit plus jamais revalider, et ne vaut pas la peine
    d'attendre la prochaine connexion ou le prochain `purge-sessions` pour
    disparaître.
    """
    token_hash = hash_session_token(token)
    session = db.scalar(select(AuthSession).where(AuthSession.token_hash == token_hash))
    if session is None:
        return None
    if session.expires_at <= naive_utcnow():
        db.delete(session)
        db.commit()
        return None
    return session


@contextmanager
def _short_busy_timeout(db: Session) -> Iterator[None]:
    """Abaisse le délai d'attente du verrou SQLite le temps d'un bloc, sur la
    connexion de `db`, puis le rétablit.

    Le `PRAGMA` passe par la connexion du pilote, pas par SQLAlchemy : il doit
    pouvoir être rétabli même quand l'écriture vient d'échouer et que la
    transaction de la session attend son `rollback()`. Le bloc se referme
    avant ce `rollback()` ou ce `commit()`, tant que la connexion est encore
    tenue par la session et pas rendue au pool.
    """
    connection = db.connection()
    if connection.dialect.name != "sqlite":
        yield
        return
    driver_connection = connection.connection.dbapi_connection
    previous = int(driver_connection.execute("PRAGMA busy_timeout").fetchone()[0])
    driver_connection.execute(f"PRAGMA busy_timeout = {RENEWAL_BUSY_TIMEOUT_MS:d}")
    try:
        yield
    finally:
        driver_connection.execute(f"PRAGMA busy_timeout = {previous:d}")


def renew_session(db: Session, session: AuthSession) -> bool:
    """Prolonge une session résolue, au plus une fois par jour (A10).

    Rien si la dernière utilisation notée (`last_used_at`, à défaut
    `created_at`, ce qui renouvelle une session d'avant le Lot 12 à sa
    première requête) date de moins de `SESSION_RENEWAL_INTERVAL`. Sinon :
    `last_used_at` = maintenant, `expires_at` = maintenant + `session_idle()`,
    sans jamais dépasser `created_at` + `session_max()`. Le jeton ne change
    pas. Rend `True` si l'échéance a été écrite, pour que l'appelant repose
    le cookie avec la durée restante.

    Ne fait jamais échouer la requête : une transaction courte, avant le corps
    de la route, avec une attente du verrou abaissée
    (`RENEWAL_BUSY_TIMEOUT_MS`). Si la base est tenue (un lot `/sync`), le
    renouvellement est sauté et sera retenté à la requête suivante. Appelé
    depuis la dépendance de session, il est commité avant que `/sync` ne
    prenne son verrou, jamais dedans.
    """
    now = naive_utcnow()
    last_used = session.last_used_at or session.created_at
    if now - last_used < SESSION_RENEWAL_INTERVAL:
        return False
    session.last_used_at = now
    session.expires_at = min(now + session_idle(), session.created_at + session_max())
    try:
        with _short_busy_timeout(db):
            db.flush()
        db.commit()
    except OperationalError:
        db.rollback()
        return False
    return True


def delete_session(db: Session, token: str) -> None:
    """Supprime la session correspondant à ce jeton, si elle existe.

    Idempotent par construction : un jeton inconnu ne supprime rien et ne lève
    pas (`POST /deconnexion` rend 204 dans tous les cas).
    """
    token_hash = hash_session_token(token)
    db.execute(delete(AuthSession).where(AuthSession.token_hash == token_hash))
    db.commit()


def revoke_all_sessions(db: Session, user_id: int) -> int:
    """Supprime toutes les sessions d'un compte ; rend le nombre supprimé
    (`scripts/manage_accounts.py revoke-sessions`)."""
    result = db.execute(delete(AuthSession).where(AuthSession.user_id == user_id))
    db.commit()
    return result.rowcount or 0


# ---------------------------------------------------------------------------
# Sessions du compte, vues depuis l'application (Lot 12, P1)
# ---------------------------------------------------------------------------

CURRENT_SESSION_CONFLICT = (
    "La session de cet appareil se ferme par la déconnexion, pas depuis la "
    "liste des sessions."
)


def list_sessions(db: Session, current: AuthSession) -> list[SessionRead]:
    """Sessions non expirées du compte de `current` (`GET /moi/sessions`).

    La session de la requête en tête (`current`), puis par dernière
    utilisation décroissante, l'ouverture et l'identifiant départageant
    ensuite. `last_used_at` NULL se lit comme `created_at` (A2).
    """
    rows = db.scalars(
        select(AuthSession).where(
            AuthSession.user_id == current.user_id,
            AuthSession.expires_at > naive_utcnow(),
        )
    ).all()
    items = [
        SessionRead(
            id=row.id,
            created_at=row.created_at,
            last_used_at=row.last_used_at or row.created_at,
            expires_at=row.expires_at,
            user_agent=row.user_agent,
            current=row.id == current.id,
        )
        for row in rows
    ]
    items.sort(
        key=lambda item: (item.current, item.last_used_at, item.created_at, item.id),
        reverse=True,
    )
    return items


def revoke_session(db: Session, current: AuthSession, session_id: int) -> None:
    """Ferme une autre session du compte (`DELETE /moi/sessions/{id}`).

    409 pour la session de la requête : elle se ferme par la déconnexion,
    seul chemin qui fait purger la base locale du compte (A1). 404, avec le
    même message, pour une session inconnue, expirée ou d'un autre compte.
    """
    if session_id == current.id:
        raise ConflictError(CURRENT_SESSION_CONFLICT)
    target = db.scalar(
        select(AuthSession).where(
            AuthSession.id == session_id,
            AuthSession.user_id == current.user_id,
            AuthSession.expires_at > naive_utcnow(),
        )
    )
    if target is None:
        raise NotFoundError(f"Session {session_id} introuvable.")
    db.delete(target)
    db.commit()


def revoke_other_sessions(db: Session, current: AuthSession) -> int:
    """Ferme toutes les sessions du compte sauf celle de la requête
    (`DELETE /moi/sessions`) ; rend le nombre de sessions fermées."""
    result = db.execute(
        delete(AuthSession).where(
            AuthSession.user_id == current.user_id,
            AuthSession.id != current.id,
        )
    )
    db.commit()
    return result.rowcount or 0
