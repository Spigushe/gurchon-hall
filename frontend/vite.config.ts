import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

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
//     cache des données API et la file d'attente offline sont le Lot 3.
//
// Portage Barrin : cette liste de préfixes est le SEUL endroit à adapter si
// Barrin utilise des noms de ressources différents ou un préfixe `/api`.
const API_ROUTE_PREFIXES = [
  "/health",
  "/cartes",
  "/stock",
  "/decks",
  "/joueurs",
  "/tournois",
  "/parties",
  "/sync",
];

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // autoUpdate : le service worker active la nouvelle version dès
      // qu'elle est prête, sans interaction utilisateur. Choisi plutôt que
      // "prompt" car ce pilote n'a pas encore d'UI de notification de mise à
      // jour (pas de composant "nouvelle version disponible" prévu au Lot 0),
      // et parce qu'une appli de saisie de scores/decks n'a pas de risque
      // fort à recharger la donnée statique (l'app shell) au prochain
      // chargement. Le rechargement effectif reste piloté depuis
      // `src/main.tsx` (écoute de l'événement de mise à jour), pas imposé de
      // force au milieu d'une saisie en cours. À réévaluer pour Barrin si une
      // UI de confirmation de mise à jour est requise en production.
      registerType: "autoUpdate",
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
        theme_color: "#1a0410",
        background_color: "#1a0410",
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
        // CSS, manifest, icônes. Aucune route API ne peut apparaître ici par
        // construction puisque ce glob ne porte que sur le dossier `dist/`.
        globPatterns: ["**/*.{js,css,html,svg,png,ico,webmanifest}"],
        // Permet à la SPA de s'ouvrir hors-ligne sur n'importe quelle route
        // cliente (ex. /decks, /parties) en retombant sur l'app shell.
        navigateFallback: "/index.html",
        navigateFallbackDenylist: API_ROUTE_PREFIXES.map(
          (prefix) => new RegExp(`^${prefix}(/|$)`),
        ),
        // Pas de runtimeCaching pour l'API en Lot 0 : volontairement absent.
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
