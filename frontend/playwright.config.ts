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
// Deux projets :
//   - `chromium` (tests/e2e) : sans API réelle, sur le build `dist/` ;
//   - `real-backend` (tests/e2e-real) : contre le VRAI back FastAPI, sur le build
//     `dist-real/` (`vite build --mode e2e`, l'URL de l'API y est compilée depuis
//     `.env.e2e`). Le back n'est pas un `webServer` : chaque test démarre le sien,
//     sur une base SQLite jetable, cf. tests/e2e-real/support/backend.ts.
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
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "real-backend",
      testDir: "./tests/e2e-real",
      timeout: 90_000,
      use: { ...devices["Desktop Chrome"], baseURL: REAL_URL },
    },
  ],
});
