"""Comptes et sessions (Lot 6, `docs/lot6-plan-comptes.md`).

Deux tables, et c'est tout ce que le pilote demande pour sortir du
mono-utilisateur :

1. `UserAccount` — un compte. L'adresse e-mail est l'identifiant de connexion,
   le nom d'utilisateur un handle public ; l'un et l'autre sont uniques. Aucune
   vérification d'adresse ni désactivation : il n'y a pas d'envoi d'e-mail
   (P2), et la suppression ou la suspension de compte sont hors lot.
2. `AuthSession` — une session ouverte par une connexion. Le navigateur tient
   le jeton dans un cookie `HttpOnly` ; la base n'en garde que l'empreinte
   SHA-256. Révoquer, c'est supprimer la ligne (D1).

Toutes les données privées portent un `user_id` qui pointe `user_account.id`
(cf. `collection`, `play`, `reference.Venue`, `sync`). Ces clés étrangères n'ont
**pas** de `ON DELETE` : supprimer un compte, quand ce sera possible, passera
par un service explicite, pas par une cascade qui viderait une collection en
silence. Seules les sessions suivent leur compte en cascade — elles ne valent
rien sans lui.

**Le compte historique** (D6) a l'identifiant `LEGACY_ACCOUNT_ID` : la révision
qui crée ces tables l'insère, et la suivante lui rattache toutes les données
d'avant le Lot 6. Son mot de passe stocké, `UNUSABLE_PASSWORD_HASH`, n'est pas
une empreinte Argon2 : la vérification échoue toujours, et personne ne peut s'y
connecter tant que le script `manage_accounts.py claim-legacy` n'a pas posé un
vrai secret.
"""

from datetime import datetime, timedelta

from sqlalchemy import CheckConstraint, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, utcnow
from app.models.enums import UserRole, enum_column
from app.models.types import UtcDateTime

LEGACY_ACCOUNT_ID = 1
"""Identifiant du compte historique, propriétaire des données d'avant le Lot 6."""

LEGACY_USERNAME = "compte-historique"
LEGACY_EMAIL = "compte-historique@gurchon-hall.invalid"
"""Adresse provisoire du compte historique. Le domaine `.invalid` est réservé
(RFC 2606) : il ne peut appartenir à personne, et `email-validator` le refuse à
l'inscription — l'adresse ne peut donc être ni prise ni saisie par l'API."""

UNUSABLE_PASSWORD_HASH = "!"
"""Valeur d'un mot de passe inutilisable : n'est pas une chaîne PHC Argon2, donc
aucune vérification ne réussit contre elle (`verify_password` rend `False`)."""

EMAIL_MAX_LENGTH = 320
"""Plafond d'une adresse : 64 caractères de partie locale, `@`, 255 de domaine.
`email-validator` est plus strict (254 au total) ; la colonne garde la borne
historique, la plus large."""

USERNAME_MAX_LENGTH = 32
PASSWORD_HASH_MAX_LENGTH = 255
"""Une chaîne PHC Argon2id fait une centaine de caractères avec les coûts de
Barrin ; 255 laisse de la marge pour des coûts ou un sel plus longs."""

TOKEN_HASH_LENGTH = 64
"""SHA-256 en hexadécimal."""

SESSION_LIFETIME = timedelta(days=14)
"""Durée d'une session (D1, P3) : échéance **fixe**, posée à la connexion et
jamais repoussée. Pas d'expiration glissante, pas de plafond absolu distinct —
une requête authentifiée n'écrit donc rien dans `auth_session`."""


class UserAccount(Base, TimestampMixin):
    """Un compte.

    `email` est stocké **normalisé** (rogné, en minuscules sur toute
    l'adresse) : c'est la forme que produit le schéma d'entrée
    (`app.schemas.account.normalize_email`), à l'écriture comme à la recherche,
    pour que `A@x.fr` et `a@x.fr` désignent le même compte. L'unicité porte sur
    cette forme. `username`, lui, garde la casse saisie : c'est un nom affiché,
    et son unicité est sensible à la casse comme chez Barrin.
    """

    __tablename__ = "user_account"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(EMAIL_MAX_LENGTH), unique=True)
    username: Mapped[str] = mapped_column(String(USERNAME_MAX_LENGTH), unique=True)
    password_hash: Mapped[str] = mapped_column(String(PASSWORD_HASH_MAX_LENGTH))
    # Enum fermé porté par un CHECK nommé, comme les autres. `server_default` en
    # plus du défaut Python : une ligne insérée hors ORM (script, SQL à la main)
    # reçoit le rôle le moins privilégié, jamais `admin` par accident.
    role: Mapped[UserRole] = mapped_column(
        enum_column(UserRole, "user_role"),
        default=UserRole.USER,
        server_default=UserRole.USER.value,
    )

    sessions: Mapped[list[AuthSession]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )


class AuthSession(Base):
    """Une session ouverte par une connexion réussie.

    `token_hash` est la clé de recherche : le serveur hache le jeton reçu dans
    le cookie et cherche la ligne. Le jeton lui-même n'est jamais stocké — une
    copie de la base (sauvegarde, pièce jointe) ne donne aucune session
    utilisable. SHA-256 simple et non Argon2 : le jeton a 256 bits d'entropie,
    un hachage lent ne protégerait de rien (P1).

    Pas de `revoked_at` ni de `last_used_at` : révoquer, c'est supprimer la
    ligne, et l'échéance est fixe (`SESSION_LIFETIME`). Les sessions expirées ne
    servent plus à rien ; elles sont purgées à la connexion du compte et par le
    script de gestion des comptes.
    """

    __tablename__ = "auth_session"
    __table_args__ = (
        CheckConstraint("expires_at > created_at", name="expires_after_creation"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("user_account.id", ondelete="CASCADE"),
        index=True,
    )
    token_hash: Mapped[str] = mapped_column(String(TOKEN_HASH_LENGTH), unique=True)
    created_at: Mapped[datetime] = mapped_column(UtcDateTime(), default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(UtcDateTime())

    user: Mapped[UserAccount] = relationship(back_populates="sessions")
