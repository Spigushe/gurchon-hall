"""Aides de test pour l'authentification (Lot 6), réutilisables par l'étape A3.

Deux niveaux :

* `make_account` — un compte écrit directement en base, pour un test qui n'a
  besoin que d'un compte existant (pas de passage par `POST /inscription`) ;
* `log_in` / `authenticated_api` — ouvrent une session par l'API, pour qu'un
  test passe par le même chemin qu'un client réel : le cookie posé par
  `POST /connexion` atterrit dans le pot de cookies du `TestClient`, qui le
  renvoie sur chaque requête suivante.

Pour un test à **deux comptes** (isolation, étape A3), utiliser
`api_client_factory` (`tests/conftest.py`) pour obtenir deux `TestClient`
distincts sur la même base jetable, puis appeler `authenticated_api` une fois
par client : un seul `TestClient` ne peut pas tenir deux sessions à la fois
(un seul pot de cookies).
"""

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.account import UserAccount
from app.models.enums import UserRole
from app.services import auth as auth_service

DEFAULT_PASSWORD = "Sup3r-Secret-1!"


def make_account(
    db: Session,
    email: str = "joueur@example.com",
    username: str = "joueur",
    password: str = DEFAULT_PASSWORD,
    role: UserRole = UserRole.USER,
) -> UserAccount:
    """Compte créé directement en base, mot de passe haché comme à l'inscription."""
    account = UserAccount(
        email=email,
        username=username,
        password_hash=auth_service.hash_password(password),
        role=role,
    )
    db.add(account)
    db.commit()
    db.refresh(account)
    return account


def log_in(api: TestClient, email: str, password: str = DEFAULT_PASSWORD):
    """Ouvre une session par l'API. Le cookie rendu atterrit dans le pot de
    cookies de `api`, qui le renverra sur toute requête suivante."""
    response = api.post("/connexion", json={"email": email, "password": password})
    response.raise_for_status()
    return response


def authenticated_api(
    api: TestClient,
    db: Session,
    email: str = "joueur@example.com",
    username: str = "joueur",
    password: str = DEFAULT_PASSWORD,
    role: UserRole = UserRole.USER,
) -> tuple[TestClient, UserAccount]:
    """Crée un compte et ouvre sa session sur `api`.

    Rend `api` (désormais authentifié pour toute requête suivante) et le
    compte créé, pour les tests qui veulent aussi vérifier son identifiant.
    """
    account = make_account(
        db, email=email, username=username, password=password, role=role
    )
    log_in(api, email, password)
    return api, account
