"""Gestion des comptes, en ligne de commande (Lot 6, étape A2).

Usage, depuis `backend/` :

    uv run python scripts/manage_accounts.py claim-legacy --email E --username U
    uv run python scripts/manage_accounts.py create --email E --username U [--role ...]
    uv run python scripts/manage_accounts.py check-me [--fix]
    uv run python scripts/manage_accounts.py set-password --email E
    uv run python scripts/manage_accounts.py set-role --email E --role user|admin
    uv run python scripts/manage_accounts.py revoke-sessions --email E
    uv run python scripts/manage_accounts.py purge-sessions

Un mot de passe est toujours lu par `getpass` (jamais en argument : il
finirait dans l'historique du shell), saisi deux fois, et soumis à la même
règle de complexité que l'API (`app.schemas.account.check_password_complexity`).
L'adresse est validée et normalisée comme à l'inscription
(`app.schemas.account.EmailAddress`, qui applique `normalize_email`).

**`claim-legacy`** pose l'adresse, le nom d'utilisateur et le mot de passe du
compte historique (`id = 1`, D6 de `docs/lot6-plan-comptes.md`), une seule
fois : la commande refuse si son mot de passe n'est plus la valeur
inutilisable posée par la migration R8 (`UNUSABLE_PASSWORD_HASH`). C'est la
seule façon de réclamer ce compte — il ne se crée pas par `POST /inscription`,
qui laisserait la première personne à s'inscrire hériter de la collection.

**`check-me`** liste les comptes sans joueur « Moi » (Lot 7, A1) et sort en
code 1 s'il en reste ; `--fix` le crée. `claim-legacy` et `create` s'occupent
eux-mêmes du « Moi » : le premier renomme celui que R10 a posé, le second le
crée avec le compte.

**`set-password`** révoque au passage toutes les sessions du compte visé : un
secret qui change invalide ce qui a été ouvert avec l'ancien.

La base visée est celle de `DATABASE_URL` (défaut : `backend/vtes.db`) ; le
schéma doit exister (`uv run alembic upgrade head`), et le compte historique
doit avoir été inséré par la révision R8.
"""

import argparse
import getpass
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent

# Permet d'exécuter le script directement, sans avoir installé le paquet `app`.
sys.path.insert(0, str(BACKEND_DIR))

from pydantic import TypeAdapter, ValidationError  # noqa: E402
from sqlalchemy import select  # noqa: E402
from sqlalchemy.exc import IntegrityError  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from app.db.session import SessionLocal  # noqa: E402
from app.models import Player  # noqa: E402
from app.models.account import (  # noqa: E402
    LEGACY_ACCOUNT_ID,
    UNUSABLE_PASSWORD_HASH,
    UserAccount,
)
from app.models.enums import UserRole  # noqa: E402
from app.schemas.account import (  # noqa: E402
    PASSWORD_MAX_LENGTH,
    USERNAME_PATTERN,
    USERNAME_RULE,
    EmailAddress,
    check_password_complexity,
)
from app.services import auth, players  # noqa: E402
from app.services.errors import ConflictError  # noqa: E402

_email_adapter = TypeAdapter(EmailAddress)


def _validate_email(raw: str) -> str:
    """Valide et normalise une adresse comme le ferait `POST /inscription`
    (même type Pydantic, donc même règle, y compris `normalize_email`)."""
    try:
        return _email_adapter.validate_python(raw)
    except ValidationError as error:
        raise SystemExit(f"Adresse invalide : {error}") from error


def _validate_username(raw: str) -> str:
    value = raw.strip()
    if not USERNAME_PATTERN.fullmatch(value):
        raise SystemExit(f"Nom d'utilisateur invalide : {USERNAME_RULE}")
    return value


def _read_new_password() -> str:
    """Lit un mot de passe par `getpass`, saisi deux fois, soumis à la règle
    de complexité de l'API. Redemande tant que la saisie ne convient pas."""
    while True:
        value = getpass.getpass("Nouveau mot de passe : ")
        if len(value) > PASSWORD_MAX_LENGTH:
            print(
                f"Trop long ({PASSWORD_MAX_LENGTH} caractères au plus).",
                file=sys.stderr,
            )
            continue
        try:
            check_password_complexity(value)
        except ValueError as error:
            print(str(error), file=sys.stderr)
            continue
        confirm = getpass.getpass("Confirmer : ")
        if value != confirm:
            print("Les deux saisies ne correspondent pas.", file=sys.stderr)
            continue
        return value


