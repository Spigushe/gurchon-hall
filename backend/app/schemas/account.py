"""Schémas des comptes et de l'authentification (Lot 6).

Quatre routes les consomment (`docs/lot6-plan-comptes.md`, « Contrat d'API ») :
`POST /inscription` (`UserSignUp` → `UserRead`), `POST /connexion`
(`UserLogIn` → `UserRead`), `POST /deconnexion` (sans corps) et `GET /moi`
(→ `UserRead`). Aucun jeton ni aucune empreinte ne figure dans un corps : le
jeton de session ne circule que dans l'en-tête `Set-Cookie`.

Les règles de saisie sont celles de barrins-project
(`apps/barrins_identity/app/schemas/auth.py`), à deux écarts près, tous deux
voulus :

* une **longueur maximale** du mot de passe (`PASSWORD_MAX_LENGTH`), que Barrin
  n'a pas : sans elle, un mot de passe de plusieurs mégaoctets ferait tourner
  Argon2 sur une entrée démesurée avant tout refus ;
* l'adresse e-mail est **normalisée en minuscules** (`normalize_email`), là où
  Barrin la garde telle que `email-validator` la rend (domaine en minuscules,
  partie locale intacte).

Ces fonctions et types servent aussi au script `scripts/manage_accounts.py` :
un mot de passe posé par la ligne de commande obéit à la même règle que
l'API, et une adresse y est normalisée de la même façon.
"""

import re
from datetime import datetime
from typing import Annotated

from pydantic import AfterValidator, EmailStr, Field

from app.models.account import EMAIL_MAX_LENGTH, USERNAME_MAX_LENGTH
from app.models.enums import UserRole
from app.schemas.base import ReadModel, WriteModel

# ---------------------------------------------------------------------------
# Mot de passe
# ---------------------------------------------------------------------------

PASSWORD_PATTERN = re.compile(
    r"^(?=.*[a-z])"  # au moins une minuscule
    r"(?=.*[A-Z])"  # au moins une majuscule
    r"(?=.*\d)"  # au moins un chiffre
    r"(?=.*[^\w\s])"  # au moins un symbole (`_` n'en est pas un : il est dans \w)
    r".{12,}$"
)
"""Règle de complexité de Barrin, à l'identique (P1).

Le moteur Rust de Pydantic v2 ne connaît pas les lookaheads : le motif est
**exposé** dans le schéma OpenAPI (`json_schema_extra`) pour que le client
puisse le reprendre, mais il est **appliqué** par `AfterValidator`, côté
Python."""

PASSWORD_MIN_LENGTH = 12
PASSWORD_MAX_LENGTH = 128
"""Plafond d'un mot de passe, en caractères (Lot 6, « Bornes »).

128 laisse toute la place à une phrase de passe ou à la sortie d'un
gestionnaire de mots de passe (les plus longs génèrent 64 à 100 caractères),
et borne le travail d'Argon2 à quelques centaines d'octets. Vérifié par
Pydantic **avant** la règle de complexité et avant tout hachage : une entrée
démesurée est refusée en 422 sans avoir coûté autre chose qu'une mesure de
longueur."""

PASSWORD_RULE = (
    "Au moins 12 caractères, dont une minuscule, une majuscule, un chiffre et "
    "un symbole ; 128 au plus."
)


def check_password_complexity(value: str) -> str:
    """Applique la règle de complexité ; lève `ValueError` sinon.

    Publique pour le script de gestion des comptes, qui la réutilise telle
    quelle. Le mot de passe n'est ni rogné ni normalisé : ce qui est tapé est
    ce qui est haché.
    """
    if not PASSWORD_PATTERN.fullmatch(value):
        raise ValueError(PASSWORD_RULE)
    return value


NewPassword = Annotated[
    str,
    Field(
        min_length=PASSWORD_MIN_LENGTH,
        max_length=PASSWORD_MAX_LENGTH,
        json_schema_extra={"pattern": PASSWORD_PATTERN.pattern},
        description=PASSWORD_RULE,
    ),
    AfterValidator(check_password_complexity),
]
"""Mot de passe choisi (inscription, et demain changement de mot de passe)."""

SubmittedPassword = Annotated[
    str,
    Field(
        min_length=1,
        max_length=PASSWORD_MAX_LENGTH,
        description=(
            "Mot de passe du compte, tel quel. Seule la longueur est bornée : "
            "la règle de complexité ne s'applique qu'au choix d'un mot de passe."
        ),
    ),
]
"""Mot de passe soumis à la connexion.

Volontairement sans règle de complexité : un secret posé sous une règle plus
ancienne (ou par la ligne de commande) doit rester utilisable, et refuser en
422 ce qui n'est qu'un mauvais mot de passe distinguerait deux échecs que la
connexion doit confondre en un seul 401."""

