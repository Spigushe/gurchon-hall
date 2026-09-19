"""Collection possédée (`/stock`) : une entrée par carte et par langue.

Sémantique du proxy, tranchée au Lot 2 (le point était ouvert au Lot 1) :
`proxy_allowed` est un **booléen** par carte et par langue. Il autorise à
jouer cette carte en proxy ; le *nombre* de proxies vit sur la ligne de deck
(`DeckCard.proxy_quantity`), pas dans le stock — un proxy n'est pas un
exemplaire possédé.

D'où la comptabilité des exemplaires réels : dans un deck, une ligne consomme
`quantity - proxy_quantity` exemplaires du stock ; la somme sur tous les decks
ne doit jamais dépasser `quantity_owned` (`allocated_real`, `available`).
"""

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app.models import Card, CardCategory, CardCopy, DeckCard
from app.schemas.collection import (
    BundleDeposit,
    CardCopyCreate,
    CardCopyUpdate,
)
from app.services import catalog
from app.services.errors import ConflictError, NotFoundError


def allocated_real(
    db: Session,
    card_id: int,
    language_code: str,
    *,
    excluding_deck_id: int | None = None,
) -> int:
    """Exemplaires réels (hors proxies) déjà pris par les decks."""
    stmt = select(
        func.coalesce(func.sum(DeckCard.quantity - DeckCard.proxy_quantity), 0)
    ).where(DeckCard.card_id == card_id, DeckCard.language_code == language_code)
    if excluding_deck_id is not None:
        stmt = stmt.where(DeckCard.deck_id != excluding_deck_id)
    return int(db.scalar(stmt))


def proxies_allocated(db: Session, card_id: int, language_code: str) -> int:
    """Proxies présents dans les decks pour cette entrée."""
    return int(
        db.scalar(
            select(func.coalesce(func.sum(DeckCard.proxy_quantity), 0)).where(
                DeckCard.card_id == card_id, DeckCard.language_code == language_code
            )
        )
    )


def list_stock(
    db: Session,
    *,
    language_code: str | None = None,
    category: CardCategory | None = None,
    q: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> list[CardCopy]:
    stmt = (
        select(CardCopy)
        .join(Card, Card.id == CardCopy.card_id)
        .options(joinedload(CardCopy.card).joinedload(Card.clan))
    )
    if language_code:
        code = catalog.normalize_language_code(language_code)
        stmt = stmt.where(CardCopy.language_code == code)
    if category is not None:
        stmt = stmt.where(Card.category == category)
    if q:
        stmt = stmt.where(Card.name.ilike(catalog.like_pattern(q), escape="\\"))
    stmt = (
        stmt.order_by(Card.name, Card.group_code, CardCopy.language_code)
        .limit(limit)
        .offset(offset)
    )
    return list(db.scalars(stmt))


def get_copy(db: Session, card_id: int, language_code: str) -> CardCopy:
    code = catalog.normalize_language_code(language_code)
    copy = db.scalars(
        select(CardCopy)
        .where(CardCopy.card_id == card_id, CardCopy.language_code == code)
        .options(joinedload(CardCopy.card).joinedload(Card.clan))
    ).one_or_none()
    if copy is None:
        raise NotFoundError(
            f"Aucune entrée de collection pour la carte {card_id} en {code}."
        )
    return copy


def create_copy(db: Session, payload: CardCopyCreate) -> CardCopy:
    code = catalog.normalize_language_code(payload.language_code)
    if db.get(Card, payload.card_id) is None:
        raise NotFoundError(f"Carte {payload.card_id} introuvable.")
    catalog.get_language(db, code)
    if db.get(CardCopy, (payload.card_id, code)) is not None:
        raise ConflictError(
            f"La carte {payload.card_id} est déjà en collection en {code} : "
            "modifier l'entrée existante."
        )
    copy = CardCopy(
        card_id=payload.card_id,
        language_code=code,
        quantity_owned=payload.quantity_owned,
        proxy_allowed=payload.proxy_allowed,
        notes=payload.notes,
    )
    db.add(copy)
    db.commit()
    return get_copy(db, copy.card_id, code)


def update_copy(
    db: Session, card_id: int, language_code: str, payload: CardCopyUpdate
) -> CardCopy:
    copy = get_copy(db, card_id, language_code)
    changes = payload.model_dump(exclude_unset=True)

    if "quantity_owned" in changes:
        used = allocated_real(db, card_id, copy.language_code)
        if changes["quantity_owned"] < used:
            raise ConflictError(
                f"{used} exemplaire(s) sont alloués à des decks : impossible de "
                f"descendre à {changes['quantity_owned']} possédé(s)."
            )
    if changes.get("proxy_allowed") is False:
        proxies = proxies_allocated(db, card_id, copy.language_code)
        if proxies:
            raise ConflictError(
                f"{proxies} proxy(s) de cette carte sont utilisés dans des decks : "
                "les retirer avant d'interdire le proxy."
            )

    for field, value in changes.items():
        setattr(copy, field, value)
    db.commit()
    return copy


def delete_copy(db: Session, card_id: int, language_code: str) -> None:
    copy = get_copy(db, card_id, language_code)
    in_decks = db.scalar(
        select(func.count()).select_from(DeckCard).where(
            DeckCard.card_id == card_id, DeckCard.language_code == copy.language_code
        )
    )
    if in_decks:
        raise ConflictError(
            f"Cette entrée est utilisée par {in_decks} ligne(s) de deck : "
            "la retirer des decks d'abord."
        )
    db.delete(copy)
    try:
        db.commit()
    except IntegrityError as error:  # course avec un ajout en deck
        db.rollback()
        raise ConflictError("Cette entrée est utilisée par un deck.") from error


def deposit_bundle(
    db: Session, bundle_id: int, payload: BundleDeposit
) -> list[CardCopy]:
    """Verse le contenu d'un produit dans la collection, dans la langue donnée.

    Additionne au stock existant (créant les entrées manquantes), en une seule
    transaction. **Non idempotent** : rejouer l'appel ajoute le produit une
    seconde fois — l'idempotence des écritures rejouées est l'affaire de
    `/sync` (Lot 3).
    """
    code = catalog.normalize_language_code(payload.language_code)
    catalog.get_language(db, code)
    catalog.get_bundle(db, bundle_id)
    contents = catalog.bundle_contents(db, bundle_id)
    if not contents:
        raise ConflictError(
            f"Le produit {bundle_id} n'a pas de contenu connu : rien à verser."
        )

    copies = []
    for card, per_bundle in contents:
        copy = db.get(CardCopy, (card.id, code))
        if copy is None:
            copy = CardCopy(card_id=card.id, language_code=code, quantity_owned=0)
            db.add(copy)
        copy.quantity_owned += per_bundle * payload.count
        copies.append(copy)
    db.commit()
    return [get_copy(db, copy.card_id, code) for copy in copies]
