"""Liens publics vers une decklist (Lot 13, `docs/lot13-plan-partage.md`, A3).

Un lien désigne un deck par un jeton de huit caractères (P3), vivant (la page
montre le deck au moment de la lecture) ou figé (la page montre la liste copiée
à la création, dans `deck_share_card`, avec le nom, l'archétype et, si le lien
les montre, les notes de ce moment, P1 et P2). Une version jouée du Lot 8 se
partage en figé : sa liste est copiée, la version elle-même ne bouge jamais.

**Portée par compte.** Toute fonction du propriétaire prend `user_id` en
paramètre obligatoire, sans valeur par défaut. Un deck, un lien d'un autre
compte n'existe pas pour ce module : même 404, même message qu'un identifiant
inconnu. La seule fonction sans `user_id` est la lecture publique
(`read_shared_decklist`), qui ne connaît aucun compte et ne rend du propriétaire
que son nom d'utilisateur (P2).

**Cycle de vie (P5).** Un lien se purge, c'est le seul moyen de le révoquer
(`purge_shares`). Supprimer un deck retire ses liens vivants dans la transaction
de la suppression (`revoke_live_shares`) et garde ses figés. Ce module n'importe
pas `app.services.decks`, qui l'importe à son tour pour cette révocation.
"""

import secrets
from collections.abc import Callable, Iterable

from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app.db.folding import fold_text
from app.models import (
    Card,
    Deck,
    DeckCard,
    DeckShare,
    DeckShareCard,
    DeckShareKind,
    DeckVersion,
    DeckVersionCard,
    UserAccount,
)
from app.models.enums import CardCategory
from app.models.share import SHARE_TOKEN_ALPHABET, SHARE_TOKEN_LENGTH
from app.schemas.share import (
    DeckShareCreate,
    DeckShareRead,
    SharedDeckCardRead,
    SharedDecklistRead,
    SharedDeckState,
    SharePurgeScope,
)
from app.services import catalog
from app.services.errors import ConflictError, NotFoundError
from app.services.persistence import commit_or_conflict

SHARE_TOKEN_ATTEMPTS = 20
"""Essais avant de renoncer, quand la base refuse un jeton déjà pris (P3). Avec
63⁸ jetons, un seul suffit en pratique ; vingt est un plafond, comme pour le
discriminant d'un deck."""

SHARED_LIST_NOT_FOUND = "Liste introuvable."
"""Message unique de la lecture publique : jeton inconnu, purgé, ou lien vivant
d'un deck supprimé ne se distinguent pas."""

type TokenPicker = Callable[[], str]


def pick_token() -> str:
    """Un jeton au hasard : `SHARE_TOKEN_LENGTH` tirages de `secrets.choice`
    sur les 63 caractères de l'alphabet (P3)."""
    return "".join(
        secrets.choice(SHARE_TOKEN_ALPHABET) for _ in range(SHARE_TOKEN_LENGTH)
    )


# --------------------------------------------------------------------------
# Lectures du propriétaire
# --------------------------------------------------------------------------


def _get_deck(db: Session, user_id: int, deck_id: int) -> Deck:
    """Un deck du compte, supprimé compris ; 404 sinon, même message que
    `decks._get_deck` (§11, Lot 6)."""
    deck = db.get(Deck, deck_id)
    if deck is None or deck.user_id != user_id:
        raise NotFoundError(f"Deck {deck_id} introuvable.")
    return deck


def _share_read(share: DeckShare) -> DeckShareRead:
    deck = share.deck
    return DeckShareRead(
        id=share.id,
        token=share.token,
        kind=share.kind,
        show_notes=share.show_notes,
        created_at=share.created_at,
        frozen_name=share.frozen_name,
        deck_version_number=(
            share.deck_version.number if share.deck_version is not None else None
        ),
        deck=SharedDeckState(
            id=deck.id,
            name=deck.name,
            discriminator=deck.discriminator,
            archived_at=deck.archived_at,
            deleted_at=deck.deleted_at,
        ),
    )


