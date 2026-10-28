import { useEffect, useRef } from "react";
import { useSyncStatus } from "../../offline/react";
import { useVtesOffline } from "../../offline/vtes";

/**
 * Détecte qu'une reconnexion est nécessaire alors que la file est vide (Lot 6,
 * « Points d'interprétation » n° 2) : dans ce cas précis, `POST /sync` n'est
 * jamais appelé (rien à envoyer), donc `SyncStatus.authRequired` ne se lève
 * jamais tout seul — seul un `GET` de rafraîchissement peut révéler le 401.
 * `runtime.start()` en déclenche déjà un au montage et à chaque retour de
 * réseau ; ce composant n'en déclenche pas de nouveau à chaque rendu, il
 * observe seulement le verdict du prochain qui a lieu pour ces raisons.
 *
 * Ne vit que dans la branche authentifiée (sous `<VtesOfflineProvider>`),
 * jamais rendu seul : `onSessionLost` fait passer `AuthGate` en mur de
 * connexion (`AuthScreen`, mode `"locked"`) sans purger la base locale.
 */
export function AuthWatcher({ locked, onSessionLost }: { locked: boolean; onSessionLost: () => void }) {
  const status = useSyncStatus();
  const { refresh } = useVtesOffline();
  const notified = useRef(false);

  useEffect(() => {
    if (!locked) notified.current = false;
  }, [locked]);

  // Pause du moteur (`/sync` a rendu 401) : ne peut arriver avec une file vide
  // que dans une fenêtre très étroite (une correction qui vide la file pendant
  // la pause) ; on la couvre quand même pour rester cohérent avec la règle.
  useEffect(() => {
    if (status.authRequired && status.pending + status.rejected === 0 && !notified.current) {
      notified.current = true;
      onSessionLost();
    }
  }, [status.authRequired, status.pending, status.rejected, onSessionLost]);

  // Verdict d'un rafraîchissement (`GET`) : a lieu à chaque retour réseau
  // (coalescé avec celui que `start()` a déjà déclenché, `runtime.ts`), file
  // vide ou pas — une session peut être révoquée côté serveur alors que la
  // file contient encore des opérations. On applique donc la même garde que
  // le premier effet (P3, `docs/lot6-plan-comptes.md`) : un 401 avec une file
  // non vide laisse l'écran ouvert, bandeau de reconnexion compris ; seule
  // une file vide verrouille l'écran.
  useEffect(() => {
    if (!status.online) return;
    let cancelled = false;
    void refresh().then((report) => {
      if (
        !cancelled &&
        report.authRequired &&
        status.pending + status.rejected === 0 &&
        !notified.current
      ) {
        notified.current = true;
        onSessionLost();
      }
    });
    return () => {
      cancelled = true;
    };
  }, [status.online, status.pending, status.rejected, refresh, onSessionLost]);

  return null;
}
