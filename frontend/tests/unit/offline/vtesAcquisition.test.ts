import { afterEach, describe, expect, it } from "vitest";
import { AcquisitionBoundError, createVtesOffline, type VtesOfflineRuntime } from "../../../src/offline/vtes/runtime";
import { deckCardUpsert, systemClock } from "../../../src/offline/vtes/operations";
import { readDeckCards, readStock } from "../../../src/offline/vtes/reads";
import { refreshDecks, refreshStock } from "../../../src/offline/vtes/refresh";
import { CARD_SET_ID, createFakeServer, type FakeServer } from "./fakeServer";
import { freshDbName, manualTimers, restoreNavigatorOnLine, until } from "./helpers";

const runtimes: VtesOfflineRuntime[] = [];

async function boot(online = false) {
  const server: FakeServer = createFakeServer();
  const state = { online };
  const clock = manualTimers();
  const runtime = createVtesOffline({
    client: server.client,
    dbName: freshDbName("acq"),
    autoRefresh: false,
    engine: { isOnline: () => state.online, lockName: null, timers: clock.timers, backoff: { jitter: 0 } },
  });
  runtimes.push(runtime);
  return { server, runtime, state, clock };
}

afterEach(async () => {
  for (const runtime of runtimes.splice(0)) {
    runtime.stop();
    await runtime.engine.whenIdle();
    runtime.dispose();
  }
  restoreNavigatorOnLine();
});

const line = { cardId: 1, languageCode: "EN", cardSetId: CARD_SET_ID };
const stockKey = `1|EN|${CARD_SET_ID}`;

describe("opération deck_card.upsert", () => {
  it("porte acquired_quantity, et l'omet s'il est nul ou absent", () => {
    const deck = { deckId: 1 };
    const withIt = deckCardUpsert(systemClock, deck, { ...line, quantity: 2, acquiredQuantity: 2 });
    const zero = deckCardUpsert(systemClock, deck, { ...line, quantity: 2, acquiredQuantity: 0 });
    const none = deckCardUpsert(systemClock, deck, { ...line, quantity: 2 });
    expect(withIt.data.acquired_quantity).toBe(2);
    expect("acquired_quantity" in zero.data).toBe(false);
    expect("acquired_quantity" in none.data).toBe(false);
  });
});

describe("montage d'un deck avec acquisition", () => {
  it("crée l'entrée de stock en même temps que la ligne, hors ligne, puis rejoue dans l'ordre", async () => {
    const { server, runtime, state } = await boot();
    const { key, clientRef } = await runtime.actions.createDeck({ name: "Existant" });
    await runtime.actions.saveDeckCard(key, { ...line, quantity: 4, acquiredQuantity: 4 });

    expect(await readStock(runtime.db)).toMatchObject([{ cardId: 1, quantityOwned: 4, pending: true }]);
    expect(await readDeckCards(runtime.db, key)).toMatchObject([{ quantity: 4, pending: true }]);

    state.online = true;
    const summary = await runtime.engine.flush();
    expect(summary).toMatchObject({ result: "drained", sent: 2, applied: 2 });
    const sent = (
      server.state.requests.find((r) => r.path === "/sync")!.body as {
        operations: Array<{ type: string; deck?: { client_ref?: string }; data: Record<string, unknown> }>;
      }
    ).operations;
    expect(sent.map((op) => op.type)).toEqual(["deck.create", "deck_card.upsert"]);
    expect(sent[1].deck).toEqual({ client_ref: clientRef });
    expect(sent[1].data.acquired_quantity).toBe(4);
    expect(server.state.stock.get(stockKey)?.quantity_owned).toBe(4);
    expect(server.state.deckCards).toHaveLength(1);

    // Tranchée, pas encore relue : ni perte ni doublon.
    expect(await readStock(runtime.db)).toMatchObject([{ quantityOwned: 4, pending: false }]);
    await runtime.refresh();
    expect(await runtime.db.settled.count()).toBe(0);
    expect(await readStock(runtime.db)).toMatchObject([{ quantityOwned: 4, pending: false }]);
    expect(await readDeckCards(runtime.db, key)).toMatchObject([{ quantity: 4, pending: false }]);
  });

  it("incrémente une entrée existante", async () => {
    const { server, runtime, state } = await boot();
    await runtime.actions.saveStock({ ...line, quantityOwned: 1 });
    const { key } = await runtime.actions.createDeck({ name: "Mixte" });
    await runtime.actions.saveDeckCard(key, { ...line, quantity: 3, acquiredQuantity: 2 });
    expect(await readStock(runtime.db)).toMatchObject([{ quantityOwned: 3 }]);
    state.online = true;
    await runtime.engine.flush();
    expect(server.state.stock.get(stockKey)?.quantity_owned).toBe(3);
  });

  it("refuse toujours une carte absente du stock sans acquisition (verdict du serveur)", async () => {
    const { server, runtime, state } = await boot();
    const { key } = await runtime.actions.createDeck({ name: "Vide" });
    await runtime.actions.saveDeckCard(key, { ...line, quantity: 2 });
    state.online = true;
    const summary = await runtime.engine.flush();
    expect(summary).toMatchObject({ sent: 2, applied: 1 });
    expect(server.state.stock.size).toBe(0);
    expect(server.state.deckCards).toHaveLength(0);
    // Refusée : aucun effet local non plus.
    expect(await readStock(runtime.db)).toEqual([]);
  });
});

