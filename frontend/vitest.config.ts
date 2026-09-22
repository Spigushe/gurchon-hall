import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Config vitest dédiée, séparée de `vite.config.ts` (qui porte la
// configuration PWA/Workbox, propriété de l'agent pwa-offline).
// Le plugin React seul suffit ici : pas de VitePWA en environnement de test
// unitaire (jsdom n'a pas de service worker, et ce n'est pas ce qui est
// couvert par ces tests — voir tests/e2e pour le service worker réel).
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/unit/**/*.test.{ts,tsx}"],
    css: false,
    restoreMocks: true,
    // Marge de délai, pas un `retry` : un test qui échoue échoue toujours, il a
    // seulement le temps de finir quand la machine est chargée (deux lancements
    // en parallèle, premier lancement à froid, CI partagée). Mesuré : les tests
    // UI les plus lents durent 0,3 s à vide et ~2 s sous une charge 6 fois
    // supérieure au nombre de coeurs ; le défaut de vitest (5 s) laissait moins
    // de 2,5 fois de marge, et le parcours exhaustif de `foldText` (voir son
    // fichier) le dépassait. 15 s = trois fois le défaut ; un vrai blocage se
    // signale toujours, seulement plus tard. Les détecteurs d'interblocage des
    // tests (`within(..., 2000)`) restent plus courts que ce délai et parlent
    // les premiers.
    testTimeout: 15_000,
    hookTimeout: 15_000,
  },
});
