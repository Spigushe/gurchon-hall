import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { navigateFallbackDenylist } from "./src/offline/apiRoutes.ts";
import packageJson from "./package.json";

// PWA minimale (Lot 0) : app shell installable et utilisable hors-ligne.
//
// Règle critique héritée de l'architecte-contrat (CLAUDE.md §7) : les routes
// de l'API FastAPI n'ont PAS de préfixe `/api` (ex. `GET /health` est à la
// racine). Il n'y a donc AUCUN chemin sûr et générique (type `/api/*`) pour
// distinguer "API" de "app shell" côté service worker. Conséquences :
//   - on ne precache que les fichiers de build réels (glob sur dist/), donc
//     aucune route API ne peut s'y retrouver par construction ;
//   - `navigateFallback` (utilisé pour que les routes SPA s'ouvrent hors-ligne)
//     est restreint aux navigations de document HTML, et `navigateFallbackDenylist`
//     exclut explicitement tout chemin qui ressemble à un appel API connu de
//     ce projet, pour ne jamais servir la coquille HTML à la place d'une
//     réponse API en cas de faille de connectivité ;
//   - aucun `runtimeCaching` n'est défini pour les requêtes API : elles
//     restent en comportement réseau par défaut du navigateur (NetworkOnly de
//     facto, rien n'intercepte ni ne met en cache ces requêtes). La mise en
//     cache des données API n'est pas prévue : hors ligne, l'UI lit IndexedDB
//     (miroirs de `src/offline/vtes`), et la file d'écritures vit elle aussi
//     dans IndexedDB, côté page, pas dans le service worker.
//
// Portage Barrin : la liste de préfixes vit dans `src/offline/apiRoutes.ts`
// (documentée et testée contre `contracts/openapi.json`) : c'est le SEUL
// endroit à adapter si Barrin utilise d'autres noms de ressources ou un
// préfixe `/api`.

// Version de la coquille (Lot 12, D1), lue dans `package.json` au build et
// affichée en pied de l'écran Compte à côté de celle de l'API (`/health`).
const appVersion: string = packageJson.version;

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(appVersion) },
  plugins: [
    react(),
    VitePWA({
      // prompt (Lot 12, A6) : une nouvelle version installée attend que
      // l'utilisateur la prenne, depuis le bandeau « nouvelle version », qui
      // ne la propose qu'une fois la file vidée de ses saisies en attente
      // (P5). Les Lots 14 et suivants changeront Dexie et la forme des
      // opérations `/sync` en production : une mise à jour imposée au milieu
      // d'une file pleine ferait dépendre la nouvelle version de sa capacité à
      // rejouer l'ancienne forme. Du Lot 0 à la v1.0 : `autoUpdate`. Le
      // cycle de vie est piloté par `src/offline/registerServiceWorker.ts`.
      registerType: "prompt",
      injectRegister: false, // enregistrement manuel dans src/main.tsx (contrôle explicite du cycle de vie)
      // Pas de `includeAssets` : apple-touch-icon.png est déjà couvert par
      // `globPatterns` (extension png), qui precache tout fichier de build
      // réel — inutile de le lister deux fois dans le manifeste de precache.
      manifest: {
        name: "Gurchon Hall — Suivi VtES",
        short_name: "Gurchon Hall",
        description:
          "Suivi de collection, decks, parties et tournois Vampire: The Eternal Struggle — utilisable hors-ligne.",
        lang: "fr",
        start_url: "/",
        scope: "/",
        display: "standalone",
        theme_color: "#161826",
        background_color: "#161826",
        icons: [
          {
            src: "pwa-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "pwa-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "pwa-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        // Precache uniquement les fichiers du build (app shell) : HTML, JS,
        // CSS, manifest, icônes, police. Aucune route API ne peut apparaître
        // ici par construction puisque ce glob ne porte que sur le dossier
        // `dist/`. `woff2` couvre la police Inter (Lot 5, système Nocturne) :
        // self-hébergée plutôt que Google Fonts, pour que l'app shell
        // s'affiche avec sa typo définitive dès la toute première ouverture
        // hors ligne, sans dépendre d'un CDN externe au premier chargement.
        // Seuls les graisses 400 et 500 en sous-ensemble latin sont importées
        // dans `src/main.tsx` (`@fontsource/inter/latin-400.css` et
        // `latin-500.css`) : Vite ne référence donc que deux fichiers
        // `.woff2` d'environ 24 Ko chacun, largement sous la limite par
        // défaut de Workbox (`maximumFileSizeToCacheInBytes`, 2 Mio), laissée
        // à sa valeur par défaut. `otf` couvre les deux polices d'icônes de
        // krcg (lot Chercher, `src/assets/fonts/`, 185 Ko et 336 Ko) : les
        // icônes de discipline, de type, de coût et de clan s'affichent hors
        // ligne dès la première ouverture, sans appel à static.krcg.org.
        globPatterns: ["**/*.{js,css,html,svg,png,ico,webmanifest,woff2,otf}"],
        // Permet à la SPA de s'ouvrir hors-ligne sur n'importe quelle route
        // cliente (ex. /decks, /parties) en retombant sur l'app shell.
        navigateFallback: "/index.html",
        navigateFallbackDenylist: navigateFallbackDenylist(),
        // Pas de runtimeCaching pour l'API : volontairement absent (cf. plus haut).
        // Les GET d'API ne sont ni interceptés ni mis en cache par le SW ;
        // ils suivent le comportement réseau normal du navigateur.
        runtimeCaching: [],
      },
      devOptions: {
        // Active le SW en dev (utile pour vérifier l'enregistrement sans
        // build), mais désactivé par défaut pour ne pas gêner le rechargement
        // à chaud habituel de `npm run dev`.
        enabled: false,
        type: "module",
      },
    }),
  ],
});
