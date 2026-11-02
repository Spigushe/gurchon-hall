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


class EventTier(StrEnum):
    """Niveau d'un tournoi, au sens où le règlement VEKN le distingue (Lot 7, A11).

    Le niveau ne sert qu'à une règle : le multi-deck est interdit en championnat
    national, en Grand Prix et en championnat continental (VEKN 3.1.5, CLAUDE.md
    §5). Tout autre tournoi est `standard`, valeur par défaut.
    """

    STANDARD = "standard"
    NATIONAL_CHAMPIONSHIP = "national_championship"
    GRAND_PRIX = "grand_prix"
    CONTINENTAL_CHAMPIONSHIP = "continental_championship"


class FinalDeckRule(StrEnum):
    """Règle du deck de finale d'un tournoi multi-deck (VEKN 3.1.5a, Lot 7, A11).

    Annoncée par l'organisateur avant la première ronde. `BEST_PERFORMING` : le
    deck de la meilleure ronde préliminaire, comparée par GW puis VP (le TP
    n'est pas suivi, CLAUDE.md §5). `FREE_CHOICE` : n'importe quel deck joué en
    préliminaires. Sans objet en mono-deck ; une colonne nulle dit que la règle
    n'est pas (encore) connue.
    """

    BEST_PERFORMING = "best_performing"
    FREE_CHOICE = "free_choice"


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


class UserRole(StrEnum):
    """Rôle d'un compte, par niveau d'accès croissant (Lot 6, décision P4).

    Patron repris de barrins-project (`apps/barrins_api/app/core/roles.py`) :
    une `StrEnum` dont chaque membre a un **niveau**, et toute autorisation se
    décide en comparant des niveaux (`role.level >= minimum.level`), jamais des
    noms. Deux niveaux seulement ici — les intermédiaires de Barrin
    (`moderator`, `ml_developer`) n'ont pas d'usage dans le pilote —, mais un
    rôle intermédiaire pourra s'insérer plus tard en renumérotant `level`,
    sans toucher aux dépendances qui comparent.

    Dans ce lot, `admin` ne sert qu'à `POST /langues`. Le rôle n'est jamais
    fourni par le client : le serveur pose `user` à l'inscription, et seul le
    script `manage_accounts.py set-role` le change.
    """

    USER = "user"
    ADMIN = "admin"

    @property
    def level(self) -> int:
        """Niveau d'accès du rôle : 1 pour `user`, 2 pour `admin`."""
        return _ROLE_LEVELS[self]


_ROLE_LEVELS: dict[UserRole, int] = {
    UserRole.USER: 1,
    UserRole.ADMIN: 2,
}


class SyncOperationType(StrEnum):
    """Écritures qu'une file hors ligne peut rejouer par `POST /sync` (Lot 3).

    Une valeur par intention de l'utilisateur : collection, decks, composition,
    versement d'un produit, et depuis le Lot 7 joueurs, lieux, tournois et
    parties. Le catalogue reste en lecture seule (il ne bouge que par l'import,
    CLAUDE.md §11). Les douze valeurs du Lot 7 sont entrées dans la contrainte
    de la base par la révision R10, avant que `/sync` sache les appliquer :
    élargir ce CHECK oblige à recréer le journal, et on ne le fait qu'une fois.
    Une participation n'a pas d'opération propre : la table d'une partie se
    remplace d'un bloc avec la partie (`game.create`, `game.update`).

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
    PLAYER_CREATE = "player.create"
    PLAYER_UPDATE = "player.update"
    PLAYER_DELETE = "player.delete"
    VENUE_CREATE = "venue.create"
    VENUE_UPDATE = "venue.update"
    VENUE_DELETE = "venue.delete"
    TOURNAMENT_CREATE = "tournament.create"
    TOURNAMENT_UPDATE = "tournament.update"
    TOURNAMENT_DELETE = "tournament.delete"
    GAME_CREATE = "game.create"
    GAME_UPDATE = "game.update"
    GAME_DELETE = "game.delete"


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
    PLAYER = "player"
    VENUE = "venue"
    TOURNAMENT = "tournament"
    GAME = "game"
