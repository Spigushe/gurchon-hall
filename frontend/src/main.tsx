import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { registerServiceWorker } from "./offline/registerServiceWorker";

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Enregistrement du service worker (PWA / offline). Volontairement effectué
// après le premier render : le rendu de l'app shell ne dépend jamais du SW
// ni du réseau (cf. CLAUDE.md §3). Voir `src/offline/registerServiceWorker.ts`
// pour la stratégie de mise à jour et `vite.config.ts` pour la config du
// plugin (manifest, precache, exclusion des routes API).
registerServiceWorker();
