import { useMemo, useRef, useState } from "react";
import { Kbd } from "../../components/Kbd";
import { Pill } from "../../components/Pill";
import { useGuardedAction } from "../../components/useGuardedAction";
import { useIsDesktop } from "../../components/useIsDesktop";
import { useKeyboardShortcuts } from "../../components/useKeyboardShortcuts";
import { formatTime, plural } from "../../labels";
import { type OutboxEntry } from "../../offline/core";
import { useFlush, usePendingOperations, useRejectedOperations, useSyncStatus } from "../../offline/react";
import { type VtesOperation } from "../../offline/vtes";
import { RejectedDetailPanel, RejectedOperations } from "./RejectedOperations";
import type { SyncState } from "./SyncStatusBar";
import { useOperationDescriber } from "./useOperationLabels";

type Entry = OutboxEntry<VtesOperation>;

/**
 * Même point de typage que le wrapper (non exporté, `react-refresh/only-export-components`)
 * de `RejectedOperations.tsx` : le hook générique rend des entrées d'enveloppe,
 * cette file n'en contient que des opérations VtES.
 */
function useRejectedVtesOperations(): Entry[] | undefined {
  return useRejectedOperations() as Entry[] | undefined;
}

/** Symétrique au wrapper ci-dessus, pour la file « en attente ». */
function usePendingVtesOperations(): Entry[] | undefined {
  return usePendingOperations() as Entry[] | undefined;
}

/** Référence stable : une liste vide recréée à chaque rendu relancerait les lectures. */
const NO_ENTRIES: Entry[] = [];

/**
 * Liste « En attente » du panneau bureau (DESKTOP.md « d06 ») : purement
 * informative, sans sélection ni action — contrairement à la liste Refusées,
 * une opération en attente n'a rien à corriger. Nouvelle (aucun équivalent
 * mobile aujourd'hui, cf. CLAUDE.md § 11 Lot 5bis « pas de conception mobile
 * en cours de route » : ce manque, s'il se confirme, relève du Lot 5c).
 */
function PendingOperationsList() {
  const entries = usePendingVtesOperations();
  const describe = useOperationDescriber(entries ?? NO_ENTRIES);

  if (!entries || entries.length === 0) return null;

  return (
    <section aria-labelledby="pending-title">
      <p id="pending-title" className="kicker">
        {plural(entries.length, "opération en attente", "opérations en attente")}
      </p>
      <ul className="sync-pending-list" data-testid="sync-pending-list">
        {entries.map((entry) => (
          <li key={entry.operationId} className="sync-pending-row" data-testid="pending-operation">
            <span className="row__name">{describe(entry.operation)}</span>
            <span className="sync-pending-row__time">{formatTime(entry.recordedAt)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Détail de la synchronisation : état de la file, action manuelle, et
 * opérations refusées (déplacées ici depuis la coquille, Lot 5).
 *
 * Bureau (≥ 1024px, Lot 5bis étape 12, `docs/design-handoff-mobile/DESKTOP.md`
 * « d06 ») : grille deux colonnes (`sync-columns`, transparente en mobile
 * comme `decks-grid`, `DecksPage.tsx` étape 6) — à gauche l'état, le bouton
 * « Synchroniser maintenant » (toujours visible, désactivé hors ligne ou sans
 * rien à envoyer), la liste Refusées désormais sélectionnable et la liste En
 * attente ; à droite (`sync-detail`), la correction de l'opération refusée
 * sélectionnée (`RejectedDetailPanel`), avec repli sur la première entrée
 * refusée quand la sélection courante disparaît (même motif que
 * `selectedDeck` dans `DecksPage.tsx`). Sous 1024px, rien ne change depuis le
 * Lot 5 : une seule colonne, chaque ligne refusée garde son bascule local
 * (`RejectedOperations`, `isDesktop` par défaut faux).
 */
export function SyncPage() {
  const status = useSyncStatus();
  const flush = useFlush();
  const action = useGuardedAction();
  const isDesktop = useIsDesktop();
  const rejectedEntries = useRejectedVtesOperations();
  const [selectedOperationId, setSelectedOperationId] = useState<string | null>(null);
  const detailRef = useRef<HTMLDivElement>(null);

  const selectedEntry = useMemo(
    () =>
      rejectedEntries?.find((entry) => entry.operationId === selectedOperationId) ?? rejectedEntries?.[0] ?? null,
    [rejectedEntries, selectedOperationId],
  );

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

  const flushDisabled = !status.online || status.pending === 0 || action.pending || status.running;

  // `S` déclenche le même envoi manuel que le bouton, avec la même garde (hors
  // ligne, rien en attente, ou une action déjà en cours) ; `⌘↵`/`Ctrl↵` soumet
  // la correction actuellement affichée dans le panneau de droite. Motif déjà
  // utilisé par `AddDeckCardForm` (étape 11) pour son picker : une recherche
  // `querySelector` bornée à un conteneur référencé, plutôt qu'un état à faire
  // remonter depuis `CorrectionForm` (qui n'a pas d'`onPrimaryAction` de
  // `Sheet` à déclencher ici, puisqu'il n'y a pas de `Sheet` côté bureau).
  useKeyboardShortcuts(
    [
      {
        keys: ["s"],
        onTrigger: () => {
          if (!flushDisabled) void action.run(flush);
        },
      },
      {
        keys: ["mod+enter"],
        onTrigger: () => {
          detailRef.current?.querySelector<HTMLFormElement>('[data-testid="correction-form"]')?.requestSubmit();
        },
        allowInEditableTarget: true,
      },
    ],
    { enabled: isDesktop },
  );

  return (
    <div className="page" data-testid="sync-page">
      <p className="kicker">Synchronisation</p>

      <div className="sync-columns" data-testid={isDesktop ? "sync-columns" : undefined}>
        <div className="sync-master">
          <div>
            <h2 className="page-title" data-testid="sync-page-title">
              {title}
            </h2>
            {detail && <p className="page-meta">{detail}</p>}
          </div>

          {isDesktop ? (
            <button
              type="button"
              className="btn btn-primary"
              data-testid="sync-flush"
              disabled={flushDisabled}
              aria-keyshortcuts="s"
              onClick={() => void action.run(flush)}
            >
              Synchroniser maintenant
              <Kbd>S</Kbd>
            </button>
          ) : (
            status.online &&
            status.pending > 0 && (
              <Pill
                compact
                data-testid="sync-flush"
                disabled={action.pending || status.running}
                onClick={() => void action.run(flush)}
              >
                Synchroniser maintenant
              </Pill>
            )
          )}

          <RejectedOperations
            isDesktop={isDesktop}
            selectedId={selectedEntry?.operationId ?? null}
            onSelect={setSelectedOperationId}
          />

          {isDesktop && <PendingOperationsList />}
        </div>

        {isDesktop && (
          <div className="sync-detail" data-testid="sync-detail" ref={detailRef}>
            <RejectedDetailPanel entry={selectedEntry} onCorrected={() => setSelectedOperationId(null)} />
          </div>
        )}
      </div>
    </div>
  );
}
