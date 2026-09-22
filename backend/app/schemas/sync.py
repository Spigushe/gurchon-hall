"""Contrat de la file de synchronisation hors ligne — `POST /sync` (Lot 3).

Le principe, posé au §3 de CLAUDE.md : une saisie faite sans réseau part en
file d'attente côté navigateur (IndexedDB), puis se rejoue vers l'API au retour
de la connexion. `/sync` est le seul point d'entrée de ce rejeu.

## Ce qu'une requête transporte

Un **lot ordonné** d'opérations, chacune étant une écriture que le client
aurait faite en ligne sur une route existante. Deux champs sont communs à
toutes :

* `operation_id` — la **clé d'idempotence**, un UUID tiré par le client au
  moment de la saisie, jamais réutilisé. C'est lui, et lui seul, qui distingue
  « l'utilisateur a versé deux fois le même produit » de « le réseau a coupé et
  le client a rejoué le même versement ». Une clé qui revient avec un corps
  différent n'est pas un rejeu mais une collision, et se refuse
  (`mismatched_replay`) : une opération déjà en file ne se modifie pas sans
  changer de clé.
* `recorded_at` — l'instant de la saisie à l'horloge du client, fuseau
  obligatoire. Il documente le journal ; aucune règle métier ne s'y adosse
  (l'horloge d'un téléphone n'est pas une autorité).

Le reste est la charge utile de la route correspondante, **réutilisée telle
quelle** : `data: CardCopyCreate`, `data: DeckCreate`, `data: DeckUpdate`,
`data: DeckCardCreate`, `data: BundleDeposit`. Ce n'est pas un détail
d'implémentation : le client construit la même charge utile qu'il aurait
envoyée en ligne, et n'a donc qu'une forme à écrire, à stocker et à tester.

## Ce qu'une réponse rend

Un résultat **par opération, dans le même ordre** (`SyncResult.results`). Trois
issues possibles (`SyncOutcome`) : appliquée, rejouée (le verdict venait du
journal, rien n'a été refait), ou refusée avec un motif lisible. Un refus ne
fait jamais échouer le lot : les opérations suivantes sont traitées.

Le « conflit » n'est pas une quatrième issue mais un **motif** de refus
(`outcome = "rejected"`, `error.code = "conflict"`). Deux axes valent mieux
qu'un : l'issue dit si l'écriture a eu lieu, le code dit pourquoi elle n'a pas
eu lieu, et le client trie sa file sur le second sans réécrire sa logique à
chaque motif ajouté.

## Politique de conflit : la file fait foi, les invariants font loi

Décidée au Lot 3, et volontairement simple — l'application est
mono-utilisateur, et le serveur ne bouge que sous l'action de ce client :

1. **Pas d'arbitrage sur l'horloge.** Aucune comparaison entre `recorded_at` et
   la date de dernière modification côté serveur : l'horloge d'un téléphone
   dérive, se remet à l'heure d'un coup et voyage avec son propriétaire.
   L'ordre qui compte est celui de la file.
2. **La dernière écriture de la file gagne.** Les opérations d'un lot sont
   appliquées dans l'ordre reçu, et les charges utiles d'upsert portent l'état
   complet voulu : une file rejouée écrase donc l'état serveur, sans se
   demander ce qu'il contenait. C'est le comportement attendu d'une saisie
   faite « pour de vrai » au club, que le réseau n'a fait que retarder.
3. **Un invariant refuse, et lui seul.** Une opération n'est rejetée que si le
   serveur l'aurait refusée en ligne : ressource introuvable (`not_found`),
   règle métier contredite (`conflict` — exemplaires insuffisants, proxy
   interdit, deck archivé ou supprimé, activation d'un deck illégal), ou
   charge utile invalide après fusion (`invalid`). Les règles restent celles
   des services : `/sync` ne les assouplit ni ne les durcit.
4. **Un refus n'arrête rien.** Le lot continue, et le client garde la main :
   un refus lui revient avec son message, à lui de corriger la saisie. Seule
   conséquence en chaîne : une création refusée rend irrésolvables les
   opérations qui la désignaient, refusées à leur tour
   (`unresolved_client_ref`).

Ce qui n'est **pas** fait, et qui reste ouvert : aucune garde optimiste
(« n'applique que si la ressource est encore dans l'état X »). Le jour où deux
appareils écriraient la même base, il faudrait ajouter une condition par
opération ; le contrat l'accueillerait sans rupture, puisque ce serait un champ
facultatif de plus.

## Désigner un deck qui n'existe pas encore

C'est le point structurant du lot. Un deck créé hors ligne n'a pas d'`id`
serveur, et il ne peut pas en avoir : son **discriminant est tiré par le
serveur** (CLAUDE.md §11), donc son identité n'est connue qu'après coup. Le
client lui donne alors une référence à lui, un `client_ref` (un UUID, comme
`operation_id`, jamais réutilisé), que `DeckCreateOperation` porte et que les
opérations suivantes réemploient via `DeckRef`.

La correspondance `client_ref` → `deck_id` est **mémorisée au journal**
(`app.models.sync.SyncOperation`), pas seulement le temps d'une requête : un
lot ultérieur peut encore désigner le deck par sa référence client, même si le
client a perdu la réponse qui lui donnait l'`id`. Ajouter des cartes au deck
tout juste créé fonctionne donc aussi bien dans le même lot qu'un mois plus
tard.

## Ce que `/sync` n'est pas

Un canal de lecture. Rien ne redescend ici que des verdicts : après une
synchronisation, le client rafraîchit ce qui l'intéresse par les `GET`
existants (il est en ligne, par construction). Un delta descendant
(« qu'est-ce qui a changé depuis ? ») n'a pas de sens dans une application
mono-utilisateur où le serveur ne bouge que sous l'action de ce client.
"""

