import type { Route } from "@playwright/test";
import { WEB_ORIGIN } from "./support/env";
import { expect, test } from "./support/backend";
import {
  BUNDLE_KIASYD,
  CARDS,
  addDeckCard,
  addStock,
  cardId,
  createDeck,
  expectCatalogDownloaded,
  expectPending,
  expectSynced,
  goToDecks,
  goToStock,
  openApp,
  readOutbox,
  stockEntry,
  syncStatus,
  type DeckRead,
  type StockLine,
} from "./support/app";

/**
 * Idempotence de bout en bout (contrat `/sync`, « Clés d'idempotence » et « 503 »).
 * Le navigateur et le vrai back sont réels ; seule la réponse de `/sync` est
 * parfois perdue ou remplacée, pour reproduire un réseau qui lâche au mauvais
 * moment.
 */

const isSyncPost = (route: Route) =>
  route.request().method() === "POST" && new URL(route.request().url()).pathname === "/sync";

interface Attempt {
  ids: string[];
  outcomes: string[];
}

test("réponse de /sync perdue deux fois : le rejeu ne double rien, versement de produit compris", async ({
  page,
  context,
  api,
}) => {
  const aura = await cardId(api, CARDS.aura);
  const awe = await cardId(api, CARDS.awe);

  await openApp(page);
  await expectCatalogDownloaded(page);
  await goToStock(page);

  // Le produit se trouve en ligne (pas de miroir local des produits) ; son
  // versement, lui, part dans la file avec sa clé d'idempotence.
  const deposit = page.getByTestId("bundle-deposit");
  await deposit.getByLabel("Rechercher un produit").fill(BUNDLE_KIASYD.search);
  await deposit.getByRole("button", { name: new RegExp(BUNDLE_KIASYD.search) }).click();
  await deposit.getByLabel("Langue du produit").selectOption("EN");

  await context.setOffline(true);
  await deposit.getByTestId("bundle-submit").click();
  await expect(deposit.getByTestId("bundle-feedback")).toContainText("mis en file");
  await addStock(page, { search: "awe", card: CARDS.awe, quantity: 2, language: "EN" });
  await goToDecks(page);
  await createDeck(page, "Idempotence");
  await addDeckCard(page, { search: "awe", card: CARDS.awe, language: "EN", quantity: 1 });
  await expectPending(page, 4);
  const queued = (await readOutbox(page)).map((row) => row.operationId);

  // Les deux premières réponses sont perdues APRÈS que le serveur a tranché :
  // la requête est bien partie et appliquée, le client n'en sait rien.
  const attempts: Attempt[] = [];
  await page.route("**/sync", async (route) => {
    if (!isSyncPost(route)) return route.fallback();
    const sent = route.request().postDataJSON() as { operations: Array<{ operation_id: string }> };
    const response = await route.fetch();
    const body = (await response.json()) as { results: Array<{ outcome: string }> };
    attempts.push({
      ids: sent.operations.map((operation) => operation.operation_id),
      outcomes: body.results.map((result) => result.outcome),
    });
    if (attempts.length <= 2) return route.abort("connectionreset");
    return route.fulfill({ response });
  });

  await context.setOffline(false);
  await expectSynced(page);

  // Trois envois du même lot, sous les mêmes clés : appliqué, puis rejoué deux fois.
  expect(attempts).toHaveLength(3);
  for (const attempt of attempts) expect(attempt.ids).toEqual(queued);
  expect(attempts[0].outcomes).toEqual(["applied", "applied", "applied", "applied"]);
  expect(attempts[1].outcomes).toEqual(["replayed", "replayed", "replayed", "replayed"]);
  expect(attempts[2].outcomes).toEqual(["replayed", "replayed", "replayed", "replayed"]);

  // Aucun double effet côté serveur.
  const stock = await api.get<StockLine[]>("/stock");
  expect(stock).toHaveLength(2);
  expect(stock.find((line) => line.card_id === aura)).toMatchObject({
    language_code: "EN",
    quantity_owned: BUNDLE_KIASYD.copies, // 4, pas 8
  });
  expect(stock.find((line) => line.card_id === awe)).toMatchObject({ quantity_owned: 2 });
  const decks = await api.get<Array<{ id: number }>>("/decks");
  expect(decks).toHaveLength(1);
  const deck = await api.get<DeckRead>(`/decks/${decks[0].id}`);
  expect(deck.cards).toEqual([expect.objectContaining({ card_id: awe, quantity: 1 })]);

  // Et côté client : file vide, aucun refus, l'instantané reprend le stock versé.
  expect(await readOutbox(page)).toEqual([]);
  await expect(syncStatus(page)).toHaveAttribute("data-rejected", "0");
  await goToStock(page);
  await expect(stockEntry(page, aura, "EN")).toHaveAttribute(
    "data-quantity",
    String(BUNDLE_KIASYD.copies),
  );
});

