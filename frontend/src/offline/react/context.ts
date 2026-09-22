import { createContext, useContext } from "react";
import type { OfflineCoreDb } from "../core/db";
import type { Outbox } from "../core/outbox";
import type { SyncEngine } from "../core/syncEngine";
import type { OperationEnvelope } from "../core/types";

/** Ce que l'application injecte : la base, la file et le moteur de rejeu. */
export interface OfflineRuntime<TOp extends OperationEnvelope = OperationEnvelope> {
  db: OfflineCoreDb;
  outbox: Outbox<TOp>;
  engine: SyncEngine<TOp>;
  /** Démarre les déclencheurs de synchronisation (idempotent, redémarrable). */
  start(): void;
  /** Les arrête. */
  stop(): void;
}

export const OfflineContext = createContext<OfflineRuntime | null>(null);

export function useOfflineRuntime(): OfflineRuntime {
  const runtime = useContext(OfflineContext);
  if (!runtime) {
    throw new Error("useOfflineRuntime : aucun <OfflineProvider> au-dessus de ce composant.");
  }
  return runtime;
}
