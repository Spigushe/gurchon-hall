"""Schémas des comptes et de l'authentification (Lot 6).

Quatre routes les consomment (`docs/lot6-plan-comptes.md`, « Contrat d'API ») :
`POST /inscription` (`UserSignUp` → `UserRead`), `POST /connexion`
(`UserLogIn` → `UserRead`), `POST /deconnexion` (sans corps) et `GET /moi`
(→ `UserRead`). Aucun jeton ni aucune empreinte ne figure dans un corps : le
jeton de session ne circule que dans l'en-tête `Set-Cookie`. Depuis la
v1.2.2, `PATCH /moi` (`UserUpdate` → `UserRead`) règle le nom à afficher.

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
import unicodedata
from datetime import datetime
from typing import Annotated, Self

from pydantic import (
    AfterValidator,
    EmailStr,
    Field,
    StringConstraints,
    model_validator,
)

from app.models.account import (
    DISPLAY_NAME_MAX_LENGTH,
    EMAIL_MAX_LENGTH,
    USERNAME_MAX_LENGTH,
)
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
comme chez Barrin : c'est un nom affiché. Il sert aussi à se connecter, à la
place de l'adresse, depuis le correctif qui a suivi la v1.1.0 (`UserLogIn`)."""

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


LoginIdentifier = Annotated[
    str,
    Field(
        min_length=1,
        max_length=EMAIL_MAX_LENGTH,
        description=(
            "Adresse e-mail ou nom d'utilisateur, dans un même champ. Une "
            "saisie qui contient « @ » est une adresse (comparée sans la "
            "casse) ; sinon c'est un nom d'utilisateur, qui n'en contient "
            "jamais (comparé à la casse près, puis sans elle s'il ne désigne "
            "alors qu'un compte)."
        ),
    ),
    AfterValidator(str.strip),
]
"""Identifiant de connexion, rogné de ses espaces de bord. Aucune autre règle :
une forme invalide (adresse mal écrite, nom hors motif) n'est pas un 422 mais
un compte introuvable, donc le même 401 qu'un mauvais mot de passe."""


class UserLogIn(WriteModel):
    """Corps de `POST /connexion`.

    Une adresse inconnue et un mauvais mot de passe rendent le même 401, au
    même coût (P1) : rien dans ce schéma ne doit permettre de les distinguer,
    d'où l'absence de règle de complexité sur le mot de passe.

    `identifier` (correctif après la v1.1.0) accepte l'adresse ou le nom
    d'utilisateur. `email`, seul champ jusque-là, reste accepté pour qu'une
    coquille v1.1.0 encore en cache se connecte jusqu'à sa mise à jour ; il
    faut exactement l'un des deux.
    """

    identifier: LoginIdentifier | None = None
    email: EmailAddress | None = Field(
        default=None,
        deprecated=True,
        description=(
            "Ancienne forme : adresse e-mail seule. Préférer `identifier`, qui "
            "accepte aussi le nom d'utilisateur."
        ),
    )
    password: SubmittedPassword

    # `email` est lu par `__dict__` : l'attribut, déclaré obsolète, lèverait un
    # `DeprecationWarning` à chaque connexion par une coquille v1.1.0.

    @model_validator(mode="after")
    def _one_identifier(self) -> Self:
        if (self.identifier is None) == (self.__dict__["email"] is None):
            raise ValueError(
                "Fournir exactement un champ parmi `identifier` et `email`."
            )
        if self.identifier == "":
            raise ValueError("`identifier` ne peut pas être vide.")
        return self

    @property
    def login(self) -> str:
        """L'identifiant saisi, quel que soit le champ qui l'a porté."""
        if self.identifier is not None:
            return self.identifier
        return str(self.__dict__["email"])


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
    display_name: str | None = Field(
        default=None,
        description=(
            "Nom à afficher dans les comptes-rendus de tournoi (v1.2.2), rogné, "
            "1 à 64 caractères ; nul s'il n'a pas été choisi. Se règle par "
            "`PATCH /moi`."
        ),
    )


# ---------------------------------------------------------------------------
# v1.2.2 : nom à afficher (`docs/v1.2.2-plan.md`, A9, A10)
# ---------------------------------------------------------------------------


def blank_to_none(value: str | None) -> str | None:
    """Une saisie vide (déjà rognée) devient nulle : « rien » n'a qu'une forme
    en base."""
    return value or None


