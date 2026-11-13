import Dexie from "dexie";
import { describe, expect, it } from "vitest";
import { CORE_STORES_V1, CORE_STORES_V2, OfflineCoreDb } from "../../../src/offline/core/db";
import {
  VtesOfflineDb,
  VTES_STORES_V1,
  VTES_STORES_V2,
  VTES_STORES_V3,
  VTES_STORES_V4,
} from "../../../src/offline/vtes/db";
import { LEGACY_DB_NAME, adoptLegacyDatabase } from "../../../src/offline/vtes/legacy";
import { readCatalogState, readProjection, searchCards } from "../../../src/offline/vtes/reads";
import { cardRowOf } from "../../../src/offline/vtes/refresh";
import { crypt, library, mirrorRows } from "./fixtures/syntheticCatalog";
import { freshDbName } from "./helpers";

/**
 * Lot Chercher, étape C1a : montée de la version 5 à la version 6 (magasin
 * `cardDetails`). Le scénario du plan : un téléphone qui exécute le nouveau code
 * pour la première fois **hors ligne** garde son catalogue, son picker et ses
 * libellés ; seul le miroir des détails est vide, donc « incomplet ».
 */

/** Base au schéma du Lot 7 (versions 1 à 5) : l'« ancien code » d'avant le lot Chercher. */
class Lot7Db extends OfflineCoreDb {
  constructor(name: string) {
    super(name);
    this.version(1).stores({ ...CORE_STORES_V1, ...VTES_STORES_V1 });
    this.version(2).stores({ ...CORE_STORES_V2 });
    this.version(3).stores({ ...VTES_STORES_V2 });
    this.version(4).stores({ ...VTES_STORES_V3 });
    this.version(5).stores({ ...VTES_STORES_V4 });
  }
}

const elan = library({
  id: 1,
  name: "Élan vital",
  translatedNames: [{ language_code: "FR", name: "Élan vital" }],
});
const theo = crypt({ id: 2, name: "Theo Bell", clan: "Brujah", group: "2", capacity: 7 });

/** Une base du Lot 7 en service : catalogue, stock, un deck, une opération en file, une correspondance. */
async function seedLot7(name: string) {
  const before = new Lot7Db(name);
  await before.table("cards").bulkPut([elan, theo].map(cardRowOf));
  await before.table("stock").put({
    cardId: 1,
    languageCode: "FR",
    cardSetId: 9,
    quantityOwned: 2,
    notes: null,
    cardName: "Élan vital",
    foldedName: "elan vital",
    category: "library",
  });
  await before.table("decks").put({
    id: 1,
    name: "Banu",
    foldedName: "banu",
    discriminator: "0001",
    createdOn: null,
    status: "draft",
    archetype: null,
    notes: null,
    proxyAllowed: false,
    archivedAt: null,
  });
  await before.table("players").put({ id: 1, name: "Moi", foldedName: "moi", isMe: true, gameCount: 0 });
  await before.table("outbox").put({
    operationId: "op-1",
    rank: 1,
    type: "stock.upsert",
    state: "pending",
    operation: {
      operation_id: "op-1",
      recorded_at: "2026-11-05T10:00:00.000+01:00",
      type: "stock.upsert",
      data: { card_id: 1, language_code: "FR", card_set_id: 9, quantity_owned: 3 },
    },
    recordedAt: "t",
    attempts: 0,
  });
  await before.table("refs").put({ ref: "r", id: 1, boundAt: "t" });
  before.close();
}

