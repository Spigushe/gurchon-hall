import { useState } from "react";
import { useSyncStatus } from "../../offline/react";
import { ReconnectSheet } from "./ReconnectSheet";

/**
 * Bandeau de reconnexion (Lot 6, § « D — écrans ») : visible, pas bloquant.
 * Rendu seulement quand le moteur signale une pause d'authentification
 * (`authRequired`) — ce qui, la file étant alors forcément non vide (sinon
 * `AuthWatcher` fait passer l'écran entier en mur de connexion avant que ce
 * bandeau n'ait de raison de s'afficher), laisse l'application utilisable
 * pendant que l'utilisateur se reconnecte.
 */
export function ReconnectBanner() {
  const status = useSyncStatus();
  const [open, setOpen] = useState(false);

  if (!status.authRequired) return null;

  return (
    <>
      <div className="sync-alert reconnect-banner" role="alert" data-testid="reconnect-banner">
        <p className="sync-alert__title">Reconnexion nécessaire pour reprendre l'envoi</p>
        <button
          type="button"
          className="btn-ghost"
          data-testid="reconnect-banner-link"
          onClick={() => setOpen(true)}
        >
          Se reconnecter →
        </button>
      </div>
      {open && <ReconnectSheet onClose={() => setOpen(false)} />}
    </>
  );
}
