"""Résolution des désignations d'une ressource (Lot 7, B2).

Une écriture désigne le lieu, le tournoi, chaque joueur et chaque deck par une
référence (`app.schemas.refs`) : un identifiant serveur, ou la `client_ref` d'un
objet créé hors ligne. Ce module est commun aux routes en ligne et à `/sync`
(B3), pour qu'un refus ait la même cause et le même message des deux côtés.

* **Chaque ressource désignée est chargée en la limitant au compte** : celle d'un
  autre compte rend 404, avec le message d'un identifiant inconnu. Sans ce
  chargement, c'est la clé étrangère composite qui refuserait, par un 409
  trompeur qui révélerait l'existence de la ressource.
* **Une `client_ref` en ligne est refusée (422)** : le client n'écrit que par la
  file, et seule `/sync` connaît les références qu'il a créées. `/sync` passe
  `allow_client_ref=True`.
* **Une référence se résout au journal, par genre** : une référence de deck
  passée là où l'on attend un tournoi ne désigne rien (A10). Seules comptent les
  créations **appliquées** : une création refusée laisse sa trace sans réserver
  la référence.
* **Tout se résout avant la première écriture** : un refus de désignation ne
  laisse donc rien derrière lui.
"""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Deck, Player, SyncOperation, Tournament, Venue
from app.models.enums import SyncOperationStatus, SyncResourceKind
from app.schemas.refs import (
    DeckRef,
    GameRef,
    ParticipantRef,
    PlayerRef,
    TournamentRef,
    VenueRef,
)
from app.services import players
from app.services.errors import DomainError, InvalidRequestError, NotFoundError

_JOURNAL_COLUMN = {
    SyncResourceKind.DECK: SyncOperation.deck_id,
    SyncResourceKind.PLAYER: SyncOperation.player_id,
    SyncResourceKind.VENUE: SyncOperation.venue_id,
    SyncResourceKind.TOURNAMENT: SyncOperation.tournament_id,
    SyncResourceKind.GAME: SyncOperation.game_id,
}

_NOUN = {
    SyncResourceKind.DECK: "deck",
    SyncResourceKind.PLAYER: "joueur",
    SyncResourceKind.VENUE: "lieu",
    SyncResourceKind.TOURNAMENT: "tournoi",
    SyncResourceKind.GAME: "partie",
}


class UnresolvedClientRef(DomainError):
    """La ressource désignée par une référence client n'a jamais été créée (ou
    sa création a été refusée). Verdict `unresolved_client_ref` de `/sync`."""

    status_code = 404


def applied_creation(
    db: Session, user_id: int, client_ref: str, kind: SyncResourceKind | None = None
) -> SyncOperation | None:
    """La création **appliquée** qui a donné son identité à cette référence, pour
    ce compte et, si `kind` est donné, pour ce genre de ressource.

    Une `client_ref` d'un autre compte ne compte pas : elle se comporte comme
    une référence inconnue (Lot 6, §11). Sans `kind`, c'est la recherche
    d'une référence déjà prise, quel que soit son genre : l'index unique
    partiel du journal vaut pour tous les genres à la fois.
    """
    stmt = select(SyncOperation).where(
        SyncOperation.user_id == user_id,
        SyncOperation.client_ref == client_ref,
        SyncOperation.status == SyncOperationStatus.APPLIED,
    )
    if kind is not None:
        stmt = stmt.where(SyncOperation.resource_kind == kind)
    return db.scalars(stmt).one_or_none()


def designation(entry: SyncOperation) -> str:
    """La ressource que cette création a désignée, pour un message : « le deck
    12 », « la partie 4 »."""
    kind = entry.resource_kind
    if kind not in _JOURNAL_COLUMN:
        return "une ressource"
    article = "la" if kind is SyncResourceKind.GAME else "le"
    ident = getattr(entry, _JOURNAL_COLUMN[kind].key)
    return f"{article} {_NOUN[kind]} {ident}"


def resolve_client_ref(
    db: Session, user_id: int, client_ref: str, kind: SyncResourceKind
) -> int:
    """Identifiant serveur de la ressource de ce genre créée sous cette
    référence, ou `UnresolvedClientRef`."""
    creation = applied_creation(db, user_id, client_ref, kind)
    column = _JOURNAL_COLUMN[kind].key
    resolved = None if creation is None else getattr(creation, column)
    if resolved is None:
        feminine = kind is SyncResourceKind.GAME
        raise UnresolvedClientRef(
            f"{'Aucune' if feminine else 'Aucun'} {_NOUN[kind]} n'a été "
            f"{'créée' if feminine else 'créé'} sous la référence client "
            f"{client_ref!r} (création absente du journal, ou refusée)."
        )
    return resolved


