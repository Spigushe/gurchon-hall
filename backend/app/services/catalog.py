"""Lecture du catalogue : cartes, produits, langues.

Le catalogue est en lecture seule côté API (il vient de l'import krcg) ; seule
la liste des langues, ouverte par décision (§11), accepte des ajouts.
"""

from datetime import date

from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload, selectinload

from app.models import (
    Bundle,
    Card,
    CardCategory,
    CardDisciplineLink,
    CardPrinting,
    CardPrintingOccurrence,
    CardSet,
    Language,
    PrintOccurrence,
)
from app.schemas.catalog import (
    BundleCardRead,
    BundleContentRead,
    CardListItem,
    CardRead,
    CardSearchItem,
    CardSummary,
)
from app.schemas.reference import LanguageCreate
from app.services.errors import ConflictError, NotFoundError
from app.services.persistence import commit_or_conflict
from app.services.text_search import contains_folded
from app.services.vtes_rules import library_requirement


def normalize_language_code(code: str) -> str:
    """Codes de langue en majuscules (« fr » et « FR » désignent la même)."""
    return code.strip().upper()


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
    commit_or_conflict(db, f"La langue {code} existe déjà.")
    return language


def list_card_sets(db: Session) -> list[CardSet]:
    """Extensions du catalogue (`GET /extensions`), des plus anciennes aux
    plus récentes ; les extensions sans date (Promo, POD, tampon) en dernier."""
    stmt = select(CardSet).order_by(
        CardSet.release_date.is_(None), CardSet.release_date, CardSet.abbrev
    )
    return list(db.scalars(stmt))


def _printing_effective_date(printing: CardPrinting) -> date | None:
    """Date d'une impression (D2a, règle 1) : la plus récente `released_on`
    de ses occurrences, à défaut la `release_date` de son extension."""
    occurrence_dates = [
        occurrence.released_on
        for occurrence in printing.occurrences
        if occurrence.released_on is not None
    ]
    if occurrence_dates:
        return max(occurrence_dates)
    return printing.card_set.release_date


def latest_card_set_id(card: Card) -> int:
    """Extension de la dernière version d'une carte (décision D2a).

    `card.printings` doit être préchargé avec `card_set` et `occurrences`
    (`selectinload`/`joinedload` côté appelant) : cette fonction ne fait
    aucune requête, pour rester sans N+1 sur une page de résultats.

    Règle, dans l'ordre : la date la plus récente (règle 1, ci-dessus) ;
    à égalité, une extension datée (produit commercial) passe avant une
    extension sans date (Promo, POD) — règle 2 ; puis l'abréviation
    d'extension par ordre alphabétique — règle 3, stable d'une base à
    l'autre. L'extension tampon (D2b) ne compte que si elle est la seule
    impression de la carte.
    """
    printings = card.printings
    if not printings:
        # Impossible une fois l'import en place (D2b garantit au moins une
        # impression, réelle ou tampon, pour toute carte du catalogue).
        raise NotImplementedError(
            f"Carte {card.id} sans impression : l'import doit poser une "
            "extension tampon (D2b) avant que cette fonction ne soit appelée."
        )
    candidates = [p for p in printings if not p.card_set.is_placeholder]
    if not candidates:
        # Seule(s) impression(s) restante(s) : la ou les tampon(s).
        candidates = printings

    def sort_key(printing: CardPrinting) -> tuple[int, bool, str]:
        effective = _printing_effective_date(printing) or date.min
        extension_dated = printing.card_set.release_date is not None
        return (-effective.toordinal(), not extension_dated, printing.card_set.abbrev)

    return min(candidates, key=sort_key).card_set_id


def _printing_fields(card: Card) -> dict[str, object]:
    """Les deux champs d'impression de `CardListItem` (Lot 4)."""
    return {
        "card_set_ids": sorted(p.card_set_id for p in card.printings),
        "latest_card_set_id": latest_card_set_id(card),
    }


def _requirement_fields(card: Card) -> dict[str, object]:
    """Lecture de `card.library_requirement` (lot Chercher, A3) : la règle
    « un titre implique sa secte » est dans `vtes_rules`, jamais au client."""
    requirement = library_requirement(card.library_requirement)
    return {
        "required_sects": list(requirement.sects),
        "required_titles": list(requirement.titles),
        "requires_titled": requirement.titled,
        "requires_non_titled": requirement.non_titled,
        "other_requirements": list(requirement.other),
    }


def _translated_names(card: Card) -> dict[str, object]:
    """Noms traduits de la ligne de liste (A7), triés par langue."""
    return {
        "translated_names": [
            {"language_code": t.language_code, "name": t.name}
            for t in sorted(card.translations, key=lambda t: t.language_code)
        ]
    }