test("rechargement de la page en plein envoi : le serveur a appliqué, le client ne le sait pas, le rejeu ne double rien", async ({
  page,
  api,
}) => {
  const aura = await cardId(api, CARDS.aura);
  await openApp(page);
  await expectCatalogDownloaded(page);
  await goToStock(page);

  const deposit = page.getByTestId("bundle-deposit");
  await deposit.getByLabel("Rechercher un produit").fill(BUNDLE_KIASYD.search);
  await deposit.getByRole("button", { name: new RegExp(BUNDLE_KIASYD.search) }).click();
  await deposit.getByLabel("Langue du produit").selectOption("EN");

  // Le premier envoi va jusqu'au serveur (qui applique) mais sa réponse n'arrive
  // jamais : la page est rechargée pendant que la requête est en vol.
  const attempts: Attempt[] = [];
  let applied!: () => void;
  const serverApplied = new Promise<void>((resolve) => {
    applied = resolve;
  });
  let dropFirst!: () => void;
  const hold = new Promise<void>((resolve) => {
    dropFirst = resolve;
  });
  await page.route("**/sync", async (route) => {
    if (!isSyncPost(route)) return route.fallback();
    const sent = route.request().postDataJSON() as { operations: Array<{ operation_id: string }> };
    const response = await route.fetch();
    const body = (await response.json()) as { results: Array<{ outcome: string }> };
    attempts.push({
      ids: sent.operations.map((operation) => operation.operation_id),
      outcomes: body.results.map((result) => result.outcome),
    });
    if (attempts.length === 1) {
      applied();
      await hold; // la réponse reste en route jusqu'à la fin du test
      await route.abort().catch(() => undefined); // la page d'origine n'existe plus
      return;
    }
    return route.fulfill({ response });
  });

  await deposit.getByTestId("bundle-submit").click();
  await serverApplied;
  const [inFlight] = await readOutbox(page);
  expect(inFlight.state).toBe("sending"); // envoyée, verdict inconnu

  await page.reload();
  await expectSynced(page);
  dropFirst();

  expect(attempts).toHaveLength(2);
  expect(attempts[1].ids).toEqual(attempts[0].ids); // même clé après rechargement
  expect(attempts[0].outcomes).toEqual(["applied"]);
  expect(attempts[1].outcomes).toEqual(["replayed"]);
  expect(await api.get<StockLine[]>("/stock")).toEqual([
    expect.objectContaining({
      card_id: aura,
      language_code: "EN",
      quantity_owned: BUNDLE_KIASYD.copies, // 4, pas 8
    }),
  ]);
  expect(await readOutbox(page)).toEqual([]);
});

