/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  /**
   * URL de base de l'API FastAPI consommée par `src/api-client/client.ts`.
   * Optionnelle : par défaut `http://localhost:8000` (convention de dev,
   * cf. `scripts/dev.ps1` / `scripts/dev.sh`).
   */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
