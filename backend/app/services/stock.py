"""Collection possédée (`/stock`) : une entrée par carte et par langue.

Sémantique du proxy, tranchée au Lot 2 (le point était ouvert au Lot 1) :
`proxy_allowed` est un **booléen** par carte et par langue. Il autorise à
jouer cette carte en proxy ; le *nombre* de proxies vit sur la ligne de deck
(`DeckCard.proxy_quantity`), pas dans le stock — un proxy n'est pas un
exemplaire possédé.

D'où la comptabilité des exemplaires réels : dans un deck, une ligne consomme
`quantity - proxy_quantity` exemplaires du stock ; la somme sur tous les decks
ne doit jamais dépasser `quantity_owned` (`allocated_real`, `available`).

Les decks supprimés logiquement ne comptent plus, sans filtre à écrire : leur
decklist a migré vers `deleted_deck_card`, qui ne référence pas la collection,
et leurs lignes vivantes n'existent plus. `allocated_real` et
`proxies_allocated` se contentent donc de sommer `deck_card`. Une entrée de
collection n'est retenue que par des decks vivants (archivés compris) : la
supprimer n'est jamais bloquée par un deck supprimé.

**Limite connue (reportée au Lot 3, `/sync`)** : la comptabilité du stock est un
« vérifier puis écrire » non atomique. Deux requêtes concurrentes peuvent
chacune constater assez d'exemplaires disponibles et, ensemble, sur-allouer une
entrée (`allocated_real` > `quantity_owned`) ; de même pour la baisse de
`quantity_owned` face à un ajout en deck. Aucune contrainte de base ne
l'interdit (la somme porte sur plusieurs lignes). Sans risque en usage
mono-utilisateur séquentiel, à traiter avec la file de synchronisation, qui
sérialisera les écritures. Les doublons de clé, eux, sont rattrapés par la base
et rendus en 409 (`app.services.persistence`).
"""

from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload

from app.models import Card, CardCategory, CardCopy, DeckCard
from app.schemas.base import MAX_DB_INT
from app.schemas.collection import (
    BundleDeposit,
    CardCopyCreate,
    CardCopyUpdate,
)
from app.services import catalog
from app.services.errors import ConflictError, NotFoundError
from app.services.persistence import commit_or_conflict
from app.services.text_search import contains_folded


def allocated_real(
    db: Session,
    card_id: int,
    language_code: str,
    *,
    excluding_deck_id: int | None = None,
) -> int:
    """Exemplaires réels (hors proxies) déjà pris par les decks vivants."""
    stmt = select(
        func.coalesce(func.sum(DeckCard.quantity - DeckCard.proxy_quantity), 0)
    ).where(
        DeckCard.card_id == card_id,
        DeckCard.language_code == language_code,
    )
    if excluding_deck_id is not None:
        stmt = stmt.where(DeckCard.deck_id != excluding_deck_id)
    return int(db.scalar(stmt))


def proxies_allocated(db: Session, card_id: int, language_code: str) -> int:
    """Proxies présents dans les decks vivants pour cette entrée."""
    stmt = select(func.coalesce(func.sum(DeckCard.proxy_quantity), 0)).where(
        DeckCard.card_id == card_id,
        DeckCard.language_code == language_code,
    )
    return int(db.scalar(stmt))


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
        stmt = stmt.where(contains_folded(Card.name, q))
    stmt = (
        stmt.order_by(Card.name, Card.group_code, Card.id, CardCopy.language_code)
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
    commit_or_conflict(
        db, f"La carte {payload.card_id} est déjà en collection en {code}."
    )
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
            f"Cette entrée est utilisée par {in_decks} ligne(s) de deck (decks "
            "archivés compris) : la retirer des decks d'abord, ou mettre sa "
            "quantité à 0."
        )
    db.delete(copy)
    # Course possible avec un ajout en deck : la base refuse la suppression.
    commit_or_conflict(db, "Cette entrée est utilisée par un deck.")


def deposit_bundle(
    db: Session, bundle_id: int, payload: BundleDeposit
) -> list[CardCopy]:
    """Verse le contenu d'un produit dans la collection, dans la langue donnée.

    Additionne au stock existant (créant les entrées manquantes), en une seule
    transaction. **Non idempotent** : rejouer l'appel ajoute le produit une
    seconde fois — l'idempotence des écritures rejouées est l'affaire de
    `/sync` (Lot 3).

    409 si le résultat dépasserait `MAX_DB_INT` pour une entrée quelconque du
    produit (le plafond que les schémas imposent à `quantity_owned`) : rien
    n'est alors écrit.
    """
    code = catalog.normalize_language_code(payload.language_code)
    catalog.get_language(db, code)
    catalog.get_bundle(db, bundle_id)
    contents = catalog.bundle_contents(db, bundle_id)
    if not contents:
        raise ConflictError(
            f"Le produit {bundle_id} n'a pas de contenu connu : rien à verser."
        )

    # Une seule requête pour les entrées déjà en collection (pas de N+1).
    existing = {
        copy.card_id: copy
        for copy in db.scalars(
            select(CardCopy)
            .where(
                CardCopy.card_id.in_([card.id for card, _ in contents]),
                CardCopy.language_code == code,
            )
            .options(joinedload(CardCopy.card).joinedload(Card.clan))
        )
    }
    # Contrôle de plafond avant toute écriture : aucune entrée n'est créée ni
    # modifiée si un seul des totaux dépasserait ce que les schémas acceptent.
    for card, per_bundle in contents:
        current = existing[card.id].quantity_owned if card.id in existing else 0
        total = current + per_bundle * payload.count
        if total > MAX_DB_INT:
            raise ConflictError(
                f"Le versement porterait la carte {card.id} à {total} exemplaire(s) "
                f"en {code}, au-delà du plafond de {MAX_DB_INT} : réduire le "
                "nombre de produits."
            )

    copies = []
    for card, per_bundle in contents:
        copy = existing.get(card.id)
        if copy is None:
            # `card` (clan préchargé par `bundle_contents`) sert à la réponse.
            copy = CardCopy(
                card_id=card.id,
                card=card,
                language_code=code,
                quantity_owned=0,
                proxy_allowed=False,
                notes=None,
            )
            db.add(copy)
        copy.quantity_owned += per_bundle * payload.count
        copies.append(copy)
    commit_or_conflict(db, "Une entrée de collection a été créée en parallèle.")
    return copies
