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

Rien ici ne lit de cookie ni ne lève de `HTTPException` : c'est le rôle de
`app.routers.common` (dépendances `current_session` / `current_user`) et des
routes elles-mêmes. Ce module est aussi celui que réutilise
`scripts/manage_accounts.py`, qui n'a pas de requête HTTP à sa disposition.
"""

import hashlib
import os
import secrets
from datetime import UTC, datetime

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models.account import SESSION_LIFETIME, AuthSession, UserAccount
from app.models.enums import UserRole
from app.services.errors import ConflictError
from app.services.persistence import commit_or_conflict

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
    jamais leur forme. Vérification préalable (message précis, email d'abord
    comme chez barrins-project) puis `commit_or_conflict` en filet, pour la
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
    commit_or_conflict(db, "L'adresse ou le nom d'utilisateur est déjà pris.")
    db.refresh(account)
    return account


def authenticate(db: Session, *, email: str, password: str) -> UserAccount | None:
    """Vérifie une adresse et un mot de passe ; rend le compte, ou `None`.

    Une adresse inconnue et un mauvais mot de passe rendent tous deux `None` :
    c'est à l'appelant (le router) de produire le même 401 dans les deux cas,
    sans jamais distinguer lequel. `dummy_verify` n'est appelé que dans le
    premier cas, pour égaliser le temps de réponse (P1). Fait évoluer
    l'empreinte au passage (`needs_rehash`) si les coûts ont changé depuis.
    """
    account = db.scalar(select(UserAccount).where(UserAccount.email == email))
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


# ---------------------------------------------------------------------------
# Sessions (D1)
# ---------------------------------------------------------------------------

_TOKEN_BYTES = 32


def _naive_utcnow() -> datetime:
    """Instant UTC **naïf**, dans la même convention de stockage que les
    colonnes date-heure du modèle (`app.models.types.UtcDateTime`) : comparer
    directement une valeur relue (naïve) à un instant *aware* lèverait une
    `TypeError`."""
    return datetime.now(UTC).replace(tzinfo=None)


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
    stmt = delete(AuthSession).where(AuthSession.expires_at <= _naive_utcnow())
    if user_id is not None:
        stmt = stmt.where(AuthSession.user_id == user_id)
    result = db.execute(stmt)
    db.commit()
    return result.rowcount or 0


def create_session(db: Session, user: UserAccount) -> tuple[AuthSession, str]:
    """Ouvre une session pour `user` : purge d'abord ses sessions expirées,
    puis pose une échéance fixe de `SESSION_LIFETIME` (D1, jamais repoussée).
    Rend la ligne et le jeton en clair — c'est la seule fois où il existe
    ailleurs que dans la tête du client, le temps de le poser en cookie."""
    purge_expired_sessions(db, user.id)
    token = generate_session_token()
    created_at = _naive_utcnow()
    session = AuthSession(
        user_id=user.id,
        token_hash=hash_session_token(token),
        created_at=created_at,
        expires_at=created_at + SESSION_LIFETIME,
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
    if session.expires_at <= _naive_utcnow():
        db.delete(session)
        db.commit()
        return None
    return session


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
