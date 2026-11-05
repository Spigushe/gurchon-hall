import { describe, expect, it } from "vitest";
import {
  activeFilterCount,
  buildSearchCatalog,
  filterCards,
  nameMatchesFirst,
  sortCards,
  type SearchContext,
} from "../../../src/offline/vtes/cardSearch";
import { runCardSearch } from "../../../src/offline/vtes/hooks";
import { cardRowOf } from "../../../src/offline/vtes/refresh";
import { DEFAULT_ON, SEARCH_CASES, SEARCH_CATALOG, ALL_IDS, CRYPT_IDS, LIBRARY_IDS } from "./fixtures/searchCases";
import { library, mirrorRows } from "./fixtures/syntheticCatalog";

/**
 * Lot Chercher, C1b et E1 : `filterCards` sur sa table de cas
 * (`fixtures/searchCases.ts`), puis le tri, le regroupement par le nom et le
 * miroir incomplet.
 */

const { cards, details } = mirrorRows(SEARCH_CATALOG);
const catalog = buildSearchCatalog(cards, details);
const context = (extra: Partial<SearchContext> = {}): SearchContext => ({ on: DEFAULT_ON, ...extra });
const idsOf = (items: Array<{ card: { id: number } }>) => items.map((item) => item.card.id);
const sorted = (ids: number[]) => [...ids].sort((a, b) => a - b);

describe("filterCards, table de cas", () => {
  it.each(SEARCH_CASES.map((c) => [c.description, c] as const))("%s", (_, c) => {
    const found = filterCards(catalog.cards, c.criteria, context(c.context));
    expect(sorted(idsOf(found))).toEqual(sorted(c.expected));
  });

  it("chaque cas a au moins une carte positive et une négative", () => {
    for (const c of SEARCH_CASES) {
      expect(c.expected.length, c.description).toBeGreaterThan(0);
      expect(c.expected.length, c.description).toBeLessThan(ALL_IDS.length);
    }
  });

  it("sans critère, rend tout le catalogue", () => {
    expect(filterCards(catalog.cards, {}, context())).toHaveLength(SEARCH_CATALOG.length);
  });

  it("compte les filtres actifs hors champ principal", () => {
    expect(activeFilterCount({ query: "bleed" }, context())).toBe(0);
    expect(
      activeFilterCount(
        {
          query: "bleed",
          category: "crypt",
          crypt: { groups: ["G2"], disciplines: [] },
          library: { bloodCost: { op: "ge", value: 1 } },
        },
        context(),
      ),
    ).toBe(3);
  });
});

describe("miroir incomplet", () => {
  // Les détails manquent pour toutes les cartes (montée de la version 5).
  const bare = buildSearchCatalog(cards, []);

  it("n'est pas complet", () => {
    expect(bare.complete).toBe(false);
    expect(catalog.complete).toBe(true);
    expect(buildSearchCatalog([], []).complete).toBe(false);
  });

  it("le champ principal ne cherche que le nom anglais", () => {
    expect(sorted(idsOf(filterCards(bare.cards, { query: "bleed" }, context())))).toEqual([121]);
    expect(idsOf(filterCards(bare.cards, { query: "majeste" }, context()))).toEqual([]);
    expect(idsOf(filterCards(bare.cards, { query: "tb" }, context()))).toEqual([1]);
  });

  it("aucune carte n'est lue comme légale sans ses détails", () => {
    expect(filterCards(bare.cards, { legality: "legal" }, context())).toEqual([]);
  });

  it("les filtres qui demandent les détails ne rendent rien ; catégorie et statut restent", () => {
    expect(filterCards(bare.cards, { crypt: { disciplines: [{ code: "dom", level: "inferior" }] } }, context())).toEqual([]);
    expect(filterCards(bare.cards, { library: { types: { values: ["Action"], mode: "or" } } }, context())).toEqual([]);
    expect(sorted(idsOf(filterCards(bare.cards, { category: "crypt" }, context())))).toEqual(CRYPT_IDS);
    expect(sorted(idsOf(filterCards(bare.cards, { crypt: { groups: ["G2"] } }, context())))).toEqual([1, 5, 9]);
    expect(
      idsOf(filterCards(bare.cards, { owned: "owned" }, context({ ownedCardIds: new Set([104]) }))),
    ).toEqual([104]);
  });
});

