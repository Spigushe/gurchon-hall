import { registerSW } from "virtual:pwa-register";

/**
 * Enregistre le service worker de l'application (app shell en cache, mise à
 * jour automatique).
 *
 * Réutilisable tel quel sur barrins-project : ce module ne dépend que de
 * `virtual:pwa-register`, fourni par `vite-plugin-pwa` quel que soit le
 * projet Vite qui l'installe, et d'aucune dépendance au domaine métier
 * VtES. Voir `vite.config.ts` pour la configuration du plugin (manifest,
 * precache, exclusion des routes API).
 *
 * Stratégie de mise à jour : `autoUpdate` (choix documenté dans
 * `vite.config.ts`). Ce module se contente de :
 *  - forcer l'enregistrement immédiat du SW (`immediate: true`) ;
 *  - revérifier périodiquement une mise à jour disponible (un onglet resté
 *    ouvert longtemps ne redéclenche pas seul le contrôle habituel du
 *    navigateur) ;
 *  - journaliser les transitions utiles au débogage (app prête hors-ligne,
 *    échec d'enregistrement).
 */
export function registerServiceWorker(): void {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  registerSW({
    immediate: true,
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;
      // Intervalle large (1h) : l'app shell change rarement, inutile de
      // solliciter le réseau souvent — cohérent avec l'esprit offline-first.
      const ONE_HOUR_MS = 60 * 60 * 1000;
      setInterval(() => {
        void registration.update();
      }, ONE_HOUR_MS);
    },
    onNeedRefresh() {
      // Avec `registerType: "autoUpdate"`, le plugin bascule déjà seul vers
      // le nouveau SW : ce hook n'a ici qu'un rôle de traçabilité. S'il faut
      // un jour une UI de confirmation ("nouvelle version disponible"),
      // basculer `registerType` vers "prompt" et piloter le rechargement
      // depuis la fonction `updateSW` retournée par `registerSW`.
      console.info("[pwa] nouvelle version de l'app shell activée");
    },
    onOfflineReady() {
      console.info("[pwa] app shell disponible hors-ligne");
    },
    onRegisterError(error) {
      console.error("[pwa] échec de l'enregistrement du service worker", error);
    },
  });
}
