"""Rejeu de la file hors ligne : `POST /sync` (Lot 3).

La sémantique est celle de `app.schemas.sync` et de `docs/lot3-sync-contrat.md` ;
ce module ne fait que l'appliquer. Il n'écrit **aucune règle métier** : chaque
opération traverse le service qui porte la règle en ligne (`stock`, `decks`),
qui la refuse pour les mêmes raisons et avec le même message.

Déroulé d'un lot, dans `apply_batch` :

1. la transaction d'écriture exclusive est prise (`app.db.locking`), **avant**
   toute lecture — c'est ce qui rend « vérifier puis écrire » sûr et solde la
   limite connue n° 1 du §11 pour les lots ;
2. les clés d'idempotence du lot sont cherchées au journal, sous ce verrou (un
   lot concurrent qui porte les mêmes clés a donc déjà été validé, ou attend) ;
3. chaque opération est traitée dans l'ordre reçu, sous son propre point de
   sauvegarde :
   * clé connue et même empreinte : verdict d'alors rendu (`replayed`) ;
   * clé connue, autre empreinte : `mismatched_replay`, rien n'est journalisé
     (la clé appartient déjà à l'autre requête) ;
   * clé neuve : le service est appelé. Une erreur métier (404 / 409 / 422 du
     service en ligne) annule ce qu'il avait écrit et se journalise en refus ;
4. tout, effets et journal, est validé d'un seul `COMMIT` à la fin. Un refus ne
   bascule donc jamais le lot, et une opération n'est jamais appliquée sans être
   journalisée (sinon son rejeu, un versement de produit par exemple, la
   réappliquerait).

Une erreur **inattendue** (bogue, base indisponible) n'est pas un verdict : elle
n'est pas journalisée comme refus, remonte en 500 et annule tout le lot. Le
client rejoue alors le même lot, ce qui est sans danger.

Langue inconnue : aucun repli n'est fait ici. Le contrat confie le repli sur
`XX` à la file côté client (`POST /langues` n'ayant pas d'équivalent hors
ligne) ; une langue absente du serveur est donc refusée `not_found`, comme
`POST /stock` la refuserait en ligne.
"""

from dataclasses import dataclass
from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from app.db.locking import serialized_writes
from app.models import CardCopy, DeckCard
from app.models.base import utcnow
from app.models.enums import (
    SyncErrorCode,
    SyncOperationStatus,
    SyncOperationType,
    SyncResourceKind,
)
from app.models.sync import SyncOperation
from app.schemas.collection import CardCopyUpdate, DeckCardUpdate
from app.schemas.sync import (
    AnySyncOperation,
    BundleDepositOperation,
    DeckCardDeleteOperation,
    DeckCardUpsertOperation,
    DeckCreateOperation,
    DeckDeleteOperation,
    DeckRef,
    DeckUpdateOperation,
    StockDeleteOperation,
    StockUpsertOperation,
    SyncOperationError,
    SyncOperationResult,
    SyncOutcome,
    SyncRequest,
    SyncResourceRef,
    SyncResult,
    fingerprint,
)
from app.services import catalog, decks, refs, stock
from app.services.errors import (
    ConflictError,
    DomainError,
    InvalidRequestError,
    NotFoundError,
)
from app.services.refs import UnresolvedClientRef


@dataclass(frozen=True, slots=True)
class Touched:
    """Ressource qu'une opération appliquée a touchée, telle que le journal la garde."""

    kind: SyncResourceKind
    deck_id: int | None = None
    card_id: int | None = None
    language_code: str | None = None
    card_set_id: int | None = None
    bundle_id: int | None = None


# --------------------------------------------------------------------------
# Désignation des decks
# --------------------------------------------------------------------------


def _resolve_deck(db: Session, user_id: int, ref: DeckRef) -> int:
    """Identifiant serveur du deck désigné, par `deck_id` ou par référence client.

    La référence se résout au journal **du compte** (`app.services.refs`), en
    filtrant sur `status = 'applied'` et sur le genre « deck » : une création
    refusée laisse sa trace sans réserver la référence. Le journal étant lu dans
    la transaction du lot, une création faite plus haut dans le même lot est
    déjà visible. Un `deck_id` fourni directement n'est pas vérifié ici : les
    services appelés par `_execute` rendent 404 pour un deck d'un autre compte,
    avec le même message qu'un identifiant inconnu.
    """
    if ref.deck_id is not None:
        return ref.deck_id
    return refs.resolve_client_ref(db, user_id, ref.client_ref, SyncResourceKind.DECK)


# --------------------------------------------------------------------------
# Une opération = un service existant
# --------------------------------------------------------------------------


