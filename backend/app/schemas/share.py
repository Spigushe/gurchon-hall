"""Schémas du Lot 13 : liens publics vers une decklist (`docs/lot13-plan-partage.md`).

Cinq opérations (A1) : lister et créer les liens d'un deck
(`/decks/{id}/partages`), lister et purger tous les liens du compte
(`/moi/partages`), et lire une liste partagée sans session
(`GET /listes/{token}`). Aucun `user_id` dans aucun corps : le propriétaire
vient de la session, et la page publique ne dit du compte que son nom
d'utilisateur (P2).

Ce que ces schémas tiennent (la forme seulement, les règles sont au service) :

* un jeton de huit caractères de `[A-Za-z0-9_]`, casse comprise (P3) ;
* `deck_version_number` réservé à un lien figé (P1), refusé en 422 sur un
  vivant ;
* `share_id` réservé à la purge `selected`, de 1 à 200 (P5), contrôlé par la
  route.
"""

from datetime import datetime
from enum import StrEnum

from pydantic import Field, model_validator

from app.models.enums import DeckArchetype, DeckShareKind
from app.models.share import SHARE_TOKEN_LENGTH
from app.schemas.base import MAX_DB_INT, ReadModel, WriteModel
from app.schemas.catalog import CardSearchItem
from app.schemas.collection import ARCHETYPE_DESCRIPTION

SHARE_TOKEN_PATTERN = rf"^[A-Za-z0-9_]{{{SHARE_TOKEN_LENGTH}}}$"
"""Motif d'un jeton de lien (P3) : huit caractères parmi 63, sans repli de
casse. Un jeton hors motif rend 422 avant toute lecture."""

SHARE_TOKEN_DESCRIPTION = (
    "Jeton du lien, huit caractères parmi les lettres des deux casses, les "
    "chiffres et `_` (`aB3x_9pQ`). La casse compte. Il est l'adresse publique "
    "de la liste (`#/liste/<jeton>` côté client) : quiconque le connaît la lit."
)

PURGE_MAX_SHARES = 200
"""Plafond d'une purge `selected` (A1), comme une page de `GET /cartes`."""

KIND_DESCRIPTION = (
    "`live` : le lien suit le deck, la page montre sa composition au moment de "
    "la lecture. `frozen` : la page montre la liste copiée à la création du "
    "lien, avec le nom, l'archétype et les notes de ce moment."
)


class SharePurgeScope(StrEnum):
    """Portée d'une purge de liens (P5), seul moyen de révoquer un lien.

    `SELECTED` : les liens désignés par `share_id`, decks supprimés compris.
    `DELETED_DECKS` : les liens figés survivants des decks
    supprimés (leurs vivants sont tombés avec le deck). `ALL` : tous les liens
    du compte.
    """

    SELECTED = "selected"
    DELETED_DECKS = "deleted_decks"
    ALL = "all"


class DeckShareCreate(WriteModel):
    """Corps de `POST /decks/{id}/partages` : un lien neuf (P1, P2).

    Le nom du deck, son archétype et le nom d'utilisateur sont montrés sur
    tout lien, sans option ; seules les notes se choisissent. Pour figer une
    version jouée (Lot 8) plutôt que la liste courante, `deck_version_number`
    la désigne.
    """

    kind: DeckShareKind = Field(description=KIND_DESCRIPTION)
    show_notes: bool = Field(
        default=False,
        description=(
            "Montre les notes sur la page publique : celles du deck, lues à "
            "chaque consultation pour un vivant, copiées à la création pour un "
            "figé. Faux par défaut, les notes pouvant porter des remarques "
            "privées."
        ),
    )
    deck_version_number: int | None = Field(
        default=None,
        ge=1,
        le=MAX_DB_INT,
        description=(
            "Numéro de la version jouée à figer (« v3 »), pour un lien `frozen` "
            "seulement ; omis ou nul, le figé copie la liste courante du deck. "
            "422 sur un lien `live`, 404 pour un numéro que le deck n'a pas."
        ),
    )

    @model_validator(mode="after")
    def _version_only_when_frozen(self) -> DeckShareCreate:
        if self.kind is DeckShareKind.LIVE and self.deck_version_number is not None:
            raise ValueError(
                "deck_version_number ne vaut que pour un lien figé (`frozen`) : "
                "un lien vivant suit la liste courante du deck."
            )
        return self


