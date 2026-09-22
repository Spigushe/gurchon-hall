"""Journal d'idempotence de la file hors ligne (`POST /sync`, Lot 3).

Une ligne par opération **reçue et tranchée**, appliquée ou refusée. Le journal
sert trois choses, et rien d'autre :

1. **L'idempotence.** La clé est `operation_id`, tirée par le client. Une
   opération déjà journalisée n'est pas rejouée : le serveur rend le verdict
   mémorisé. C'est ce qui rend `POST /bundles/{id}/stock` — qui additionne à
   chaque appel — rejouable sans double comptage dès lors qu'il passe par
   `/sync` (limite connue n° 2 du §11).
2. **La résolution des identifiants créés hors ligne.** Un deck créé sans
   réseau n'a pas encore d'`id` serveur ; le client le désigne par un
   `client_ref` qu'il a tiré lui-même. La ligne appliquée qui l'a créé garde ce
   `client_ref` *et* l'`id` obtenu : la correspondance survit donc au lot, et
   une opération d'un lot ultérieur peut encore désigner le deck par sa
   référence client, même si le client a perdu la réponse.
3. **La détection d'un rejeu incohérent.** `request_hash` est l'empreinte du
   corps reçu (cf. `app.schemas.sync.fingerprint`). Même `operation_id` avec un
   corps différent n'est pas un rejeu mais un bug côté client : le serveur
   refuse plutôt que de rendre en silence le résultat d'une autre requête.

Les colonnes suffisent à reconstituer la réponse d'origine
(`app.schemas.sync.SyncOperationResult`) sans rien recalculer : c'est la
définition même d'un journal d'idempotence — on rend ce qu'on avait rendu.

**Aucune clé étrangère**, volontairement, alors que les autres tables en sont
tissées. Un journal est en ajout seul : il décrit ce qui s'est passé, pas ce qui
existe. Le lier aux ressources qu'il mentionne le rendrait dépendant de leur
cycle de vie (un jour, une purge des decks), et le couplerait au schéma métier
alors que toute la mécanique doit pouvoir être portée telle quelle sur
barrins-project (CLAUDE.md §1). Les colonnes `deck_id`, `card_id`,
`language_code` et `bundle_id` sont donc des identifiants, pas des relations.
"""

from datetime import datetime

from sqlalchemy import CheckConstraint, Index, String, Text, text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, utcnow
from app.models.enums import (
    SyncErrorCode,
    SyncOperationStatus,
    SyncOperationType,
    SyncResourceKind,
    enum_column,
)
from app.models.types import UtcDateTime

# Un UUID en représentation canonique (« 8-4-4-4-12 »).
UUID_LENGTH = 36
# sha256 en hexadécimal.
HASH_LENGTH = 64
# Référence libre tirée par le client ; un UUID est attendu, sans obligation.
CLIENT_REF_LENGTH = 64

# Une référence client ne désigne qu'un objet, mais seulement parmi les
# opérations **appliquées** : une création refusée laisse sa trace au journal
# sans bloquer la reprise de la même référence par une seconde tentative
# corrigée (qui porte, elle, un autre `operation_id`). C'est aussi la condition
# que la résolution `client_ref` → `deck_id` doit filtrer.
_APPLIED_CLIENT_REF = text("client_ref IS NOT NULL AND status = 'applied'")


class SyncOperation(Base):
    """Verdict rendu sur une opération de la file hors ligne."""

    __tablename__ = "sync_operation"
    __table_args__ = (
        Index(
            "ux_sync_operation_client_ref",
            "client_ref",
            unique=True,
            sqlite_where=_APPLIED_CLIENT_REF,
            postgresql_where=_APPLIED_CLIENT_REF,
        ),
        Index("ix_sync_operation_batch_id", "batch_id"),
        # Un refus porte toujours son motif, une réussite n'en porte jamais.
        CheckConstraint(
            "(status = 'rejected') = (error_code IS NOT NULL)",
            name="error_code_iff_rejected",
        ),
        # Une opération appliquée a forcément touché quelque chose ; un refus,
        # lui, peut n'avoir rien touché (ressource introuvable).
        CheckConstraint(
            "status <> 'applied' OR resource_kind IS NOT NULL",
            name="resource_kind_when_applied",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)

    # --- Identité de l'opération -------------------------------------------
    operation_id: Mapped[str] = mapped_column(String(UUID_LENGTH), unique=True)
    """Clé d'idempotence, tirée par le client (UUID) et jamais réutilisée."""
    batch_id: Mapped[str] = mapped_column(String(UUID_LENGTH))
    """Requête `/sync` qui a tranché l'opération — posé par le serveur.

    Sans valeur métier : sert à relire d'un bloc ce qu'une synchronisation a
    fait, quand une file rejouée se met à produire des refus inattendus.
    """
    operation_type: Mapped[SyncOperationType] = mapped_column(
        enum_column(SyncOperationType, "sync_operation_type")
    )
    request_hash: Mapped[str] = mapped_column(String(HASH_LENGTH))
    """Empreinte du corps reçu (cf. `app.schemas.sync.fingerprint`)."""

    # --- Verdict ------------------------------------------------------------
    status: Mapped[SyncOperationStatus] = mapped_column(
        enum_column(SyncOperationStatus, "sync_operation_status")
    )
    error_code: Mapped[SyncErrorCode | None] = mapped_column(
        enum_column(SyncErrorCode, "sync_error_code")
    )
    error_message: Mapped[str | None] = mapped_column(Text())
    """Le message du service, tel que l'utilisateur doit le lire."""

    # --- Ressource touchée --------------------------------------------------
    client_ref: Mapped[str | None] = mapped_column(String(CLIENT_REF_LENGTH))
    """Référence que **cette** opération a attribuée à l'objet qu'elle a créé.

    Renseignée par les seules opérations de création (`deck.create` à ce jour),
    jamais par celles qui se contentent de *désigner* un objet par sa référence
    (`DeckRef.client_ref`) : sans quoi l'index unique partiel ci-dessus
    refuserait la deuxième opération portant sur le même deck. Ce qui est
    unique ici, c'est « la création qui a donné son identité à cette
    référence », pas « les opérations qui la mentionnent ».
    """
    resource_kind: Mapped[SyncResourceKind | None] = mapped_column(
        enum_column(SyncResourceKind, "sync_resource_kind")
    )
    deck_id: Mapped[int | None] = mapped_column()
    card_id: Mapped[int | None] = mapped_column()
    language_code: Mapped[str | None] = mapped_column(String(8))
    bundle_id: Mapped[int | None] = mapped_column()

    # --- Horodatages (UTC) --------------------------------------------------
    recorded_at: Mapped[datetime] = mapped_column(UtcDateTime())
    """Instant de la saisie, à l'horloge du client.

    Conservé tel quel : c'est la seule trace de *quand* l'utilisateur a agi —
    au club, sans réseau — par opposition à `processed_at`, qui dit quand le
    serveur l'a appris. L'horloge d'un téléphone n'est pas une autorité ; rien
    de métier ne doit en dépendre, l'ordre d'application venant de la file et
    non des horodatages (cf. `app.schemas.sync`, « politique de conflit »).
    """
    processed_at: Mapped[datetime] = mapped_column(UtcDateTime(), default=utcnow)
    """Instant du verdict, à l'horloge du serveur."""