def _owned_shares(user_id: int, *conditions):
    """Liens du compte, du plus récent au plus ancien, deck et version
    préchargés."""
    return (
        select(DeckShare)
        .where(DeckShare.user_id == user_id, *conditions)
        .options(joinedload(DeckShare.deck), joinedload(DeckShare.deck_version))
        .order_by(DeckShare.created_at.desc(), DeckShare.id.desc())
    )


def list_deck_shares(db: Session, user_id: int, deck_id: int) -> list[DeckShareRead]:
    """Les liens d'un deck, lisible même supprimé (il ne garde alors que ses
    figés)."""
    _get_deck(db, user_id, deck_id)
    shares = db.scalars(_owned_shares(user_id, DeckShare.deck_id == deck_id))
    return [_share_read(share) for share in shares]


def list_my_shares(db: Session, user_id: int) -> list[DeckShareRead]:
    """Tous les liens du compte, decks supprimés compris (écran Compte)."""
    return [_share_read(share) for share in db.scalars(_owned_shares(user_id))]


# --------------------------------------------------------------------------
# Création
# --------------------------------------------------------------------------


def _current_list(db: Session, deck: Deck) -> dict[int, int]:
    """`card_id -> quantité totale` de la liste courante, langues et extensions
    confondues, comme `freeze_decklist` du Lot 8. Un deck supprimé n'a plus de
    ligne vivante (et ne se partage pas : l'appelant l'a déjà refusé)."""
    rows = db.execute(
        select(DeckCard.card_id, func.sum(DeckCard.quantity))
        .where(DeckCard.deck_id == deck.id)
        .group_by(DeckCard.card_id)
    )
    return {card_id: int(total) for card_id, total in rows}


def _version_list(db: Session, deck: Deck, number: int) -> tuple[DeckVersion, dict]:
    version = db.scalars(
        select(DeckVersion).where(
            DeckVersion.deck_id == deck.id, DeckVersion.number == number
        )
    ).first()
    if version is None:
        raise NotFoundError(f"Version {number} du deck {deck.id} introuvable.")
    lines = db.execute(
        select(DeckVersionCard.card_id, DeckVersionCard.quantity).where(
            DeckVersionCard.deck_version_id == version.id
        )
    )
    return version, {card_id: quantity for card_id, quantity in lines}


def _new_share(
    user_id: int,
    deck: Deck,
    payload: DeckShareCreate,
    token: str,
    cards: dict[int, int],
    version: DeckVersion | None,
) -> DeckShare:
    share = DeckShare(
        user_id=user_id,
        deck_id=deck.id,
        token=token,
        kind=payload.kind,
        show_notes=payload.show_notes,
    )
    if payload.kind is DeckShareKind.FROZEN:
        share.frozen_name = deck.name
        share.frozen_archetype = deck.archetype
        # Des notes que la page ne montrera jamais ne se copient pas : le figé
        # ne garde rien de privé qu'il n'ait à publier.
        share.frozen_notes = deck.notes if payload.show_notes else None
        share.deck_version_id = version.id if version is not None else None
        share.cards = [
            DeckShareCard(card_id=card_id, quantity=quantity)
            for card_id, quantity in sorted(cards.items())
        ]
    return share


