import { useCallback, useSyncExternalStore } from "react";
import type { SyncStatus } from "../core/syncEngine";
import type { OutboxEntry } from "../core/types";
import { useOfflineRuntime } from "./context";
import { useLiveQuery } from "./useLiveQuery";

/**
 * État de la file et de la connectivité : en attente, en cours d'envoi,
 * refusées, dernier échec, prochain essai. Se met à jour tout seul.
 */
export function useSyncStatus(): SyncStatus {
  const { engine } = useOfflineRuntime();
  return useSyncExternalStore(engine.subscribe, engine.getStatus, engine.getStatus);
}

/** Connectivité déclarée par le navigateur, suivie par le moteur. */
export function useConnectivity(): boolean {
  return useSyncStatus().online;
}

/** Opérations refusées, dans l'ordre de la file, à corriger ou abandonner. */
export function useRejectedOperations(): OutboxEntry[] | undefined {
  const { outbox } = useOfflineRuntime();
  const querier = useCallback(() => outbox.list("rejected"), [outbox]);
  return useLiveQuery(querier);
}

/** Déclenche un rejeu manuel (bouton « Synchroniser »). */
export function useFlush(): () => Promise<void> {
  const { engine } = useOfflineRuntime();
  return useCallback(async () => {
    await engine.flush();
  }, [engine]);
}
