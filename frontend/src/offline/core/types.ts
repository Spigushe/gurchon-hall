/**
 * Types du cœur générique de la couche offline : file d'attente et rejeu.
 *
 * Aucune dépendance au domaine (VtES) ni au client d'API généré : le cœur ne
 * connaît que l'enveloppe commune des opérations du protocole `/sync`
 * (`operation_id`, `recorded_at`, `type`) et les trois issues d'un verdict.
 * La forme des charges utiles reste l'affaire de l'adaptateur (`../vtes`).
 */

/** Ce que toute opération de la file porte, quel que soit son domaine. */
export interface OperationEnvelope {
  /** Clé d'idempotence, tirée à la saisie, jamais régénérée. */
  operation_id: string;
  /** Instant de la saisie, ISO 8601 avec fuseau. */
  recorded_at: string;
  /** Intention (`stock.upsert`, `deck.create`…). */
  type: string;
}

/**
 * État local d'une opération **encore présente** dans la file.
 *
 * - `pending` : en attente d'envoi ;
 * - `sending` : envoyée, verdict pas encore reçu (au redémarrage, l'issue est
 *   inconnue : elle repasse en `pending` et se rejoue sous la même clé) ;
 * - `rejected` : refusée par le serveur (ou par la validation locale du lot) ;
 *   elle ne se rejoue pas telle quelle, l'appelant la corrige par
 *   `Outbox.reissue`.
 *
 * L'état « tranchée » du contrat n'est pas stocké : une opération `applied` ou
 * `replayed` sort de la file.
 */
export type OutboxState = "pending" | "sending" | "rejected";

/**
 * Motif d'un refus. Les cinq premiers viennent du serveur (`SyncErrorCode`) ;
 * `invalid_request` est local : le serveur a répondu 422 à cette opération
 * envoyée seule, la charge utile est mal formée.
 */
export type RejectionCode =
  | "not_found"
  | "conflict"
  | "invalid"
  | "unresolved_client_ref"
  | "mismatched_replay"
  | "invalid_request";

export interface Rejection {
  code: RejectionCode;
  /** Texte du service, fait pour être affiché. */
  message: string;
  /** Le verdict venait du journal du serveur (`replayed`), refus mémorisé. */
  replayed: boolean;
}

export interface OutboxEntry<TOp extends OperationEnvelope = OperationEnvelope> {
  /** Clé primaire : la clé d'idempotence. */
  operationId: string;
  /** Rang dans la file (ordre significatif), unique, croissant. */
  rank: number;
  type: string;
  state: OutboxState;
  /** Opération complète, exactement ce qui part vers `/sync`. Jamais modifiée. */
  operation: TOp;
  recordedAt: string;
  /** Nombre d'envois tentés sous cette clé. */
  attempts: number;
  /** Référence client réservée par une création (`deck.create`), sinon absente. */
  clientRef?: string;
  /** Présent seulement en état `rejected`. */
  rejection?: Rejection;
  /** Clé de l'opération refusée que celle-ci remplace (trace de correction). */
  reissuedFrom?: string;
}

/**
 * Opération tranchée (`applied` / `replayed`) dont l'effet n'est peut-être pas
 * encore dans les miroirs de lecture : elle a quitté la file, mais l'instantané
 * du serveur n'a pas été relu depuis. Retenue par `Outbox` (option
 * `retainSettled`) et lue par la projection pour que ce que l'utilisateur voit
 * ne recule pas entre le verdict et le rafraîchissement. Effacée par le
 * rafraîchissement qui a relu le serveur après elle (`core/settled.ts`).
 */
export interface SettledEntry<TOp extends OperationEnvelope = OperationEnvelope> {
  /** Ordre de tranchage, croissant (clé auto-incrémentée). */
  seq?: number;
  operationId: string;
  type: string;
  operation: TOp;
  settledAt: string;
}

/** Correspondance référence client -> identifiant serveur, survit aux redémarrages. */
export interface RefBinding {
  ref: string;
  id: number;
  boundAt: string;
}

export type SyncOutcome = "applied" | "replayed" | "rejected";

/** Verdict du serveur sur une opération, indépendant du format du fil. */
export interface SyncVerdict {
  operationId: string;
  outcome: SyncOutcome;
  error: { code: RejectionCode; message: string } | null;
  /** Correspondances à mémoriser (ex. `client_ref` -> `deck_id`). */
  refs: ReadonlyArray<{ ref: string; id: number }>;
}

/** Résultat d'un envoi de lot, vu du moteur. */
export type TransportResult =
  /** HTTP 200 : un verdict par opération. */
  | { status: "ok"; verdicts: SyncVerdict[] }
  /** HTTP 422 : le lot est mal formé, rien n'a été écrit. */
  | { status: "invalid"; message: string }
  /** Réseau coupé, 503 transitoire, 5xx, toute autre réponse inattendue : rien n'est perdu, on réessaie. */
  | {
      status: "unavailable";
      message: string;
      httpStatus?: number;
      /** Délai conseillé par le serveur (`Retry-After`), en millisecondes. */
      retryAfterMs?: number;
    };

export interface SyncTransport<TOp extends OperationEnvelope> {
  send(operations: TOp[], signal?: AbortSignal): Promise<TransportResult>;
}
