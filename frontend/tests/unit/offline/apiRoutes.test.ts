import { describe, expect, it } from "vitest";
import contract from "../../../../contracts/openapi.json";
import { API_ROUTE_PREFIXES, navigateFallbackDenylist } from "../../../src/offline/apiRoutes";

/**
 * Le service worker ne doit jamais servir la coquille HTML à la place d'une
 * réponse d'API (CLAUDE.md §11 : pas de préfixe `/api`, donc une liste
 * explicite). Ce test est le garde-fou : une nouvelle ressource au contrat
 * sans entrée dans la liste fait échouer la suite.
 */
describe("routes de l'API hors du service worker", () => {
  const denied = navigateFallbackDenylist();
  const isDenied = (path: string) => denied.some((pattern) => pattern.test(path));

  it("couvre chaque chemin de contracts/openapi.json, /sync compris", () => {
    const paths = Object.keys((contract as { paths: Record<string, unknown> }).paths);
    expect(paths).toContain("/sync");
    const uncovered = paths.filter((path) => !isDenied(path.replace(/\{[^}]+\}/g, "1")));
    expect(uncovered).toEqual([]);
  });

  it("exclut /sync et ses variantes, avec ou sans query", () => {
    for (const path of ["/sync", "/sync/", "/sync?x=1", "/decks/12", "/decks?state=all", "/openapi.json"]) {
      expect(isDenied(path), path).toBe(true);
    }
  });

  it("laisse passer l'app shell et les routes clientes", () => {
    for (const path of ["/", "/index.html", "/assets/index-abc.js", "/decks2", "/syncing", "/app/decks"]) {
      expect(isDenied(path), path).toBe(false);
    }
  });

  it("échappe les caractères spéciaux des préfixes", () => {
    expect(isDenied("/openapiXjson")).toBe(false);
    expect(API_ROUTE_PREFIXES).toContain("/sync");
  });
});
