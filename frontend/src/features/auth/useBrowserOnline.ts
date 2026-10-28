import { useSyncExternalStore } from "react";

/**
 * Connectivité du navigateur, sans dépendre de la couche offline
 * (`useConnectivity` de `offline/react` exige un `<OfflineProvider>`, qui
 * n'existe pas encore avant la toute première connexion — Lot 6, mur de
 * connexion). Les écrans d'authentification en ont besoin dans les deux
 * contextes (avec ou sans compte actif sur l'appareil) : ce hook fonctionne
 * dans les deux.
 */
export function useBrowserOnline(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      window.addEventListener("online", onChange);
      window.addEventListener("offline", onChange);
      return () => {
        window.removeEventListener("online", onChange);
        window.removeEventListener("offline", onChange);
      };
    },
    () => navigator.onLine,
    () => true,
  );
}