describe("tri (P9)", () => {
  it("par défaut : nom replié, puis groupe, puis identifiant", () => {
    const pair = buildSearchCatalog(
      [
        cardRowOf(library({ id: 3, name: "Zoé" })),
        cardRowOf(library({ id: 2, name: "élan" })),
        cardRowOf(library({ id: 1, name: "Elan" })),
      ],
      [],
    );
    expect(idsOf(sortCards(pair.cards))).toEqual([1, 2, 3]);
    expect(idsOf(sortCards(pair.cards, { key: "name", direction: "desc" }))).toEqual([3, 2, 1]);
  });

  it("capacité décroissante, départagée par le nom", () => {
    const crypt = filterCards(catalog.cards, { category: "crypt" }, context());
    const order = idsOf(sortCards(crypt, { key: "capacity", direction: "desc" }));
    expect(order.slice(0, 3)).toEqual([10, 8, 7]); // 11 (Inner…), 11 (Lasombra…), 10
    expect(order.at(-1)).toBe(9); // capacité 1
  });

  it("groupe croissant, « Any » en dernier", () => {
    const crypt = filterCards(catalog.cards, { category: "crypt" }, context());
    const order = idsOf(sortCards(crypt, { key: "group" }));
    expect(order[0]).toBe(10); // G1
    expect(order.at(-1)).toBe(5); // Any
  });

  it("coût croissant, « X » après les nombres, sans coût en dernier", () => {
    const withCost = filterCards(catalog.cards, { cardSetIds: [9] }, context()).filter((item) =>
      [104, 106, 108, 117, 110, 120].includes(item.card.id),
    );
    expect(idsOf(sortCards(withCost, { key: "cost" }))).toEqual([117, 104, 106, 110, 108, 120]); // à coût égal, le nom départage
    expect(idsOf(sortCards(withCost, { key: "cost", direction: "desc" }))).toEqual([108, 106, 110, 117, 104, 120]);
  });
});

describe("correspondances par le nom d'abord (proposition de P1, à valider en D1c)", () => {
  it("place les cartes trouvées par leur nom devant celles trouvées par leur texte", () => {
    const found = sortCards(filterCards(catalog.cards, { query: "bleed" }, context()));
    expect(idsOf(found)).toEqual([121, 120]); // déjà dans cet ordre par le nom
    const reversed = [...found].reverse();
    expect(nameMatchesFirst(reversed, "bleed")).toEqual({ cards: found, byName: 1 });
    expect(nameMatchesFirst(found, "").byName).toBe(2);
  });

  it("runCardSearch : regroupe sous le tri par nom seulement", () => {
    const status = { ownedCardIds: new Set<number>(), deckCardIds: new Set<number>() };
    const grouped = runCardSearch(catalog, status, { query: "bleed" }, { on: DEFAULT_ON, grouped: true });
    expect(grouped).toMatchObject({ byName: 1, complete: true });
    expect(idsOf(grouped.cards!)).toEqual([121, 120]);
    const byCost = runCardSearch(catalog, status, { query: "bleed" }, { on: DEFAULT_ON, grouped: true, sort: { key: "cost" } });
    expect(byCost.byName).toBeUndefined();
    expect(runCardSearch(undefined, status, {}, { on: DEFAULT_ON })).toEqual({
      cards: undefined,
      byName: undefined,
      complete: false,
    });
    expect(runCardSearch(catalog, undefined, {}, { on: DEFAULT_ON }).complete).toBe(true);
  });

  it("catégories bien réparties dans le catalogue de cas", () => {
    expect(CRYPT_IDS).toHaveLength(10);
    expect(LIBRARY_IDS).toHaveLength(22);
  });
});