def _execute(db: Session, user_id: int, operation: AnySyncOperation) -> Touched:
    """Appelle le service de la route en ligne équivalente, pour ce compte."""
    match operation:
        case StockUpsertOperation(data=data):
            code = catalog.normalize_language_code(data.language_code)
            copy_key = (user_id, data.card_id, code, data.card_set_id)
            if db.get(CardCopy, copy_key) is None:
                stock.create_copy(db, user_id, data)
            else:
                # L'état complet voulu : les champs omis valent leur défaut, ils
                # ne conservent pas ce que le serveur avait.
                stock.update_copy(
                    db,
                    user_id,
                    data.card_id,
                    code,
                    data.card_set_id,
                    CardCopyUpdate(
                        quantity_owned=data.quantity_owned,
                        notes=data.notes,
                    ),
                )
            return Touched(
                SyncResourceKind.CARD_COPY,
                card_id=data.card_id,
                language_code=code,
                card_set_id=data.card_set_id,
            )

        case StockDeleteOperation(
            card_id=card_id, language_code=language_code, card_set_id=card_set_id
        ):
            code = catalog.normalize_language_code(language_code)
            stock.delete_copy(db, user_id, card_id, code, card_set_id)
            return Touched(
                SyncResourceKind.CARD_COPY,
                card_id=card_id,
                language_code=code,
                card_set_id=card_set_id,
            )

        case DeckCreateOperation(client_ref=client_ref, data=data):
            # Contrôlé avant l'écriture : la base refuserait le doublon (index
            # unique partiel) mais seulement à l'insertion du journal, quand le
            # deck serait déjà créé.
            existing = refs.applied_creation(db, user_id, client_ref)
            if existing is not None:
                raise ConflictError(
                    f"La référence client {client_ref!r} désigne déjà le deck "
                    f"{existing.deck_id} : une référence n'est jamais réutilisée, "
                    "en tirer une nouvelle."
                )
            deck = decks.create_deck(db, user_id, data)
            return Touched(SyncResourceKind.DECK, deck_id=deck.id)

        case DeckUpdateOperation(deck=ref, data=data):
            deck_id = _resolve_deck(db, user_id, ref)
            decks.update_deck(db, user_id, deck_id, data)
            return Touched(SyncResourceKind.DECK, deck_id=deck_id)

        case DeckDeleteOperation(deck=ref):
            deck_id = _resolve_deck(db, user_id, ref)
            decks.delete_deck(db, user_id, deck_id)
            return Touched(SyncResourceKind.DECK, deck_id=deck_id)

        case DeckCardUpsertOperation(deck=ref, data=data):
            deck_id = _resolve_deck(db, user_id, ref)
            code = catalog.normalize_language_code(data.language_code)
            key = (deck_id, data.card_id, code, data.card_set_id)
            if db.get(DeckCard, key) is None:
                decks.add_card(db, user_id, deck_id, data)
            else:
                decks.update_card(
                    db,
                    user_id,
                    deck_id,
                    data.card_id,
                    code,
                    data.card_set_id,
                    # `acquired_quantity` est un effet de bord, pas un état : sur
                    # une ligne existante, il est borné par ce que le
                    # remplacement ajoute d'exemplaires réels (Lot 4b).
                    DeckCardUpdate(
                        quantity=data.quantity,
                        proxy_quantity=data.proxy_quantity,
                        acquired_quantity=data.acquired_quantity,
                    ),
                )
            return Touched(
                SyncResourceKind.DECK_CARD,
                deck_id=deck_id,
                card_id=data.card_id,
                language_code=code,
                card_set_id=data.card_set_id,
            )

        case DeckCardDeleteOperation(
            deck=ref,
            card_id=card_id,
            language_code=language_code,
            card_set_id=card_set_id,
        ):
            deck_id = _resolve_deck(db, user_id, ref)
            code = catalog.normalize_language_code(language_code)
            decks.remove_card(db, user_id, deck_id, card_id, code, card_set_id)
            return Touched(
                SyncResourceKind.DECK_CARD,
                deck_id=deck_id,
                card_id=card_id,
                language_code=code,
                card_set_id=card_set_id,
            )

        case BundleDepositOperation(bundle_id=bundle_id, data=data):
            stock.deposit_bundle(db, user_id, bundle_id, data)
            return Touched(
                SyncResourceKind.BUNDLE,
                bundle_id=bundle_id,
                language_code=catalog.normalize_language_code(data.language_code),
            )

    raise AssertionError(f"Type d'opération non géré : {operation.type!r}")


def _error_code(error: Exception) -> SyncErrorCode:
    """Le motif de refus qui correspond à l'erreur d'un service."""
    if isinstance(error, UnresolvedClientRef):
        return SyncErrorCode.UNRESOLVED_CLIENT_REF
    if isinstance(error, NotFoundError):
        return SyncErrorCode.NOT_FOUND
    if isinstance(error, InvalidRequestError):
        return SyncErrorCode.INVALID
    return SyncErrorCode.CONFLICT


def _error_message(error: Exception) -> str:
    return error.message if isinstance(error, DomainError) else str(error)


# --------------------------------------------------------------------------
# Journal et verdicts
# --------------------------------------------------------------------------