describe("conversion d'un proxy", () => {
  async function withProxyLine() {
    const ctx = await boot();
    await ctx.runtime.actions.saveStock({ ...line, quantityOwned: 0 });
    const { key } = await ctx.runtime.actions.createDeck({ name: "Proxies", proxyAllowed: true });
    await ctx.runtime.actions.saveDeckCard(key, { ...line, quantity: 3, proxyQuantity: 3 });
    ctx.state.online = true;
    await ctx.runtime.engine.flush();
    await ctx.runtime.refresh();
    return { ...ctx, key };
  }

  it("réduit les proxies et ajoute autant à la collection", async () => {
    const { server, runtime, key } = await withProxyLine();
    await runtime.actions.convertProxies(key, line, 2);

    const [queued] = await runtime.outbox.list();
    expect(queued.operation).toMatchObject({
      type: "deck_card.upsert",
      data: { quantity: 3, proxy_quantity: 1, acquired_quantity: 2 },
    });
    expect(await readStock(runtime.db)).toMatchObject([{ quantityOwned: 2, pending: true }]);
    expect(await readDeckCards(runtime.db, key)).toMatchObject([{ quantity: 3, proxyQuantity: 1 }]);

    await runtime.engine.flush();
    expect(server.state.stock.get(stockKey)?.quantity_owned).toBe(2);
    expect(server.state.deckCards[0]).toMatchObject({ quantity: 3, proxy_quantity: 1 });
    await runtime.refresh();
    expect(await readStock(runtime.db)).toMatchObject([{ quantityOwned: 2, pending: false }]);
  });

  it("refuse, sans rien mettre en file, plus de proxies que la ligne n'en compte ou une ligne absente", async () => {
    const { runtime, key } = await withProxyLine();
    await expect(runtime.actions.convertProxies(key, line, 4)).rejects.toBeInstanceOf(AcquisitionBoundError);
    await expect(runtime.actions.convertProxies(key, line, 0)).rejects.toBeInstanceOf(AcquisitionBoundError);
    await expect(runtime.actions.convertProxies(key, { ...line, cardId: 2 }, 1)).rejects.toBeInstanceOf(
      AcquisitionBoundError,
    );
    expect(await runtime.outbox.list()).toEqual([]);
  });
});

describe("plafond de l'acquisition", () => {
  it("refuse plus d'exemplaires acquis que la ligne n'en ajoute", async () => {
    const { runtime } = await boot();
    const { key } = await runtime.actions.createDeck({ name: "Plafond" });
    const before = (await runtime.outbox.list()).length;
    await expect(
      runtime.actions.saveDeckCard(key, { ...line, quantity: 2, acquiredQuantity: 3 }),
    ).rejects.toBeInstanceOf(AcquisitionBoundError);
    // Les proxies ne comptent pas dans les exemplaires réels ajoutés.
    await expect(
      runtime.actions.saveDeckCard(key, { ...line, quantity: 4, proxyQuantity: 3, acquiredQuantity: 2 }),
    ).rejects.toBeInstanceOf(AcquisitionBoundError);
    await expect(
      runtime.actions.saveDeckCard(key, { ...line, quantity: 2, acquiredQuantity: -1 }),
    ).rejects.toBeInstanceOf(AcquisitionBoundError);
    await expect(
      runtime.actions.saveDeckCard(key, { ...line, quantity: 2, acquiredQuantity: 0.5 }),
    ).rejects.toBeInstanceOf(AcquisitionBoundError);
    expect((await runtime.outbox.list()).length).toBe(before);
  });

  it("refuse de compter deux fois la même saisie sur une ligne déjà écrite", async () => {
    const { runtime } = await boot();
    const { key } = await runtime.actions.createDeck({ name: "Double" });
    await runtime.actions.saveDeckCard(key, { ...line, quantity: 2, acquiredQuantity: 2 });
    await expect(
      runtime.actions.saveDeckCard(key, { ...line, quantity: 2, acquiredQuantity: 2 }),
    ).rejects.toBeInstanceOf(AcquisitionBoundError);
    // Monter la ligne de 2 à 3 n'ajoute qu'un exemplaire réel.
    await expect(
      runtime.actions.saveDeckCard(key, { ...line, quantity: 3, acquiredQuantity: 2 }),
    ).rejects.toBeInstanceOf(AcquisitionBoundError);
    await runtime.actions.saveDeckCard(key, { ...line, quantity: 3, acquiredQuantity: 1 });
    expect(await readStock(runtime.db)).toMatchObject([{ quantityOwned: 3 }]);
  });
});