test("503 avec Retry-After : rien n'est perdu, le même lot repart après le délai annoncé", async ({
  page,
  api,
}) => {
  const awe = await cardId(api, CARDS.awe);
  await openApp(page);
  await expectCatalogDownloaded(page);
  await goToStock(page);

  const posts: Array<{ at: number; ids: string[]; status: number }> = [];
  await page.route("**/sync", async (route) => {
    if (!isSyncPost(route)) return route.fallback();
    const sent = route.request().postDataJSON() as { operations: Array<{ operation_id: string }> };
    const ids = sent.operations.map((operation) => operation.operation_id);
    if (posts.length === 0) {
      posts.push({ at: Date.now(), ids, status: 503 });
      // Un serveur bien configuré : `Retry-After` est exposé au navigateur (CORS).
      return route.fulfill({
        status: 503,
        headers: {
          "content-type": "application/json",
          "retry-after": "3",
          "access-control-allow-origin": WEB_ORIGIN,
          "access-control-expose-headers": "Retry-After",
        },
        body: JSON.stringify({
          detail: "Une autre écriture est en cours : renvoyer le lot tel quel.",
        }),
      });
    }
    const response = await route.fetch();
    posts.push({ at: Date.now(), ids, status: response.status() });
    return route.fulfill({ response });
  });

  await addStock(page, { search: "awe", card: CARDS.awe, quantity: 2, language: "EN" });

  // Le 503 n'est pas un verdict : l'opération reste en file, sans refus, et rien n'est écrit.
  await expect(syncStatus(page)).toHaveAttribute("data-state", "pending");
  await expect(page.getByTestId("sync-label")).toContainText("serveur injoignable");
  await expectPending(page, 1);
  await expect(syncStatus(page)).toHaveAttribute("data-rejected", "0");
  expect(await api.get<StockLine[]>("/stock")).toEqual([]);
  const queued = (await readOutbox(page)).map((row) => row.operationId);
  expect(queued).toHaveLength(1);

  await expectSynced(page);
  expect(posts.map((post) => post.status)).toEqual([503, 200]);
  expect(posts[1].ids).toEqual(queued); // même clé : ni régénérée ni traitée comme un refus
  // Le délai annoncé (3 s) est respecté ; sans cela, le premier backoff est de 1 s ±20 %.
  expect(posts[1].at - posts[0].at).toBeGreaterThanOrEqual(2_800);
  expect(await api.get<StockLine[]>("/stock")).toEqual([
    expect.objectContaining({ card_id: awe, language_code: "EN", quantity_owned: 2 }),
  ]);
});

test("503 réel (verrou d'écriture tenu par un autre processus) : rien n'est perdu, le lot repart au retour du verrou", async ({
  page,
  api,
}) => {
  const awe = await cardId(api, CARDS.awe);
  await openApp(page);
  await expectCatalogDownloaded(page);
  await goToStock(page);

  const lock = await api.holdWriteLock();
  const refused = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/sync" && response.status() === 503,
  );
  try {
    await addStock(page, { search: "awe", card: CARDS.awe, quantity: 2, language: "EN" });
    // Le serveur attend son délai de verrou (5 s) puis répond 503 + Retry-After.
    const response = await refused;
    expect(response.headers()["retry-after"]).toBe("1");
    await expect(syncStatus(page)).toHaveAttribute("data-state", "pending");
    await expect(page.getByTestId("sync-label")).toContainText("serveur injoignable");
    await expectPending(page, 1);
    await expect(syncStatus(page)).toHaveAttribute("data-rejected", "0");
  } finally {
    await lock.release();
  }

  await expectSynced(page);
  expect(await api.get<StockLine[]>("/stock")).toEqual([
    expect.objectContaining({ card_id: awe, language_code: "EN", quantity_owned: 2 }),
  ]);
});

/**
 * CORRECTIF CONFIRMÉ (voir le rapport QA) : `Retry-After` est désormais dans
 * les en-têtes de réponse lisibles en cross-origin
 * (`Access-Control-Expose-Headers`), alors que le front (5173) et l'API (8000)
 * sont deux origines. Le client peut donc lire l'en-tête et allonger son
 * backoff en conséquence, comme le promet le README (« Retry-After allonge ce
 * délai »). `main.py` déclare `expose_headers=["Retry-After"]` sur le
 * `CORSMiddleware`.
 */
test("le vrai back expose Retry-After au navigateur (CORS)", async ({ api }) => {
  const response = await fetch(`${api.url}/health`, { headers: { origin: WEB_ORIGIN } });
  expect(response.headers.get("access-control-allow-origin")).toBe(WEB_ORIGIN);
  expect(response.headers.get("access-control-expose-headers") ?? "").toMatch(/retry-after/i);
});
