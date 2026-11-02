import Dexie from "dexie";
import { describe, expect, it, vi } from "vitest";
import { CORE_STORES_V1, CORE_STORES_V2, OfflineCoreDb } from "../../../src/offline/core/db";
import {
  VtesOfflineDb,
  VTES_STORES_V1,
  VTES_STORES_V2,
  VTES_STORES_V3,
  type GameRow,
} from "../../../src/offline/vtes/db";
import { freshDbName } from "./helpers";

/** Base au schéma d'avant le Lot 7 (versions 1 à 4), pour simuler un navigateur qui l'a déjà ouverte. */
class PreLot7Db extends OfflineCoreDb {
  constructor(name: string) {
    super(name);
    this.version(1).stores({ ...CORE_STORES_V1, ...VTES_STORES_V1 });
    this.version(2).stores({ ...CORE_STORES_V2 });
    this.version(3).stores({ ...VTES_STORES_V2 });
    this.version(4).stores({ ...VTES_STORES_V3 });
  }
}

describe("version 5 du schéma (Lot 7 : miroirs de la pratique de jeu)", () => {
  it("ajoute quatre magasins sans rien perdre des données existantes", async () => {
    const name = freshDbName("v5");
    const before = new PreLot7Db(name);
    await before.table("stock").put({
      cardId: 1,
      languageCode: "FR",
      cardSetId: 3,
      quantityOwned: 2,
      notes: null,
      cardName: "Élan vital",
      foldedName: "elan vital",
      category: "library",
    });
    await before.table("decks").put({ id: 1, name: "Banu", foldedName: "banu" });
    await before.table("outbox").put({
      operationId: "op-1",
      rank: 1,
      type: "stock.upsert",
      state: "pending",
      operation: {},
      recordedAt: "t",
      attempts: 0,
    });
    await before.table("refs").put({ ref: "r", id: 1, boundAt: "t" });
    before.close();

    const after = new VtesOfflineDb(name);
    try {
      await after.open();
      expect(after.verno).toBe(5);
      // Rien n'est vidé : ni miroirs, ni file, ni correspondances.
      expect(await after.stock.count()).toBe(1);
      expect(await after.decks.count()).toBe(1);
      expect(await after.outbox.count()).toBe(1);
      expect(await after.refs.get("r")).toEqual({ ref: "r", id: 1, boundAt: "t" });
      // Les quatre nouveaux magasins, vides.
      for (const table of [after.players, after.venues, after.tournaments, after.games]) {
        expect(await table.count()).toBe(0);
      }
    } finally {
      after.close();
    }
  });

  it("indexe les parties par tournoi et par date, et range la table dans la ligne", async () => {
    const db = new VtesOfflineDb(freshDbName("v5-games"));
    try {
      const game = (id: number, tournamentId: number | null, playedAt: string): GameRow => ({
        id,
        playedAt,
        venueId: null,
        tournamentId,
        tournamentName: null,
        roundNumber: null,
        roundType: tournamentId === null ? "casual" : "preliminary",
        playerCount: 5,
        me: { deckId: null, seat: null, victoryPoints: 2, gameWin: null },
        notes: null,
        updatedAt: playedAt,
        table:
          id === 1
            ? [
                {
                  playerId: 1,
                  isMe: true,
                  deckId: null,
                  seat: 1,
                  victoryPoints: 2,
                  gameWin: null,
                  notes: null,
                },
              ]
            : null,
      });
      await db.games.bulkPut([
        game(1, 7, "2026-10-01T10:00:00Z"),
        game(2, 7, "2026-10-02T10:00:00Z"),
        game(3, null, "2026-10-03T10:00:00Z"),
      ]);
      expect((await db.games.where("tournamentId").equals(7).toArray()).map((g) => g.id)).toEqual([1, 2]);
      expect((await db.games.orderBy("playedAt").reverse().first())?.id).toBe(3);
      expect((await db.games.get(1))?.table).toHaveLength(1);
      expect((await db.games.get(2))?.table).toBeNull();

      await db.players.put({ id: 1, name: "Moi", foldedName: "moi", isMe: true, gameCount: 3 });
      expect((await db.players.where("foldedName").equals("moi").first())?.id).toBe(1);
    } finally {
      db.close();
    }
  });
});

describe("versionchange : fermeture propre", () => {
  it("ferme la connexion quand un autre onglet monte la version, et la mise à niveau aboutit", async () => {
    const name = freshDbName("vc");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const tab = new VtesOfflineDb(name);
    await tab.open();
    expect(tab.isOpen()).toBe(true);

    // « Autre onglet » : même base, une version de plus (Dexie multiplie par 10).
    const other = new Dexie(name);
    other.version(6).stores({ extra: "id" });
    try {
      await other.open();
      expect(other.isOpen()).toBe(true);
      expect(tab.isOpen()).toBe(false);
      // Notre gestionnaire remplace celui de Dexie : pas de bruit en console.
      expect(warn).not.toHaveBeenCalled();
    } finally {
      other.close();
      tab.close();
      warn.mockRestore();
    }
  });
});
