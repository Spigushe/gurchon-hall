// Cœur générique de la couche offline : aucune dépendance au domaine VtES.
export { CORE_STORES_V1, CORE_STORES_V2, OfflineCoreDb, type MetaRow } from "./db";
export { lastSettledSeq, pruneSettled, readSettled } from "./settled";
export { newUuid, toLocalIso } from "./ids";
export { containsFolded, foldText } from "./foldText";
export {
  DuplicateOperationError,
  DuplicateRefError,
  NotRejectedError,
  Outbox,
  type EnqueueOptions,
  type OutboxChange,
  type OutboxCounts,
} from "./outbox";
export {
  DEFAULT_BACKOFF,
  DEFAULT_MAX_BATCH_SIZE,
  SyncEngine,
  type BackoffOptions,
  type FlushResult,
  type FlushSummary,
  type SyncEngineOptions,
  type SyncStatus,
} from "./syncEngine";
export type {
  OperationEnvelope,
  OutboxEntry,
  OutboxState,
  RefBinding,
  Rejection,
  RejectionCode,
  SettledEntry,
  SyncOutcome,
  SyncTransport,
  SyncVerdict,
  TransportResult,
} from "./types";