def _id_of(
    db: Session,
    user_id: int,
    kind: SyncResourceKind,
    identifier: int | None,
    client_ref: str | None,
    allow_client_ref: bool,
    loc: tuple[str, ...],
) -> int:
    if client_ref is None:
        assert identifier is not None  # « exactement une désignation », schéma
        return identifier
    if not allow_client_ref:
        raise InvalidRequestError(
            f"Une référence client ne s'emploie que par la synchronisation : "
            f"désigner le {_NOUN[kind]} par son identifiant.",
            loc=(*loc, "client_ref"),
        )
    return resolve_client_ref(db, user_id, client_ref, kind)


def _loader(db: Session, user_id: int, model, article: str, ident: int):
    row = db.scalar(select(model).where(model.id == ident, model.user_id == user_id))
    if row is None:
        raise NotFoundError(f"{article} {ident} introuvable.")
    return row


def resolve_venue(
    db: Session,
    user_id: int,
    ref: VenueRef | None,
    *,
    allow_client_ref: bool = False,
    loc: tuple[str, ...] = ("body", "venue"),
) -> Venue | None:
    """Le lieu du compte désigné, `None` si `ref` est `None`."""
    if ref is None:
        return None
    ident = _id_of(
        db,
        user_id,
        SyncResourceKind.VENUE,
        ref.venue_id,
        ref.client_ref,
        allow_client_ref,
        loc,
    )
    return _loader(db, user_id, Venue, "Lieu", ident)


def resolve_tournament(
    db: Session,
    user_id: int,
    ref: TournamentRef | None,
    *,
    allow_client_ref: bool = False,
    loc: tuple[str, ...] = ("body", "tournament"),
) -> Tournament | None:
    """Le tournoi du compte désigné, `None` si `ref` est `None`."""
    if ref is None:
        return None
    ident = _id_of(
        db,
        user_id,
        SyncResourceKind.TOURNAMENT,
        ref.tournament_id,
        ref.client_ref,
        allow_client_ref,
        loc,
    )
    return _loader(db, user_id, Tournament, "Tournoi", ident)


def resolve_deck(
    db: Session,
    user_id: int,
    ref: DeckRef,
    *,
    allow_client_ref: bool = False,
    loc: tuple[str, ...] = ("body", "deck"),
) -> Deck:
    """Le deck du compte désigné, supprimé ou non (le refus d'un deck supprimé
    dépend de la ligne, A8 : c'est l'affaire de l'appelant)."""
    ident = _id_of(
        db,
        user_id,
        SyncResourceKind.DECK,
        ref.deck_id,
        ref.client_ref,
        allow_client_ref,
        loc,
    )
    return _loader(db, user_id, Deck, "Deck", ident)


def resolve_game_id(
    db: Session,
    user_id: int,
    ref: GameRef,
    *,
    allow_client_ref: bool = False,
    loc: tuple[str, ...] = ("body", "game"),
) -> int:
    """Identifiant de la partie désignée (existence vérifiée par le service de
    la partie, qui la charge pour le compte)."""
    return _id_of(
        db,
        user_id,
        SyncResourceKind.GAME,
        ref.game_id,
        ref.client_ref,
        allow_client_ref,
        loc,
    )


def resolve_player(
    db: Session,
    user_id: int,
    ref: ParticipantRef | PlayerRef,
    *,
    allow_client_ref: bool = False,
    loc: tuple[str, ...] = ("body", "player"),
) -> Player:
    """Le joueur désigné : `{"me": true}` donne le « Moi » du compte (créé au
    besoin, sans valider : l'appelant garde la transaction)."""
    if isinstance(ref, ParticipantRef) and ref.me:
        return players.get_or_create_me(db, user_id)
    ident = _id_of(
        db,
        user_id,
        SyncResourceKind.PLAYER,
        ref.player_id,
        ref.client_ref,
        allow_client_ref,
        loc,
    )
    return _loader(db, user_id, Player, "Joueur", ident)
