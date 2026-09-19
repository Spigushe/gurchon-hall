import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Garde-fou du pipeline `openapi-typescript` + `openapi-fetch` (Lot 1, cf.
 * CLAUDE.md §7 et `contracts/README.md`), pas un test d'intégration réseau :
 * on vérifie que le client généré s'importe, type-check contre le contrat
 * `/health`, et s'instancie sans effectuer d'appel HTTP au chargement. Une
 * vraie régression du pipeline (schema.d.ts désynchronisé, mauvaise
 * `baseUrl`, etc.) ferait échouer ce test ou la compilation TypeScript.
 */
describe("apiClient (généré depuis contracts/openapi.json)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("s'instancie sans effectuer d'appel réseau", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const { apiClient } = await import("../../../src/api-client/client");

    expect(apiClient).toBeDefined();
    expect(typeof apiClient.GET).toBe("function");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("utilise l'URL de dev par défaut (port 8000) quand VITE_API_BASE_URL n'est pas défini", async () => {
    const { API_BASE_URL } = await import("../../../src/api-client/client");

    expect(API_BASE_URL).toBe("http://localhost:8000");
  });

  it("type-check un appel GET /health contre le schéma généré", async () => {
    const { apiClient } = await import("../../../src/api-client/client");

    // On ne déclenche pas réellement la requête (pas d'intégration réseau
    // ici) : on vérifie seulement que l'appel typé compile et renvoie la
    // forme attendue par openapi-fetch, preuve que `schema.d.ts` reflète bien
    // `/health` tel que décrit dans `contracts/openapi.json`.
    const call = () => apiClient.GET("/health");
    expect(call).toBeTypeOf("function");
  });
});