import json
from datetime import datetime
from enum import StrEnum
from hashlib import sha256
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, Field, StringConstraints, model_validator

from app.models.enums import (
    SyncErrorCode,
    SyncOperationType,
    SyncResourceKind,
)
from app.schemas.base import (
    MAX_DB_INT,
    AwareDateTime,
    ReadModel,
    RequiredText,
    WriteModel,
)
from app.schemas.collection import (
    BundleDeposit,
    CardCopyCreate,
    DeckCardCreate,
    DeckCreate,
    DeckUpdate,
)

MAX_SYNC_OPERATIONS = 200
"""Opérations acceptées dans un lot.

Une borne plutôt qu'un flux : un lot est traité en une passe, sous verrou
d'écriture (cf. `app.routers.sync`), et un lot sans limite tiendrait ce verrou
aussi longtemps que le client le voudrait. Une file plus longue se découpe côté
client, ce qui est sans danger puisque chaque opération porte sa propre clé
d'idempotence et que les références client survivent d'un lot à l'autre.
"""

ClientRef = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=64)
]
"""Référence qu'un client donne à un objet qu'il vient de créer hors ligne.

Un UUID est attendu, mais le contrat ne l'impose pas : ce qui compte est
qu'elle soit **unique et jamais réutilisée**, y compris entre deux
installations de l'application. Une référence déjà employée par une création
appliquée est refusée.
"""


class SyncOutcome(StrEnum):
    """Issue d'une opération, du point de vue du client.

    `REPLAYED` n'est pas un état stocké (le journal ne connaît que « appliquée »
    et « refusée ») : c'est la façon dont le serveur a répondu — il a retrouvé
    la clé d'idempotence et rendu le verdict d'alors sans rien refaire. Ce
    verdict peut très bien avoir été un refus : `error` le dit.
    """

    APPLIED = "applied"
    REPLAYED = "replayed"
    REJECTED = "rejected"


