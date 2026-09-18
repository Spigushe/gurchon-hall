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
  },
});
