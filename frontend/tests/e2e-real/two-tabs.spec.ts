import type { Page, Route } from "@playwright/test";
import { expect, test } from "./support/backend";
import {
  CARDS,
  addStock,
  cardId,
  expectCatalogDownloaded,
  expectPending,
  expectSynced,
  goToStock,
  openApp,
  readOutbox,
  type StockLine,
} from "./support/app";

/**
 * Deux onglets du même navigateur partagent la même IndexedDB, donc la même file.
 * La couche offline promet qu'un seul lot part à la fois (verrou Web Locks
 * `offline-sync`, `ifAvailable`) et que les onglets s'avertissent des saisies par
 * BroadcastChannel. On l'observe sans rien y changer :
 *
 * - les appels à `navigator.locks.request` sont journalisés (script d'init qui
 *   enveloppe la méthode et rend le même résultat) : c'est le signal
 *   déterministe qu'un onglet s'est vu refuser le verrou ;
 * - le lot est retenu à la porte du serveur (`context.route`) le temps de
 *   l'observation, et le nombre d'envois en vol est compté.
 */

interface LockEntry {
  name: string;
  granted: boolean;
}

const isSyncPost = (route: Route) =>
  route.request().method() === "POST" && new URL(route.request().url()).pathname === "/sync";

const lockLog = (page: Page) =>
  page.evaluate(() => (window as unknown as { __locks: LockEntry[] }).__locks.slice());

const resetLockLog = (page: Page) =>
  page.evaluate(() => {
    (window as unknown as { __locks: LockEntry[] }).__locks.length = 0;
  });

test("deux onglets : un seul lot en vol, l'autre onglet est écarté puis n'envoie rien de déjà tranché", async ({
  context,
  api,
}) => {
  const awe = await cardId(api, CARDS.awe);
  const aura = await cardId(api, CARDS.aura);
  const op419 = await cardId(api, CARDS.operation419);

  await context.addInitScript(() => {
    const log: LockEntry[] = [];
    (window as unknown as { __locks: LockEntry[] }).__locks = log;
    const locks = navigator.locks;
    const original = locks.request.bind(locks) as (
      name: string,
      options: LockOptions,
      callback: (lock: Lock | null) => unknown,
    ) => Promise<unknown>;
    (locks as unknown as { request: typeof original }).request = (name, options, callback) =>
      original(name, options, (lock) => {
        log.push({ name, granted: lock !== null });
        return callback(lock);
      });
  });

  const pageA = await context.newPage();
  await openApp(pageA);
  await expectCatalogDownloaded(pageA);
  await expectSynced(pageA);
  const pageB = await context.newPage();
  await openApp(pageB);
  await expectCatalogDownloaded(pageB); // le catalogue est celui d'IndexedDB, partagé
  await expectSynced(pageB);

  await context.setOffline(true);
  await goToStock(pageA);
  await addStock(pageA, { search: "awe", card: CARDS.awe, quantity: 2, language: "EN" });
  await addStock(pageA, { search: "aura", card: CARDS.aura, quantity: 1, language: "EN" });
  await expectPending(pageA, 2);
  // BroadcastChannel : l'autre onglet apprend la saisie sans recharger.
  await expectPending(pageB, 2);
  const queued = (await readOutbox(pageA)).map((row) => row.operationId);
  expect(queued).toHaveLength(2);

  // Le lot est retenu à la porte du serveur ; on compte les envois en vol.
  let inFlight = 0;
  let maxInFlight = 0;
  const batches: Array<{ ids: string[]; outcomes: string[] }> = [];
  let arrived!: () => void;
  const firstArrived = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  let openGate!: () => void;
  const gate = new Promise<void>((resolve) => {
    openGate = resolve;
  });
  await context.route("**/sync", async (route) => {
    if (!isSyncPost(route)) return route.fallback();
    const sent = route.request().postDataJSON() as { operations: Array<{ operation_id: string }> };
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    const position = batches.length;
    batches.push({ ids: sent.operations.map((operation) => operation.operation_id), outcomes: [] });
    arrived();
    try {
      if (position === 0) await gate; // seul le premier lot est retenu
      const response = await route.fetch();
      const body = (await response.json()) as { results: Array<{ outcome: string }> };
      batches[position].outcomes = body.results.map((result) => result.outcome);
      await route.fulfill({ response });
    } finally {
      inFlight -= 1;
    }
  });

  await Promise.all([resetLockLog(pageA), resetLockLog(pageB)]);
  await context.setOffline(false); // les deux onglets reçoivent `online` et tentent d'envoyer
  await firstArrived;

  // Un onglet tient le verrou et a envoyé ; l'autre a été écarté (résultat `null` de ifAvailable).
  await expect
    .poll(async () => {
      const entries = [...(await lockLog(pageA)), ...(await lockLog(pageB))];
      return {
        granted: entries.filter((entry) => entry.granted).length,
        denied: entries.some((entry) => !entry.granted),
      };
    })
    .toEqual({ granted: 1, denied: true });
  const held = await pageB.evaluate(async () => (await navigator.locks.query()).held ?? []);
  expect(held.map((lock) => lock.name)).toEqual(["offline-sync"]);
  expect(batches).toHaveLength(1);
  expect(batches[0].ids).toEqual(queued);
  expect(inFlight).toBe(1);

  // Pendant que le lot est en vol, une saisie dans l'autre onglet (en ligne, donc
  // qui tente aussi d'envoyer) ne part pas en parallèle : elle attend le lot suivant.
  await goToStock(pageB);
  await addStock(pageB, { search: "419", card: CARDS.operation419, quantity: 1, language: "EN" });
  await expectPending(pageB, 3);
  await expectPending(pageA, 3);
  expect(batches, "la saisie n'a pas doublé l'envoi en cours").toHaveLength(1);
  expect(inFlight).toBe(1);

  // Le loser retente après `lockedRetryMs` : toujours écarté tant que le lot est en vol.
  await expect
    .poll(async () => {
      const entries = [...(await lockLog(pageA)), ...(await lockLog(pageB))];
      return entries.filter((entry) => !entry.granted).length;
    })
    .toBeGreaterThanOrEqual(3);
  expect(batches).toHaveLength(1);
  expect(inFlight).toBe(1);

  openGate();
  await expectSynced(pageA);
  await expectSynced(pageB);

  // Deux lots, jamais en parallèle : les deux opérations d'abord, la saisie tardive ensuite.
  expect(maxInFlight).toBe(1);
  expect(batches).toHaveLength(2);
  expect(batches[0].ids).toEqual(queued);
  expect(batches[0].outcomes).toEqual(["applied", "applied"]);
  expect(batches[1].ids).toHaveLength(1);
  expect(batches[1].ids).not.toContain(queued[0]);
  expect(batches[1].ids).not.toContain(queued[1]);
  expect(batches[1].outcomes).toEqual(["applied"]);

  // Aucune double application côté serveur, file vide des deux côtés.
  const stock = await api.get<StockLine[]>("/stock");
  expect(stock).toHaveLength(3);
  expect(stock.find((line) => line.card_id === awe)?.quantity_owned).toBe(2);
  expect(stock.find((line) => line.card_id === aura)?.quantity_owned).toBe(1);
  expect(stock.find((line) => line.card_id === op419)?.quantity_owned).toBe(1);
  expect(await readOutbox(pageA)).toEqual([]);
  expect(await readOutbox(pageB)).toEqual([]);
});
