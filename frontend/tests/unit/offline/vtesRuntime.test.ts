import { liveQuery } from "dexie";
import { afterEach, describe, expect, it } from "vitest";
import { createVtesOffline, type VtesOfflineRuntime } from "../../../src/offline/vtes/runtime";
import { readDeck, readDeckCards, readDecks, readStock } from "../../../src/offline/vtes/reads";
import { refreshCatalog, refreshDecks } from "../../../src/offline/vtes/refresh";
import type { ApiClient } from "../../../src/offline/vtes/types";
import { CARD_SET_ID, createFakeServer, type FakeServer } from "./fakeServer";
import { freshDbName, manualTimers, restoreNavigatorOnLine, setNavigatorOnLine, until, within } from "./helpers";

const runtimes: VtesOfflineRuntime[] = [];

async function boot(
  options: { online?: boolean; dbName?: string; server?: FakeServer; autoRefresh?: boolean } = {},
) {
  const server = options.server ?? createFakeServer();
  const state = { online: options.online ?? true };
  const clock = manualTimers();
  const runtime = createVtesOffline({
    client: server.client,
    dbName: options.dbName ?? freshDbName("runtime"),
    autoRefresh: options.autoRefresh ?? false,
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

describe("saisie hors ligne", () => {
  it("passe par la file, sans aucun appel réseau, et se lit tout de suite", async () => {
    const { server, runtime } = await boot({ online: false });
    await refreshCatalog(server.client, runtime.db); // catalogue mis en cache quand on était en ligne
    server.state.requests.length = 0;

    await runtime.actions.saveStock({ cardId: 1, languageCode: "fr", cardSetId: CARD_SET_ID, quantityOwned: 4 });
    const { key } = await runtime.actions.createDeck({ name: "Malkavien", proxyAllowed: true });
    await runtime.actions.saveDeckCard(key, { cardId: 1, languageCode: "FR", cardSetId: CARD_SET_ID, quantity: 2 });

    expect(server.state.requests).toEqual([]); // §10 : jamais d'appel API dans le chemin de saisie
    const queued = await runtime.outbox.list();
    expect(queued.map((entry) => entry.type)).toEqual(["stock.upsert", "deck.create", "deck_card.upsert"]);
    expect(queued.every((entry) => entry.state === "pending")).toBe(true);

    expect(await readStock(runtime.db)).toMatchObject([
      { cardId: 1, cardName: "Élan vital", quantityOwned: 4, pending: true },
    ]);
    expect(await readDeck(runtime.db, key)).toMatchObject({ name: "Malkavien", id: null, pending: true });
    expect(await readDeckCards(runtime.db, key)).toHaveLength(1);
  });

  it("se rabat sur XX pour une langue inconnue du serveur", async () => {
    const { runtime } = await boot({ online: false });
    await runtime.db.languages.bulkPut([
      { code: "EN", label: "Anglais", sortOrder: 0 },
      { code: "XX", label: "Autre", sortOrder: 9 },
    ]);
    const entry = await runtime.actions.saveStock({
      cardId: 1,
      languageCode: "de",
      cardSetId: CARD_SET_ID,
      quantityOwned: 1,
    });
    expect(entry.operation).toMatchObject({ data: { language_code: "XX" } });
    await expect(
      runtime.actions.saveStock({ cardId: 1, languageCode: "  ", cardSetId: CARD_SET_ID }),
    ).rejects.toThrow(RangeError);
  });

  it("garde la file et les clés à travers un rechargement", async () => {
    const dbName = freshDbName("reload");
    const first = await boot({ online: false, dbName });
    const { key } = await first.runtime.actions.createDeck({ name: "Ventrue" });
    await first.runtime.actions.saveDeckCard(key, {
      cardId: 1,
      languageCode: "EN",
      cardSetId: CARD_SET_ID,
      quantity: 1,
    });
    const before = await first.runtime.outbox.list();
    first.runtime.stop();
    first.runtime.dispose();
    runtimes.splice(runtimes.indexOf(first.runtime), 1);

    const second = await boot({ online: false, dbName });
    const after = await second.runtime.outbox.list();
    expect(after.map((entry) => entry.operationId)).toEqual(before.map((entry) => entry.operationId));
    expect(after.map((entry) => entry.operation)).toEqual(before.map((entry) => entry.operation));
    expect((await readDecks(second.runtime.db))[0]).toMatchObject({ key, name: "Ventrue" });
  });
});

describe("rejeu vers /sync", () => {
  it("envoie la file dans l'ordre au retour du réseau, raccorde le deck à son identité serveur", async () => {
    const { server, runtime, state } = await boot({ online: false });
    await runtime.actions.saveStock({ cardId: 1, languageCode: "EN", cardSetId: CARD_SET_ID, quantityOwned: 3 });
    const { key, clientRef } = await runtime.actions.createDeck({ name: "Malkavien" });
    await runtime.actions.saveDeckCard(key, {
      cardId: 1,
      languageCode: "EN",
      cardSetId: CARD_SET_ID,
      quantity: 2,
    });
    expect(server.state.requests).toEqual([]);

    state.online = true;
    const summary = await runtime.engine.flush();

    expect(summary).toMatchObject({ result: "drained", sent: 3, applied: 3 });
    const syncCalls = server.state.requests.filter((request) => request.path === "/sync");
    expect(syncCalls).toHaveLength(1);
    const sent = (syncCalls[0].body as { operations: Array<{ type: string }> }).operations;
    expect(sent.map((op) => op.type)).toEqual(["stock.upsert", "deck.create", "deck_card.upsert"]);
    expect(await runtime.outbox.list()).toEqual([]);
    expect((await runtime.db.refs.get(clientRef))?.id).toBe(1);

    // Rafraîchissement : le deck du serveur se raccorde à la référence, la clé ne change pas.
    const report = await runtime.refresh();
    expect(report).toMatchObject({ complete: true, errors: [] });
    const [deck] = await readDecks(runtime.db);
    expect(deck).toMatchObject({ key, id: 1, clientRef, name: "Malkavien", pending: false });
    expect(deck.discriminator).not.toBeNull();
    expect(await readDeckCards(runtime.db, key)).toMatchObject([{ cardId: 1, quantity: 2, pending: false }]);
    expect((await readStock(runtime.db))[0]).toMatchObject({ quantityOwned: 3, pending: false });
  });

  it("rejoue un versement de produit sous la même clé sans le doubler quand la réponse s'est perdue", async () => {
    const { server, runtime, clock } = await boot();
    runtime.engine.start();
    await runtime.engine.whenIdle();

    server.next.loseResponse = true; // le serveur applique, le client ne le sait pas
    const entry = await runtime.actions.depositBundle(7, "EN", 1);
    await until(() => server.state.requests.some((request) => request.path === "/sync"));
    await runtime.engine.whenIdle();

    expect(server.state.depositsApplied).toBe(1);
    expect(await runtime.outbox.counts()).toMatchObject({ pending: 1 }); // toujours en file
    expect(runtime.engine.getStatus().failures).toBe(1);

    clock.fireLast(); // fin du backoff
    await until(async () => (await runtime.outbox.list()).length === 0);

    const bodies = server.state.requests.filter((request) => request.path === "/sync").map((request) => request.body);
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toEqual(bodies[0]); // même clé, même corps octet pour octet
    expect((bodies[0] as { operations: Array<{ operation_id: string }> }).operations[0].operation_id).toBe(
      entry.operationId,
    );
    expect(server.state.depositsApplied).toBe(1); // « replayed » : rien n'a été réappliqué
    expect(server.state.stock.get(`1|EN|${CARD_SET_ID}`)?.quantity_owned).toBe(3);
  });

  it("expose un refus, et sa correction repart sous une nouvelle clé", async () => {
    const { server, runtime } = await boot({ online: false });
    await runtime.actions.saveStock({ cardId: 1, languageCode: "EN", cardSetId: CARD_SET_ID, quantityOwned: 1 });
    const { key } = await runtime.actions.createDeck({ name: "Gangrel" });
    const tooMany = await runtime.actions.saveDeckCard(key, {
      cardId: 1,
      languageCode: "EN",
      cardSetId: CARD_SET_ID,
      quantity: 5,
    });

    const summary = await runtime.engine.flush();
    expect(summary).toMatchObject({ applied: 2, rejected: 1 });

    const [refused] = await runtime.outbox.list("rejected");
    expect(refused.operationId).toBe(tooMany.operationId);
    expect(refused.rejection).toEqual({ code: "conflict", message: "exemplaires insuffisants", replayed: false });
    expect(await readDeckCards(runtime.db, key)).toEqual([]); // le refus n'a plus d'effet local

    // Rejeu tel quel : rien ne part.
    server.state.requests.length = 0;
    await runtime.engine.flush();
    expect(server.state.requests).toEqual([]);

    const fixed = await runtime.outbox.reissue(refused.operationId, (op) =>
      op.type === "deck_card.upsert" ? { ...op, data: { ...op.data, quantity: 1 } } : op,
    );
    expect(fixed.operationId).not.toBe(tooMany.operationId);
    await runtime.engine.flush();
    expect(await runtime.outbox.list()).toEqual([]);
    expect(server.state.deckCards).toHaveLength(1);
  });

  it("refuse en cascade ce qui dépend d'une création refusée, sans rien bloquer d'autre", async () => {
    const { runtime } = await boot({ online: false });
    const { key } = await runtime.actions.createDeck({ name: "Brujah" });
    await runtime.actions.createDeck({ name: "Brujah" }); // ne conflit pas : autre référence
    await runtime.actions.saveDeckCard("ref:jamais-cree", {
      cardId: 1,
      languageCode: "EN",
      cardSetId: CARD_SET_ID,
      quantity: 1,
    });
    await runtime.actions.saveStock({ cardId: 2, languageCode: "EN", cardSetId: CARD_SET_ID, quantityOwned: 1 });

    const summary = await runtime.engine.flush();
    expect(summary).toMatchObject({ applied: 3, rejected: 1 });
    const [refused] = await runtime.outbox.list("rejected");
    expect(refused.rejection?.code).toBe("unresolved_client_ref");
    expect(key).toMatch(/^ref:/);
  });
});

describe("indisponibilité du serveur", () => {
  it("traite un 503 (écriture concurrente côté serveur) comme une panne : file intacte, nouvel essai programmé", async () => {
    const { server, runtime, clock } = await boot();
    runtime.engine.start();
    await runtime.engine.whenIdle();
    server.next.status = 503;
    await runtime.actions.saveStock({ cardId: 1, languageCode: "EN", cardSetId: CARD_SET_ID, quantityOwned: 1 });
    await until(() => runtime.engine.getStatus().failures === 1);
    await runtime.engine.whenIdle();

    expect(runtime.engine.getStatus().lastError).toContain("503");
    expect(await runtime.outbox.counts()).toMatchObject({ pending: 1, rejected: 0 });
    expect(clock.active()).toHaveLength(1);
    expect(clock.active()[0].delayMs).toBe(1000);
  });
});

describe("rafraîchissement des miroirs", () => {
  it("lit toutes les pages du stock", async () => {
    const { server, runtime } = await boot();
    server.addBulkStock(203);
    const report = await runtime.refresh();
    expect(report.complete).toBe(true);
    expect(await runtime.db.stock.count()).toBe(203);
    const stockPages = server.state.requests.filter((request) => request.path === "/stock");
    expect(stockPages).toHaveLength(2);
  });

  it("n'écrase pas l'ancien instantané quand la lecture échoue", async () => {
    const { server, runtime } = await boot();
    server.state.stock.set(`1|EN|${CARD_SET_ID}`, {
      card_id: 1,
      language_code: "EN",
      card_set_id: CARD_SET_ID,
      quantity_owned: 2,
      notes: null,
    });
    await runtime.refresh();
    expect(await runtime.db.stock.count()).toBe(1);

    server.state.stock.clear();
    server.next.getStatus = 500;
    const report = await runtime.refresh();
    expect(report.complete).toBe(false);
    expect(report.errors.length).toBeGreaterThan(0);
    expect(await runtime.db.stock.count()).toBe(1); // ancien instantané conservé
  });

  it("ne tente rien hors ligne", async () => {
    const { server, runtime } = await boot({ online: false });
    const original = Object.getOwnPropertyDescriptor(navigator, "onLine");
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    try {
      const report = await runtime.refresh();
      expect(report).toMatchObject({ complete: false, errors: ["hors ligne"] });
      expect(server.state.requests).toEqual([]);
    } finally {
      if (original) Object.defineProperty(navigator, "onLine", original);
      else delete (navigator as unknown as Record<string, unknown>).onLine;
    }
  });

  it("lit le catalogue à la demande, pour saisir hors ligne", async () => {
    const { runtime } = await boot();
    const report = await runtime.refresh({ catalog: true });
    expect(report.refreshed).toContain("catalog");
    expect(await runtime.db.cards.count()).toBe(3);
  });
});

describe("rafraîchissement automatique et rejeu", () => {
  it("ne s'interbloque pas quand `online` lance à la fois le rejeu et le rafraîchissement", async () => {
    setNavigatorOnLine(false);
    const { server, runtime, state } = await boot({ online: false, autoRefresh: true });
    runtime.start();

    // Hors ligne : file non vide, aucun appel réseau.
    await runtime.actions.saveStock({ cardId: 1, languageCode: "EN", cardSetId: CARD_SET_ID, quantityOwned: 3 });
    const { key } = await runtime.actions.createDeck({ name: "Malkavien" });
    await runtime.actions.saveDeckCard(key, {
      cardId: 1,
      languageCode: "EN",
      cardSetId: CARD_SET_ID,
      quantity: 2,
    });
    expect(server.state.requests).toEqual([]);

    // Retour du réseau : le moteur rejoue, et la couche relit les miroirs.
    state.online = true;
    setNavigatorOnLine(true);
    window.dispatchEvent(new Event("online"));

    const report = await within(runtime.refresh(), 3000, "runtime.refresh()");
    expect(report).toMatchObject({ complete: true, errors: [] });
    await within(runtime.engine.whenIdle(), 3000, "engine.whenIdle()");

    expect(await runtime.outbox.list()).toEqual([]);
    expect(await runtime.db.stock.count()).toBe(1);
    expect(await runtime.db.decks.count()).toBe(1);
    expect(await runtime.db.deckCards.count()).toBe(1);
    expect(await readDeck(runtime.db, key)).toMatchObject({ name: "Malkavien", pending: false });
  });
});

describe("entre le verdict et le rafraîchissement", () => {
  const seedOffline = async (runtime: VtesOfflineRuntime) => {
    await runtime.actions.saveStock({ cardId: 1, languageCode: "EN", cardSetId: CARD_SET_ID, quantityOwned: 3 });
    const created = await runtime.actions.createDeck({ name: "Malkavien" });
    await runtime.actions.saveDeckCard(created.key, {
      cardId: 1,
      languageCode: "EN",
      cardSetId: CARD_SET_ID,
      quantity: 2,
    });
    return created;
  };

  it("garde le deck créé lisible à chaque étape de sa synchronisation", async () => {
    const { runtime, state } = await boot({ online: false });
    const { key, clientRef } = await seedOffline(runtime);

    // Chaque émission de la lecture vivante est un instantané cohérent : le deck
    // ne doit manquer à aucune, ni sa composition.
    const seen: Array<{ found: boolean; lines: number; queued: number }> = [];
    const subscription = liveQuery(async () => ({
      found: (await readDeck(runtime.db, key)) !== undefined,
      lines: (await readDeckCards(runtime.db, key)).length,
      queued: (await runtime.outbox.list()).length,
    })).subscribe({ next: (value) => seen.push(value) });
    try {
      // 1. Saisi hors ligne.
      await until(() => seen.length > 0);
      expect(await readDeck(runtime.db, key)).toMatchObject({ id: null, clientRef, pending: true });

      // 2. Verdict reçu : l'opération a quitté la file, le miroir n'a pas été relu.
      state.online = true;
      await runtime.engine.flush();
      expect(await runtime.outbox.list()).toEqual([]);
      expect(await runtime.db.decks.count()).toBe(0); // le miroir est bien resté vide
      expect(await readDecks(runtime.db)).toMatchObject([
        { key, id: 1, clientRef, name: "Malkavien", pending: false, discriminator: null },
      ]);
      expect(await readDeck(runtime.db, key)).toMatchObject({ id: 1, pending: false });
      expect(await readDeckCards(runtime.db, key)).toMatchObject([
        { cardId: 1, quantity: 2, pending: false },
      ]);
      expect(await readStock(runtime.db)).toMatchObject([{ quantityOwned: 3, pending: false }]);
      expect(await runtime.db.settled.count()).toBe(3);

      // 3. Miroir relu : même clé, discriminant attribué, plus rien à retenir.
      await runtime.refresh();
      expect(await runtime.db.settled.count()).toBe(0);
      expect(await readDecks(runtime.db)).toHaveLength(1);
      expect(await readDeck(runtime.db, key)).toMatchObject({ id: 1, clientRef, pending: false });
      expect((await readDeck(runtime.db, key))?.discriminator).not.toBeNull();
      expect(await readDeckCards(runtime.db, key)).toMatchObject([{ cardId: 1, quantity: 2 }]);

      await until(() => seen.at(-1)?.queued === 0 && seen.at(-1)?.lines === 1);
    } finally {
      subscription.unsubscribe();
    }
    expect(seen.length).toBeGreaterThan(1);
    expect(seen.filter((value) => !value.found)).toEqual([]);
    expect(seen.filter((value) => value.lines !== 1)).toEqual([]);
  });

  it("garde ce qui a été tranché pendant la lecture du serveur, sans doublon", async () => {
    const { server, runtime, state } = await boot({ online: false });
    const { key } = await seedOffline(runtime);

    // Une lecture des decks qui n'aboutit qu'une fois le rejeu passé : le curseur
    // est relevé avant, les opérations tranchées entre-temps ne sont pas effacées.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slow = {
      GET: async (...args: unknown[]) => {
        await gate;
        return (server.client.GET as (...a: unknown[]) => unknown)(...args);
      },
    } as unknown as ApiClient;
    const reading = refreshDecks(slow, runtime.db);

    state.online = true;
    await runtime.engine.flush();
    expect(await runtime.db.settled.count()).toBe(3);
    release();
    await reading;

    expect(await runtime.db.decks.count()).toBe(1); // la lecture a vu le deck du serveur
        expect(await runtime.db.settled.count()).toBe(3); // tranchées après le curseur : retenues
    const decks = await readDecks(runtime.db);
    expect(decks).toHaveLength(1); // le deck du miroir et celui de l'opération ne se doublent pas
    expect(decks[0]).toMatchObject({ key, id: 1 });
    expect(await readDeckCards(runtime.db, key)).toHaveLength(1);

    await runtime.refresh(); // le rafraîchissement suivant les reprend
    expect(await runtime.db.settled.count()).toBe(0);
  });
});

describe("coalescence des rafraîchissements", () => {
  it("réunit les options : le catalogue demandé pendant une lecture est lu ensuite, une seule fois de plus", async () => {
    const { server, runtime } = await boot();
    const first = runtime.refresh();
    const second = runtime.refresh({ catalog: true }); // la lecture en cours est déjà partie
    const third = runtime.refresh({ catalog: true });

    const [a, , c] = await Promise.all([first, second, third]);
    expect(a.refreshed).not.toContain("catalog");
    expect(c.refreshed).toContain("catalog");
    expect(await runtime.db.cards.count()).toBe(3);
    expect(server.state.requests.filter((request) => request.path === "/cartes")).toHaveLength(1);
    expect(server.state.requests.filter((request) => request.path === "/stock")).toHaveLength(2);
  });

  it("ne se fond pas dans une lecture commencée avant l'appel", async () => {
    const { server, runtime } = await boot();
    const first = runtime.refresh();
    await until(() => server.state.requests.length > 0); // la lecture est en route
    server.state.stock.set(`1|EN|${CARD_SET_ID}`, {
      card_id: 1, language_code: "EN", card_set_id: CARD_SET_ID, quantity_owned: 5, notes: null,
    });
    await runtime.refresh(); // demandé après le changement : doit le voir
    await first;
    expect((await readStock(runtime.db))[0]).toMatchObject({ quantityOwned: 5 });
  });

  it("libère la place quand une lecture ne répond jamais", async () => {
    const hung = { GET: () => new Promise(() => {}) } as unknown as ApiClient;
    const clock = manualTimers();
    const runtime = createVtesOffline({
      client: hung,
      dbName: freshDbName("guard"),
      autoRefresh: false,
      refreshTimeoutMs: 40,
      engine: { lockName: null, timers: clock.timers },
    });
    runtimes.push(runtime);
    const report = await within(runtime.refresh(), 2000, "runtime.refresh() bloqué");
    expect(report.complete).toBe(false);
    expect(report.errors[0]).toContain("sans réponse");
  });
});
