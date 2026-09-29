import { useSyncStatus } from "../../offline/react";
import { formatTime, plural } from "../../labels";

export type SyncState = "offline" | "syncing" | "pending" | "synced";

/**
 * Hors ligne, en cours d'envoi, en attente d'un nouvel essai, ou tout à jour.
 * Les refusées sont comptées à part : elles n'empêchent pas la file de passer,
 * mais elles ne doivent jamais passer inaperçues.
 *
 * Monté en permanence dans la coquille (visuellement masqué depuis le Lot 5,
 * `App.tsx`) : le détail visible et l'action de synchronisation manuelle
 * vivent sur la page `#/synchronisation` (`SyncPage`).
 */
export function SyncStatusBar() {
  const status = useSyncStatus();

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
        <strong data-testid="sync-rejected-count">{plural(status.rejected, "refusée")}</strong>
      )}
    </section>
  );
}
