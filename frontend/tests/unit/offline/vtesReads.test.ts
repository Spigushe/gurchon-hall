import { afterEach, describe, expect, it } from "vitest";
import { Outbox } from "../../../src/offline/core/outbox";
import { foldText } from "../../../src/offline/core/foldText";
import { VtesOfflineDb, type CardRow, type StockRow } from "../../../src/offline/vtes/db";
import * as ops from "../../../src/offline/vtes/operations";
import { project } from "../../../src/offline/vtes/overlay";
import {
  readDeck,
  readDeckCards,
  readDecks,
  readStock,
  searchCards,
} from "../../../src/offline/vtes/reads";
import type { VtesOperation } from "../../../src/offline/vtes/types";
import { freshDbName } from "./helpers";

let counter = 0;
const clock: ops.OperationClock = {
  newId: () => `aaaaaaaa-0000-4000-8000-${String(++counter).padStart(12, "0")}`,
  now: () => "2026-09-20T14:03:11.123+02:00",
};

const opened: Array<{ db: VtesOfflineDb; outbox: Outbox<VtesOperation> }> = [];
afterEach(() => {
  for (const { db, outbox } of opened.splice(0)) {
    outbox.close();
    db.close();
  }
});
function open() {
  const db = new VtesOfflineDb(freshDbName("reads"));
  const outbox = new Outbox<VtesOperation>(db);
  opened.push({ db, outbox });
  return { db, outbox };
}

const stockRow = (
  cardId: number,
  name: string,
  languageCode = "EN",
  quantityOwned = 1,
  cardSetId = 9,
): StockRow => ({
  cardId,
  languageCode,
  cardSetId,
  quantityOwned,
  notes: null,
  cardName: name,
  foldedName: foldText(name),
  category: "library",
});

const cardRow = (id: number, name: string): CardRow => ({
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
  cardSetIds: [9],
  latestCardSetId: 9,
});

const NAMES = ["Élan vital", "École de sang", "Niño", "Ça ira", "Plain", "100% Bleed", "Under_score", "Elan brut", "Łódź", "Œuvre"];

describe("recherche locale : parité avec la recherche du serveur", () => {
  async function seeded() {
    const ctx = open();
    await ctx.db.stock.bulkPut(NAMES.map((name, i) => stockRow(i + 1, name)));
    await ctx.db.cards.bulkPut(NAMES.map((name, i) => cardRow(i + 1, name)));
    await ctx.db.decks.bulkPut(
      NAMES.map((name, i) => ({
        id: i + 1,
        name,
        foldedName: foldText(name),
        discriminator: String(1000 + i),
        createdOn: null,
        status: "draft" as const,
        archetype: null,
        notes: null,
        proxyAllowed: false,
        archivedAt: null,
      })),
    );
    return ctx;
  }

  const stockNames = async (db: VtesOfflineDb, q: string) =>
    (await readStock(db, { q })).map((entry) => entry.cardName).sort();
  const cardNames = async (db: VtesOfflineDb, q: string) =>
    (await searchCards(db, { q, limit: 100 })).map((card) => card.name).sort();
  const deckNames = async (db: VtesOfflineDb, q: string) =>
    (await readDecks(db, { q })).map((deck) => deck.name).sort();

  it.each(["élan", "ÉLAN", "elan", "ELAN"])("« %s » trouve « Élan vital » et « Elan brut »", async (q) => {
    const { db } = await seeded();
    const expected = ["Elan brut", "Élan vital"];
    expect(await stockNames(db, q)).toEqual(expected);
    expect(await cardNames(db, q)).toEqual(expected);
    expect(await deckNames(db, q)).toEqual(expected);
  });

  it("« oe » ne trouve pas « Œuvre », « œ » si", async () => {
    const { db } = await seeded();
    for (const list of [stockNames, cardNames, deckNames]) {
      expect(await list(db, "oe")).toEqual([]);
      expect(await list(db, "lodz")).toEqual([]);
      expect(await list(db, "œ")).toEqual(["Œuvre"]);
      expect(await list(db, "ŒUVRE")).toEqual(["Œuvre"]);
      expect(await list(db, "ł")).toEqual(["Łódź"]);
    }
  });

  it("garde les jokers littéraux, et un texte vide liste tout", async () => {
    const { db } = await seeded();
    expect(await stockNames(db, "%")).toEqual(["100% Bleed"]);
    expect(await stockNames(db, "_")).toEqual(["Under_score"]);
    expect(await stockNames(db, "％")).toEqual(["100% Bleed"]);
    expect(await stockNames(db, "")).toHaveLength(NAMES.length);
  });

  it("combine la recherche avec la langue et la catégorie", async () => {
    const { db } = await seeded();
    await db.stock.put(stockRow(1, "Élan vital", "FR"));
    expect((await readStock(db, { q: "ÉLAN", languageCode: "fr" })).map((e) => e.languageCode)).toEqual(["FR"]);
    expect(await readStock(db, { q: "élan", category: "crypt" })).toEqual([]);
  });
});

