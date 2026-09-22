import { useFlush, useSyncStatus } from "../../offline/react";
import { useGuardedAction } from "../../components/useGuardedAction";
import { formatTime, plural } from "../../labels";

export type SyncState = "offline" | "syncing" | "pending" | "synced";

/**
 * Hors ligne, en cours d'envoi, en attente d'un nouvel essai, ou tout à jour.
 * Les refusées sont comptées à part : elles n'empêchent pas la file de passer,
 * mais elles ne doivent jamais passer inaperçues.
 */
export function SyncStatusBar() {
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
  const label = {
    offline: status.pending > 0 ? `Hors ligne : ${waiting}` : "Hors ligne : rien en attente",
    syncing: `Synchronisation en cours… (${waiting})`,
    pending: status.lastError
      ? `${waiting} : serveur injoignable${status.nextRetryAt ? `, nouvel essai à ${formatTime(status.nextRetryAt)}` : ""}`
      : waiting,
    synced: "Tout est à jour",
  }[state];

  return (
    <section
      className="sync-bar"
      aria-label="Synchronisation"
      aria-live="polite"
      data-testid="sync-status"
      data-state={state}
      data-pending={status.pending}
      data-rejected={status.rejected}
    >
      <span data-testid="sync-label">{label}</span>
      {status.rejected > 0 && (
        <strong className="sync-bar__rejected" data-testid="sync-rejected-count">
          {plural(status.rejected, "refusée")}
        </strong>
      )}
      {status.online && status.pending > 0 && (
        <button
          type="button"
          className="button--small"
          data-testid="sync-flush"
          disabled={action.pending || status.running}
          onClick={() => void action.run(flush)}
        >
          Synchroniser maintenant
        </button>
      )}
    </section>
  );
}
