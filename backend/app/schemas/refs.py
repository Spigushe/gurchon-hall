"""Désignations d'une ressource : identifiant serveur, ou référence client.

Une saisie faite hors ligne crée des objets qui n'ont pas encore d'`id`
serveur : un deck la veille, puis au club un lieu, un tournoi, un adversaire et
la partie qui les réunit. Le client leur donne une référence à lui, une
`client_ref`, que la création porte et que les écritures suivantes réemploient.
La correspondance `client_ref` → identifiant est mémorisée au journal de
synchronisation (`app.models.sync.SyncOperation`) et se résout par compte et
par genre de ressource : une référence de deck passée là où l'on attend un
tournoi ne désigne rien (Lot 7, A10).

`DeckRef` est né au Lot 3 dans `app.schemas.sync` ; il vit ici depuis le Lot 7,
parce que les schémas de partie (`app.schemas.play`) en ont besoin et que
`app.schemas.sync` les importe à son tour. `app.schemas.sync` le réexporte, et
son nom au contrat ne change pas.

Une `client_ref` ne se résout que par `/sync` : une écriture en ligne qui en
porte une est refusée (422, décision du 2026-10-29), le client en ligne
connaissant les identifiants et n'écrivant que par la file lorsqu'il ne les
connaît pas.
"""

from typing import Annotated, Literal, Self

from pydantic import Field, StringConstraints, model_validator

from app.schemas.base import MAX_DB_INT, WriteModel

ClientRef = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=64)
]
"""Référence qu'un client donne à un objet qu'il vient de créer hors ligne.

Un UUID est attendu, mais le contrat ne l'impose pas : ce qui compte est
qu'elle soit **unique et jamais réutilisée**, y compris entre deux
installations de l'application. Une référence déjà employée par une création
appliquée est refusée.
"""

_CLIENT_REF_DESCRIPTION = (
    "Référence donnée par le client à la ressource lors de sa création hors "
    "ligne. Résolue par le serveur, dans ce lot ou dans un lot antérieur."
)


def _exactly_one(ref: WriteModel, noun: str, *fields: str) -> None:
    given = [name for name in fields if getattr(ref, name) is not None]
    if len(given) != 1:
        choices = " ou ".join(f"`{name}`" for name in fields)
        raise ValueError(
            f"désigner {noun} par {choices}, exactement l'un d'eux "
            f"(reçu : {', '.join(given) or 'aucun'})."
        )


class DeckRef(WriteModel):
    """Désignation d'un deck : son identifiant serveur, ou sa référence client.

    Exactement l'un des deux. `deck_id` pour un deck que le client a déjà vu
    revenir du serveur ; `client_ref` pour un deck créé hors ligne, dont
    l'identifiant n'existe pas encore au moment où la file est constituée.
    """

    deck_id: int | None = Field(default=None, ge=1, le=MAX_DB_INT)
    client_ref: ClientRef | None = Field(
        default=None,
        description=(
            "Référence donnée par le client au deck lors de sa création hors "
            "ligne (`deck.create`). Résolue par le serveur, dans ce lot ou dans "
            "un lot antérieur."
        ),
    )

    @model_validator(mode="after")
    def _exactly_one_designation(self) -> Self:
        if (self.deck_id is None) == (self.client_ref is None):
            raise ValueError(
                "désigner le deck par `deck_id` (identifiant serveur) ou par "
                "`client_ref` (référence de création hors ligne), mais pas les "
                "deux ni aucun des deux."
            )
        return self


class PlayerRef(WriteModel):
    """Désignation d'un joueur : identifiant serveur ou référence client."""

    player_id: int | None = Field(default=None, ge=1, le=MAX_DB_INT)
    client_ref: ClientRef | None = Field(
        default=None, description=_CLIENT_REF_DESCRIPTION
    )

    @model_validator(mode="after")
    def _exactly_one_designation(self) -> Self:
        _exactly_one(self, "le joueur", "player_id", "client_ref")
        return self


class ParticipantRef(WriteModel):
    """Le joueur d'une ligne de table : moi, ou un joueur désigné.

    `{"me": true}` désigne le « Moi » du compte, que le serveur résout : le
    client n'a pas besoin de son identifiant pour saisir sa première partie,
    hors ligne compris. Un adversaire se désigne par `player_id`, ou par
    `client_ref` s'il a été créé hors ligne (`player.create`). Exactement l'un
    des trois.
    """

    me: Literal[True] | None = Field(
        default=None,
        description="Vrai pour désigner le « Moi » du compte ; à omettre sinon.",
    )
    player_id: int | None = Field(default=None, ge=1, le=MAX_DB_INT)
    client_ref: ClientRef | None = Field(
        default=None, description=_CLIENT_REF_DESCRIPTION
    )

    @model_validator(mode="after")
    def _exactly_one_designation(self) -> Self:
        _exactly_one(self, "le joueur", "me", "player_id", "client_ref")
        return self


class VenueRef(WriteModel):
    """Désignation d'un lieu : identifiant serveur ou référence client."""

    venue_id: int | None = Field(default=None, ge=1, le=MAX_DB_INT)
    client_ref: ClientRef | None = Field(
        default=None, description=_CLIENT_REF_DESCRIPTION
    )

    @model_validator(mode="after")
    def _exactly_one_designation(self) -> Self:
        _exactly_one(self, "le lieu", "venue_id", "client_ref")
        return self


class TournamentRef(WriteModel):
    """Désignation d'un tournoi : identifiant serveur ou référence client."""

    tournament_id: int | None = Field(default=None, ge=1, le=MAX_DB_INT)
    client_ref: ClientRef | None = Field(
        default=None, description=_CLIENT_REF_DESCRIPTION
    )

    @model_validator(mode="after")
    def _exactly_one_designation(self) -> Self:
        _exactly_one(self, "le tournoi", "tournament_id", "client_ref")
        return self


class GameRef(WriteModel):
    """Désignation d'une partie : identifiant serveur ou référence client."""

    game_id: int | None = Field(default=None, ge=1, le=MAX_DB_INT)
    client_ref: ClientRef | None = Field(
        default=None, description=_CLIENT_REF_DESCRIPTION
    )

    @model_validator(mode="after")
    def _exactly_one_designation(self) -> Self:
        _exactly_one(self, "la partie", "game_id", "client_ref")
        return self