describe("rejeu idempotent", () => {
  it("ne compte pas l'acquisition deux fois quand la réponse s'est perdue", async () => {
    const { server, runtime, state, clock } = await boot();
    const { key } = await runtime.actions.createDeck({ name: "Rejeu" });
    await runtime.actions.saveDeckCard(key, { ...line, quantity: 3, acquiredQuantity: 3 });

    state.online = true;
    server.next.loseResponse = true;
    runtime.engine.start();
    await until(() => server.state.requests.some((r) => r.path === "/sync"));
    await runtime.engine.whenIdle();
    expect(server.state.stock.get(stockKey)?.quantity_owned).toBe(3);
    expect(await runtime.outbox.list()).toHaveLength(2);

    clock.fireLast();
    await until(async () => (await runtime.outbox.list()).length === 0);
    const bodies = server.state.requests.filter((r) => r.path === "/sync").map((r) => r.body);
    expect(bodies[1]).toEqual(bodies[0]);
    expect(server.state.stock.get(stockKey)?.quantity_owned).toBe(3);
  });

  it("le serveur refuse en `invalid` une acquisition au-delà de la borne (file forgée)", async () => {
    const { server, runtime, state } = await boot();
    const { key } = await runtime.actions.createDeck({ name: "Forgé" });
    await runtime.outbox.enqueue(deckCardUpsert(systemClock, key, { ...line, quantity: 1, acquiredQuantity: 5 }));
    state.online = true;
    const summary = await runtime.engine.flush();
    expect(summary).toMatchObject({ sent: 2, applied: 1 });
    expect(server.state.stock.size).toBe(0);
    expect(await runtime.outbox.list("rejected")).toHaveLength(1);
  });
});

describe("opérations tranchées (settled)", () => {
  async function settledAcquisition() {
    const ctx = await boot();
    const { key } = await ctx.runtime.actions.createDeck({ name: "Settled" });
    await ctx.runtime.actions.saveDeckCard(key, { ...line, quantity: 2, acquiredQuantity: 2 });
    ctx.state.online = true;
    await ctx.runtime.engine.flush();
    return { ...ctx, key };
  }

  it("ne sort de settled qu'une fois le stock ET les decks relus, sans doublon ni trou", async () => {
    const { server, runtime, key } = await settledAcquisition();
    expect(await runtime.db.settled.count()).toBe(2);

    // Les decks relus seuls : l'acquisition reste retenue, le stock la montre encore.
    await refreshDecks(server.client, runtime.db);
    expect(await runtime.db.settled.count()).toBe(1);
    expect(await readStock(runtime.db)).toMatchObject([{ quantityOwned: 2 }]);
    expect(await readDeckCards(runtime.db, key)).toMatchObject([{ quantity: 2 }]);

    // Le stock relu : pas de double comptage (2, jamais 4), l'opération est reprise
    // par le prochain rafraîchissement des decks.
    await refreshStock(server.client, runtime.db);
    expect(await readStock(runtime.db)).toMatchObject([{ quantityOwned: 2 }]);
    expect(await runtime.db.stock.count()).toBe(1);
    expect(await readDeckCards(runtime.db, key)).toMatchObject([{ quantity: 2 }]);

    await refreshDecks(server.client, runtime.db);
    expect(await runtime.db.settled.count()).toBe(0);
    expect(await readStock(runtime.db)).toMatchObject([{ quantityOwned: 2 }]);
    expect(await readDeckCards(runtime.db, key)).toMatchObject([{ quantity: 2 }]);
  });

  it("l'ordre du rafraîchissement complet (stock puis decks) vide settled", async () => {
    const { server, runtime } = await settledAcquisition();
    await refreshStock(server.client, runtime.db);
    expect(await readStock(runtime.db)).toMatchObject([{ quantityOwned: 2 }]);
    await refreshDecks(server.client, runtime.db);
    expect(await runtime.db.settled.count()).toBe(0);
  });
});