def _find_account(db: Session, email: str) -> UserAccount | None:
    return db.scalar(select(UserAccount).where(UserAccount.email == email))


def cmd_claim_legacy(args: argparse.Namespace) -> int:
    email = _validate_email(args.email)
    username = _validate_username(args.username)
    password = _read_new_password()
    with SessionLocal() as db:
        account = db.get(UserAccount, LEGACY_ACCOUNT_ID)
        if account is None:
            print(
                "Compte historique introuvable : la révision R8 a-t-elle été "
                "appliquée (`uv run alembic upgrade head`) ?",
                file=sys.stderr,
            )
            return 1
        if account.password_hash != UNUSABLE_PASSWORD_HASH:
            print("Le compte historique a déjà été réclamé.", file=sys.stderr)
            return 1
        if (
            db.scalar(
                select(UserAccount).where(
                    UserAccount.email == email, UserAccount.id != LEGACY_ACCOUNT_ID
                )
            )
            is not None
        ):
            print(
                f"Adresse déjà utilisée par un autre compte : {email!r}.",
                file=sys.stderr,
            )
            return 1
        if (
            db.scalar(
                select(UserAccount).where(
                    UserAccount.username == username,
                    UserAccount.id != LEGACY_ACCOUNT_ID,
                )
            )
            is not None
        ):
            print(
                f"Nom d'utilisateur déjà pris par un autre compte : {username!r}.",
                file=sys.stderr,
            )
            return 1
        previous_username = account.username
        account.email = email
        account.username = username
        account.password_hash = auth.hash_password(password)
        db.add(account)
        # Le « Moi » posé par R10 porte l'ancien nom d'utilisateur (Lot 7, A1) :
        # il suit le nouveau, tant que l'utilisateur ne l'a pas déjà renommé.
        warning = _follow_username(db, account.id, previous_username, username)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            print("Conflit à l'écriture (adresse ou nom déjà pris).", file=sys.stderr)
            return 1
    print(f"Compte historique réclamé : {email} / {username}.")
    if warning:
        print(warning, file=sys.stderr)
    return 0


def _follow_username(
    db: Session, user_id: int, previous_username: str, username: str
) -> str | None:
    """Renomme le « Moi » du compte pour qu'il suive son nouveau `username`.

    Le crée s'il manque. Ne touche pas à un « Moi » déjà renommé à la main, ni
    ne le renomme sur un nom qu'un autre joueur porte déjà (repli sur un
    avertissement). Ne valide pas : la transaction reste à l'appelant.
    """
    me = players.get_me(db, user_id)
    if me is None:
        players.get_or_create_me(db, user_id, username)
        return None
    if me.name != previous_username or me.name == username:
        return None
    if players.find_by_name(db, user_id, username, exclude_id=me.id) is not None:
        return (
            f"Le joueur Moi garde le nom {me.name!r} : un autre joueur porte déjà "
            f"{username!r}. À renommer par l'application."
        )
    me.name = username
    return None


def cmd_create(args: argparse.Namespace) -> int:
    email = _validate_email(args.email)
    username = _validate_username(args.username)
    role = UserRole(args.role)
    password = _read_new_password()
    with SessionLocal() as db:
        try:
            account = auth.create_account(
                db, email=email, username=username, password=password, role=role
            )
        except ConflictError as error:
            print(str(error), file=sys.stderr)
            return 1
        print(f"Compte créé : #{account.id} {account.email} ({account.role.value}).")
    return 0


