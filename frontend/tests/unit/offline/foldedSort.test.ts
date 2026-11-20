import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { compareCodeUnits, compareFolded, compareFoldedKeys, foldText } from "../../../src/offline/core/foldText";
import { VtesOfflineDb } from "../../../src/offline/vtes/db";
import { readDeckCards, readDecks, readStock, readVenues, searchCards } from "../../../src/offline/vtes/reads";
import { freshDbName } from "./helpers";

// Lot 12, A7 : le miroir trie les noms comme l'API (`folded_order`), sur la
// table de cas commune aux deux suites.
interface SortCase {
  description: string;
  names: string[];
  expected: string[];
}
const TABLE = JSON.parse(
  readFileSync(resolve(__dirname, "../../../../backend/tests/fixtures/folded_sort_cases.json"), "utf-8"),
) as { cases: SortCase[] };
const CASES = TABLE.cases.map((entry) => [entry.description, entry] as const);

const opened: VtesOfflineDb[] = [];
afterEach(() => {
  for (const db of opened.splice(0)) db.close();
});
function open(): VtesOfflineDb {
  const db = new VtesOfflineDb(freshDbName("folded-sort"));
  opened.push(db);
  return db;
}

describe("la table de cas commune", () => {
  it("contient au moins un cas où l'ordre binaire se trompe", () => {
    const wrong = TABLE.cases.filter(
      (entry) => JSON.stringify([...entry.names].sort(compareCodeUnits)) !== JSON.stringify(entry.expected),
    );
    expect(wrong.length).toBeGreaterThan(0);
  });

  it("ne répète aucun nom dans un cas", () => {
    for (const entry of TABLE.cases) expect(new Set(entry.names).size).toBe(entry.names.length);
  });
});

describe("compareFolded", () => {
  it.each(CASES)("%s", (_description, entry) => {
    expect([...entry.names].sort(compareFolded)).toEqual(entry.expected);
  });

  it.each(CASES)("même ordre avec le nom replié déjà calculé : %s", (_description, entry) => {
    const sorted = [...entry.names].sort((a, b) => compareFoldedKeys(foldText(a), a, foldText(b), b));
    expect(sorted).toEqual(entry.expected);
  });

  it("rend 0 pour deux noms identiques", () => {
    expect(compareFolded("Élan", "Élan")).toBe(0);
  });
});

describe("lectures du miroir", () => {
  it.each(CASES)("stock, cartes, decks, lignes de deck et lieux : %s", async (_description, entry) => {
    const db = open();
    const names = entry.names;
    await db.stock.bulkPut(
      names.map((name, i) => ({
        cardId: i + 1,
        languageCode: "EN",
        cardSetId: 9,
        quantityOwned: 1,
        notes: null,
        cardName: name,
        foldedName: foldText(name),
        category: "library" as const,
      })),
    );
    await db.cards.bulkPut(
      names.map((name, i) => ({
        id: i + 1,
        veknId: 100000 + i,
        name,
        foldedName: foldText(name),
        category: "library" as const,
        clanName: null,
        capacity: null,
        groupCode: null,
        advanced: false,
        imageUrl: null,
        cardSetIds: [9],
        latestCardSetId: 9,
      })),
    );
    await db.decks.bulkPut(
      names.map((name, i) => ({
        id: i + 1,
        name,
        foldedName: foldText(name),
        // Discriminants décroissants : l'ordre attendu ne peut pas venir d'eux.
        discriminator: String(9000 - i),
        createdOn: null,
        status: "draft" as const,
        archetype: null,
        notes: null,
        proxyAllowed: false,
        archivedAt: null,
      })),
    );
    await db.deckCards.bulkPut(
      names.map((name, i) => ({
        deckId: 1,
        cardId: i + 1,
        languageCode: "EN",
        cardSetId: 9,
        quantity: 1,
        proxyQuantity: 0,
        cardName: name,
      })),
    );
    await db.venues.bulkPut(
      names.map((name, i) => ({
        id: i + 1,
        name,
        foldedName: foldText(name),
        city: null,
        notes: null,
        gameCount: 0,
        tournamentCount: 0,
      })),
    );

    expect((await readStock(db)).map((row) => row.cardName)).toEqual(entry.expected);
    expect((await searchCards(db, { limit: 100 })).map((card) => card.name)).toEqual(entry.expected);
    expect((await readDecks(db)).map((deck) => deck.name)).toEqual(entry.expected);
    expect((await readDeckCards(db, "id:1")).map((line) => line.cardName)).toEqual(entry.expected);
    expect((await readVenues(db)).map((venue) => venue.name)).toEqual(entry.expected);
  });

  it("garde les clés suivantes : deux decks du même nom se rangent par discriminant", async () => {
    const db = open();
    const deck = (id: number, name: string, discriminator: string) => ({
      id,
      name,
      foldedName: foldText(name),
      discriminator,
      createdOn: null,
      status: "draft" as const,
      archetype: null,
      notes: null,
      proxyAllowed: false,
      archivedAt: null,
    });
    await db.decks.bulkPut([deck(1, "Zoé", "0001"), deck(2, "Élan", "0042"), deck(3, "Élan", "0007")]);
    expect((await readDecks(db)).map((row) => `${row.name}#${row.discriminator}`)).toEqual([
      "Élan#0007",
      "Élan#0042",
      "Zoé#0001",
    ]);
  });
});
