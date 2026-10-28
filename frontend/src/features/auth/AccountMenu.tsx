import { useCallback, useState } from "react";
import { useGuardedAction } from "../../components/useGuardedAction";
import { useLiveQuery, useSyncStatus } from "../../offline/react";
import { readLocalAccount, useVtesOffline } from "../../offline/vtes";
import { plural } from "../../labels";
import { useAuthActions } from "./context";

/**
 * Compte courant et déconnexion (Lot 6, § « D — écrans »), dans la coquille
 * partagée (`shell-bar`, visible aux deux largeurs, cf. `App.tsx`). Rend `null`
 * tant qu'aucun compte n'est connu localement — notamment sous les bancs
 * d'essai existants qui montent `<App/>` sans `<AuthGate>` au-dessus
 * (`tests/unit/ui/harness.tsx`), dont la base ne porte aucune ligne `meta`.
 *
 * Déconnexion (D3) :
 * - hors ligne : bouton désactivé (le cookie `HttpOnly` ne peut pas être
 *   effacé côté serveur sans réseau) ;
 * - file vide : déconnexion directe ;
 * - file non vide (en attente ou refusées) : confirmation explicite, avec le
 *   nombre d'opérations concernées ; sans confirmation, rien ne bouge.
 */
export function AccountMenu() {
  const { db } = useVtesOffline();
  const status = useSyncStatus();
  const { logout } = useAuthActions();
  const action = useGuardedAction();
  const [confirming, setConfirming] = useState(false);

  const query = useCallback(() => readLocalAccount(db), [db]);
  const account = useLiveQuery(query);

  if (!account) return null;

  const queued = status.pending + status.rejected;

  const runLogout = () => {
    void action.run(async () => {
      await logout();
      setConfirming(false);
    });
  };

  const onLogoutClick = () => {
    if (queued > 0 && !confirming) {
      setConfirming(true);
      return;
    }
    runLogout();
  };

  return (
    <div className="account-menu" data-testid="account-menu">
      <span className="account-menu__name" data-testid="account-menu-username">
        {account.username}
      </span>
      {!status.online ? (
        <span className="hint" data-testid="account-menu-offline-hint">
          Déconnexion indisponible hors ligne
        </span>
      ) : confirming ? (
        <div className="confirm-row" role="group" aria-label="Confirmer la déconnexion">
          <span className="hint" data-testid="account-menu-warning">
            {plural(queued, "opération en attente ou refusée sera perdue", "opérations en attente ou refusées seront perdues")}.
          </span>
          <button
            type="button"
            className="chip-action chip-action--accent"
            disabled={action.pending}
            data-testid="account-menu-logout-confirm"
            onClick={runLogout}
          >
            Se déconnecter quand même
          </button>
          <button
            type="button"
            className="chip-action chip-action--neutral"
            disabled={action.pending}
            data-testid="account-menu-logout-cancel"
            onClick={() => setConfirming(false)}
          >
            Rester connecté
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="btn-text"
          disabled={action.pending}
          data-testid="account-menu-logout"
          onClick={onLogoutClick}
        >
          Se déconnecter
        </button>
      )}
    </div>
  );
}
