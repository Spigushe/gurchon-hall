"""Decks et decklists.

Une carte n'entre dans un deck que si elle est **en collection dans cette
langue** (CLAUDE.md §11, décision 2 — la base l'impose déjà par la clé étrangère
composite `deck_card` → `card_copy`, le service en fait une réponse lisible).
Les ajouts respectent en plus la comptabilité du stock (cf. `app.services.stock`) :
un deck ne consomme que des exemplaires disponibles, et ne joue en proxy que
les cartes dont le proxy est autorisé.

Légalité (crypt ≥ 12, library 60–90) : calculée à la demande, jamais bloquante
pendant la construction — un brouillon est incomplet par nature. Elle ne gate
qu'une chose : passer un deck au statut `active`.
"""

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload, selectinload

from app.models import (
    Card,
    CardCategory,
    CardCopy,
    Deck,
    DeckCard,
    DeckStatus,
    Participation,
)
from app.models.base import utcnow
from app.schemas.collection import (
    DeckCardCreate,
    DeckCardUpdate,
    DeckCreate,
    DeckDetailRead,
    DeckLegality,
    DeckUpdate,
)
from app.services import catalog, stock, vtes_rules
from app.services.errors import ConflictError, InvalidRequestError, NotFoundError


def _get_deck(db: Session, deck_id: int) -> Deck:
    deck = db.get(Deck, deck_id)
    if deck is None:
        raise NotFoundError(f"Deck {deck_id} introuvable.")
    return deck


def _ensure_name_free(
    db: Session, name: str, *, excluding_id: int | None = None
) -> None:
    stmt = select(Deck.id).where(Deck.name == name)
    if excluding_id is not None:
        stmt = stmt.where(Deck.id != excluding_id)
    if db.scalar(stmt) is not None:
        raise ConflictError(f"Un deck nommé {name!r} existe déjà.")


def deck_counts(db: Session, deck_id: int) -> tuple[int, int]:
    """(cartes de crypt, cartes de library), proxies compris."""
    rows = db.execute(
        select(Card.category, func.coalesce(func.sum(DeckCard.quantity), 0))
        .join(Card, Card.id == DeckCard.card_id)
        .where(DeckCard.deck_id == deck_id)
        .group_by(Card.category)
    ).all()
    totals = {category: int(total) for category, total in rows}
    return totals.get(CardCategory.CRYPT, 0), totals.get(CardCategory.LIBRARY, 0)


def get_legality(db: Session, deck_id: int) -> DeckLegality:
    _get_deck(db, deck_id)
    crypt, library = deck_counts(db, deck_id)
    issues = vtes_rules.deck_issues(crypt, library)
    return DeckLegality(
        deck_id=deck_id,
        crypt_count=crypt,
        library_count=library,
        crypt_minimum=vtes_rules.CRYPT_MINIMUM,
        library_minimum=vtes_rules.LIBRARY_MINIMUM,
        library_maximum=vtes_rules.LIBRARY_MAXIMUM,
        is_legal=not issues,
        issues=issues,
    )


def _ensure_can_activate(db: Session, deck: Deck) -> None:
    legality = get_legality(db, deck.id)
    if not legality.is_legal:
        raise ConflictError(
            "Un deck illégal ne peut pas être actif : " + " ".join(legality.issues)
        )


def list_decks(
    db: Session, *, status: DeckStatus | None = None, q: str | None = None
) -> list[Deck]:
    stmt = select(Deck)
    if status is not None:
        stmt = stmt.where(Deck.status == status)
    if q:
        stmt = stmt.where(Deck.name.ilike(catalog.like_pattern(q), escape="\\"))
    return list(db.scalars(stmt.order_by(Deck.name)))


def get_deck_detail(db: Session, deck_id: int) -> DeckDetailRead:
    deck = db.scalars(
        select(Deck)
        .where(Deck.id == deck_id)
        .options(
            selectinload(Deck.cards).joinedload(DeckCard.card).joinedload(Card.clan)
        )
    ).one_or_none()
    if deck is None:
        raise NotFoundError(f"Deck {deck_id} introuvable.")
    detail = DeckDetailRead.model_validate(deck)
    detail.cards.sort(
        key=lambda line: (
            line.card.category is not CardCategory.CRYPT,
            line.card.name,
            line.language_code,
        )
    )
    return detail


def create_deck(db: Session, payload: DeckCreate) -> Deck:
    _ensure_name_free(db, payload.name)
    deck = Deck(**payload.model_dump())
    db.add(deck)
    db.flush()
    if deck.status is DeckStatus.ACTIVE:
        _ensure_can_activate(db, deck)
    db.commit()
    return deck


def update_deck(db: Session, deck_id: int, payload: DeckUpdate) -> Deck:
    deck = _get_deck(db, deck_id)
    changes = payload.model_dump(exclude_unset=True)
    if "name" in changes:
        _ensure_name_free(db, changes["name"], excluding_id=deck_id)
    activating = (
        changes.get("status") is DeckStatus.ACTIVE
        and deck.status is not DeckStatus.ACTIVE
    )
    if activating:
        _ensure_can_activate(db, deck)
    for field, value in changes.items():
        setattr(deck, field, value)
    db.commit()
    return deck