# ---------------------------------------------------------------------------
# Nom d'utilisateur
# ---------------------------------------------------------------------------

USERNAME_PATTERN = re.compile(r"^[A-Za-z0-9_-]{3,32}$")
"""Motif de Barrin (`USERNAME_PATTERN`) : sans lookaround, donc appliqué
directement par `Field(pattern=...)`."""

USERNAME_RULE = (
    "De 3 à 32 caractères : lettres non accentuées, chiffres, tiret ou tiret bas."
)

Username = Annotated[
    str,
    Field(
        pattern=USERNAME_PATTERN.pattern,
        min_length=3,
        max_length=USERNAME_MAX_LENGTH,
        description=USERNAME_RULE,
    ),
]
"""Nom d'utilisateur. Sa casse est conservée et son unicité y est sensible,
comme chez Barrin : c'est un nom affiché, pas un identifiant de connexion."""

# ---------------------------------------------------------------------------
# Adresse e-mail
# ---------------------------------------------------------------------------


def normalize_email(value: str) -> str:
    """Forme canonique d'une adresse, à l'écriture comme à la recherche.

    Règle retenue (point d'interprétation 4 du brief) : **toute l'adresse en
    minuscules**, partie locale comprise, après la normalisation
    d'`email-validator` (espaces de bord retirés, domaine en minuscules et
    converti, partie locale en NFC). `A@x.fr` et `a@x.fr` désignent donc le
    même compte.

    La RFC 5321 permet à un serveur de distinguer la casse de la partie
    locale, mais aucun fournisseur courant ne le fait, et l'adresse ne sert ici
    qu'à se connecter : elle n'est jamais utilisée pour écrire (aucun envoi
    d'e-mail, P2). Le risque inverse est concret — deux comptes pour la même
    personne, ou une connexion refusée pour une majuscule — d'où ce choix.
    `str.lower()` et non `casefold()` : `casefold` réécrit certaines lettres
    (« ß » devient « ss »), ce qui changerait l'adresse au lieu de seulement sa
    casse.

    Sans contrainte en base : `lower()` de SQLite ne connaît que l'ASCII et
    refuserait à tort une adresse accentuée déjà normalisée par Python. La
    normalisation est donc l'affaire de ce module, que l'API (schémas
    ci-dessous) et le script de gestion des comptes appliquent l'une et l'autre.
    """
    return value.strip().lower()


EmailAddress = Annotated[
    EmailStr,
    Field(
        max_length=EMAIL_MAX_LENGTH,
        description=(
            "Adresse e-mail, identifiant de connexion. Comparée sans tenir "
            "compte de la casse : le serveur la ramène en minuscules."
        ),
    ),
    AfterValidator(normalize_email),
]
"""Adresse saisie : validée par `email-validator` (sans résolution DNS),
bornée à 320 caractères, puis normalisée. Les domaines réservés (`.invalid`,
`.test`, `localhost`…) sont refusés : c'est ce qui rend l'adresse du compte
historique impossible à prendre par l'inscription."""


# ---------------------------------------------------------------------------
# Schémas
# ---------------------------------------------------------------------------


class UserSignUp(WriteModel):
    """Corps de `POST /inscription`.

    Pas de champ `role` : le serveur pose `user` lui-même (P2), et
    `extra="forbid"` (hérité de `WriteModel`) fait d'un `role` envoyé — comme
    de tout champ inconnu — un 422 explicite plutôt qu'une valeur ignorée en
    silence. Même défense que le `UserSignup` de Barrin.
    """

    email: EmailAddress
    username: Username
    password: NewPassword


class UserLogIn(WriteModel):
    """Corps de `POST /connexion`.

    Une adresse inconnue et un mauvais mot de passe rendent le même 401, au
    même coût (P1) : rien dans ce schéma ne doit permettre de les distinguer,
    d'où l'absence de règle de complexité sur le mot de passe.
    """

    email: EmailAddress
    password: SubmittedPassword


class UserRead(ReadModel):
    """Le compte de la session : `GET /moi`, et la réponse d'une inscription ou
    d'une connexion réussie.

    Jamais d'empreinte de mot de passe ni de jeton. `email` est une chaîne et
    non un `EmailStr` en sortie : l'adresse provisoire du compte historique
    (domaine `.invalid`) doit pouvoir être relue telle quelle avant que
    `claim-legacy` ne la remplace.
    """

    id: int
    email: str = Field(description="Adresse e-mail, en minuscules.")
    username: str
    role: UserRole = Field(
        description=(
            "Rôle du compte. `admin` ouvre `POST /langues` ; aucune route ne le "
            "modifie."
        )
    )
    created_at: datetime = Field(description="Création du compte, en UTC.")