def create_deck_share(
    db: Session,
    user_id: int,
    deck_id: int,
    payload: DeckShareCreate,
    *,
    pick: TokenPicker | None = None,
) -> DeckShareRead:
    """Crée un lien. Vivant, il ne copie rien ; figé, il copie la liste courante
    du deck ou la version jouée `deck_version_number`, avec le nom, l'archétype
    et (si `show_notes`) les notes du moment.

    Un deck archivé se partage ; un deck supprimé, non (409). Le jeton se tire
    au hasard et se retire si la base le refuse (course ou doublon) ; 409 après
    `SHARE_TOKEN_ATTEMPTS` refus. `pick` est injectable pour tester ce chemin
    sans dépendre du hasard.
    """
    deck = _get_deck(db, user_id, deck_id)
    if deck.deleted_at is not None:
        raise ConflictError(
            f"Le deck {deck_id} est supprimé : il ne peut plus être partagé."
        )
    version: DeckVersion | None = None
    cards: dict[int, int] = {}
    if payload.kind is DeckShareKind.FROZEN:
        if payload.deck_version_number is not None:
            version, cards = _version_list(db, deck, payload.deck_version_number)
        else:
            cards = _current_list(db, deck)
    draw = pick or pick_token
    for _ in range(SHARE_TOKEN_ATTEMPTS):
        share = _new_share(user_id, deck, payload, draw(), cards, version)
        db.add(share)
        try:
            db.flush()
        except IntegrityError:
            db.rollback()  # jeton déjà pris : un autre tirage
            deck = _get_deck(db, user_id, deck_id)
            if version is not None:
                version = db.get(DeckVersion, version.id)
            continue
        commit_or_conflict(
            db, "Le lien n'a pas pu être enregistré (écriture concurrente)."
        )
        return _share_read(
            db.scalars(_owned_shares(user_id, DeckShare.id == share.id)).one()
        )
    raise ConflictError(
        f"Aucun jeton libre n'a pu être tiré après {SHARE_TOKEN_ATTEMPTS} essais : "
        "réessayer."
    )


# --------------------------------------------------------------------------
# Purge et révocation
# --------------------------------------------------------------------------


def revoke_live_shares(db: Session, deck_id: int) -> int:
    """Supprime les liens **vivants** d'un deck, sans commit : la suppression
    logique du deck les retire dans sa propre transaction (P5). Les figés
    restent. Rend le nombre de liens retirés."""
    result = db.execute(
        delete(DeckShare).where(
            DeckShare.deck_id == deck_id, DeckShare.kind == DeckShareKind.LIVE
        )
    )
    return result.rowcount


def _purge_selection(db: Session, user_id: int, share_ids: Iterable[int]) -> int:
    """Une sélection, vérifiée **en entier** avant toute suppression : 404 pour
    un lien inconnu ou d'un autre compte (même message). Les liens des decks
    supprimés s'y sélectionnent comme les autres (P5 amendée à F)."""
    ids = list(dict.fromkeys(share_ids))
    owned = set(
        db.scalars(
            select(DeckShare.id).where(
                DeckShare.user_id == user_id, DeckShare.id.in_(ids)
            )
        )
    )
    for share_id in ids:
        if share_id not in owned:
            raise NotFoundError(f"Lien {share_id} introuvable.")
    return _delete_shares(db, DeckShare.user_id == user_id, DeckShare.id.in_(ids))


def _delete_shares(db: Session, *conditions) -> int:
    # `ON DELETE CASCADE` emporte `deck_share_card` ; SQLite l'applique parce que
    # `PRAGMA foreign_keys` est actif sur chaque connexion.
    return db.execute(delete(DeckShare).where(*conditions)).rowcount


def purge_shares(
    db: Session,
    user_id: int,
    scope: SharePurgeScope,
    share_ids: Iterable[int] = (),
) -> int:
    """Purge des liens du compte, une transaction, et rend leur nombre.

    `selected` : les liens `share_ids`, decks supprimés compris, refusés en
    entier si l'un est inconnu ; `deleted_decks` : les figés des decks supprimés ;
    `all` : tous. Les deux dernières sont idempotentes."""
    if scope is SharePurgeScope.SELECTED:
        revoked = _purge_selection(db, user_id, share_ids)
    elif scope is SharePurgeScope.DELETED_DECKS:
        deleted_decks = select(Deck.id).where(
            Deck.user_id == user_id, Deck.deleted_at.is_not(None)
        )
        revoked = _delete_shares(
            db, DeckShare.user_id == user_id, DeckShare.deck_id.in_(deleted_decks)
        )
    else:
        revoked = _delete_shares(db, DeckShare.user_id == user_id)
    commit_or_conflict(
        db, "La purge n'a pas pu être enregistrée (écriture concurrente)."
    )
    return revoked


