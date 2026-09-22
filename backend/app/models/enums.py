"""Énumérations métier réellement fermées.

Règle : une valeur n'a sa place ici que si la liste est **close et connue**.
Tout ce qui est encore ouvert (les langues, cf. CLAUDE.md §11 point 2 ; les
lieux ; les clans du catalogue VEKN) reste une table de référence dans
`app.models.reference`, pas une énumération figée dans le code.
"""

from enum import StrEnum

from sqlalchemy import Enum as SAEnum


def enum_column(enum_cls: type[StrEnum], name: str) -> SAEnum:
    """Type colonne pour une `StrEnum`.

    `native_enum=False` + `create_constraint=True` produit un `VARCHAR` assorti
    d'une contrainte `CHECK ... IN (...)` nommée (portable SQLite/Postgres) :
    la liste fermée est alors garantie par la base, pas seulement par le code.
    `values_callable` stocke la *valeur* des membres et non leur nom, pour que
    le contenu de la base reste lisible et identique à ce que voit le front via
    l'OpenAPI.
    """
    return SAEnum(
        enum_cls,
        name=name,
        native_enum=False,
        create_constraint=True,
        validate_strings=True,
        values_callable=lambda members: [member.value for member in members],
    )


class CardCategory(StrEnum):
    """Les deux moitiés d'un deck VtES (CLAUDE.md §5)."""

    CRYPT = "crypt"
    LIBRARY = "library"


class CostType(StrEnum):
    """Nature du coût d'une carte de library.

    krcg n'expose qu'un coût par carte (`{"type": ..., "value": ...}`) : une
    carte ne coûte jamais à la fois du sang et du pool.
    """

    POOL = "pool"
    BLOOD = "blood"
    CONVICTION = "conviction"


class DisciplineRequirement(StrEnum):
    """Manière dont une carte de library combine ses disciplines requises.

    `MONO` : une seule discipline (ou aucune). `CHOICE` : l'une au choix
    parmi plusieurs. `COMBO` : toutes exigées ensemble. Remplace le champ
    textuel brut qu'imposaient les CSV, où « / » et « & » portaient cette
    nuance.
    """

    MONO = "mono"
    CHOICE = "choice"
    COMBO = "combo"


class PrintOccurrence(StrEnum):
    """Manière dont une carte apparaît dans une extension.

    Les trois cas sont disjoints dans le catalogue krcg et n'utilisent pas les
    mêmes champs : `RARITY` porte une fréquence et un multiplicateur (booster),
    `PRECON` un produit et un nombre d'exemplaires, `SINGLE` une date de mise
    en vente (promo, impression à la demande).
    """

    RARITY = "rarity"
    PRECON = "precon"
    SINGLE = "single"


class DeckStatus(StrEnum):
    """Avancement d'un deck côté joueur : brouillon ou jouable.

    Volontairement réduit à deux valeurs. « Rangé » et « supprimé » ne sont pas
    des statuts mais des dates (`deck.archived_at`, `deck.deleted_at`) : un deck
    archivé garde le statut qu'il avait, et le désarchiver ne demande donc pas
    de deviner lequel.
    """

    DRAFT = "draft"
    ACTIVE = "active"


class DeckPolicy(StrEnum):
    """Contrainte de deck d'un tournoi (CLAUDE.md §5, « mono / multi-deck »)."""

    MONO = "mono"
    MULTI = "multi"


class TournamentFormat(StrEnum):
    """Format de tournoi.

    [à confirmer] La liste des formats sanctionnés VEKN dépasse peut-être
    construit/draft ; `OTHER` sert de soupape en attendant vérification.
    """

    CONSTRUCTED = "constructed"
    DRAFT = "draft"
    OTHER = "other"


class RoundType(StrEnum):
    """Nature d'une partie dans un tournoi (ou hors tournoi)."""

    CASUAL = "casual"
    PRELIMINARY = "preliminary"
    FINAL = "final"


class SyncOperationType(StrEnum):
    """Écritures qu'une file hors ligne peut rejouer par `POST /sync` (Lot 3).

    Une valeur par intention de l'utilisateur, limitée aux ressources qui
    existent déjà : collection, decks, composition, versement d'un produit. Le
    catalogue reste en lecture seule (il ne bouge que par l'import, CLAUDE.md
    §11) et les parties, tournois et participations attendent le Lot 4 — les
    ajouter ici avant qu'elles aient une route serait promettre une
    synchronisation sans destination.

    Les langues n'y sont pas non plus : `POST /langues` reste une écriture en
    ligne. Une saisie hors ligne dans une langue inconnue du serveur doit se
    rabattre sur « XX » (autre), cf. le point ouvert du rapport de lot.

    Deux nuances de vocabulaire par rapport aux routes REST :

    * `stock.upsert` et `deck_card.upsert` créent **ou** remplacent l'entrée,
      là où REST distingue `POST` et `PATCH`. Une file rejouée n'a pas de
      garantie sur ce que le serveur possède déjà ; l'upsert rend l'ordre des
      opérations indifférent et la charge utile porte l'état complet voulu.
    * il n'y a pas d'opération d'archivage : archiver, c'est `deck.update` avec
      `archived`, exactement comme `PATCH /decks/{id}`.
    """

    STOCK_UPSERT = "stock.upsert"
    STOCK_DELETE = "stock.delete"
    DECK_CREATE = "deck.create"
    DECK_UPDATE = "deck.update"
    DECK_DELETE = "deck.delete"
    DECK_CARD_UPSERT = "deck_card.upsert"
    DECK_CARD_DELETE = "deck_card.delete"
    BUNDLE_DEPOSIT = "bundle.deposit"


class SyncOperationStatus(StrEnum):
    """Verdict rendu par le serveur sur une opération, tel qu'il est journalisé.

    Deux valeurs seulement : une opération a été appliquée, ou refusée. Le
    « rejouée » que voit le client (`SyncOutcome`) n'est pas un état stocké
    mais la façon dont le journal a répondu — le verdict mémorisé, lui, reste
    l'un de ces deux-là.
    """

    APPLIED = "applied"
    REJECTED = "rejected"


class SyncErrorCode(StrEnum):
    """Motif de refus d'une opération, lisible par la machine.

    Les trois premiers reprennent les erreurs métier des services
    (`app.services.errors`), qui restent la seule autorité sur les règles :
    `not_found` ← `NotFoundError`, `conflict` ← `ConflictError`, `invalid` ←
    `InvalidRequestError`. Les deux derniers sont propres à la
    synchronisation.
    """

    NOT_FOUND = "not_found"
    CONFLICT = "conflict"
    INVALID = "invalid"
    UNRESOLVED_CLIENT_REF = "unresolved_client_ref"
    MISMATCHED_REPLAY = "mismatched_replay"


class SyncResourceKind(StrEnum):
    """Nature de la ressource touchée par une opération de synchronisation."""

    CARD_COPY = "card_copy"
    DECK = "deck"
    DECK_CARD = "deck_card"
    BUNDLE = "bundle"