class DeckRef(WriteModel):
    """Désignation d'un deck : son identifiant serveur, ou sa référence client.

    Exactement l'un des deux. `deck_id` pour un deck que le client a déjà vu
    revenir du serveur ; `client_ref` pour un deck créé hors ligne, dont
    l'identifiant n'existe pas encore au moment où la file est constituée.
    """

    deck_id: int | None = Field(default=None, ge=1, le=MAX_DB_INT)
    client_ref: ClientRef | None = Field(
        default=None,
        description=(
            "Référence donnée par le client au deck lors de sa création hors "
            "ligne (`deck.create`). Résolue par le serveur, dans ce lot ou dans "
            "un lot antérieur."
        ),
    )

    @model_validator(mode="after")
    def _exactly_one_designation(self) -> DeckRef:
        if (self.deck_id is None) == (self.client_ref is None):
            raise ValueError(
                "désigner le deck par `deck_id` (identifiant serveur) ou par "
                "`client_ref` (référence de création hors ligne), mais pas les "
                "deux ni aucun des deux."
            )
        return self


class SyncOperationBase(WriteModel):
    """Ce que toute opération porte, quelle que soit son intention."""

    operation_id: UUID = Field(
        description=(
            "Clé d'idempotence tirée par le client (UUID), fixée à la saisie et "
            "jamais réutilisée. Rejouer le même identifiant rend le verdict "
            "d'origine sans rien réappliquer."
        )
    )
    recorded_at: AwareDateTime = Field(
        description=(
            "Instant de la saisie à l'horloge du client, fuseau obligatoire, "
            "normalisé en UTC. Journalisé ; sans effet sur les règles métier."
        )
    )


class StockUpsertOperation(SyncOperationBase):
    """Crée ou remplace une entrée de collection (carte × langue).

    `data` porte l'**état complet voulu** de l'entrée : les champs omis
    reprennent leur valeur par défaut (0 exemplaire, proxy interdit, pas de
    note), ils ne conservent pas ce que le serveur avait. C'est ce qui rend
    l'opération indifférente à l'ordre du rejeu.

    Les règles de stock restent celles du serveur : descendre
    `quantity_owned` sous ce que les decks ont déjà alloué, ou retirer le droit
    de proxy alors qu'un deck en joue, est refusé (`conflict`).
    """

    type: Literal["stock.upsert"]
    data: CardCopyCreate


class StockDeleteOperation(SyncOperationBase):
    """Retire une entrée de collection.

    Refusée (`conflict`) tant qu'un deck vivant l'utilise, comme
    `DELETE /stock/{card_id}/{language_code}`.
    """

    type: Literal["stock.delete"]
    card_id: int = Field(ge=1, le=MAX_DB_INT)
    language_code: RequiredText = Field(max_length=8)


class DeckCreateOperation(SyncOperationBase):
    """Crée un deck saisi hors ligne.

    `client_ref` est **obligatoire** : sans elle, aucune des opérations
    suivantes de la file ne pourrait désigner le deck, puisque son identifiant
    n'existe pas encore. Le discriminant, lui, reste tiré par le serveur
    (CLAUDE.md §11) — un client ne le fournit jamais, hors ligne pas plus
    qu'en ligne.
    """

    type: Literal["deck.create"]
    client_ref: ClientRef = Field(
        description=(
            "Référence du deck côté client, unique et jamais réutilisée (UUID "
            "attendu). Les opérations suivantes s'en servent pour désigner ce "
            "deck, dans ce lot comme dans les suivants."
        )
    )
    data: DeckCreate


class DeckUpdateOperation(SyncOperationBase):
    """Modifie un deck — y compris pour l'archiver ou le désarchiver.

    `data` suit la sémantique de `PATCH /decks/{id}` : seuls les champs fournis
    sont appliqués, et `archived` range ou sort de l'archive. Passer le deck à
    `active` exige qu'il soit légal, comme en ligne.
    """

    type: Literal["deck.update"]
    deck: DeckRef
    data: DeckUpdate


