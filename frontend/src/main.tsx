import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-500.css";
import "./index.css";
import { AuthGate } from "./features/auth/AuthGate.tsx";
import { registerServiceWorker } from "./offline/registerServiceWorker";

// Couche offline (Lot 3) et comptes (Lot 6) : `AuthGate` décide, avant tout,
// s'il existe un compte connu sur cet appareil, ouvre le runtime offline (base
// IndexedDB, file d'écritures, rejeu vers `POST /sync`) du bon compte le cas
// échéant, et affiche le mur de connexion sinon. Rien ici n'attend le réseau :
// le premier rendu ne dépend ni de la file ni de l'API (`docs/lot6-plan-comptes.md`,
// § P3).
createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <AuthGate />
  </StrictMode>,
);

// Enregistrement du service worker (PWA / offline). Volontairement effectué
// après le premier render : le rendu de l'app shell ne dépend jamais du SW
// ni du réseau (cf. CLAUDE.md §3). Voir `src/offline/registerServiceWorker.ts`
// pour la stratégie de mise à jour et `vite.config.ts` pour la config du
// plugin (manifest, precache, exclusion des routes API).
registerServiceWorker();