def _result(entry: SyncOperation, outcome: SyncOutcome) -> SyncOperationResult:
    """Le verdict tel que le journal le mémorise : rien n'est recalculé."""
    resource = None
    if entry.resource_kind is not None:
        resource = SyncResourceRef(
            kind=entry.resource_kind,
            deck_id=entry.deck_id,
            card_id=entry.card_id,
            language_code=entry.language_code,
            card_set_id=entry.card_set_id,
            bundle_id=entry.bundle_id,
            player_id=entry.player_id,
            venue_id=entry.venue_id,
            tournament_id=entry.tournament_id,
            game_id=entry.game_id,
        )
    error = None
    if entry.error_code is not None:
        error = SyncOperationError(code=entry.error_code, message=entry.error_message)
    return SyncOperationResult(
        operation_id=UUID(entry.operation_id),
        type=entry.operation_type,
        outcome=outcome,
        client_ref=entry.client_ref,
        resource=resource,
        error=error,
        processed_at=entry.processed_at,
    )


def _mismatch(operation: AnySyncOperation) -> SyncOperationResult:
    """Clé déjà tranchée revenue avec un autre corps : refusée, non journalisée."""
    return SyncOperationResult(
        operation_id=operation.operation_id,
        type=SyncOperationType(operation.type),
        outcome=SyncOutcome.REJECTED,
        error=SyncOperationError(
            code=SyncErrorCode.MISMATCHED_REPLAY,
            message=(
                f"La clé d'idempotence {operation.operation_id} a déjà servi à "
                "une autre opération : une opération en file ne se modifie pas "
                "sans changer de clé."
            ),
        ),
        processed_at=utcnow(),
    )


def _process(
    db: Session,
    user_id: int,
    operation: AnySyncOperation,
    known: SyncOperation | None,
    body_hash: str,
    batch_id: str,
) -> SyncOperationResult:
    if known is not None:
        if known.request_hash != body_hash:
            return _mismatch(operation)
        return _result(known, SyncOutcome.REPLAYED)

    entry = SyncOperation(
        user_id=user_id,
        operation_id=str(operation.operation_id),
        batch_id=batch_id,
        operation_type=SyncOperationType(operation.type),
        request_hash=body_hash,
        recorded_at=operation.recorded_at,
        processed_at=utcnow(),
        # Renseignée par les seules créations, appliquées ou refusées : c'est
        # « la création qui a donné son identité à cette référence ».
        client_ref=(
            operation.client_ref if isinstance(operation, DeckCreateOperation) else None
        ),
    )
    try:
        touched = _execute(db, user_id, operation)
    except (DomainError, UnresolvedClientRef) as error:
        # Le service a pu écrire avant de refuser : on revient au point de
        # sauvegarde de cette opération, rien de partiel ne reste.
        db.rollback()
        entry.status = SyncOperationStatus.REJECTED
        entry.error_code = _error_code(error)
        entry.error_message = _error_message(error)
        outcome = SyncOutcome.REJECTED
    else:
        entry.status = SyncOperationStatus.APPLIED
        entry.resource_kind = touched.kind
        entry.deck_id = touched.deck_id
        entry.card_id = touched.card_id
        entry.language_code = touched.language_code
        entry.card_set_id = touched.card_set_id
        entry.bundle_id = touched.bundle_id
        outcome = SyncOutcome.APPLIED

    result = _result(entry, outcome)  # avant le commit, qui expire l'objet
    db.add(entry)
    db.commit()  # relâche le point de sauvegarde ; le COMMIT réel est celui du lot
    return result


def apply_batch(engine: Engine, request: SyncRequest, user_id: int) -> SyncResult:
    """Applique un lot d'opérations sous verrou d'écriture, dans l'ordre reçu.

    Prend le moteur et non une session : la transaction est ouverte ici, à la
    main (cf. `app.db.locking`), et une session ordinaire ne peut pas la
    partager.

    `user_id` est le compte de la session qui a envoyé le lot (résolu et
    vérifié par le routeur, une fois, avant l'appel) : l'idempotence et les
    références client sont filtrées par ce compte (Lot 6, §11) — une clé ou
    une référence prise par un autre compte est traitée comme neuve, jamais
    comme un rejeu ni comme un conflit qui le révélerait.

    `WriteLockTimeout` (`app.db.locking`) si une autre écriture tient la base
    au-delà du délai d'attente du pilote : rien n'a été fait, le lot peut être
    renvoyé tel quel.
    """
    batch_id = str(uuid4())
    hashes = [fingerprint(operation) for operation in request.operations]
    keys = [str(operation.operation_id) for operation in request.operations]

    with serialized_writes(engine) as db:
        journal = {
            entry.operation_id: entry
            for entry in db.scalars(
                select(SyncOperation).where(
                    SyncOperation.user_id == user_id,
                    SyncOperation.operation_id.in_(keys),
                )
            )
        }
        results = [
            _process(db, user_id, operation, journal.get(key), body_hash, batch_id)
            for operation, key, body_hash in zip(
                request.operations, keys, hashes, strict=True
            )
        ]

    def count(outcome: SyncOutcome) -> int:
        return sum(1 for result in results if result.outcome is outcome)

    return SyncResult(
        batch_id=UUID(batch_id),
        synced_at=utcnow(),
        applied=count(SyncOutcome.APPLIED),
        replayed=count(SyncOutcome.REPLAYED),
        rejected=count(SyncOutcome.REJECTED),
        results=results,
    )
