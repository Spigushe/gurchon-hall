import { defineConfig } from "@playwright/test";
import { FRONTEND_DIR, WEB_PORT } from "../e2e-real/support/env";

/**
 * Config Playwright dédiée à la capture des instantanés de référence mobile
 * (Lot 5bis, étape 0 — plan `docs/lot5bis-plan-design.md`, décisions
 * CLAUDE.md §11/§12). Volontairement **séparée** de `frontend/playwright.config.ts` :
 * ce n'est pas une suite de non-régression automatisée (aucune assertion sur
 * les images, aucun `toHaveScreenshot`), seulement un outil de capture à
 * lancer à la main, qui ne tourne jamais dans `npm run test:e2e` ni en CI.
 *
 * Prérequis : le build `dist-real` doit exister (`npm run build:e2e`, déjà
 * fait par `npm run test:e2e`). Voir `README.md` de ce dossier pour la
 * commande complète et le statut de versionnage des captures produites.
 */
const BASE_URL = `http://localhost:${WEB_PORT}`;

export default defineConfig({
  testDir: ".",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  timeout: 90_000,
  use: {
    baseURL: BASE_URL,
    viewport: { width: 390, height: 844 },
  },
  webServer: {
    command: `npm run preview -- --outDir dist-real --port ${WEB_PORT} --strictPort`,
    cwd: FRONTEND_DIR,
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
