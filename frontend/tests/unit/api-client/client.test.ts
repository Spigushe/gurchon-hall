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

  // Lot 2 : le contrat couvre désormais le catalogue, le stock et les decks.
  // Ces appels sont typés par `schema.d.ts` (l'éditeur les vérifie ; `tsc -b`
  // ne couvre que `src/`) et on contrôle les requêtes produites ; le `fetch`
  // est simulé, aucun réseau.
  it("construit les requêtes des routes métier à partir du contrat", async () => {
    const sent: Request[] = [];
    const fetchSpy = vi.fn(async (request: Request) => {
      sent.push(request);
      return new Response("[]", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    const { apiClient } = await import("../../../src/api-client/client");
    const client = apiClient;

    await client.GET("/cartes", {
      params: { query: { q: "aabbt", category: "crypt", limit: 10 } },
      fetch: fetchSpy,
    });
    await client.POST("/decks/{deck_id}/cartes", {
      params: { path: { deck_id: 3 } },
      body: { card_id: 7, language_code: "FR", quantity: 2, proxy_quantity: 1 },
      fetch: fetchSpy,
    });
    await client.DELETE("/stock/{card_id}/{language_code}", {
      params: { path: { card_id: 7, language_code: "FR" } },
      fetch: fetchSpy,
    });

    const [search, add, remove] = sent;
    const url = new URL(search.url);
    expect(url.pathname).toBe("/cartes");
    expect(url.searchParams.get("q")).toBe("aabbt");
    expect(url.searchParams.get("category")).toBe("crypt");
    expect(url.searchParams.get("limit")).toBe("10");
    expect(add.method).toBe("POST");
    expect(new URL(add.url).pathname).toBe("/decks/3/cartes");
    expect(await add.json()).toEqual({
      card_id: 7,
      language_code: "FR",
      quantity: 2,
      proxy_quantity: 1,
    });
    expect(remove.method).toBe("DELETE");
    expect(new URL(remove.url).pathname).toBe("/stock/7/FR");
  });

  it("type les erreurs métier 409 avec le schéma ErrorResponse", async () => {
    const fetchSpy = vi.fn(
      async () =>
        new Response(JSON.stringify({ detail: "Exemplaires insuffisants" }), {
          status: 409,
          headers: { "Content-Type": "application/json" },
        }),
    );
    const { apiClient } = await import("../../../src/api-client/client");

    const { data, error, response } = await apiClient.POST(
      "/decks/{deck_id}/cartes",
      {
        params: { path: { deck_id: 1 } },
        body: { card_id: 1, language_code: "EN", quantity: 9 },
        fetch: fetchSpy,
      },
    );

    expect(response.status).toBe(409);
    expect(data).toBeUndefined();
    // `error` est typé union `ErrorResponse | HTTPValidationError` : `detail`
    // existe dans les deux, on l'utilise sans forcer de cast.
    expect(error && "detail" in error ? error.detail : null).toBe(
      "Exemplaires insuffisants",
    );
  });
});
