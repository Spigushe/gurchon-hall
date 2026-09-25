import { afterEach, describe, expect, it } from "vitest";
import { Outbox } from "../../../src/offline/core/outbox";
import { foldText } from "../../../src/offline/core/foldText";
import { VtesOfflineDb, type CardRow, type DeckCardRow, type DeckRow, type StockRow } from "../../../src/offline/vtes/db";
import * as ops from "../../../src/offline/vtes/operations";
import { project } from "../../../src/offline/vtes/overlay";
import { readDeckCards, readStock } from "../../../src/offline/vtes/reads";
import type { VtesOperation } from "../../../src/offline/vtes/types";
import { freshDbName } from "./helpers";

/**
 * Lot 4 : deux impressions de la même carte et de la même langue sont deux
 * entrées distinctes (`card_set_id` dans la clé), aussi bien dans la base
 * Dexie que dans la projection de la file (`overlay.ts`).
 */

let counter = 0;
const clock: ops.OperationClock = {
  newId: () => `bbbbbbbb-0000-4000-8000-${String(++counter).padStart(12, "0")}`,
  now: () => "2026-09-24T10:00:00.000+02:00",
};

const opened: Array<{ db: VtesOfflineDb; outbox: Outbox<VtesOperation> }> = [];
afterEach(() => {
  for (const { db, outbox } of opened.splice(0)) {
    outbox.close();
    db.close();
  }
});
function open() {
  const db = new VtesOfflineDb(freshDbName("printings"));
  const outbox = new Outbox<VtesOperation>(db);
  opened.push({ db, outbox });
  return { db, outbox };
}

const cardRow = (id: number, name: string, cardSetIds: number[]): CardRow => ({
  id,
  veknId: 100000 + id,
  name,
  foldedName: foldText(name),
  category: "library",
  clanName: null,
  capacity: null,
  groupCode: null,
  advanced: false,
  imageUrl: null,
  cardSetIds,
  latestCardSetId: Math.max(...cardSetIds),
});

const stockRow = (cardSetId: number, quantityOwned: number): StockRow => ({
  cardId: 1,
  languageCode: "FR",
  cardSetId,
  quantityOwned,
  notes: null,
  cardName: "Govern the Unaligned",
  foldedName: foldText("Govern the Unaligned"),
  category: "library",
});

const deckRow = (id: number): DeckRow => ({
  id,
  name: "Toréador",
  foldedName: "toreador",
  discriminator: "0001",
  createdOn: null,
  status: "draft",
  archetype: null,
  notes: null,
  proxyAllowed: false,
  archivedAt: null,
});

const deckCardRow = (deckId: number, cardSetId: number, quantity: number): DeckCardRow => ({
  deckId,
  cardId: 1,
  languageCode: "FR",
  cardSetId,
  quantity,
  proxyQuantity: 0,
  cardName: "Govern the Unaligned",
});

describe("deux impressions de la même carte et langue : clés Dexie", () => {
  it("coexistent dans `stock`, une entrée par extension", async () => {
    const { db } = open();
    await db.cards.put(cardRow(1, "Govern the Unaligned", [10, 20]));
    await db.stock.bulkPut([stockRow(10, 2), stockRow(20, 1)]);

    expect(await db.stock.count()).toBe(2);
    const entries = await readStock(db);
    expect(entries).toEqual([
      expect.objectContaining({ cardSetId: 10, quantityOwned: 2 }),
      expect.objectContaining({ cardSetId: 20, quantityOwned: 1 }),
    ]);

    // Modifier une impression ne touche pas l'autre.
    await db.stock.put(stockRow(10, 5));
    expect(await db.stock.count()).toBe(2);
    expect((await readStock(db)).find((e) => e.cardSetId === 10)?.quantityOwned).toBe(5);
    expect((await readStock(db)).find((e) => e.cardSetId === 20)?.quantityOwned).toBe(1);
  });

  it("filtre `readStock` par extension (`cardSetId`)", async () => {
    const { db } = open();
    await db.cards.put(cardRow(1, "Govern the Unaligned", [10, 20]));
    await db.stock.bulkPut([stockRow(10, 2), stockRow(20, 1)]);

    expect(await readStock(db, { cardSetId: 20 })).toEqual([
      expect.objectContaining({ cardSetId: 20, quantityOwned: 1 }),
    ]);
  });

  it("coexistent dans `deckCards`, une ligne par extension", async () => {
    const { db } = open();
    await db.decks.put(deckRow(1));
    await db.deckCards.bulkPut([deckCardRow(1, 10, 2), deckCardRow(1, 20, 1)]);

    expect(await db.deckCards.count()).toBe(2);
    const lines = await readDeckCards(db, "id:1");
    expect(lines).toEqual([
      expect.objectContaining({ cardSetId: 10, quantity: 2 }),
      expect.objectContaining({ cardSetId: 20, quantity: 1 }),
    ]);
  });
});

describe("deux impressions de la même carte et langue : projection de la file", () => {
  const emptySnapshot = { stock: [], decks: [], deckCards: [], cards: [], refs: [] };

  it("stock.upsert sur une extension ne remplace pas l'autre", () => {
    const first = ops.stockUpsert(clock, { cardId: 1, languageCode: "FR", cardSetId: 10, quantityOwned: 2 });
    const second = ops.stockUpsert(clock, { cardId: 1, languageCode: "FR", cardSetId: 20, quantityOwned: 1 });
    const projection = project(emptySnapshot, [first, second]);
    expect(projection.stock).toHaveLength(2);
    expect(projection.stock).toEqual([
      expect.objectContaining({ cardSetId: 10, quantityOwned: 2 }),
      expect.objectContaining({ cardSetId: 20, quantityOwned: 1 }),
    ]);
  });

  it("stock.delete sur une extension laisse l'autre intacte", () => {
    const snapshot = {
      ...emptySnapshot,
      stock: [stockRow(10, 2), stockRow(20, 1)],
    };
    const projection = project(snapshot, [ops.stockDelete(clock, 1, "FR", 10)]);
    expect(projection.stock).toEqual([expect.objectContaining({ cardSetId: 20, quantityOwned: 1 })]);
  });

  it("deck_card.upsert et deck_card.delete distinguent l'impression, à deck égal", () => {
    const snapshot = {
      stock: [],
      cards: [],
      refs: [],
      decks: [deckRow(1)],
      deckCards: [deckCardRow(1, 10, 2), deckCardRow(1, 20, 1)],
    };
    // Remplace la ligne de l'extension 10 seulement.
    const upserted = project(snapshot, [
      ops.deckCardUpsert(clock, "id:1", { cardId: 1, languageCode: "FR", cardSetId: 10, quantity: 3 }),
    ]);
    expect(upserted.deckCards.get("id:1")).toEqual([
      expect.objectContaining({ cardSetId: 10, quantity: 3 }),
      expect.objectContaining({ cardSetId: 20, quantity: 1 }),
    ]);

    // Retire la ligne de l'extension 20 seulement.
    const deleted = project(snapshot, [ops.deckCardDelete(clock, "id:1", 1, "FR", 20)]);
    expect(deleted.deckCards.get("id:1")).toEqual([expect.objectContaining({ cardSetId: 10, quantity: 2 })]);
  });
});