def cmd_check_me(args: argparse.Namespace) -> int:
    """Liste les comptes sans joueur « Moi » ; `--fix` le crée (nom = `username`).

    Un compte sans « Moi » ne devrait pas exister (Lot 7, A1) : R10 en pose un
    aux comptes existants, `create_account` aux suivants. La commande sert de
    contrôle après une mise en service. Code de sortie 1 s'il en reste.
    """
    with SessionLocal() as db:
        missing = list(
            db.scalars(
                select(UserAccount)
                .where(
                    ~select(Player.id)
                    .where(Player.user_id == UserAccount.id, Player.is_me.is_(True))
                    .exists()
                )
                .order_by(UserAccount.id)
            )
        )
        for account in missing:
            print(f"#{account.id} {account.email} ({account.username}) : pas de Moi.")
        if not missing:
            print("Tous les comptes ont un joueur Moi.")
            return 0
        if args.fix:
            for account in missing:
                players.get_or_create_me(db, account.id, account.username)
            db.commit()
            print(f"{len(missing)} joueur(s) Moi créé(s).")
            return 0
    return 1


def cmd_set_password(args: argparse.Namespace) -> int:
    email = _validate_email(args.email)
    password = _read_new_password()
    with SessionLocal() as db:
        account = _find_account(db, email)
        if account is None:
            print(f"Compte introuvable : {email!r}.", file=sys.stderr)
            return 1
        auth.set_password(db, account, password)
    print(f"Mot de passe changé pour {email} ; toutes ses sessions ont été révoquées.")
    return 0


def cmd_set_role(args: argparse.Namespace) -> int:
    email = _validate_email(args.email)
    role = UserRole(args.role)
    with SessionLocal() as db:
        account = _find_account(db, email)
        if account is None:
            print(f"Compte introuvable : {email!r}.", file=sys.stderr)
            return 1
        account.role = role
        db.add(account)
        db.commit()
    print(f"Rôle de {email} : {role.value}.")
    return 0


def cmd_revoke_sessions(args: argparse.Namespace) -> int:
    email = _validate_email(args.email)
    with SessionLocal() as db:
        account = _find_account(db, email)
        if account is None:
            print(f"Compte introuvable : {email!r}.", file=sys.stderr)
            return 1
        count = auth.revoke_all_sessions(db, account.id)
    print(f"{count} session(s) révoquée(s) pour {email}.")
    return 0


def cmd_purge_sessions(_args: argparse.Namespace) -> int:
    with SessionLocal() as db:
        count = auth.purge_expired_sessions(db)
    print(f"{count} session(s) expirée(s) supprimée(s).")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    claim_legacy = subparsers.add_parser(
        "claim-legacy",
        help="Pose l'adresse, le nom et le mot de passe du compte historique.",
    )
    claim_legacy.add_argument("--email", required=True)
    claim_legacy.add_argument("--username", required=True)
    claim_legacy.set_defaults(func=cmd_claim_legacy)

    create = subparsers.add_parser("create", help="Crée un compte.")
    create.add_argument("--email", required=True)
    create.add_argument("--username", required=True)
    create.add_argument(
        "--role",
        choices=[role.value for role in UserRole],
        default=UserRole.USER.value,
    )
    create.set_defaults(func=cmd_create)

    check_me = subparsers.add_parser(
        "check-me", help="Liste les comptes sans joueur Moi (--fix pour le créer)."
    )
    check_me.add_argument("--fix", action="store_true")
    check_me.set_defaults(func=cmd_check_me)

    set_password = subparsers.add_parser(
        "set-password",
        help="Change le mot de passe d'un compte ; révoque toutes ses sessions.",
    )
    set_password.add_argument("--email", required=True)
    set_password.set_defaults(func=cmd_set_password)

    set_role = subparsers.add_parser(
        "set-role",
        help="Change le rôle d'un compte (seul moyen de créer un autre admin).",
    )
    set_role.add_argument("--email", required=True)
    set_role.add_argument(
        "--role", required=True, choices=[role.value for role in UserRole]
    )
    set_role.set_defaults(func=cmd_set_role)

    revoke_sessions = subparsers.add_parser(
        "revoke-sessions", help="Révoque toutes les sessions d'un compte."
    )
    revoke_sessions.add_argument("--email", required=True)
    revoke_sessions.set_defaults(func=cmd_revoke_sessions)

    purge_sessions = subparsers.add_parser(
        "purge-sessions", help="Supprime les sessions expirées, pour tous les comptes."
    )
    purge_sessions.set_defaults(func=cmd_purge_sessions)

    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
