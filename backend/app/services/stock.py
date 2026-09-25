"""Collection possédée (`/stock`) : une entrée par carte, langue et extension.

Lot 4 : la clé (carte, langue, extension) est propagée dans les recherches et
les écritures. `create_copy` vérifie que l'impression (carte × extension)
existe dans le catalogue avant d'écrire (`catalog.get_printing`, 404
lisible) ; la clé étrangère composite vers `card_printing` reste le dernier
filet (409 par `commit_or_conflict`) pour une course entre deux requêtes.

Sémantique du proxy, tranchée au Lot 2 puis déplacée au Lot 4 : l'autorisation
de jouer une carte en proxy n'est plus portée par l'entrée de collection, mais
par le deck (`Deck.proxy_allowed`, cf. `app.services.decks`), choisie selon le
tournoi visé. Le *nombre* de proxies reste porté par la ligne de deck
(`DeckCard.proxy_quantity`) — un proxy n'est pas un exemplaire possédé.

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
    card_set_id: int,
    *,
    excluding_deck_id: int | None = None,
) -> int:
    """Exemplaires réels (hors proxies) déjà pris par les decks vivants."""
    stmt = select(
        func.coalesce(func.sum(DeckCard.quantity - DeckCard.proxy_quantity), 0)
    ).where(
        DeckCard.card_id == card_id,
        DeckCard.language_code == language_code,
        DeckCard.card_set_id == card_set_id,
    )
    if excluding_deck_id is not None:
        stmt = stmt.where(DeckCard.deck_id != excluding_deck_id)
    return int(db.scalar(stmt))


def proxies_allocated(
    db: Session, card_id: int, language_code: str, card_set_id: int
) -> int:
    """Proxies présents dans les decks vivants pour cette entrée."""
    stmt = select(func.coalesce(func.sum(DeckCard.proxy_quantity), 0)).where(
        DeckCard.card_id == card_id,
        DeckCard.language_code == language_code,
        DeckCard.card_set_id == card_set_id,
    )
    return int(db.scalar(stmt))


def list_stock(
    db: Session,
    *,
    language_code: str | None = None,
    card_set_id: int | None = None,
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
    if card_set_id is not None:
        stmt = stmt.where(CardCopy.card_set_id == card_set_id)
    if category is not None:
        stmt = stmt.where(Card.category == category)
    if q:
        stmt = stmt.where(contains_folded(Card.name, q))
    stmt = (
        stmt.order_by(
            Card.name,
            Card.group_code,
            Card.id,
            CardCopy.language_code,
            CardCopy.card_set_id,
        )
        .limit(limit)
        .offset(offset)
    )
    return list(db.scalars(stmt))


def get_copy(
    db: Session, card_id: int, language_code: str, card_set_id: int
) -> CardCopy:
    code = catalog.normalize_language_code(language_code)
    copy = db.scalars(
        select(CardCopy)
        .where(
            CardCopy.card_id == card_id,
            CardCopy.language_code == code,
            CardCopy.card_set_id == card_set_id,
        )
        .options(joinedload(CardCopy.card).joinedload(Card.clan))
    ).one_or_none()
    if copy is None:
        raise NotFoundError(
            f"Aucune entrée de collection pour la carte {card_id} en {code} "
            f"dans l'extension {card_set_id}."
        )
    return copy


def create_copy(db: Session, payload: CardCopyCreate) -> CardCopy:
    code = catalog.normalize_language_code(payload.language_code)
    if db.get(Card, payload.card_id) is None:
        raise NotFoundError(f"Carte {payload.card_id} introuvable.")
    catalog.get_language(db, code)
    catalog.get_printing(db, payload.card_id, payload.card_set_id)
    if db.get(CardCopy, (payload.card_id, code, payload.card_set_id)) is not None:
        raise ConflictError(
            f"La carte {payload.card_id} est déjà en collection en {code} : "
            "modifier l'entrée existante."
        )
    copy = CardCopy(
        card_id=payload.card_id,
        language_code=code,
        card_set_id=payload.card_set_id,
        quantity_owned=payload.quantity_owned,
        notes=payload.notes,
    )
    db.add(copy)
    commit_or_conflict(
        db, f"La carte {payload.card_id} est déjà en collection en {code}."
    )
    return get_copy(db, copy.card_id, code, copy.card_set_id)


def update_copy(
    db: Session,
    card_id: int,
    language_code: str,
    card_set_id: int,
    payload: CardCopyUpdate,
) -> CardCopy:
    copy = get_copy(db, card_id, language_code, card_set_id)
    changes = payload.model_dump(exclude_unset=True)

    if "quantity_owned" in changes:
        used = allocated_real(db, card_id, copy.language_code, card_set_id)
        if changes["quantity_owned"] < used:
            raise ConflictError(
                f"{used} exemplaire(s) sont alloués à des decks : impossible de "
                f"descendre à {changes['quantity_owned']} possédé(s)."
            )
    for field, value in changes.items():
        setattr(copy, field, value)
    db.commit()
    return copy


def delete_copy(
    db: Session, card_id: int, language_code: str, card_set_id: int
) -> None:
    copy = get_copy(db, card_id, language_code, card_set_id)
    in_decks = db.scalar(
        select(func.count()).select_from(DeckCard).where(
            DeckCard.card_id == card_id,
            DeckCard.language_code == copy.language_code,
            DeckCard.card_set_id == card_set_id,
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
    bundle = catalog.get_bundle(db, bundle_id)
    # Chaque carte est rangée sous l'extension du produit (Lot 4) : toute
    # occurrence `precon` d'un produit désigne une impression de cette
    # extension (vérifié sur le catalogue, cf. docs/lot4-plan-inventaire.md).
    card_set_id = bundle.card_set_id
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
                CardCopy.card_set_id == card_set_id,
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
                card_set_id=card_set_id,
                quantity_owned=0,
                notes=None,
            )
            db.add(copy)
        copy.quantity_owned += per_bundle * payload.count
        copies.append(copy)
    commit_or_conflict(db, "Une entrée de collection a été créée en parallèle.")
    return copies
