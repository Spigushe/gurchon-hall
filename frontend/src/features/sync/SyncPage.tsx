import { RejectedOperations } from "./RejectedOperations";
import { SyncStatusBar } from "./SyncStatusBar";

/**
 * Écran plein « Synchronisation » (Lot 7, handoff écran 8) : ce que
 * `SyncStatusBar` et `RejectedOperations` affichaient jusqu'ici sur toutes les
 * routes vit maintenant ici seulement. Ni l'un ni l'autre composant n'est
 * modifié par ce déplacement — seul l'endroit où ils sont montés change
 * (`App.tsx`), leur habillage visuel Nocturne restant à faire dans une étape
 * dédiée.
 */
export function SyncPage() {
  return (
    <div className="page" data-testid="sync-page">
      <h2>Synchronisation</h2>
      <SyncStatusBar />
      <RejectedOperations />
    </div>
  );
}
