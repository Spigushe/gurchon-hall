import { useState } from "react";
import { useGuardedAction } from "../../components/useGuardedAction";
import { useSyncStatus } from "../../offline/react";
import { plural } from "../../labels";
import { useAuthActions } from "./context";

/**
 * Identifiants de test par emplacement, écrits en littéraux pour le
 * recensement (`scripts/testid-census.mjs`) : le menu garde ceux du Lot 6
 * (`account-menu-…`), la page en a d'autres (`account-page-…`), pour que les
 * deux ne se confondent jamais quand le menu s'ouvre sur l'écran Compte.
 */
const TEST_IDS = {
  menu: {
    logout: { "data-testid": "account-menu-logout" },
    confirm: { "data-testid": "account-menu-logout-confirm" },
    cancel: { "data-testid": "account-menu-logout-cancel" },
    warning: { "data-testid": "account-menu-warning" },
    offline: { "data-testid": "account-menu-offline-hint" },
  },
  page: {
    logout: { "data-testid": "account-page-logout" },
    confirm: { "data-testid": "account-page-logout-confirm" },
    cancel: { "data-testid": "account-page-logout-cancel" },
    warning: { "data-testid": "account-page-warning" },
    offline: { "data-testid": "account-page-offline-hint" },
  },
} as const;

/**
 * Déconnexion (Lot 6, D3), sortie d'`AccountMenu` au Lot 12 pour vivre à deux
 * endroits : la section « Déconnexion » de l'écran Compte, seule place au
 * mobile (écart 1 du handoff), et le menu du compte de la barre haute au
 * bureau (écart 2). Mêmes règles qu'avant :
 *
 * - hors ligne, rien ne part (le cookie `HttpOnly` ne s'efface pas sans le
 *   serveur, et purger la base en le laissant en place renverrait des requêtes
 *   sous ce compte au retour du réseau) ;
 * - file vide, déconnexion directe ;
 * - file non vide (en attente ou refusées), confirmation avec le nombre
 *   d'opérations perdues ; sans confirmation, rien ne bouge.
 */
export function LogoutControl({
  place,
  onDone,
}: {
  /** `page` : bouton secondaire, raison sous le bouton désactivé ; `menu` : entrée de menu. */
  place: "page" | "menu";
  /** Appelé quand l'utilisateur renonce (le menu se referme). */
  onDone?: () => void;
}) {
  const status = useSyncStatus();
  const { logout } = useAuthActions();
  const action = useGuardedAction();
  const [confirming, setConfirming] = useState(false);
  const queued = status.pending + status.rejected;
  const ids = TEST_IDS[place];

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

  if (confirming && status.online) {
    return (
      <div className="confirm-row" role="group" aria-label="Confirmer la déconnexion">
        <span className="hint" {...ids.warning}>
          {plural(queued, "opération en attente ou refusée sera perdue", "opérations en attente ou refusées seront perdues")}.
        </span>
        <button
          type="button"
          className="chip-action chip-action--accent"
          disabled={action.pending}
          {...ids.confirm}
          onClick={runLogout}
        >
          Se déconnecter quand même
        </button>
        <button
          type="button"
          className="chip-action chip-action--neutral"
          disabled={action.pending}
          {...ids.cancel}
          onClick={() => {
            setConfirming(false);
            onDone?.();
          }}
        >
          Rester connecté
        </button>
      </div>
    );
  }

  if (place === "menu") {
    return status.online ? (
      <button
        type="button"
        role="menuitem"
        className="account-dropdown__item account-dropdown__item--logout"
        disabled={action.pending}
        {...ids.logout}
        onClick={onLogoutClick}
      >
        Se déconnecter
      </button>
    ) : (
      <span className="hint account-dropdown__hint" {...ids.offline}>
        Déconnexion indisponible hors ligne
      </span>
    );
  }

  return (
    <div className="account-action">
      <button
        type="button"
        className="btn btn-secondary"
        disabled={action.pending || !status.online}
        {...ids.logout}
        onClick={onLogoutClick}
      >
        Se déconnecter
      </button>
      {!status.online && (
        <p className="hint" {...ids.offline}>
          Indisponible hors ligne.
        </p>
      )}
    </div>
  );
}