def delete_deck(db: Session, deck_id: int) -> None:
    """Supprime le deck et sa composition (les exemplaires retournent au stock).

    Refusé si le deck a servi en partie : l'historique de pratique (Lot 4) ne
    doit pas perdre le deck joué. On le passe alors au statut `retired`.
    """
    deck = _get_deck(db, deck_id)
    played = db.scalar(
        select(func.count())
        .select_from(Participation)
        .where(Participation.deck_id == deck_id)
    )
    if played:
        raise ConflictError(
            f"Ce deck a été joué dans {played} partie(s) : le passer au statut "
            "« retired » plutôt que le supprimer."
        )
    db.delete(deck)
    _commit(db)


def _load_line(db: Session, deck_id: int, card_id: int, language_code: str) -> DeckCard:
    line = db.scalars(
        select(DeckCard)
        .where(
            DeckCard.deck_id == deck_id,
            DeckCard.card_id == card_id,
            DeckCard.language_code == language_code,
        )
        .options(joinedload(DeckCard.card).joinedload(Card.clan))
    ).one_or_none()
    if line is None:
        raise NotFoundError(
            f"La carte {card_id} en {language_code} n'est pas dans le deck {deck_id}."
        )
    return line


def _check_allocation(
    db: Session, deck_id: int, copy: CardCopy, quantity: int, proxy_quantity: int
) -> None:
    """La ligne demandée tient-elle dans le stock ?"""
    if proxy_quantity and not copy.proxy_allowed:
        raise ConflictError(
            "Le proxy n'est pas autorisé pour cette carte dans cette langue : "
            "l'autoriser dans la collection d'abord."
        )
    real = quantity - proxy_quantity
    available = copy.quantity_owned - stock.allocated_real(
        db, copy.card_id, copy.language_code, excluding_deck_id=deck_id
    )
    if real > available:
        raise ConflictError(
            f"Exemplaires insuffisants : {real} réel(s) demandé(s), "
            f"{max(available, 0)} disponible(s) sur {copy.quantity_owned} possédé(s) "
            "(le reste est alloué à d'autres decks)."
        )


def _commit(db: Session) -> None:
    try:
        db.commit()
    except IntegrityError as error:
        # Filet : la base refuse ce que le service aurait laissé passer.
        db.rollback()
        raise ConflictError(
            "La composition du deck contredit la collection."
        ) from error


def add_card(db: Session, deck_id: int, payload: DeckCardCreate) -> DeckCard:
    deck = _get_deck(db, deck_id)
    code = catalog.normalize_language_code(payload.language_code)
    if db.get(Card, payload.card_id) is None:
        raise NotFoundError(f"Carte {payload.card_id} introuvable.")
    copy = db.get(CardCopy, (payload.card_id, code))
    if copy is None:
        raise ConflictError(
            f"La carte {payload.card_id} n'est pas en collection en {code} : "
            "l'ajouter au stock avant de l'utiliser dans un deck."
        )
    if db.get(DeckCard, (deck_id, payload.card_id, code)) is not None:
        raise ConflictError(
            f"La carte {payload.card_id} en {code} est déjà dans le deck : "
            "modifier sa ligne."
        )
    _check_allocation(db, deck_id, copy, payload.quantity, payload.proxy_quantity)

    db.add(
        DeckCard(
            deck_id=deck_id,
            card_id=payload.card_id,
            language_code=code,
            quantity=payload.quantity,
            proxy_quantity=payload.proxy_quantity,
        )
    )
    deck.updated_at = utcnow()
    _commit(db)
    return _load_line(db, deck_id, payload.card_id, code)


def update_card(
    db: Session, deck_id: int, card_id: int, language_code: str, payload: DeckCardUpdate
) -> DeckCard:
    deck = _get_deck(db, deck_id)
    code = catalog.normalize_language_code(language_code)
    line = _load_line(db, deck_id, card_id, code)
    changes = payload.model_dump(exclude_unset=True)
    quantity = changes.get("quantity", line.quantity)
    proxy_quantity = changes.get("proxy_quantity", line.proxy_quantity)

    # Le schéma ne compare que deux valeurs reçues ensemble (cf. DeckCardUpdate) ;
    # ici on dispose de la valeur fusionnée avec la ligne existante.
    if proxy_quantity > quantity:
        raise InvalidRequestError(
            "proxy_quantity ne peut pas dépasser quantity : on ne joue pas plus "
            "de proxies que d'exemplaires dans le deck.",
            loc=("body", "proxy_quantity"),
        )
    copy = db.get(CardCopy, (card_id, code))
    _check_allocation(db, deck_id, copy, quantity, proxy_quantity)

    line.quantity = quantity
    line.proxy_quantity = proxy_quantity
    deck.updated_at = utcnow()
    _commit(db)
    return line


def remove_card(db: Session, deck_id: int, card_id: int, language_code: str) -> None:
    deck = _get_deck(db, deck_id)
    line = _load_line(
        db, deck_id, card_id, catalog.normalize_language_code(language_code)
    )
    db.delete(line)
    deck.updated_at = utcnow()
    db.commit()
