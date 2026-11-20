import { registerSW } from "virtual:pwa-register";
import { appUpdateStore, type AppUpdateStore } from "./core/appUpdate";

/**
 * Délai au-delà duquel la page se recharge d'elle-même après « Mettre à
 * jour », si le service worker n'a pas pris la main entre-temps (message
 * `SKIP_WAITING` perdu, version déjà activée par un autre onglet). Sans ce
 * filet, un appareil pourrait rester sur l'ancienne coquille sans que personne
 * ne s'en aperçoive (Lot 12, risques). Recharger alors que la version attend
 * encore ne casse rien : l'ancienne coquille revient, et le bandeau avec elle.
 */
export const RELOAD_FALLBACK_MS = 10_000;

/**
 * Enregistre le service worker de l'application (app shell en cache, mise à
 * jour proposée).
 *
 * Ce module ne dépend que de `virtual:pwa-register`, fourni par
 * `vite-plugin-pwa`, et du store générique `core/appUpdate.ts` ; aucune
 * dépendance au domaine VtES. Voir `vite.config.ts` pour la configuration du
 * plugin (manifest, precache, exclusion des routes API).
 *
 * Stratégie de mise à jour : `prompt` depuis le Lot 12 (A6). Une nouvelle
 * version installée attend ; `onNeedRefresh` la signale au store, et le
 * bandeau (`useAppUpdate`) la propose une fois la file vidée de ses saisies en
 * attente (P5). « Mettre à jour » appelle `updateSW`, qui envoie
 * `SKIP_WAITING` au service worker en attente ; quand il prend la main, le
 * plugin recharge la page, et **chaque onglet ouvert** qui l'avait vu attendre
 * se recharge aussi (comportement par défaut du plugin, gardé : un onglet
 * resté sur l'ancien JavaScript demanderait des fragments chargés à la demande
 * qui n'existent plus). La file vit dans IndexedDB : un rechargement n'en perd
 * rien.
 *
 * Le module, en plus :
 *  - force l'enregistrement immédiat du SW (`immediate: true`) ;
 *  - revérifie toutes les heures une mise à jour disponible (un onglet resté
 *    ouvert longtemps ne redéclenche pas seul le contrôle du navigateur) ;
 *  - journalise les transitions utiles au débogage.
 *
 * Transition : un appareil qui tourne la v1.0 a un service worker en
 * `autoUpdate` ; il installe la v1.1 tout seul, une dernière fois.
 */
export function registerServiceWorker(
  store: AppUpdateStore = appUpdateStore,
  reload: () => void = () => window.location.reload(),
): void {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  const updateSW = registerSW({
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
      console.info("[pwa] nouvelle version de l'app shell en attente");
      store.offer(async () => {
        await updateSW();
        setTimeout(reload, RELOAD_FALLBACK_MS);
      });
    },
    onOfflineReady() {
      console.info("[pwa] app shell disponible hors-ligne");
    },
    onRegisterError(error) {
      console.error("[pwa] échec de l'enregistrement du service worker", error);
    },
  });
}
