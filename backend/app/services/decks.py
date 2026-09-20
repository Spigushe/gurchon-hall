"""Decks et decklists.

Une carte n'entre dans un deck que si elle est **en collection dans cette
langue** (CLAUDE.md §11, décision 2 — la base l'impose déjà par la clé étrangère
composite `deck_card` → `card_copy`, le service en fait une réponse lisible).
Les ajouts respectent en plus la comptabilité du stock (cf. `app.services.stock`) :
un deck ne consomme que des exemplaires disponibles, et ne joue en proxy que
les cartes dont le proxy est autorisé.

Légalité (cf. `app.services.vtes_rules`) : calculée à la demande, jamais
bloquante pendant la construction — un brouillon est incomplet par nature. Elle
ne gate qu'une chose : passer un deck au statut `active`.

Identité : deux decks peuvent porter le même nom, un **discriminant** de quatre
chiffres tiré par le serveur les distingue (« Malkavien 2022#8561 »). Il est
conservé au renommage, sauf si le nouveau couple (nom, discriminant) est déjà
pris. Le tirage évite les valeurs prises et **réessaie** si la base refuse quand
même (course entre deux requêtes) ; `pick_discriminator` est injectable pour
tester ces deux chemins sans dépendre du hasard.

Cycle de vie : un deck s'archive (`PATCH archived: true` : il sort des listes par
défaut, n'est plus modifiable sauf pour être désarchivé, garde ses exemplaires),
puis se supprime *depuis l'archive*. La suppression est logique : la ligne reste,
la decklist migre de `deck_card` vers `deleted_deck_card` (figée, sans plus rien
réserver dans le stock) et `deleted_at` est posé. Un deck supprimé reste lisible
par son identifiant, jamais en liste, et n'accepte plus aucune écriture.
"""

import random
from collections.abc import Callable, Collection
from datetime import UTC, date, datetime

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app.models import (
    Card,
    CardCategory,
    CardCopy,
    Deck,
    DeckCard,
    DeckStatus,
    DeletedDeckCard,
)
from app.models.base import utcnow
from app.schemas.catalog import CardSummary
from app.schemas.collection import (
    DeckCardCreate,
    DeckCardRead,
    DeckCardUpdate,
    DeckCreate,
    DeckDetailRead,
    DeckLegality,
    DeckListState,
    DeckRead,
    DeckUpdate,
)
from app.services import catalog, stock, vtes_rules
from app.services.errors import ConflictError, InvalidRequestError, NotFoundError
from app.services.persistence import commit_or_conflict
from app.services.text_search import contains_folded

_COMPOSITION_CONFLICT = "La composition du deck contredit la collection."
_WRITE_CONFLICT = "Le deck n'a pas pu être enregistré (écriture concurrente)."

# Espace des discriminants : « 0001 » à « 9999 » (« 0000 » est exclu par la base).
DISCRIMINATOR_COUNT = 9999
# Essais avant de renoncer, quand la base refuse un tirage que le service croyait
# libre. En usage mono-utilisateur, un seul essai suffit ; vingt est un plafond.
DISCRIMINATOR_ATTEMPTS = 20
_ALL_DISCRIMINATORS = tuple(f"{number:04d}" for number in range(1, 10_000))

type Picker = Callable[[Collection[str]], str]


def pick_discriminator(taken: Collection[str]) -> str:
    """Un discriminant au hasard parmi ceux que `taken` ne contient pas."""
    taken = set(taken)
    return random.choice([d for d in _ALL_DISCRIMINATORS if d not in taken])


def _taken_discriminators(
    db: Session, name: str, *, excluding_id: int | None = None
) -> set[str]:
    """Discriminants déjà portés par ce nom — decks supprimés compris.

    L'unicité (nom, discriminant) vaut sur tous les decks : un deck supprimé
    garde son identité d'affichage, rien ne la réattribue.
    """
    stmt = select(Deck.discriminator).where(Deck.name == name)
    if excluding_id is not None:
        stmt = stmt.where(Deck.id != excluding_id)
    return set(db.scalars(stmt))