class DeckDeleteOperation(SyncOperationBase):
    """Supprime logiquement un deck archivé (cf. `DELETE /decks/{id}`)."""

    type: Literal["deck.delete"]
    deck: DeckRef


class DeckCardUpsertOperation(SyncOperationBase):
    """Place une carte dans un deck, ou remplace sa ligne.

    `data` porte l'état complet voulu de la ligne (`quantity`,
    `proxy_quantity`). La carte doit être en collection dans cette langue et
    les exemplaires disponibles doivent suffire : sinon `conflict`, comme en
    ligne.
    """

    type: Literal["deck_card.upsert"]
    deck: DeckRef
    data: DeckCardCreate


class DeckCardDeleteOperation(SyncOperationBase):
    """Retire une carte d'un deck."""

    type: Literal["deck_card.delete"]
    deck: DeckRef
    card_id: int = Field(ge=1, le=MAX_DB_INT)
    language_code: RequiredText = Field(max_length=8)


class BundleDepositOperation(SyncOperationBase):
    """Verse le contenu d'un produit dans la collection.

    L'opération qui justifie à elle seule le journal : hors `/sync`,
    `POST /bundles/{id}/stock` additionne le produit à chaque appel, donc un
    rejeu double le stock. Passée par ici, elle est tranchée une fois pour
    toutes — un second envoi de la même clé d'idempotence est « rejouée », sans
    effet.
    """

    type: Literal["bundle.deposit"]
    bundle_id: int = Field(ge=1, le=MAX_DB_INT)
    data: BundleDeposit


AnySyncOperation = Annotated[
    StockUpsertOperation
    | StockDeleteOperation
    | DeckCreateOperation
    | DeckUpdateOperation
    | DeckDeleteOperation
    | DeckCardUpsertOperation
    | DeckCardDeleteOperation
    | BundleDepositOperation,
    Field(discriminator="type"),
]
"""Union discriminée par `type`.

Le discriminant produit un `oneOf` assorti d'une table de correspondance dans
l'OpenAPI, donc une union discriminée exploitable telle quelle en TypeScript :
tester `op.type === "deck.create"` suffit à obtenir `client_ref` et `data`
correctement typés, sans garde ni cast.
"""


class SyncRequest(WriteModel):
    """Un lot d'opérations à rejouer, dans l'ordre où elles ont été saisies."""

    operations: list[AnySyncOperation] = Field(
        min_length=1,
        max_length=MAX_SYNC_OPERATIONS,
        description=(
            "Opérations à appliquer dans l'ordre donné. L'ordre compte : une "
            "carte ne s'ajoute qu'à un deck déjà créé."
        ),
    )

    @model_validator(mode="after")
    def _keys_are_unique(self) -> SyncRequest:
        """Deux opérations d'un même lot ne partagent ni clé ni référence.

        Ce n'est pas une règle métier mais un contrôle de cohérence : un lot
        qui répète une clé d'idempotence ou une référence client est mal formé
        (le client a dupliqué une entrée de sa file), et le traiter
        reviendrait à deviner laquelle des deux il voulait. 422, donc, avant
        toute écriture.
        """
        seen_ops: set[UUID] = set()
        seen_refs: set[str] = set()
        for index, operation in enumerate(self.operations):
            if operation.operation_id in seen_ops:
                raise ValueError(
                    f"opération {index} : la clé d'idempotence "
                    f"{operation.operation_id} apparaît deux fois dans le lot."
                )
            seen_ops.add(operation.operation_id)
            client_ref = getattr(operation, "client_ref", None)
            if client_ref is not None:
                if client_ref in seen_refs:
                    raise ValueError(
                        f"opération {index} : la référence client {client_ref!r} "
                        "est utilisée par deux créations du même lot."
                    )
                seen_refs.add(client_ref)
        return self


