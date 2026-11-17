import { afterEach, describe, expect, it } from "vitest";
import {
  DeckNotRefreshableError,
  createVtesOffline,
  type VtesOfflineRuntime,
} from "../../../src/offline/vtes/runtime";
import { deckCreate, systemClock } from "../../../src/offline/vtes/operations";
import { readDeck, readDeckCards } from "../../../src/offline/vtes/reads";
import { CARD_SET_ID, createFakeServer, type FakeServer } from "./fakeServer";
import { freshDbName, manualTimers, restoreNavigatorOnLine } from "./helpers";

// Lot 9, A4 : un import et une mise à jour depuis VDB, chacun en une transaction de la file.

const runtimes: VtesOfflineRuntime[] = [];

async function boot() {
  const server: FakeServer = createFakeServer();
  const state = { online: false };
  const clock = manualTimers();
  const runtime = createVtesOffline({
    client: server.client,
    dbName: freshDbName("vdb-import"),
    autoRefresh: false,
    engine: { isOnline: () => state.online, lockName: null, timers: clock.timers, backoff: { jitter: 0 } },
  });
  runtimes.push(runtime);
  return { server, runtime, state };
}

afterEach(async () => {
  for (const runtime of runtimes.splice(0)) {
    runtime.stop();
    await runtime.engine.whenIdle();
    runtime.dispose();
  }
  restoreNavigatorOnLine();
});

type SentOperation = {
  type: string;
  client_ref?: string;
  deck?: { client_ref?: string; deck_id?: number };
  data?: Record<string, unknown>;
  card_id?: number;
};

const sentOperations = (server: FakeServer): SentOperation[] =>
  server.state.requests
    .filter((request) => request.path === "/sync")
    .flatMap((request) => (request.body as { operations: SentOperation[] }).operations);

const proxyLine = (cardId: number, quantity: number, languageCode = "EN") => ({
  cardId,
  languageCode,
  cardSetId: CARD_SET_ID,
  quantity,
  proxyQuantity: quantity,
});

const importInput = {
  deck: {
    name: "Banu Princes",
    notes: "Auteur : Martin",
    archetype: "vote" as const,
    status: "draft" as const,
    proxyAllowed: true,
    vdbDeckId: "4fc0ee5e9",
  },
  lines: [proxyLine(1, 2), proxyLine(2, 4)],
};

describe("actions.importDeck", () => {
  it("range le deck et ses lignes en une fois, lisibles aussitôt hors ligne", async () => {
    const { runtime } = await boot();
    const seen: string[] = [];
    runtime.outbox.onChange((change) => seen.push(change));

    const { key, clientRef, entries } = await runtime.actions.importDeck(importInput);

    expect(key).toBe(`ref:${clientRef}`);
    expect(entries.map((entry) => entry.type)).toEqual(["deck.create", "deck_card.upsert", "deck_card.upsert"]);
    expect(entries[0].clientRef).toBe(clientRef);
    expect(seen).toEqual(["enqueued"]);
    expect(await readDeck(runtime.db, key)).toMatchObject({
      name: "Banu Princes",
      status: "draft",
      archetype: "vote",
      proxyAllowed: true,
      vdbDeckId: "4fc0ee5e9",
      pending: true,
    });
    expect(await readDeckCards(runtime.db, key)).toMatchObject([
      { cardId: 1, quantity: 2, proxyQuantity: 2, pending: true },
      { cardId: 2, quantity: 4, proxyQuantity: 4, pending: true },
    ]);
  });

  it("relie les lignes au deck par sa référence et garde le lien VDB jusqu'au miroir", async () => {
    const { server, runtime, state } = await boot();
    const { key, clientRef } = await runtime.actions.importDeck(importInput);

    state.online = true;
    expect(await runtime.engine.flush()).toMatchObject({ result: "drained", sent: 3, applied: 3 });
    const sent = sentOperations(server);
    expect(sent.map((op) => op.type)).toEqual(["deck.create", "deck_card.upsert", "deck_card.upsert"]);
    expect(sent[0].client_ref).toBe(clientRef);
    expect(sent[0].data).toMatchObject({ vdb_deck_id: "4fc0ee5e9", proxy_allowed: true, status: "draft" });
    expect(sent.slice(1).every((op) => op.deck?.client_ref === clientRef)).toBe(true);
    expect(server.state.decks[0].vdb_deck_id).toBe("4fc0ee5e9");
    expect(server.state.deckCards).toHaveLength(2);

    await runtime.refresh();
    expect(await runtime.db.settled.count()).toBe(0);
    expect((await runtime.db.decks.toArray())[0].vdbDeckId).toBe("4fc0ee5e9");
    expect(await readDeck(runtime.db, key)).toMatchObject({ vdbDeckId: "4fc0ee5e9", pending: false });
  });

  it("omet le lien d'un deck importé d'une liste, et résout la langue des lignes", async () => {
    const { runtime } = await boot();
    const { key, entries } = await runtime.actions.importDeck({
      deck: { name: "Liste collée", proxyAllowed: true },
      lines: [proxyLine(1, 1, "fr")],
    });
    const create = entries[0].operation as SentOperation;
    expect(create.data && "vdb_deck_id" in create.data).toBe(false);
    expect((await readDeck(runtime.db, key))?.vdbDeckId).toBeNull();
    expect((entries[1].operation as SentOperation).data?.language_code).toBe("FR");
  });

  it("un deck sans ligne ne range que sa création", async () => {
    const { runtime } = await boot();
    const { entries } = await runtime.actions.importDeck({ deck: { name: "Vide" }, lines: [] });
    expect(entries.map((entry) => entry.type)).toEqual(["deck.create"]);
  });

  it("deckCreate omet vdb_deck_id s'il n'est pas fourni, et garde null explicite", () => {
    expect("vdb_deck_id" in deckCreate(systemClock, "r", { name: "A" }).data).toBe(false);
    expect(deckCreate(systemClock, "r", { name: "A", vdbDeckId: null }).data.vdb_deck_id).toBeNull();
  });
});