class SharedDeckState(ReadModel):
    """Le deck d'un lien, tel que son propriétaire le voit (écran Compte, P5).

    `deleted_at` dit au client de ranger à part les liens d'un deck supprimé,
    qui se purgent aussi à l'unité (P5 amendée à F).
    """

    id: int
    name: str = Field(description="Nom actuel du deck.")
    discriminator: str = Field(
        description="Discriminant du deck, à coller au nom (« Banu Princes#1234 »)."
    )
    archived_at: datetime | None = Field(
        default=None, description="Instant d'archivage (UTC), nul sinon."
    )
    deleted_at: datetime | None = Field(
        default=None,
        description=(
            "Instant de suppression logique (UTC), nul sinon. Un deck supprimé "
            "ne garde que ses liens figés."
        ),
    )


class DeckShareRead(ReadModel):
    """Un lien du compte, avec son jeton, pour son propriétaire seulement.

    Rendu par `POST /decks/{id}/partages`, `GET /decks/{id}/partages` et
    `GET /moi/partages`. Le jeton est en clair (P3) : le propriétaire peut
    recopier son lien à tout moment.
    """

    id: int
    token: str = Field(description=SHARE_TOKEN_DESCRIPTION)
    kind: DeckShareKind = Field(description=KIND_DESCRIPTION)
    show_notes: bool = Field(description="Vrai si la page publique montre les notes.")
    created_at: datetime = Field(
        description="Création du lien (UTC) ; pour un figé, date de la liste copiée."
    )
    frozen_name: str | None = Field(
        default=None,
        description=(
            "Nom du deck copié à la création d'un figé, celui que montre la page "
            "publique ; nul pour un vivant, qui montre le nom actuel du deck."
        ),
    )
    deck_version_number: int | None = Field(
        default=None,
        description=(
            "Numéro de la version jouée qu'un figé a copiée (« v3 ») ; nul pour "
            "un vivant et pour un figé de la liste courante."
        ),
    )
    deck: SharedDeckState


class SharePurgeResult(ReadModel):
    """Réponse de `DELETE /moi/partages` : le nombre de liens purgés."""

    revoked: int = Field(
        ge=0,
        description=(
            "Liens supprimés par la purge. 0 au second appel d'une purge "
            "`deleted_decks` ou `all`, qui sont idempotentes."
        ),
    )


class SharedDeckCardRead(ReadModel):
    """Une carte d'une liste partagée, avec sa quantité totale.

    La carte entière (`CardSearchItem`, la forme de `GET /cartes`) : la page
    publique n'a pas de miroir du catalogue, et en tire seule ses tableaux et
    ses exports.
    """

    card: CardSearchItem
    quantity: int = Field(
        ge=1, description="Exemplaires, toutes impressions confondues."
    )


class SharedDecklistRead(ReadModel):
    """Une liste partagée, lue sans session par `GET /listes/{token}` (P2).

    Jamais : langue, extension, proxies, disponibilités, versions, parties, ni
    rien de la collection. Pour un vivant, nom, archétype, notes et cartes sont
    ceux du deck au moment de la lecture ; pour un figé, ceux copiés à la
    création du lien.
    """

    name: str = Field(description="Nom du deck, sans son discriminant.")
    archetype: DeckArchetype | None = Field(
        default=None, description=ARCHETYPE_DESCRIPTION
    )
    kind: DeckShareKind = Field(description=KIND_DESCRIPTION)
    frozen_at: datetime | None = Field(
        default=None,
        description="Date de la liste copiée (UTC) pour un figé ; nul pour un vivant.",
    )
    author: str = Field(
        description=(
            "Nom d'utilisateur du propriétaire (son handle public), toujours "
            "montré et lu à la consultation."
        )
    )
    notes: str | None = Field(
        default=None,
        description=(
            "Notes du deck (copiées pour un figé), si le lien les montre ; nul "
            "sinon."
        ),
    )
    cards: list[SharedDeckCardRead] = Field(
        default=[],
        description=(
            "Carte × quantité totale, langues et extensions confondues, par "
            "identifiant de carte croissant. Vide pour un deck sans carte."
        ),
    )
    reprinted_card_ids: list[int] = Field(
        default=[],
        description=(
            "Identifiants (`card.id`) des cartes de crypte non *advanced* de la "
            "liste dont le nom est porté par une autre carte de crypte non "
            "*advanced* du catalogue, de plus petit identifiant VEKN : la "
            "version récente d'un vampire réimprimé, que l'export marque de son "
            "groupe (« (G6) »), comme VDB. Triés par identifiant croissant."
        ),
    )
