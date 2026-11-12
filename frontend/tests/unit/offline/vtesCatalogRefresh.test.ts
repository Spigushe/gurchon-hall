import { afterEach, describe, expect, it } from "vitest";
import { VtesOfflineDb } from "../../../src/offline/vtes/db";
import { readCatalogState } from "../../../src/offline/vtes/reads";
import { refreshCatalog } from "../../../src/offline/vtes/refresh";
import { createVtesOffline, type VtesOfflineRuntime } from "../../../src/offline/vtes/runtime";
import type { ApiClient } from "../../../src/offline/vtes/types";
import { CARD_SET_ID, createFakeServer, type FakeServer } from "./fakeServer";
import { bulkCatalog, crypt, library, mirrorRows } from "./fixtures/syntheticCatalog";
import { freshDbName, manualTimers, within } from "./helpers";

/**
 * Lot Chercher, étape C1a : `refreshCatalog` sur deux magasins, et la relecture
 * du catalogue sortie de la séquence des 60 s (`runtime.ts`).
 */

const dbs: VtesOfflineDb[] = [];
const runtimes: VtesOfflineRuntime[] = [];

const openDb = (prefix: string) => {
  const db = new VtesOfflineDb(freshDbName(prefix));
  dbs.push(db);
  return db;
};

afterEach(async () => {
  for (const runtime of runtimes.splice(0)) {
    runtime.stop();
    await runtime.engine.whenIdle();
    runtime.dispose();
  }
  for (const db of dbs.splice(0)) db.close();
});

/** Un client qui laisse passer le serveur factice, sauf ce que `get` intercepte. */
function wrap(
  server: FakeServer,
  get: (path: string, forward: () => Promise<unknown>) => Promise<unknown>,
): ApiClient {
  return {
    ...server.client,
    GET: ((path: string, init: unknown) =>
      get(path, () => (server.client.GET as (p: string, i: unknown) => Promise<unknown>)(path, init))) as ApiClient["GET"],
  } as ApiClient;
}

const pagesRequested = (server: FakeServer) =>
  server.state.requests.filter((request) => request.path === "/cartes").length;

describe("refreshCatalog : deux magasins", () => {
  it("écrit `cards` et `cardDetails` ensemble, détails lus dans la forme du contrat", async () => {
    const server = createFakeServer();
    server.state.catalog = [
      library({
        id: 10,
        name: "Govern the Unaligned",
        types: ["Action"],
        disciplines: ["dom"],
        disciplineRequirement: "mono",
        costType: "blood",
        costValue: "1",
        clanRequirement: "Ventrue, Tremere",
        text: "+1 stealth. [DOM] Bleed with +1 bleed.",
        translatedNames: [{ language_code: "FR", name: "Gouverner les Indépendants" }],
        requiredSects: ["Camarilla"],
        requiredTitles: ["Prince"],
        libraryRequirement: "prince",
      }),
      crypt({ id: 11, name: "Théo Bell", disciplines: ["CEL", "dom", "POT"], title: "Archon", sect: "Camarilla" }),
    ];
    const db = openDb("catalog-both");

    expect(await refreshCatalog(server.client, db)).toBe(2);

    expect(await db.cards.count()).toBe(2);
    expect(await db.cardDetails.get(10)).toEqual({
      id: 10,
      clanId: null,
      sect: null,
      title: null,
      path: null,
      costType: "blood",
      costValue: "1",
      clanRequirements: ["Ventrue", "Tremere"],
      pathRequirements: [],
      disciplineRequirement: "mono",
      disciplines: [{ code: "dom", name: "Dominate", superior: false }],
      types: ["Action"],
      libraryRequirement: "prince",
      requiredSects: ["Camarilla"],
      requiredTitles: ["Prince"],
      requiresTitled: false,
      requiresNonTitled: false,
      otherRequirements: [],
      cardText: "+1 stealth. [DOM] Bleed with +1 bleed.",
      foldedText: "+1 stealth. [dom] bleed with +1 bleed.",
      bannedOn: null,
      legalFrom: "1995-01-01",
      translatedNames: [{ languageCode: "FR", name: "Gouverner les Indépendants" }],
      foldedTranslatedNames: ["gouverner les independants"],
    });
    expect((await db.cardDetails.get(11))?.disciplines).toEqual([
      { code: "cel", name: "Celerity", superior: true },
      { code: "dom", name: "Dominate", superior: false },
      { code: "pot", name: "Potence", superior: true },
    ]);
    expect(await readCatalogState(db)).toEqual({ cards: 2, details: 2, complete: true });
  });

  it("lit au-delà de 200 cartes, page par page, et remplace tout le catalogue", async () => {
    const server = createFakeServer();
    server.state.catalog = bulkCatalog(450);
    const db = openDb("catalog-pages");
    const stale = mirrorRows([library({ id: 9999, name: "Carte disparue" })]);
    await db.cards.bulkPut(stale.cards);
    await db.cardDetails.bulkPut(stale.details);

    expect(await refreshCatalog(server.client, db)).toBe(450);

    expect(pagesRequested(server)).toBe(3); // 200 + 200 + 50
    expect(await readCatalogState(db)).toEqual({ cards: 450, details: 450, complete: true });
    expect(await db.cards.get(9999)).toBeUndefined();
    expect(await db.cardDetails.get(9999)).toBeUndefined();
  });

  it("une lecture interrompue ne touche à aucun des deux magasins", async () => {
    const server = createFakeServer();
    server.state.catalog = bulkCatalog(450);
    const db = openDb("catalog-interrupted");
    const before = mirrorRows([library({ id: 1, name: "Élan vital" })]);
    await db.cards.bulkPut(before.cards);
    await db.cardDetails.bulkPut(before.details);

    let calls = 0;
    const client = wrap(server, async (path, forward) => {
      if (path === "/cartes" && ++calls === 2) throw new TypeError("Failed to fetch");
      return forward();
    });
    await expect(refreshCatalog(client, db)).rejects.toThrow("Failed to fetch");

    expect(await db.cards.toArray()).toEqual(before.cards);
    expect(await db.cardDetails.toArray()).toEqual(before.details);
  });

  it("face à un ancien serveur : `cards` relu comme avant, `cardDetails` laissé tel quel, miroir incomplet", async () => {
    const server = createFakeServer();
    server.state.legacyCatalog = true;
    const db = openDb("catalog-legacy");

    expect(await refreshCatalog(server.client, db)).toBe(3);

    expect((await db.cards.toArray()).map((card) => card.name)).toEqual(["Élan vital", "Œuvre", "Theo Bell"]);
    expect(await db.cardDetails.count()).toBe(0);
    expect(await readCatalogState(db)).toEqual({ cards: 3, details: 0, complete: false });
  });

  it("deux comptes, deux bases : relire le catalogue de l'un ne touche pas l'autre", async () => {
    const server = createFakeServer();
    const alice = openDb("catalog-u1");
    const bob = openDb("catalog-u2");

    await refreshCatalog(server.client, alice);

    expect(await readCatalogState(alice)).toMatchObject({ complete: true, cards: 3 });
    expect(await readCatalogState(bob)).toEqual({ cards: 0, details: 0, complete: false });
  });
});