def _ordered_relations(card: Card) -> dict[str, object]:
    """Ordre défini des types (par nom) et des disciplines (par abréviation) :
    sans cela, l'ordre dépend du plan de requête de SQLite, et une réponse
    identique d'un appel à l'autre n'est plus garantie (lot Chercher, B1)."""
    return {
        "types": sorted(card.types, key=lambda t: t.name),
        "discipline_links": sorted(
            card.discipline_links,
            key=lambda link: (link.discipline.abbrev or "", link.discipline_id),
        ),
    }


_COMPUTED_FIELDS = frozenset(
    {
        "types",
        "discipline_links",
        "card_set_ids",
        "latest_card_set_id",
        "required_sects",
        "required_titles",
        "requires_titled",
        "requires_non_titled",
        "other_requirements",
        "translated_names",
    }
)
"""Champs de lecture calculés par le service, qui ne sont ni des colonnes ni
des relations de `Card`."""


def _card_read[T: CardListItem](card: Card, schema: type[T]) -> T:
    """Remplit `schema` depuis la carte : chaque champ lu par `getattr`, sauf
    les champs calculés. Les relations lues doivent être préchargées par
    l'appelant, sans quoi chaque carte d'une page déclenche ses requêtes."""
    computed = {
        **_printing_fields(card),
        **_requirement_fields(card),
        **_ordered_relations(card),
    }
    if "translated_names" in schema.model_fields:
        computed.update(_translated_names(card))
    return schema.model_validate(
        {
            **{
                name: getattr(card, name)
                for name in schema.model_fields
                if name not in _COMPUTED_FIELDS
            },
            **computed,
        }
    )


def list_cards(
    db: Session,
    *,
    q: str | None = None,
    category: CardCategory | None = None,
    clan_id: int | None = None,
    limit: int = 50,
    offset: int = 0,
) -> list[CardSearchItem]:
    # Lot Chercher (A1, B1) : même assembleur que `get_card`, donc même forme ;
    # le nombre de requêtes ne dépend pas de la taille de la page (test dédié).
    stmt = select(Card).options(
        joinedload(Card.clan),
        joinedload(Card.sect),
        selectinload(Card.types),
        selectinload(Card.discipline_links).joinedload(CardDisciplineLink.discipline),
        selectinload(Card.translations),
        selectinload(Card.printings).joinedload(CardPrinting.card_set),
        # Nécessaire à `latest_card_set_id` (D2a, règle 1) : sans ce
        # préchargement, chaque carte de la page déclencherait sa propre
        # requête d'occurrences (N+1).
        selectinload(Card.printings).selectinload(CardPrinting.occurrences),
    )
    if q:
        stmt = stmt.where(contains_folded(Card.name, q))
    if category is not None:
        stmt = stmt.where(Card.category == category)
    if clan_id is not None:
        stmt = stmt.where(Card.clan_id == clan_id)
    stmt = stmt.order_by(Card.name, Card.group_code, Card.id)
    stmt = stmt.limit(limit).offset(offset)
    return [_card_read(card, CardSearchItem) for card in db.scalars(stmt)]


def get_card(db: Session, card_id: int) -> CardRead:
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
    return _card_read(card, CardRead)


def list_bundles(
    db: Session, *, card_set_id: int | None = None, q: str | None = None
) -> list[Bundle]:
    stmt = select(Bundle)
    if card_set_id is not None:
        stmt = stmt.where(Bundle.card_set_id == card_set_id)
    if q:
        stmt = stmt.where(contains_folded(Bundle.name, q))
    return list(db.scalars(stmt.order_by(Bundle.card_set_id, Bundle.code)))


def get_bundle(db: Session, bundle_id: int) -> Bundle:
    bundle = db.get(Bundle, bundle_id)
    if bundle is None:
        raise NotFoundError(f"Produit {bundle_id} introuvable.")
    return bundle


def get_printing(db: Session, card_id: int, card_set_id: int) -> CardPrinting:
    """L'impression (carte × extension) désignée, ou un 404 lisible.

    `card_copy.card_set_id` (D2, Lot 4) doit toujours pointer une impression
    réelle : la clé étrangère composite vers `card_printing` le garantit déjà
    au niveau base, mais un refus 404 est plus lisible qu'un 409 d'intégrité
    (§ B1 de `docs/lot4-plan-inventaire.md`). À vérifier avant toute écriture
    dans `card_copy` ou `deck_card`, avant même le contrôle « pas en
    collection ».
    """
    printing = db.scalars(
        select(CardPrinting).where(
            CardPrinting.card_id == card_id, CardPrinting.card_set_id == card_set_id
        )
    ).one_or_none()
    if printing is None:
        raise NotFoundError(
            f"La carte {card_id} n'a pas été imprimée dans l'extension {card_set_id}."
        )
    return printing


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