def _write_with_discriminator[T](
    db: Session,
    name: str,
    write: Callable[[str], T],
    *,
    excluding_id: int | None = None,
    preferred: str | None = None,
    pick: Picker | None = None,
) -> T:
    """Appelle `write(discriminant)` jusqu'à ce que la base accepte le couple.

    `preferred` est essayé en premier s'il est libre (renommage : on garde
    l'identité) ; sinon, et après tout refus de la base, on en tire un autre.
    `write` doit finir par un `flush` pour que le refus survienne ici : la
    session est alors annulée (`rollback`) et `write` rejoué en entier, il doit
    donc pouvoir se répéter sur un état rechargé.

    409 si le nom a épuisé ses 9999 discriminants, ou après
    `DISCRIMINATOR_ATTEMPTS` refus de la base.
    """
    draw = pick or pick_discriminator
    candidate = preferred
    for _ in range(DISCRIMINATOR_ATTEMPTS):
        taken = _taken_discriminators(db, name, excluding_id=excluding_id)
        if len(taken) >= DISCRIMINATOR_COUNT:
            raise ConflictError(
                f"Les {DISCRIMINATOR_COUNT} discriminants du nom {name!r} sont tous "
                "pris : choisir un autre nom."
            )
        if candidate is None or candidate in taken:
            candidate = draw(taken)
        try:
            return write(candidate)
        except IntegrityError:
            db.rollback()  # course : un autre deck a pris le couple entre-temps
            candidate = None
    raise ConflictError(
        f"Aucun discriminant libre n'a pu être attribué au nom {name!r} après "
        f"{DISCRIMINATOR_ATTEMPTS} essais : réessayer."
    )


def _get_deck(db: Session, deck_id: int) -> Deck:
    """Un deck lisible : vivant, archivé ou supprimé (lecture seule)."""
    deck = db.get(Deck, deck_id)
    if deck is None:
        raise NotFoundError(f"Deck {deck_id} introuvable.")
    return deck


def _get_live_deck(db: Session, deck_id: int) -> Deck:
    """Un deck non supprimé (archivé ou non) : la base de toute écriture."""
    deck = _get_deck(db, deck_id)
    if deck.deleted_at is not None:
        raise ConflictError(
            f"Le deck {deck_id} est supprimé : il n'est plus consultable qu'en "
            "lecture seule."
        )
    return deck


def _get_editable_deck(db: Session, deck_id: int) -> Deck:
    """Un deck vivant et non archivé : celui dont on peut changer la composition."""
    deck = _get_live_deck(db, deck_id)
    if deck.archived_at is not None:
        raise ConflictError(
            f"Le deck {deck_id} est archivé : le désarchiver (`archived: false`) "
            "avant de le modifier."
        )
    return deck


def _today() -> date:
    return datetime.now(UTC).date()


