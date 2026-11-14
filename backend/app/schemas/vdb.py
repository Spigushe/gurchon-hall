"""Schémas du Lot 9 : un deck lu chez VDB, et l'identifiant qui le désigne.

VDB (`vdb.im`, `github.com/smeea/vdb`) est le deckbuilder où l'utilisateur
construit ses decks. Le Lot 9 en importe un de deux façons
(`docs/lot9-plan-import-vdb.md`, P1) : une liste (texte, fichier, URL qui
porte la liste) se lit et s'apparie dans le navigateur, hors ligne, sans rien
demander au serveur ; l'**adresse d'un deck** (`vdb.im/decks/<id>`) se lit par
le serveur, en ligne, à `GET /vdb/decks/{vdb_deck_id}` (P3, A7). Le serveur
relaie la liste telle que l'API de VDB la rend, par identifiant VEKN : il ne
crée aucun deck et n'apparie aucun nom. Le deck s'écrit ensuite par la file
`/sync`, comme toute saisie, et garde l'identifiant (`DeckCreate.vdb_deck_id`)
pour se mettre à jour depuis VDB.
"""

from datetime import datetime
from typing import Annotated

from pydantic import Field, StringConstraints

from app.schemas.base import MAX_DB_INT, ReadModel

VDB_DECK_ID_PATTERN = r"^[A-Za-z0-9:_-]{1,64}$"
"""Motif fermé d'un identifiant de deck VDB (A7, confirmé à A1).

Relevé sur les trois genres de deck que VDB sert le 2026-11-13 : neuf
caractères hexadécimaux pour un deck d'utilisateur (`4fc0ee5e9`), un nombre
pour un deck de la TWDA (`12761`), `extension:précon` pour un précon
(`SV5:PCaine`). Le tiret et le soulignement couvrent les précons de promo.

Le motif ferme la porte à tout ce qui ferait sortir la route de l'adresse que
le code fixe (`https://vdb.im/api/deck/<id>`) : ni `/`, ni `.`, ni `?`, ni
`#`, ni `%`. Le même motif valide le chemin de la route et le champ
`vdb_deck_id` de `DeckCreate`, et le client le reprend pour reconnaître une
adresse (`parseVdbUrl`) avant de rien envoyer.
"""

VDB_DECK_ID_MAX_LENGTH = 64

VDB_DECK_ID_DESCRIPTION = (
    "Identifiant d'un deck VDB, celui de son adresse `https://vdb.im/decks/<id>` "
    "(neuf caractères pour un deck d'utilisateur, un nombre pour un deck de la "
    "TWDA, `extension:précon` pour un précon). Lettres, chiffres, `:`, `-` et "
    "`_`, 64 caractères au plus."
)

VdbDeckId = Annotated[
    str,
    StringConstraints(
        pattern=VDB_DECK_ID_PATTERN, max_length=VDB_DECK_ID_MAX_LENGTH
    ),
    Field(description=VDB_DECK_ID_DESCRIPTION),
]
"""Identifiant de deck VDB en écriture. Jamais rogné : le client envoie
l'identifiant qu'il a lu dans l'adresse ou que la route lui a rendu, et une
espace n'y a pas sa place."""


class VdbDeckCardRead(ReadModel):
    """Une carte d'un deck VDB : identifiant VEKN et nombre d'exemplaires.

    Crypte et bibliothèque mêlées, comme VDB les rend. Un identifiant inconnu
    du catalogue est relayé tel quel : c'est le navigateur qui le signale à
    l'appariement (règle 1 de P4).
    """

    vekn_id: int = Field(
        ge=1, le=MAX_DB_INT, description="Identifiant VEKN (`CardRead.vekn_id`)."
    )
    quantity: int = Field(
        ge=1, le=MAX_DB_INT, description="Nombre d'exemplaires dans le deck."
    )


class VdbDeckRead(ReadModel):
    """Un deck tel que l'API de VDB le rend, réduit aux champs communs aux
    trois genres de deck (d'utilisateur, de la TWDA, précon).

    Les étiquettes de VDB (`tags`) ne sont pas reprises : l'archétype se
    choisit à l'import (P7). Rien n'est stocké : la route relaie une lecture.
    """

    vdb_deck_id: str = Field(
        description=(
            "Identifiant du deck tel que VDB le rend (`deckid`), à garder dans "
            "`DeckCreate.vdb_deck_id`. " + VDB_DECK_ID_DESCRIPTION
        )
    )
    name: str = Field(description="Nom du deck chez VDB.")
    author: str | None = Field(
        default=None, description="Auteur déclaré chez VDB, nul s'il est vide."
    )
    description: str | None = Field(
        default=None,
        description=(
            "Description du deck, telle quelle (plusieurs lignes, Markdown "
            "possible), nulle si elle est vide. Pour un deck de la TWDA, VDB y "
            "compose la date, le nombre de joueurs, l'événement et le lieu."
        ),
    )
    cards: list[VdbDeckCardRead] = Field(
        default=[],
        description="Les cartes du deck, par identifiant VEKN croissant.",
    )
    fetched_at: datetime = Field(
        description="Instant (UTC) où le serveur a lu le deck chez VDB."
    )
