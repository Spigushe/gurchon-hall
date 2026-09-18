import { defineConfig, devices } from "@playwright/test";

// E2E du pilote PWA (CLAUDE.md §3). Sert le build de production (`dist/`)
// via `vite preview` : le service worker généré par vite-plugin-pwa n'existe
// qu'après build, jamais en dev server. `npm run test:e2e` construit d'abord
// (`npm run build`), ce config ne fait que démarrer le serveur de preview.
//
// `localhost` est utilisé volontairement : un service worker ne s'enregistre
// que dans un contexte sécurisé, et `localhost`/`127.0.0.1` en font partie
// sans HTTPS (cf. CLAUDE.md §2, rappel PWA).
const PORT = 4173;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
  },
  webServer: {
    command: `npm run preview -- --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