def get_legality(db: Session, deck_id: int, on: date | None = None) -> DeckLegality:
    """Verdict de légalité à la date `on` (aujourd'hui UTC par défaut).

    Calculé sur la composition **vivante** : un deck supprimé est refusé (409).
    """
    _get_live_deck(db, deck_id)
    on = on or _today()
    lines = db.scalars(
        select(DeckCard)
        .where(DeckCard.deck_id == deck_id)
        .options(joinedload(DeckCard.card).joinedload(Card.clan))
    ).all()

    crypt = sum(x.quantity for x in lines if x.card.category is CardCategory.CRYPT)
    library = sum(x.quantity for x in lines if x.card.category is CardCategory.LIBRARY)
    # Une carte possédée en deux langues fait deux lignes : on la compte une fois.
    cards = {line.card_id: line.card for line in lines}.values()
    numbers = sorted(
        {
            number
            for card in cards
            if card.category is CardCategory.CRYPT
            and (number := vtes_rules.crypt_group(card.group_code)) is not None
        }
    )

    def label(card: Card) -> str:
        return vtes_rules.card_label(card.name, card.group_code, card.advanced)

    # Les règles de date sont évaluées **par carte** : on leur passe l'identifiant
    # (en texte) à la place du libellé, qui n'identifie pas une carte (deux
    # cartes homonymes ont le même). Les libellés ne servent qu'aux `issues`.
    banned_ids = set(
        vtes_rules.banned_cards(((str(c.id), c.banned_on) for c in cards), on)
    )
    early_ids = set(
        vtes_rules.not_yet_legal_cards(((str(c.id), c.legal_from) for c in cards), on)
    )

    def faulty(ids: set[str]) -> list[Card]:
        return sorted(
            (c for c in cards if str(c.id) in ids),
            key=lambda c: (c.name, c.group_code or "", c.advanced, c.id),
        )

    banned = faulty(banned_ids)
    early = faulty(early_ids)

    issues = vtes_rules.deck_issues(
        crypt,
        library,
        crypt_groups=numbers,
        banned={label(c) for c in banned},
        not_yet_legal={label(c) for c in early},
    )
    return DeckLegality(
        deck_id=deck_id,
        evaluated_on=on,
        crypt_count=crypt,
        library_count=library,
        crypt_minimum=vtes_rules.CRYPT_MINIMUM,
        library_minimum=vtes_rules.LIBRARY_MINIMUM,
        library_maximum=vtes_rules.LIBRARY_MAXIMUM,
        crypt_groups=[f"G{number}" for number in numbers],
        banned_cards=[CardSummary.model_validate(c) for c in banned],
        not_yet_legal_cards=[CardSummary.model_validate(c) for c in early],
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
    db: Session,
    *,
    status: DeckStatus | None = None,
    q: str | None = None,
    state: DeckListState = DeckListState.ACTIVE,
) -> list[Deck]:
    """Decks non supprimés, selon `state` : non archivés, archivés, ou tous."""
    stmt = select(Deck).where(Deck.deleted_at.is_(None))
    if state is DeckListState.ACTIVE:
        stmt = stmt.where(Deck.archived_at.is_(None))
    elif state is DeckListState.ARCHIVED:
        stmt = stmt.where(Deck.archived_at.is_not(None))
    if status is not None:
        stmt = stmt.where(Deck.status == status)
    if q:
        stmt = stmt.where(contains_folded(Deck.name, q))
    return list(db.scalars(stmt.order_by(Deck.name, Deck.discriminator, Deck.id)))


def get_deck_detail(db: Session, deck_id: int) -> DeckDetailRead:
    """Un deck et sa composition ; un deck supprimé se lit depuis sa decklist figée."""
    deck = _get_deck(db, deck_id)
    line_type = DeletedDeckCard if deck.deleted_at is not None else DeckCard
    lines = db.scalars(
        select(line_type)
        .where(line_type.deck_id == deck_id)
        .options(joinedload(line_type.card).joinedload(Card.clan))
    ).all()
    cards = [DeckCardRead.model_validate(line) for line in lines]
    cards.sort(
        key=lambda line: (
            line.card.category is not CardCategory.CRYPT,
            line.card.name,
            line.language_code,
        )
    )
    return DeckDetailRead(**DeckRead.model_validate(deck).model_dump(), cards=cards)


def create_deck(
    db: Session, payload: DeckCreate, *, pick: Picker | None = None
) -> Deck:
    data = payload.model_dump()

    def write(discriminator: str) -> Deck:
        deck = Deck(**data, discriminator=discriminator)
        db.add(deck)
        db.flush()  # l'INSERT part ici : la base a le dernier mot sur l'unicité
        return deck

    deck = _write_with_discriminator(db, payload.name, write, pick=pick)
    if deck.status is DeckStatus.ACTIVE:
        try:
            _ensure_can_activate(db, deck)
        except ConflictError:
            db.rollback()  # rien ne doit rester du deck refusé
            raise
    commit_or_conflict(db, _WRITE_CONFLICT)
    return deck


