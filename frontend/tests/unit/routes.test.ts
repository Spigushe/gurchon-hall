import { describe, expect, it } from "vitest";
import { API_ROUTE_PREFIXES } from "../../src/offline/apiRoutes";
import { hrefFor, parseHash, type Route } from "../../src/app/routes";

const ROUTES: Route[] = [
  { name: "home" },
  { name: "stock" },
  { name: "decks" },
  { name: "deck", key: "id:12" },
  { name: "deck", key: "ref:0b8c1f5e-6a4d-4c3e-9a51-2f0e7d1c9b33" },
];

describe("routes clientes", () => {
  it("ne portent jamais le chemin d'une ressource de l'API : tout vit dans le hash", () => {
    for (const route of ROUTES) {
      const href = hrefFor(route);
      expect(href.startsWith("#/")).toBe(true);
      // Le serveur (et le service worker) ne voient que le chemin, toujours « / ».
      const { pathname } = new URL(href, "http://localhost/");
      expect(pathname).toBe("/");
      expect(API_ROUTE_PREFIXES).not.toContain(pathname);
    }
  });

  it("font l'aller-retour entre l'adresse et la route, clé de deck comprise", () => {
    for (const route of ROUTES) {
      expect(parseHash(hrefFor(route))).toEqual(route);
    }
  });

  it("refusent une clé de deck mal formée plutôt que de la deviner", () => {
    expect(parseHash("#/decks/n-importe-quoi")).toEqual({ name: "not-found" });
    expect(parseHash("#/decks/id:abc")).toEqual({ name: "not-found" });
    expect(parseHash("#/decks/%E0%A4%A")).toEqual({ name: "not-found" });
    expect(parseHash("#/inconnu")).toEqual({ name: "not-found" });
  });

  it("porte une intention d'ouverture dans la query du hash, et fait l'aller-retour", () => {
    const withIntent: Route[] = [
      { name: "stock", intent: "add" },
      { name: "stock", intent: "bundle" },
      { name: "decks", intent: "new" },
    ];
    for (const route of withIntent) {
      const href = hrefFor(route);
      expect(new URL(href, "http://localhost/").pathname).toBe("/");
      expect(parseHash(href)).toEqual(route);
    }
    expect(hrefFor({ name: "stock", intent: "add" })).toBe("#/collection?action=ajouter");
    expect(hrefFor({ name: "decks", intent: "new" })).toBe("#/decks?action=nouveau");
    // Une action inconnue ou posée sur le mauvais écran est ignorée.
    expect(parseHash("#/collection?action=nouveau")).toEqual({ name: "stock" });
    expect(parseHash("#/decks?action=ajouter")).toEqual({ name: "decks" });
    expect(parseHash("#/collection?action=constructor")).toEqual({ name: "stock" });
  });

  it("tolère l'adresse vide, la barre finale et une query", () => {
    expect(parseHash("")).toEqual({ name: "home" });
    expect(parseHash("#")).toEqual({ name: "home" });
    expect(parseHash("#/collection/")).toEqual({ name: "stock" });
    expect(parseHash("#/decks?x=1")).toEqual({ name: "decks" });
  });
});