describe("actions.refreshDeck", () => {
  async function imported() {
    const booted = await boot();
    const { key } = await booted.runtime.actions.importDeck(importInput);
    booted.state.online = true;
    await booted.runtime.engine.flush();
    await booted.runtime.refresh();
    booted.server.state.requests.length = 0;
    return { ...booted, key };
  }

  it("range le passage en brouillon, les retraits puis les écritures, en une fois", async () => {
    const { server, runtime, state, key } = await imported();
    server.state.decks[0].status = "active";
    await runtime.refresh();
    state.online = false;
    const seen: string[] = [];
    runtime.outbox.onChange((change) => seen.push(change));

    const entries = await runtime.actions.refreshDeck(key, {
      deck: { status: "draft" },
      removed: [{ cardId: 1, languageCode: "EN", cardSetId: CARD_SET_ID }],
      saved: [proxyLine(2, 3), proxyLine(3, 1)],
    });

    expect(entries.map((entry) => entry.type)).toEqual([
      "deck.update",
      "deck_card.delete",
      "deck_card.upsert",
      "deck_card.upsert",
    ]);
    expect(seen).toEqual(["enqueued"]);
    expect(await readDeck(runtime.db, key)).toMatchObject({ status: "draft" });
    const lines = await readDeckCards(runtime.db, key);
    expect(lines.map((line) => [line.cardId, line.quantity, line.pending]).sort()).toEqual([
      [2, 3, true],
      [3, 1, true],
    ]);

    state.online = true;
    expect(await runtime.engine.flush()).toMatchObject({ result: "drained", sent: 4, applied: 4 });
    expect(server.state.decks[0].status).toBe("draft");
    expect(
      server.state.deckCards.map((line) => [line.card_id, line.quantity, line.proxy_quantity]).sort(),
    ).toEqual([
      [2, 3, 3],
      [3, 1, 1],
    ]);
  });

  it("retire une ligne puis la refait sous la même clé (conflit refait en proxy)", async () => {
    const { server, runtime, key } = await imported();
    const entries = await runtime.actions.refreshDeck(key, {
      removed: [{ cardId: 2, languageCode: "EN", cardSetId: CARD_SET_ID }],
      saved: [proxyLine(2, 5)],
    });
    expect(entries.map((entry) => entry.type)).toEqual(["deck_card.delete", "deck_card.upsert"]);
    await runtime.engine.flush();
    expect(server.state.deckCards.find((line) => line.card_id === 2)).toMatchObject({
      quantity: 5,
      proxy_quantity: 5,
    });
  });

  it("n'envoie pas de deck.update pour un patch vide, et rien du tout sans écriture", async () => {
    const { runtime, key } = await imported();
    expect(await runtime.actions.refreshDeck(key, { deck: {} })).toEqual([]);
    expect(await runtime.actions.refreshDeck(key, { deck: { status: undefined }, removed: [], saved: [] })).toEqual(
      [],
    );
    expect(await runtime.outbox.counts()).toEqual({ pending: 0, sending: 0, rejected: 0 });
    const entries = await runtime.actions.refreshDeck(key, { deck: {}, saved: [proxyLine(1, 3)] });
    expect(entries.map((entry) => entry.type)).toEqual(["deck_card.upsert"]);
  });

  it("vise un deck créé hors ligne par sa référence, avant sa synchronisation", async () => {
    const { server, runtime, state } = await boot();
    const { key, clientRef } = await runtime.actions.importDeck(importInput);
    await runtime.actions.refreshDeck(key, { deck: { status: "draft" }, saved: [proxyLine(1, 3)] });

    state.online = true;
    await runtime.engine.flush();
    const sent = sentOperations(server);
    expect(sent.map((op) => op.type)).toEqual([
      "deck.create",
      "deck_card.upsert",
      "deck_card.upsert",
      "deck.update",
      "deck_card.upsert",
    ]);
    expect(sent.slice(3).every((op) => op.deck?.client_ref === clientRef)).toBe(true);
    expect(server.state.deckCards.find((line) => line.card_id === 1)?.quantity).toBe(3);
  });

  it("refuse un deck archivé ou inconnu, sans rien mettre en file", async () => {
    const { runtime, key } = await imported();
    await runtime.actions.archiveDeck(key);
    const before = await runtime.outbox.counts();

    await expect(runtime.actions.refreshDeck(key, { saved: [proxyLine(1, 3)] })).rejects.toThrow(
      new DeckNotRefreshableError("Désarchivez le deck pour le mettre à jour."),
    );
    await expect(runtime.actions.refreshDeck("id:999", { saved: [proxyLine(1, 3)] })).rejects.toBeInstanceOf(
      DeckNotRefreshableError,
    );
    expect(await runtime.outbox.counts()).toEqual(before);
  });
});