def update_deck(
    db: Session, deck_id: int, payload: DeckUpdate, *, pick: Picker | None = None
) -> Deck:
    """Modifie un deck, et l'archive ou le désarchive (`archived`).

    Un deck archivé n'accepte qu'un désarchivage (`archived: false`, seul ou
    accompagné d'autres champs, appliqués après). Sans lui, tout champ autre
    qu'`archived` est refusé (409) ; `archived: true` seul sur un deck déjà
    archivé reste un 200 sans effet, la date d'origine étant conservée.
    """
    deck = _get_live_deck(db, deck_id)
    changes = payload.model_dump(exclude_unset=True)
    archived: bool | None = changes.pop("archived", None)

    if deck.archived_at is not None and archived is not False and changes:
        _get_editable_deck(db, deck_id)  # lève le 409 « archivé »

    activating = (
        changes.get("status") is DeckStatus.ACTIVE
        and deck.status is not DeckStatus.ACTIVE
    )
    if activating:
        _ensure_can_activate(db, deck)

    def apply() -> None:
        for field, value in changes.items():
            setattr(deck, field, value)
        if archived is True and deck.archived_at is None:
            deck.archived_at = utcnow()
        elif archived is False:
            deck.archived_at = None

    renaming = "name" in changes and changes["name"] != deck.name
    if renaming:

        def write(discriminator: str) -> None:
            apply()
            deck.discriminator = discriminator
            db.flush()

        _write_with_discriminator(
            db,
            changes["name"],
            write,
            excluding_id=deck_id,
            preferred=deck.discriminator,
            pick=pick,
        )
    else:
        apply()
    commit_or_conflict(db, _WRITE_CONFLICT)
    # Relu depuis la base, comme le fera un GET : sans cela `updated_at` (posé
    # côté Python, avec fuseau) et `archived_at` sortiraient autrement que lus.
    db.refresh(deck)
    return deck


def delete_deck(db: Session, deck_id: int) -> None:
    """Suppression **logique**, possible seulement depuis l'archive.

    En une transaction : la decklist est recopiée dans `deleted_deck_card`, les
    lignes vivantes sont supprimées (le stock est libéré, proxies compris) et
    `deleted_at` est posé. Le deck et ses participations restent en base : un
    deck joué garde son historique.
    """
    deck = _get_live_deck(db, deck_id)
    if deck.archived_at is None:
        raise ConflictError(
            f"Le deck {deck_id} n'est pas archivé : l'archiver avant de le supprimer."
        )
    for line in db.scalars(select(DeckCard).where(DeckCard.deck_id == deck_id)):
        db.add(
            DeletedDeckCard(
                deck_id=deck_id,
                card_id=line.card_id,
                language_code=line.language_code,
                quantity=line.quantity,
                proxy_quantity=line.proxy_quantity,
            )
        )
        db.delete(line)
    deck.deleted_at = utcnow()
    db.commit()


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


def _commit(db: Session, message: str = _COMPOSITION_CONFLICT) -> None:
    """Commit dont le refus d'intégrité devient un 409.

    Filet : la base refuse ce que le service aurait laissé passer (course).
    """
    commit_or_conflict(db, message)


def add_card(db: Session, deck_id: int, payload: DeckCardCreate) -> DeckCard:
    deck = _get_editable_deck(db, deck_id)
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
    deck = _get_editable_deck(db, deck_id)
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
    deck = _get_editable_deck(db, deck_id)
    line = _load_line(
        db, deck_id, card_id, catalog.normalize_language_code(language_code)
    )
    db.delete(line)
    deck.updated_at = utcnow()
    db.commit()
