import { describe, expect, it } from "vitest";
import { API_ROUTE_PREFIXES } from "../../src/offline/apiRoutes";
import { hrefFor, parseHash, type Route } from "../../src/app/routes";

const ROUTES: Route[] = [
  { name: "home" },
  { name: "stock" },
  { name: "decks" },
  { name: "deck", key: "id:12" },
  { name: "deck", key: "ref:0b8c1f5e-6a4d-4c3e-9a51-2f0e7d1c9b33" },
  { name: "games" },
  { name: "game", key: "id:7" },
  { name: "game", key: "ref:0b8c1f5e-6a4d-4c3e-9a51-2f0e7d1c9b33" },
  { name: "tournaments" },
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
      { name: "games", intent: "new" },
    ];
    for (const route of withIntent) {
      const href = hrefFor(route);
      expect(new URL(href, "http://localhost/").pathname).toBe("/");
      expect(parseHash(href)).toEqual(route);
    }
    expect(hrefFor({ name: "stock", intent: "add" })).toBe("#/collection?action=ajouter");
    expect(hrefFor({ name: "decks", intent: "new" })).toBe("#/decks?action=nouveau");
    expect(hrefFor({ name: "games", intent: "new" })).toBe("#/parties?action=nouvelle");
    // Une action inconnue ou posée sur le mauvais écran est ignorée.
    expect(parseHash("#/parties?action=nouveau")).toEqual({ name: "games" });
    expect(parseHash("#/decks?action=nouvelle")).toEqual({ name: "decks" });
    expect(parseHash("#/collection?action=nouveau")).toEqual({ name: "stock" });
    expect(parseHash("#/decks?action=ajouter")).toEqual({ name: "decks" });
    expect(parseHash("#/collection?action=constructor")).toEqual({ name: "stock" });
  });

  it("refuse une clé de partie mal formée, et nomme les parties et tournois en français", () => {
    expect(hrefFor({ name: "games" })).toBe("#/parties");
    expect(hrefFor({ name: "tournaments" })).toBe("#/tournois");
    expect(parseHash("#/parties/n-importe-quoi")).toEqual({ name: "not-found" });
    expect(parseHash("#/parties/id:abc")).toEqual({ name: "not-found" });
    expect(parseHash("#/parties/%E0%A4%A")).toEqual({ name: "not-found" });
    // Étape D2 : le détail d'un tournoi (même forme de clé que les parties) et le carnet.
    expect(parseHash("#/tournois/id:1")).toEqual({ name: "tournament", key: "id:1" });
    expect(parseHash("#/tournois/ref:3f2a-9c")).toEqual({ name: "tournament", key: "ref:3f2a-9c" });
    expect(parseHash("#/tournois/n-importe-quoi")).toEqual({ name: "not-found" });
    expect(parseHash("#/tournois/id:abc")).toEqual({ name: "not-found" });
    expect(parseHash("#/carnet")).toEqual({ name: "notebook" });
    expect(hrefFor({ name: "tournament", key: "ref:3f2a-9c" })).toBe("#/tournois/ref:3f2a-9c");
    expect(hrefFor({ name: "notebook" })).toBe("#/carnet");
    // Deux-points en clair dans l'adresse ; un ancien lien encodé s'ouvre encore.
    expect(hrefFor({ name: "deck", key: "id:1" })).toBe("#/decks/id:1");
    expect(hrefFor({ name: "game", key: "id:2" })).toBe("#/parties/id:2");
    expect(parseHash("#/decks/id%3A1")).toEqual({ name: "deck", key: "id:1" });
    expect(parseHash("#/tournois/ref%3A3f2a-9c")).toEqual({ name: "tournament", key: "ref:3f2a-9c" });
    expect(parseHash(hrefFor({ name: "tournament", key: "ref:3f2a-9c" }))).toEqual({
      name: "tournament",
      key: "ref:3f2a-9c",
    });
  });

  it("ouvre le bilan, filtré ou non sur un deck, et la liste d'une version (Lot 8)", () => {
    expect(hrefFor({ name: "bilan" })).toBe("#/bilan");
    expect(hrefFor({ name: "bilan", deck: "id:4" })).toBe("#/bilan?deck=id:4");
    expect(parseHash("#/bilan?deck=id:4")).toEqual({ name: "bilan", deck: "id:4" });
    expect(parseHash("#/bilan?deck=pas-une-cle")).toEqual({ name: "bilan" });
    expect(hrefFor({ name: "deckVersion", key: "ref:3f2a-9c", number: 2 })).toBe("#/decks/ref:3f2a-9c/versions/2");
    expect(parseHash("#/decks/id:4/versions/3")).toEqual({ name: "deckVersion", key: "id:4", number: 3 });
    expect(parseHash("#/decks/id:4/versions/0")).toEqual({ name: "not-found" });
    expect(parseHash("#/decks/id:4/versions/v2")).toEqual({ name: "not-found" });
  });

  it("tolère l'adresse vide, la barre finale et une query", () => {
    expect(parseHash("")).toEqual({ name: "home" });
    expect(parseHash("#")).toEqual({ name: "home" });
    expect(parseHash("#/collection/")).toEqual({ name: "stock" });
    expect(parseHash("#/decks?x=1")).toEqual({ name: "decks" });
  });
});