describe("relecture du catalogue hors de la séquence des 60 s", () => {
  const boot = (client: ApiClient, options: { refreshTimeoutMs?: number; catalogTimeoutMs?: number } = {}) => {
    const runtime = createVtesOffline({
      client,
      dbName: freshDbName("catalog-runtime"),
      autoRefresh: false,
      ...options,
      engine: { isOnline: () => true, lockName: null, timers: manualTimers().timers, backoff: { jitter: 0 } },
    });
    runtimes.push(runtime);
    return runtime;
  };

  it("un catalogue plus lent que le délai des miroirs aboutit, sous son propre délai", async () => {
    const server = createFakeServer();
    const slow = wrap(server, async (path, forward) => {
      if (path === "/cartes") await new Promise((resolve) => setTimeout(resolve, 900));
      return forward();
    });
    // Marges larges : sous la suite complète et la couverture, les miroirs ont dépassé
    // un délai de 60 ms (échec isolé du 2026-11-05). Seul compte l'ordre des délais :
    // catalogue (900 ms) plus lent que le délai des miroirs (600 ms), sous le sien.
    const runtime = boot(slow, { refreshTimeoutMs: 600, catalogTimeoutMs: 4000 });

    const report = await within(runtime.refresh({ catalog: true }), 6000, "refresh");

    expect(report).toMatchObject({ complete: true, errors: [] });
    expect(report.refreshed.at(-1)).toBe("catalog");
    expect(report.refreshed).toContain("games");
    expect(await readCatalogState(runtime.db)).toMatchObject({ complete: true });
  });

  it("un catalogue qui ne répond pas rend un échec du seul catalogue, les miroirs étant à jour", async () => {
    const server = createFakeServer();
    const hung = wrap(server, (path, forward) => (path === "/cartes" ? new Promise(() => {}) : forward()));
    const runtime = boot(hung, { catalogTimeoutMs: 40 });

    const report = await within(runtime.refresh({ catalog: true }), 3000, "refresh");

    expect(report.complete).toBe(false);
    expect(report.refreshed).toContain("stock");
    expect(report.refreshed).not.toContain("catalog");
    expect(report.errors).toEqual(["catalogue sans réponse après 40 ms"]);
  });

  it("n'est pas rejouée quand un verdict de sync tombe pendant la lecture", async () => {
    const server = createFakeServer();
    const holder: { runtime?: VtesOfflineRuntime } = {};
    let triggered = false;
    const client = wrap(server, async (path, forward) => {
      if (path === "/cartes" && !triggered) {
        triggered = true;
        const runtime = holder.runtime!;
        await runtime.actions.saveStock({ cardId: 1, languageCode: "FR", cardSetId: CARD_SET_ID, quantityOwned: 2 });
        await runtime.engine.flush(); // un verdict tombe : `settleEpoch` change
      }
      return forward();
    });
    const runtime = boot(client);
    holder.runtime = runtime;

    const report = await within(runtime.refresh({ catalog: true }), 3000, "refresh");

    expect(server.state.stock.size).toBe(1); // le rejeu a bien eu lieu
    expect(report.refreshed.filter((name) => name === "catalog")).toHaveLength(1);
    expect(report.errors).toEqual([]);
    expect(pagesRequested(server)).toBe(1);
  });

  it("hors ligne, ne lit ni les miroirs ni le catalogue", async () => {
    const original = Object.getOwnPropertyDescriptor(window.navigator, "onLine");
    Object.defineProperty(window.navigator, "onLine", { configurable: true, value: false });
    try {
      const server = createFakeServer();
      const runtime = boot(server.client);
      const report = await runtime.refresh({ catalog: true });
      expect(report).toMatchObject({ complete: false, refreshed: [], errors: ["hors ligne"] });
      expect(server.state.requests).toEqual([]);
    } finally {
      if (original) Object.defineProperty(window.navigator, "onLine", original);
      else delete (window.navigator as unknown as Record<string, unknown>).onLine;
    }
  });
});