class SyncOperationError(ReadModel):
    """Motif de refus d'une opération.

    `code` est fait pour le code du client (router l'opération vers une file
    « à corriger », par exemple), `message` pour l'utilisateur : c'est le texte
    du service qui a refusé, celui-là même que la route en ligne aurait mis
    dans son 404 ou son 409.
    """

    code: SyncErrorCode
    message: str


class SyncResourceRef(ReadModel):
    """Identité de la ressource touchée par une opération.

    Volontairement réduite à des identifiants : la réponse ne renvoie pas les
    objets. Un versement de produit touche des centaines d'entrées de
    collection, et le client est en ligne au moment où il synchronise — il
    rafraîchit par les `GET` existants. Ce dont il a réellement besoin ici,
    c'est du `deck_id` attribué à un deck créé hors ligne.
    """

    kind: SyncResourceKind
    deck_id: int | None = None
    card_id: int | None = None
    language_code: str | None = None
    bundle_id: int | None = None


class SyncOperationResult(ReadModel):
    """Verdict rendu sur une opération du lot."""

    operation_id: UUID
    type: SyncOperationType
    outcome: SyncOutcome
    client_ref: str | None = Field(
        default=None,
        description=(
            "Référence client de l'opération, renvoyée telle quelle. Avec "
            "`resource.deck_id`, c'est la correspondance que le client doit "
            "enregistrer pour ses prochaines requêtes."
        ),
    )
    resource: SyncResourceRef | None = Field(
        default=None,
        description="Ressource touchée ; nul si l'opération a été refusée.",
    )
    error: SyncOperationError | None = Field(
        default=None,
        description=(
            "Motif du refus ; nul si l'opération a abouti. Une opération "
            "`replayed` peut en porter un : c'est alors le refus mémorisé."
        ),
    )
    processed_at: datetime = Field(
        description=(
            "Instant du verdict (UTC). Pour une opération rejouée, c'est celui "
            "du verdict d'origine, pas celui de ce rejeu."
        )
    )


class SyncResult(ReadModel):
    """Réponse de `POST /sync` : un verdict par opération, dans le même ordre."""

    batch_id: UUID = Field(
        description=(
            "Identifiant de ce traitement, tiré par le serveur. Sans valeur "
            "métier : il sert à relier une trace client à ce qui a été "
            "journalisé côté serveur."
        )
    )
    synced_at: datetime = Field(description="Instant du traitement du lot (UTC).")
    applied: int = Field(description="Opérations appliquées maintenant.")
    replayed: int = Field(description="Opérations déjà connues, non réappliquées.")
    rejected: int = Field(description="Opérations refusées, motif à l'appui.")
    results: list[SyncOperationResult] = Field(
        default=[],
        description="Un résultat par opération reçue, dans l'ordre de la requête.",
    )


def fingerprint(operation: BaseModel) -> str:
    """Empreinte du corps d'une opération, telle que le journal la mémorise.

    Sert à un seul contrôle : un `operation_id` déjà vu doit revenir avec le
    **même corps**. Sinon ce n'est pas un rejeu mais une collision de clé, et
    rendre le verdict d'une autre requête serait plus grave que de refuser.

    La recette est figée ici parce qu'elle doit rester stable dans le temps —
    une empreinte calculée autrement ferait passer d'anciennes opérations pour
    incohérentes :

    1. `model_dump(mode="json", exclude_unset=True)` — la représentation JSON
       des seuls champs **fournis**. `exclude_unset` est essentiel : sans lui,
       « effacer les notes » (`notes: null` explicite) et « ne pas toucher aux
       notes » donneraient la même empreinte alors que ce sont deux requêtes
       différentes ;
    2. `json.dumps` à clés triées, sans espace, sans échappement non-ASCII ;
    3. sha256 de l'UTF-8 obtenu, en hexadécimal (64 caractères).
    """
    payload = operation.model_dump(mode="json", exclude_unset=True)
    canonical = json.dumps(
        payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    )
    return sha256(canonical.encode("utf-8")).hexdigest()
