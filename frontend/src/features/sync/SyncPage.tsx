import { Pill } from "../../components/Pill";
import { useGuardedAction } from "../../components/useGuardedAction";
import { formatTime, plural } from "../../labels";
import { useFlush, useSyncStatus } from "../../offline/react";
import { RejectedOperations } from "./RejectedOperations";
import type { SyncState } from "./SyncStatusBar";

/**
 * Détail de la synchronisation : état de la file, action manuelle, et
 * opérations refusées (déplacées ici depuis la coquille, Lot 5).
 */
export function SyncPage() {
  const status = useSyncStatus();
  const flush = useFlush();
  const action = useGuardedAction();

  const state: SyncState = !status.online
    ? "offline"
    : status.running || status.sending > 0
      ? "syncing"
      : status.pending > 0
        ? "pending"
        : "synced";

  const waiting = plural(status.pending, "opération") + " en attente";
  const title = {
    offline: "Hors ligne",
    syncing: "Synchronisation en cours…",
    pending: waiting,
    synced: "Tout est à jour",
  }[state];
  const detail =
    state === "pending" && status.lastError
      ? `Serveur injoignable${status.nextRetryAt ? ` · nouvel essai à ${formatTime(status.nextRetryAt)}` : ""}`
      : state === "offline" && status.pending > 0
        ? waiting
        : null;

  return (
    <div className="page" data-testid="sync-page">
      <p className="kicker">Synchronisation</p>
      <div>
        <h2 className="page-title" data-testid="sync-page-title">
          {title}
        </h2>
        {detail && <p className="page-meta">{detail}</p>}
      </div>

      {status.online && status.pending > 0 && (
        <Pill
          compact
          data-testid="sync-flush"
          disabled={action.pending || status.running}
          onClick={() => void action.run(flush)}
        >
          Synchroniser maintenant
        </Pill>
      )}

      <RejectedOperations />
    </div>
  );
}