describe("version 6 du schéma (lot Chercher : détails du catalogue)", () => {
  it("ajoute `cardDetails` sans rien vider : catalogue, picker, file et libellés restent", async () => {
    const name = freshDbName("v6");
    await seedLot7(name);

    const after = new VtesOfflineDb(name);
    try {
      await after.open();
      expect(after.verno).toBe(7);
      expect(await after.cards.count()).toBe(2);
      expect(await after.stock.count()).toBe(1);
      expect(await after.decks.count()).toBe(1);
      expect(await after.players.count()).toBe(1);
      expect(await after.outbox.count()).toBe(1);
      expect(await after.refs.get("r")).toEqual({ ref: "r", id: 1, boundAt: "t" });
      expect(await after.cardDetails.count()).toBe(0);

      // Le picker cherche toujours dans le miroir court.
      expect((await searchCards(after, { q: "elan" })).map((card) => card.id)).toEqual([1]);
      // Les libellés de la projection viennent toujours de `cards`, file comprise.
      const projection = await readProjection(after);
      expect(projection.stock).toEqual([
        expect.objectContaining({ cardId: 1, cardName: "Élan vital", quantityOwned: 3 }),
      ]);
      // Miroir incomplet : détails absents.
      expect(await readCatalogState(after)).toEqual({ cards: 2, details: 0, complete: false });
    } finally {
      after.close();
    }
  });

  it("se dit complet quand les détails couvrent tout le catalogue, incomplet sinon", async () => {
    const db = new VtesOfflineDb(freshDbName("v6-state"));
    try {
      expect(await readCatalogState(db)).toEqual({ cards: 0, details: 0, complete: false });
      const { cards, details } = mirrorRows([elan, theo]);
      await db.cards.bulkPut(cards);
      await db.cardDetails.bulkPut(details.slice(0, 1));
      expect(await readCatalogState(db)).toMatchObject({ complete: false });
      await db.cardDetails.bulkPut(details);
      expect(await readCatalogState(db)).toEqual({ cards: 2, details: 2, complete: true });
    } finally {
      db.close();
    }
  });

  it("monte aussi la base d'avant le Lot 6 quand l'adoption l'ouvre, sans toucher sa file", async () => {
    await seedLot7(LEGACY_DB_NAME);
    const target = freshDbName("v6-adopt");
    try {
      expect(await adoptLegacyDatabase(target)).toMatchObject({ adopted: true, operations: 1 });
      const db = new VtesOfflineDb(target);
      try {
        await db.open();
        expect(db.verno).toBe(7);
        expect((await db.outbox.toArray()).map((row) => row.operationId)).toEqual(["op-1"]);
      } finally {
        db.close();
      }
    } finally {
      await Dexie.delete(LEGACY_DB_NAME);
    }
  });

  it("supporte une double ouverture : deux onglets du nouveau code sur la même base", async () => {
    const name = freshDbName("v6-double");
    await seedLot7(name);
    const first = new VtesOfflineDb(name);
    const second = new VtesOfflineDb(name);
    try {
      await Promise.all([first.open(), second.open()]);
      expect(first.verno).toBe(7);
      expect(second.verno).toBe(7);
      await first.cardDetails.bulkPut(mirrorRows([elan]).details);
      expect(await second.cardDetails.count()).toBe(1);
    } finally {
      first.close();
      second.close();
    }
  });

  it("l'ancien code (Lot 7) ouvre encore une base montée en version 6, et y lit son catalogue", async () => {
    // Cas réel : un onglet resté ouvert sur l'ancien code, ou un retour arrière
    // du déploiement. Constat sous Dexie 4.4 : il ouvre la base à la version
    // installée, sans `VersionError`, et y lit ses magasins ; `cardDetails` lui
    // est inconnu et reste intact. Résultat noté dans
    // `frontend/src/offline/README.md`.
    const name = freshDbName("v6-old-code");
    await seedLot7(name);
    const upgraded = new VtesOfflineDb(name);
    await upgraded.open();
    await upgraded.cardDetails.bulkPut(mirrorRows([elan, theo]).details);
    upgraded.close();

    const old = new Lot7Db(name);
    try {
      await old.open();
      expect(await old.table("cards").count()).toBe(2);
      expect(await old.table("outbox").count()).toBe(1);
    } finally {
      old.close();
    }

    // Et le nouveau code retrouve ensuite ses détails intacts.
    const again = new VtesOfflineDb(name);
    try {
      expect(await again.cardDetails.count()).toBe(2);
    } finally {
      again.close();
    }
  });
});
