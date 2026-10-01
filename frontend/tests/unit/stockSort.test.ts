import { describe, expect, it } from "vitest";
import {
  STOCK_SORT_COLUMNS,
  compareStockEntries,
  sortStockEntries,
  stockSortValue,
  type StockSortColumn,
} from "../../src/features/stock/stockSort";
import type { LocalStockEntry } from "../../src/offline/vtes";

const entry = (over: Partial<LocalStockEntry>): LocalStockEntry =>
  ({
    cardId: 1,
    languageCode: "EN",
    cardSetId: 9,
    quantityOwned: 1,
    notes: null,
    cardName: "Alpha",
    category: "library",
    pending: false,
    ...over,
  }) as LocalStockEntry;

const cards = new Map([
  [1, { clanName: "Toreador", capacity: null }],
  [2, { clanName: "Brujah", capacity: 8 }],
  [3, { clanName: "Ventrue", capacity: 4 }],
]);
// La carte 3 n'a aucun deck : absente de la table, elle vaut 0.
const deckCounts = new Map([
  [1, 3],
  [2, 1],
]);
const lookups = { cards, deckCounts };

const a = entry({ cardId: 1, cardName: "Alpha", category: "library", languageCode: "FR", quantityOwned: 5, notes: "z" });
const b = entry({ cardId: 2, cardName: "Beta", category: "crypt", languageCode: "EN", quantityOwned: 2, notes: null });
const c = entry({ cardId: 3, cardName: "Gamma", category: "crypt", languageCode: "ES", quantityOwned: 9, notes: "a" });
const names = (sorted: LocalStockEntry[]) => sorted.map((e) => e.cardName);

describe("tri de la collection (fonction pure partagée)", () => {
  // Entrée toujours [c, a, b] : les égalités (type) gardent cet ordre, dans les deux sens.
  const cases: Array<[StockSortColumn, string[], string[]]> = [
    ["name", ["Alpha", "Beta", "Gamma"], ["Gamma", "Beta", "Alpha"]],
    ["type", ["Alpha", "Gamma", "Beta"], ["Gamma", "Beta", "Alpha"]], // Bibliothèque avant Crypte
    ["clan", ["Beta", "Alpha", "Gamma"], ["Gamma", "Alpha", "Beta"]], // Brujah, Toreador, Ventrue
    ["capacity", ["Alpha", "Gamma", "Beta"], ["Beta", "Gamma", "Alpha"]], // -1, 4, 8
    ["language", ["Beta", "Gamma", "Alpha"], ["Alpha", "Gamma", "Beta"]], // EN, ES, FR
    ["quantity", ["Beta", "Alpha", "Gamma"], ["Gamma", "Alpha", "Beta"]], // 2, 5, 9
    ["decks", ["Gamma", "Beta", "Alpha"], ["Alpha", "Beta", "Gamma"]], // 0, 1, 3
    ["notes", ["Beta", "Gamma", "Alpha"], ["Alpha", "Gamma", "Beta"]], // "", "a", "z"
  ];

  it("couvre tous les critères du tableau", () => {
    expect(cases.map(([column]) => column).sort()).toEqual(STOCK_SORT_COLUMNS.map((col) => col.key).sort());
  });

  it.each(cases)("critère %s : sens croissant puis décroissant", (column, asc, desc) => {
    const input = [c, a, b];
    expect(names(sortStockEntries(input, column, "asc", lookups))).toEqual(asc);
    expect(names(sortStockEntries(input, column, "desc", lookups))).toEqual(desc);
    expect(input).toEqual([c, a, b]); // l'entrée n'est pas modifiée
  });

  it("valeurs absentes : texte vide, capacité -1, zéro deck, sans miroir chargé", () => {
    expect(stockSortValue(entry({ cardName: null }), "name")).toBe("");
    expect(stockSortValue(entry({ category: null }), "type")).toBe("");
    expect(stockSortValue(a, "clan")).toBe(""); // miroir pas encore lu
    expect(stockSortValue(entry({ cardId: 99, category: "crypt" }), "capacity", lookups)).toBe(-1);
    expect(stockSortValue(a, "capacity", lookups)).toBe(-1); // bibliothèque : jamais de capacité
    expect(stockSortValue(b, "capacity", lookups)).toBe(8);
    expect(stockSortValue(entry({ cardId: 99 }), "decks", lookups)).toBe(0);
    expect(stockSortValue(b, "notes")).toBe("");
  });

  it("égalités : l'ordre d'entrée est conservé (tri stable), dans les deux sens", () => {
    const x = entry({ cardId: 1, cardName: "Même", languageCode: "FR" });
    const y = entry({ cardId: 2, cardName: "Même", languageCode: "EN" });
    expect(sortStockEntries([x, y], "name", "asc").map((e) => e.languageCode)).toEqual(["FR", "EN"]);
    expect(sortStockEntries([x, y], "name", "desc").map((e) => e.languageCode)).toEqual(["FR", "EN"]);
    expect(compareStockEntries(x, y, "name", "asc")).toBe(0);
  });

  it("compare par unités de code, comme la lecture locale : « T » avant « É »", () => {
    const t = entry({ cardName: "Theo Bell" });
    const e = entry({ cardName: "Élan vital" });
    expect(names(sortStockEntries([e, t], "name", "asc"))).toEqual(["Theo Bell", "Élan vital"]);
  });
});
