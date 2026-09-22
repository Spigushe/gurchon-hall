import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
// Police Inter auto-hébergée (Lot 7, Nocturne) : variable, poids 400/900 sur
// un seul fichier par script. Import par défaut = axe "wght", style normal,
// tous les scripts fournis par le paquet (`files/inter-*-wght-normal.woff2`) ;
// seuls les .woff2 dont l'`unicode-range` couvre les caractères réellement
// affichés sont téléchargés par le navigateur. Choisi plutôt que Google Fonts
// en CDN pour que l'app shell s'affiche hors ligne dès le premier chargement
// (CLAUDE.md §3) : le service worker doit pouvoir précacher ces fichiers,
// ce qui suppose qu'ils sortent du build Vite (`dist/assets/*.woff2`) plutôt
// que d'être chargés depuis un CDN externe — précache à câbler côté
// `vite.config.ts` par l'agent pwa-offline.
import "@fontsource-variable/inter";
import "./index.css";
import { registerServiceWorker } from "./offline/registerServiceWorker";
import { VtesOfflineProvider } from "./offline/vtes/VtesOfflineProvider";
import { createVtesOffline } from "./offline/vtes/runtime";

// Couche offline (Lot 3) : base IndexedDB, file d'écritures et rejeu vers
// `POST /sync`. Créée une fois ; le provider démarre le moteur (reprise de la
// file au lancement, écoute de `online`) et l'arrête au démontage. Rien ici
// n'attend le réseau : le premier rendu ne dépend ni de la file ni de l'API.
const offline = createVtesOffline();

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <VtesOfflineProvider runtime={offline}>
      <App />
    </VtesOfflineProvider>
  </StrictMode>,
);

// Enregistrement du service worker (PWA / offline). Volontairement effectué
// après le premier render : le rendu de l'app shell ne dépend jamais du SW
// ni du réseau (cf. CLAUDE.md §3). Voir `src/offline/registerServiceWorker.ts`
// pour la stratégie de mise à jour et `vite.config.ts` pour la config du
// plugin (manifest, precache, exclusion des routes API).
registerServiceWorker();