describe("lecture locale = instantané du serveur + opérations en file", () => {
  it("montre une saisie hors ligne avant qu'elle existe côté serveur", async () => {
    const { db, outbox } = open();
    await db.cards.bulkPut([cardRow(1, "Élan vital")]);
    await outbox.enqueue(
      ops.stockUpsert(clock, { cardId: 1, languageCode: "FR", cardSetId: 9, quantityOwned: 3 }),
    );

    expect(await readStock(db)).toEqual([
      {
        cardId: 1,
        languageCode: "FR",
        cardSetId: 9,
        quantityOwned: 3,
        notes: null,
        cardName: "Élan vital",
        category: "library",
        pending: true,
      },
    ]);
  });

  it("applique la dernière écriture de la file (upsert puis suppression)", async () => {
    const { db, outbox } = open();
    await db.stock.put(stockRow(1, "Élan vital", "EN", 5));
    await outbox.enqueue(
      ops.stockUpsert(clock, { cardId: 1, languageCode: "EN", cardSetId: 9, quantityOwned: 2 }),
    );
    expect((await readStock(db))[0]).toMatchObject({ quantityOwned: 2, pending: true });
    await outbox.enqueue(ops.stockDelete(clock, 1, "EN", 9));
    expect(await readStock(db)).toEqual([]);
  });

  it("un refus n'a plus d'effet local : rien n'est à défaire", async () => {
    const { db, outbox } = open();
    await db.stock.put(stockRow(1, "Élan vital", "EN", 5));
    const entry = await outbox.enqueue(
      ops.stockUpsert(clock, { cardId: 1, languageCode: "EN", cardSetId: 9, quantityOwned: 99 }),
    );
    expect((await readStock(db))[0].quantityOwned).toBe(99);

    await outbox.settle([
      {
        operationId: entry.operationId,
        outcome: "rejected",
        error: { code: "conflict", message: "trop" },
        refs: [],
      },
    ]);
    expect((await readStock(db))[0]).toMatchObject({ quantityOwned: 5, pending: false });
  });

  it("un deck créé hors ligne se lit par sa référence, composition comprise", async () => {
    const { db, outbox } = open();
    await db.cards.bulkPut([cardRow(1, "Élan vital")]);
    await outbox.enqueue(ops.deckCreate(clock, "ref-A", { name: "Malkavien" }), { createsRef: "ref-A" });
    await outbox.enqueue(
      ops.deckCardUpsert(clock, "ref:ref-A", { cardId: 1, languageCode: "EN", cardSetId: 9, quantity: 2 }),
    );

    const [deck] = await readDecks(db);
    expect(deck).toMatchObject({
      key: "ref:ref-A",
      id: null,
      clientRef: "ref-A",
      name: "Malkavien",
      discriminator: null,
      status: "draft",
      proxyAllowed: false,
      pending: true,
    });
    expect(await readDeckCards(db, "ref:ref-A")).toEqual([
      {
        cardId: 1,
        languageCode: "EN",
        cardSetId: 9,
        quantity: 2,
        proxyQuantity: 0,
        cardName: "Élan vital",
        pending: true,
      },
    ]);
  });

  it("garde la clé d'un deck après sa synchronisation, et l'identité serveur s'y raccorde", async () => {
    const { db, outbox } = open();
    // Après rejeu : la file est vide, la correspondance est mémorisée, le
    // rafraîchissement a rapporté le deck du serveur.
    await db.refs.put({ ref: "ref-A", id: 12, boundAt: "2026-09-20T14:00:00.000+02:00" });
    await db.decks.put({
      id: 12,
      name: "Malkavien",
      foldedName: "malkavien",
      discriminator: "8561",
      createdOn: null,
      status: "draft",
      archetype: null,
      notes: null,
      proxyAllowed: false,
      archivedAt: null,
    });
    // Une opération encore en file peut continuer de désigner le deck par sa référence.
    await outbox.enqueue(
      ops.deckCardUpsert(clock, "ref:ref-A", { cardId: 1, languageCode: "EN", cardSetId: 9, quantity: 1 }),
    );

    expect(await readDeck(db, "ref:ref-A")).toMatchObject({
      key: "ref:ref-A",
      id: 12,
      discriminator: "8561",
      pending: true,
    });
    expect(await readDeck(db, "id:12")).toBeUndefined();
    expect((await readDeckCards(db, "ref:ref-A"))[0]).toMatchObject({ cardId: 1, pending: true });
  });

  it("archive, désarchive, supprime", async () => {
    const { db, outbox } = open();
    await db.decks.put({
      id: 3,
      name: "Toréador",
      foldedName: "toreador",
      discriminator: "0001",
      createdOn: null,
      status: "active",
      archetype: null,
      notes: null,
      proxyAllowed: false,
      archivedAt: null,
    });
    await outbox.enqueue(ops.deckUpdate(clock, "id:3", { archived: true }));
    expect(await readDecks(db)).toEqual([]); // sorti de la liste par défaut
    expect(await readDecks(db, { state: "archived" })).toHaveLength(1);

    await outbox.enqueue(ops.deckUpdate(clock, "id:3", { archived: false, name: "Toréador 2" }));
    expect((await readDecks(db))[0]).toMatchObject({ name: "Toréador 2", archivedAt: null });

    await outbox.enqueue(ops.deckDelete(clock, "id:3"));
    expect(await readDecks(db, { state: "all" })).toEqual([]);
  });

  it("ignore une opération dont le deck n'existe pas (création refusée)", () => {
    const projection = project(
      { stock: [], decks: [], deckCards: [], cards: [], refs: [] },
      [ops.deckCardUpsert(clock, "ref:inconnue", { cardId: 1, languageCode: "EN", cardSetId: 9, quantity: 1 })],
    );
    expect(projection.decks).toEqual([]);
    expect(projection.deckCards.size).toBe(0);
  });

  it("projette une création tranchée avec son identifiant serveur, sans marque d'attente", () => {
    const create = ops.deckCreate(clock, "r1", { name: "Malkavien" });
    const line = ops.deckCardUpsert(clock, "ref:r1", { cardId: 1, languageCode: "EN", cardSetId: 9, quantity: 2 });
    const queued = ops.deckUpdate(clock, "ref:r1", { notes: "en file" });
    const empty = { stock: [], decks: [], deckCards: [], cards: [], refs: [{ ref: "r1", id: 7, boundAt: "x" }] };

    const projection = project(empty, [queued], [create, line]);
    expect(projection.decks).toMatchObject([
      { key: "ref:r1", id: 7, clientRef: "r1", name: "Malkavien", notes: "en file", proxyAllowed: false, pending: true },
    ]);
    expect(projection.deckCards.get("ref:r1")).toMatchObject([{ cardId: 1, quantity: 2, pending: false }]);

    const settledOnly = project(empty, [], [create, line]);
    expect(settledOnly.decks[0]).toMatchObject({ id: 7, pending: false, discriminator: null });
  });

  it("laisse le miroir faire foi quand il a déjà le deck d'une création tranchée", () => {
    const create = ops.deckCreate(clock, "r1", { name: "Nom de l'opération" });
    const mirrored = {
      stock: [],
      cards: [],
      refs: [{ ref: "r1", id: 7, boundAt: "x" }],
      decks: [
        {
          id: 7, name: "Nom du serveur", foldedName: "nom du serveur", discriminator: "4242",
          createdOn: null, status: "draft" as const, archetype: null, notes: null, proxyAllowed: true,
          archivedAt: null,
        },
      ],
      deckCards: [
        { deckId: 7, cardId: 1, languageCode: "EN", cardSetId: 9, quantity: 1, proxyQuantity: 0, cardName: null },
      ],
    };
    const projection = project(mirrored, [], [create]);
    expect(projection.decks).toMatchObject([
      { key: "ref:r1", name: "Nom du serveur", discriminator: "4242", proxyAllowed: true },
    ]);
    expect(projection.deckCards.get("ref:r1")).toHaveLength(1); // composition intacte
  });

  it("ne projette pas un versement de produit (contenu non miroité)", () => {
    const projection = project(
      { stock: [], decks: [], deckCards: [], cards: [], refs: [] },
      [ops.bundleDeposit(clock, 4, "EN", 2)],
    );
    expect(projection.stock).toEqual([]);
  });
});
