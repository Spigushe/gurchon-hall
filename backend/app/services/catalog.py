"""Lecture du catalogue : cartes, produits, langues.

Le catalogue est en lecture seule côté API (il vient de l'import krcg) ; seule
la liste des langues, ouverte par décision (§11), accepte des ajouts.
"""

from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload, selectinload

from app.models import (
    Bundle,
    Card,
    CardCategory,
    CardDisciplineLink,
    CardPrinting,
    CardPrintingOccurrence,
    Language,
    PrintOccurrence,
)
from app.schemas.catalog import BundleCardRead, BundleContentRead, CardSummary
from app.schemas.reference import LanguageCreate
from app.services.errors import ConflictError, NotFoundError


def normalize_language_code(code: str) -> str:
    """Codes de langue en majuscules (« fr » et « FR » désignent la même)."""
    return code.strip().upper()


def like_pattern(text: str) -> str:
    """Motif `LIKE` « contient », avec les jokers de l'utilisateur neutralisés."""
    escaped = text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def list_languages(db: Session) -> list[Language]:
    stmt = select(Language).order_by(Language.sort_order, Language.code)
    return list(db.scalars(stmt))


def get_language(db: Session, code: str) -> Language:
    language = db.get(Language, normalize_language_code(code))
    if language is None:
        raise NotFoundError(f"Langue inconnue : {code!r}.")
    return language


def create_language(db: Session, payload: LanguageCreate) -> Language:
    code = normalize_language_code(payload.code)
    if db.get(Language, code) is not None:
        raise ConflictError(f"La langue {code} existe déjà.")
    language = Language(code=code, label=payload.label, sort_order=payload.sort_order)
    db.add(language)
    db.commit()
    return language


def list_cards(
    db: Session,
    *,
    q: str | None = None,
    category: CardCategory | None = None,
    clan_id: int | None = None,
    limit: int = 50,
    offset: int = 0,
) -> list[Card]:
    stmt = select(Card).options(joinedload(Card.clan))
    if q:
        stmt = stmt.where(Card.name.ilike(like_pattern(q), escape="\\"))
    if category is not None:
        stmt = stmt.where(Card.category == category)
    if clan_id is not None:
        stmt = stmt.where(Card.clan_id == clan_id)
    stmt = stmt.order_by(Card.name, Card.group_code, Card.id)
    stmt = stmt.limit(limit).offset(offset)
    return list(db.scalars(stmt))


def get_card(db: Session, card_id: int) -> Card:
    """Fiche complète, avec tout ce que `CardRead` expose préchargé."""
    stmt = (
        select(Card)
        .where(Card.id == card_id)
        .options(
            joinedload(Card.clan),
            joinedload(Card.sect),
            selectinload(Card.types),
            selectinload(Card.discipline_links).joinedload(CardDisciplineLink.discipline),
            selectinload(Card.printings).joinedload(CardPrinting.card_set),
            selectinload(Card.printings)
            .selectinload(CardPrinting.occurrences)
            .joinedload(CardPrintingOccurrence.bundle),
            selectinload(Card.translations),
        )
    )
    card = db.scalars(stmt).one_or_none()
    if card is None:
        raise NotFoundError(f"Carte {card_id} introuvable.")
    return card


def list_bundles(
    db: Session, *, card_set_id: int | None = None, q: str | None = None
) -> list[Bundle]:
    stmt = select(Bundle)
    if card_set_id is not None:
        stmt = stmt.where(Bundle.card_set_id == card_set_id)
    if q:
        stmt = stmt.where(Bundle.name.ilike(like_pattern(q), escape="\\"))
    return list(db.scalars(stmt.order_by(Bundle.card_set_id, Bundle.code)))


def get_bundle(db: Session, bundle_id: int) -> Bundle:
    bundle = db.get(Bundle, bundle_id)
    if bundle is None:
        raise NotFoundError(f"Produit {bundle_id} introuvable.")
    return bundle


def bundle_contents(db: Session, bundle_id: int) -> list[tuple[Card, int]]:
    """Contenu d'un produit : (carte, exemplaires), crypt d'abord puis par nom.

    Projection des occurrences `precon` qui désignent le produit. Une carte
    listée par plusieurs occurrences du même produit voit ses exemplaires
    additionnés.
    """
    copies_by_card = dict(
        db.execute(
            select(CardPrinting.card_id, func.sum(CardPrintingOccurrence.copies))
            .join(
                CardPrintingOccurrence,
                CardPrintingOccurrence.card_printing_id == CardPrinting.id,
            )
            .where(
                CardPrintingOccurrence.bundle_id == bundle_id,
                CardPrintingOccurrence.occurrence_type == PrintOccurrence.PRECON,
            )
            .group_by(CardPrinting.card_id)
        ).all()
    )
    cards = db.scalars(
        select(Card).where(Card.id.in_(list(copies_by_card))).options(joinedload(Card.clan))
    )
    contents = [(card, int(copies_by_card[card.id] or 1)) for card in cards]
    contents.sort(
        key=lambda item: (item[0].category is not CardCategory.CRYPT, item[0].name)
    )
    return contents


def get_bundle_content(db: Session, bundle_id: int) -> BundleContentRead:
    bundle = get_bundle(db, bundle_id)
    cards = [
        BundleCardRead(card=CardSummary.model_validate(card), copies=copies)
        for card, copies in bundle_contents(db, bundle_id)
    ]
    return BundleContentRead.model_validate(bundle).model_copy(update={"cards": cards})
