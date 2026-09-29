import { defineConfig, devices } from "@playwright/test";
import { WEB_PORT as REAL_PORT } from "./tests/e2e-real/support/env";

// E2E du pilote PWA (CLAUDE.md §3). Sert le build de production (`dist/`)
// via `vite preview` : le service worker généré par vite-plugin-pwa n'existe
// qu'après build, jamais en dev server. `npm run test:e2e` construit d'abord
// (`npm run build`), ce config ne fait que démarrer le serveur de preview.
//
// `localhost` est utilisé volontairement : un service worker ne s'enregistre
// que dans un contexte sécurisé, et `localhost`/`127.0.0.1` en font partie
// sans HTTPS (cf. CLAUDE.md §2, rappel PWA).
//
// Quatre projets, deux largeurs (Lot 5bis, étape 0 — CLAUDE.md §12) :
//   - `chromium` (tests/e2e) : sans API réelle, sur le build `dist/` ;
//   - `real-backend` (tests/e2e-real) : contre le VRAI back FastAPI, sur le build
//     `dist-real/` (`vite build --mode e2e`, l'URL de l'API y est compilée depuis
//     `.env.e2e`). Le back n'est pas un `webServer` : chaque test démarre le sien,
//     sur une base SQLite jetable, cf. tests/e2e-real/support/backend.ts ;
//   - `desktop` / `desktop-real-backend` : mêmes builds et la même API que les deux
//     projets ci-dessus, à la largeur bureau. Déclarés dès l'étape 0 (nom et largeur
//     figés) mais sans spec pour l'instant : `testDir` pointe un dossier qui n'existe
//     pas encore, l'étape 11/14 y ajoutera les scénarios bureau du plan (navigation par
//     la barre haute, panneau latéral, Deckbuilder à deux colonnes). Un projet dont le
//     dossier ne matche aucun fichier ne fait pas échouer `npx playwright test` tant que
//     d'autres projets du même run ont des tests : seul un `--project` isolé sur un
//     projet vide échoue avec « No tests found » (vérifié le 2026-09-29 avec la version
//     de Playwright du lockfile). `npm run test:e2e` n'utilise jamais `--project`, donc
//     ce mode "coquille vide" ne casse pas la commande.
//
// Toute la suite existante (`chromium`, `real-backend`) tournait jusqu'ici en
// `devices["Desktop Chrome"]` (1280×720), au-dessus du seuil de 1024px du futur
// breakpoint (étape 1) : sans une largeur mobile explicite, poser le breakpoint
// aurait fait basculer ces deux projets en disposition bureau (barre d'onglets basse
// absente, `nav-home`/`nav-stock`/`nav-decks` à retrouver dans la barre haute) et plus
// personne n'aurait vérifié la non-régression mobile. 390×844 reprend la taille de
// repère du handoff mobile « 1b » (`docs/design-handoff-mobile/README.md`, proche d'un
// iPhone 12/13) ; 1440×900 reprend la référence du handoff bureau
// (`docs/design-handoff-mobile/DESKTOP.md`).
const MOBILE_VIEWPORT = { width: 390, height: 844 };
const DESKTOP_VIEWPORT = { width: 1440, height: 900 };

const PORT = 4173;
const BASE_URL = `http://localhost:${PORT}`;
const REAL_URL = `http://localhost:${REAL_PORT}`;

export default defineConfig({
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: `npm run preview -- --port ${PORT} --strictPort`,
      url: BASE_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: `npm run preview -- --outDir dist-real --port ${REAL_PORT} --strictPort`,
      url: REAL_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
  projects: [
    {
      name: "chromium",
      testDir: "./tests/e2e",
      use: { ...devices["Desktop Chrome"], viewport: MOBILE_VIEWPORT },
    },
    {
      name: "real-backend",
      testDir: "./tests/e2e-real",
      timeout: 90_000,
      use: { ...devices["Desktop Chrome"], baseURL: REAL_URL, viewport: MOBILE_VIEWPORT },
    },
    // Étape 11/14 du Lot 5bis les remplira ; laissés vides ici à dessein (voir
    // commentaire ci-dessus). Ne pas lancer `--project=desktop` ou
    // `--project=desktop-real-backend` isolément tant qu'aucune spec n'y vit : cela
    // échoue avec « No tests found », contrairement à un run complet.
    {
      name: "desktop",
      testDir: "./tests/e2e-desktop",
      use: { ...devices["Desktop Chrome"], viewport: DESKTOP_VIEWPORT },
    },
    {
      name: "desktop-real-backend",
      testDir: "./tests/e2e-desktop-real",
      timeout: 90_000,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: REAL_URL,
        viewport: DESKTOP_VIEWPORT,
      },
    },
  ],
});
