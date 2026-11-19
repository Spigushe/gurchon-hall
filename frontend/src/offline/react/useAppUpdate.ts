import { useCallback, useSyncExternalStore } from "react";
import { appUpdateStore, type AppUpdateSnapshot, type AppUpdateStore } from "../core/appUpdate";
import type { SyncStatus } from "../core/syncEngine";
import { useSyncStatus } from "./hooks";

/**
 * Ce que le bandeau « nouvelle version » doit montrer (Lot 12, P5) :
 *
 * - `hidden` : aucune version n'attend, ou « Plus tard » a été choisi ;
 * - `waiting` : une version attend, mais des saisies ne sont pas encore
 *   envoyées. Pas de « Mettre à jour » : la nouvelle version ne doit pas
 *   dépendre de sa capacité à rejouer la forme des opérations de l'ancienne.
 *   Le bandeau passe de lui-même à `ready` quand la file se vide ;
 * - `ready` : rien n'attend l'envoi, la mise à jour est proposée. Des
 *   opérations refusées ne bloquent pas (elles peuvent rester des semaines) :
 *   elles sont comptées pour que le bandeau dise qu'elles sont conservées.
 */
export type AppUpdateView =
  | { kind: "hidden" }
  | { kind: "waiting"; pending: number; online: boolean; authRequired: boolean }
  | { kind: "ready"; rejected: number; applying: boolean };

/** Fonction pure : la version qui attend, croisée avec l'état de la file. */
export function appUpdateViewOf(
  update: AppUpdateSnapshot,
  sync: Pick<SyncStatus, "pending" | "rejected" | "online" | "authRequired">,
): AppUpdateView {
  if (!update.available || update.dismissed) return { kind: "hidden" };
  if (sync.pending > 0) {
    return { kind: "waiting", pending: sync.pending, online: sync.online, authRequired: sync.authRequired };
  }
  return { kind: "ready", rejected: sync.rejected, applying: update.applying };
}

export interface AppUpdate {
  view: AppUpdateView;
  /**
   * Installe la nouvelle version et recharge la page. Sans effet hors de
   * l'état `ready` : une saisie arrivée entre l'affichage et le clic repasse
   * le bandeau en `waiting` sans rien installer.
   */
  apply: () => Promise<void>;
  /** « Plus tard » : masqué jusqu'au prochain démarrage. */
  dismiss: () => void;
}

/**
 * Bandeau « nouvelle version », générique : aucune notion du domaine, seulement
 * le store de mise à jour (`core/appUpdate.ts`) et l'état de la file. Exige un
 * `OfflineProvider` au-dessus.
 */
export function useAppUpdate(store: AppUpdateStore = appUpdateStore): AppUpdate {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const view = appUpdateViewOf(snapshot, useSyncStatus());
  const ready = view.kind === "ready";
  const apply = useCallback(async () => {
    if (ready) await store.apply();
  }, [ready, store]);
  const dismiss = useCallback(() => store.dismiss(), [store]);
  return { view, apply, dismiss };
}