# --------------------------------------------------------------------------
# Lecture publique
# --------------------------------------------------------------------------


def _shared_list(db: Session, share: DeckShare) -> dict[int, int]:
    """`card_id -> quantité` de la page : le deck au moment de la lecture pour un
    vivant, la copie du lien pour un figé."""
    if share.kind is DeckShareKind.FROZEN:
        return {line.card_id: line.quantity for line in share.cards}
    return _current_list(db, share.deck)


def _reprinted_card_ids(db: Session, cards: Iterable[Card]) -> list[int]:
    """Cartes de crypte non *advanced* de la liste dont le nom replié est porté
    par une autre carte de crypte non *advanced* de plus petit identifiant VEKN
    (la version récente d'un vampire réimprimé), par identifiant croissant :
    exactement `reprintedCardIds` du client."""
    crypt = [
        c for c in cards if c.category is CardCategory.CRYPT and not c.advanced
    ]
    if not crypt:
        return []
    folded = {card.id: fold_text(card.name) for card in crypt}
    oldest: dict[str, int] = {}
    rows = db.execute(
        select(Card.name, Card.vekn_id).where(
            Card.category == CardCategory.CRYPT,
            Card.advanced.is_(False),
            func.fold_text(Card.name).in_(set(folded.values())),
        )
    )
    for name, vekn_id in rows:
        key = fold_text(name)
        if key not in oldest or vekn_id < oldest[key]:
            oldest[key] = vekn_id
    return sorted(
        card.id
        for card in crypt
        if oldest.get(folded[card.id], card.vekn_id) < card.vekn_id
    )


def _public_cards(db: Session, quantities: dict[int, int]):
    """Les cartes de la liste sous la forme de `GET /cartes`, par identifiant
    croissant, avec leur quantité."""
    if not quantities:
        return []
    items = catalog.list_cards(db, ids=sorted(quantities), limit=len(quantities))
    return [
        SharedDeckCardRead(card=item, quantity=quantities[item.id])
        for item in sorted(items, key=lambda item: item.id)
    ]


def read_shared_decklist(db: Session, token: str) -> SharedDecklistRead:
    """La liste d'un jeton, sans session ni compte (P2, A3). Jeton inconnu ou
    purgé : le même 404. Un lien vivant dont le deck est supprimé n'existe plus
    (la suppression l'a retiré ; la garde ne sert qu'à ne rien montrer d'un
    deck supprimé si une écriture directe l'avait laissé)."""
    share = db.scalars(
        select(DeckShare)
        .where(DeckShare.token == token)
        .options(joinedload(DeckShare.deck))
    ).first()
    if share is None:
        raise NotFoundError(SHARED_LIST_NOT_FOUND)
    frozen = share.kind is DeckShareKind.FROZEN
    if not frozen and share.deck.deleted_at is not None:
        raise NotFoundError(SHARED_LIST_NOT_FOUND)
    author = db.scalar(
        select(UserAccount.username).where(UserAccount.id == share.user_id)
    )
    cards = _public_cards(db, _shared_list(db, share))
    reprinted = _reprinted_card_ids(
        db, db.scalars(select(Card).where(Card.id.in_([c.card.id for c in cards])))
    )
    notes = share.frozen_notes if frozen else share.deck.notes
    return SharedDecklistRead(
        name=share.frozen_name if frozen else share.deck.name,
        archetype=share.frozen_archetype if frozen else share.deck.archetype,
        kind=share.kind,
        frozen_at=share.created_at if frozen else None,
        author=author,
        notes=notes if share.show_notes else None,
        cards=cards,
        reprinted_card_ids=reprinted,
    )
