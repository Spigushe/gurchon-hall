import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

// Socle standard d'un scaffold Vite + React + TS récent (ESLint 9+ flat
// config), cf. CLAUDE.md §9 (skill `pwa-offline` / `ci-cd-deploiement`).
// Découpage en deux groupes de fichiers TS/TSX plutôt qu'une seule règle
// globale :
//   - `src/**` : code applicatif exécuté dans le navigateur (composants
//     React, hooks, service worker côté client) -> globals navigateur,
//     règles React Hooks + Fast Refresh (utiles seulement là où il y a des
//     composants).
//   - fichiers de config (`*.config.ts`) et tests (`tests/**`) : exécutés
//     sous Node (Vite, Vitest, Playwright), pas de règle Fast Refresh (elle
//     n'a pas de sens hors composants React) ; globals Node + navigateur
//     (les tests unitaires tournent en jsdom et touchent `window`/`document`).
export default defineConfig([
  globalIgnores([
    "dist",
    "coverage",
    "playwright-report",
    "test-results",
    // Fichier généré par `npm run generate:client` (openapi-typescript) :
    // jamais écrit à la main, ne doit pas être soumis au lint applicatif
    // (cf. contracts/README.md, section "Côté front").
    "src/api-client/schema.d.ts",
  ]),
  {
    files: ["**/*.{ts,tsx}"],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    extends: [reactHooks.configs.flat["recommended-latest"], reactRefresh.configs.vite],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    files: ["*.config.ts", "tests/**/*.{ts,tsx}"],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
  },
]);