DISPLAY_NAME_RULE = (
    "Une seule ligne : aucun caractère de contrôle (saut de ligne, tabulation…)."
)


def single_line(value: str | None) -> str | None:
    """Refuse tout caractère de contrôle (catégorie Unicode `Cc`) d'un nom
    déjà rogné : le nom tient sur une ligne de table (v1.2.2, A9). Les sauts de
    ligne et tabulations de bord sont partis avec le rognage ; ceux du milieu
    restent et font refuser la saisie."""
    if value is not None and any(unicodedata.category(c) == "Cc" for c in value):
        raise ValueError(DISPLAY_NAME_RULE)
    return value


DisplayName = Annotated[
    Annotated[
        str,
        StringConstraints(strip_whitespace=True, max_length=DISPLAY_NAME_MAX_LENGTH),
    ]
    | None,
    AfterValidator(single_line),
    AfterValidator(blank_to_none),
]
"""Nom à afficher saisi : rogné de ses espaces de bord, puis 64 caractères au
plus et sur une seule ligne, sans caractère de contrôle. Le rognage précède
les contrôles, comme pour `RequiredText` ; une chaîne vide ou blanche devient
`None`, comme `null`, qui efface le nom."""


class UserUpdate(WriteModel):
    """Corps de `PATCH /moi` (A10) : modification partielle du compte.

    Un seul champ aujourd'hui, `display_name`. Omis, il ne change pas ; `null`,
    vide ou blanc, il efface le nom. Tout autre champ (`username`, `email`,
    `role`…) rend 422 (`extra="forbid"`) : aucune route ne modifie l'identité
    de connexion ni le rôle.
    """

    display_name: DisplayName = Field(
        default=None,
        description=(
            "Nom à afficher dans les comptes-rendus, rogné, 64 caractères au "
            "plus, sur une seule ligne : un caractère de contrôle (catégorie "
            "Unicode `Cc`, saut de ligne et tabulation compris) restant après "
            "le rognage rend 422. `null`, une chaîne vide ou blanche l'efface ; "
            "omis, il ne change pas."
        ),
    )


# ---------------------------------------------------------------------------
# Lot 12 : mot de passe et sessions (`docs/lot12-plan-consolidation.md`, A1)
# ---------------------------------------------------------------------------


class PasswordChange(WriteModel):
    """Corps de `POST /moi/mot-de-passe`.

    L'actuel est un `SubmittedPassword`, sans règle de complexité, comme à la
    connexion : un secret posé sous une règle plus ancienne doit pouvoir être
    remplacé. Le nouveau suit la règle de l'inscription. Un actuel faux rend
    **422**, jamais 401 : le client lit un 401 comme une session perdue (pause
    du moteur de sync, bandeau de reconnexion), alors que la session est
    intacte.
    """

    current_password: SubmittedPassword
    new_password: NewPassword


class SessionRead(ReadModel):
    """Une session ouverte du compte : `GET /moi/sessions` (P1).

    Ni jeton ni empreinte. `user_agent` est l'en-tête brut noté à la
    connexion : le client en tire le libellé lisible (« Chrome sur Android »),
    qui aide à reconnaître un appareil sans rien prouver.
    """

    id: int
    created_at: datetime = Field(description="Ouverture de la session, en UTC.")
    last_used_at: datetime = Field(
        description=(
            "Dernière utilisation notée, au jour près (le renouvellement l'écrit "
            "au plus une fois par jour) ; égale à `created_at` pour une session "
            "jamais renouvelée."
        )
    )
    expires_at: datetime = Field(
        description=(
            "Échéance du moment, en UTC : repoussée à l'usage (14 jours sans "
            "usage), jamais au-delà de 90 jours après l'ouverture."
        )
    )
    user_agent: str | None = Field(
        default=None,
        description=(
            "En-tête `User-Agent` de la connexion qui a ouvert la session, coupé "
            "à 256 caractères ; nul pour une session ouverte avant le Lot 12 ou "
            "sans en-tête (« appareil inconnu »)."
        ),
    )
    current: bool = Field(
        description=(
            "Vrai pour la session de la requête, et pour elle seule. Elle se "
            "ferme par `POST /deconnexion`, jamais par `DELETE /moi/sessions/{id}`."
        )
    )
