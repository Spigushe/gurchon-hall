import { expect, test } from "./support/backend";
import {
  CARDS,
  addDeckCard,
  addStock,
  cardInfo,
  cardSetOptionLabel,
  cardSets,
  deckCardLine,
  expectCatalogDownloaded,
  expectPending,
  expectSynced,
  goToDecks,
  goToStock,
  openApp,
  readOutbox,
  recordSyncRequests,
  stockEntry,
  waitForServiceWorkerControl,
  type DeckRead,
  type StockLine,
} from "./support/app";

/**
 * Lot 4 (D1, D2) : deux impressions de la même carte et de la même langue
 * sont deux entrées de collection distinctes, et deux lignes de deck
 * distinctes. Le scénario les saisit hors ligne, les place dans un deck qui
 * autorise les proxies (une ligne en joue un, l'autre non), recharge
 * l'application hors ligne, revient en ligne, laisse le rejeu se faire, puis
 * vérifie côté serveur (par l'API) que les deux impressions ne se sont jamais
 * confondues : deux entrées de stock, deux lignes de deck, quantités et
 * proxies corrects sur chacune.
 *
 * « Awe » (échantillon `backend/tests/fixtures`) a six impressions connues :
 * de quoi choisir deux extensions réelles sans dépendre d'un jeu de données
 * fabriqué pour l'occasion.
 */
test("deux impressions de la même carte et langue, saisies hors ligne puis rejouées, restent deux entrées et deux lignes distinctes", async ({
  page,
  context,
  api,
}) => {
  const syncCalls = recordSyncRequests(page);
  const awe = await cardInfo(api, CARDS.awe);
  expect(
    awe.card_set_ids.length,
    "l'échantillon de test doit fournir au moins deux impressions de Awe",
  ).toBeGreaterThanOrEqual(2);
  const [firstSetId, secondSetId] = awe.card_set_ids;
  const setsById = new Map((await cardSets(api)).map((set) => [set.id, set]));
  const firstLabel = cardSetOptionLabel(setsById.get(firstSetId)!);
  const secondLabel = cardSetOptionLabel(setsById.get(secondSetId)!);
  expect(firstLabel).not.toBe(secondLabel);

  await openApp(page);
  await waitForServiceWorkerControl(page);
  await expectCatalogDownloaded(page);
  await context.setOffline(true);

  // 1. Deux entrées de collection pour la même carte et langue, une par extension.
  await goToStock(page);
  await addStock(page, {
    search: "awe",
    card: CARDS.awe,
    quantity: 2,
    language: "EN",
    cardSetLabel: firstLabel,
  });
  await addStock(page, {
    search: "awe",
    card: CARDS.awe,
    quantity: 3,
    language: "EN",
    cardSetLabel: secondLabel,
  });
  await expect(stockEntry(page, awe.id, "EN", firstLabel)).toHaveAttribute("data-quantity", "2");
  await expect(stockEntry(page, awe.id, "EN", secondLabel)).toHaveAttribute("data-quantity", "3");
  await expect(
    page.getByTestId("stock-entry").and(page.locator(`[data-card-id="${awe.id}"][data-language="EN"]`)),
  ).toHaveCount(2);

  // 2. Un deck qui autorise les proxies dès sa création, avec une ligne par
  //    impression : la première joue un proxy, la seconde non.
  await goToDecks(page);
  const deckForm = page.getByTestId("deck-form");
  await deckForm.getByLabel("Nom du deck").fill("Deux impressions e2e");
  await deckForm.getByTestId("deck-form-proxy-allowed").check();
  await deckForm.getByTestId("deck-form-submit").click();
  const deckPage = page.getByTestId("deck-page");
  await expect(deckPage).toBeVisible();
  const deckKey = (await deckPage.getAttribute("data-deck-key")) as string;
  expect(deckKey).toMatch(/^ref:/);
  await expect(page.getByTestId("deck-proxy-allowed")).toBeVisible();

  await addDeckCard(page, {
    search: "awe",
    card: CARDS.awe,
    language: "EN",
    cardSetId: firstSetId,
    quantity: 2,
    proxyQuantity: 1,
  });
  await addDeckCard(page, {
    search: "awe",
    card: CARDS.awe,
    language: "EN",
    cardSetId: secondSetId,
    quantity: 2,
  });
  await expect(deckCardLine(page, awe.id, "EN", firstLabel)).toHaveAttribute("data-quantity", "2");
  await expect(deckCardLine(page, awe.id, "EN", firstLabel)).toHaveAttribute("data-proxy-quantity", "1");
  await expect(deckCardLine(page, awe.id, "EN", secondLabel)).toHaveAttribute("data-quantity", "2");
  await expect(deckCardLine(page, awe.id, "EN", secondLabel)).toHaveAttribute("data-proxy-quantity", "0");
  await expect(
    page.getByTestId("deck-card").and(page.locator(`[data-card-id="${awe.id}"][data-language="EN"]`)),
  ).toHaveCount(2);

  // Cinq opérations en file : deux entrées de stock, une création de deck (avec
  // son autorisation de proxy posée dès la création), deux lignes de deck.
  await expectPending(page, 5);
  expect(syncCalls).toHaveLength(0);
  const queued = (await readOutbox(page)).map((row) => row.operationId);
  expect(queued).toHaveLength(5);

  // 3. Rechargement hors ligne : la file et les deux lignes distinctes survivent.
  const reloaded = await page.reload();
  expect(reloaded?.fromServiceWorker()).toBe(true);
  await expect(page.getByRole("heading", { name: "Gurchon Hall" })).toBeVisible();
  await expectPending(page, 5);
  await expect(page.getByTestId("deck-page")).toHaveAttribute("data-deck-key", deckKey);
  await expect(deckCardLine(page, awe.id, "EN", firstLabel)).toHaveAttribute("data-proxy-quantity", "1");
  await expect(deckCardLine(page, awe.id, "EN", secondLabel)).toHaveAttribute("data-proxy-quantity", "0");
  expect((await readOutbox(page)).map((row) => row.operationId)).toEqual(queued);

  // 4. Retour du réseau : un seul lot, aucun refus.
  await context.setOffline(false);
  await expectSynced(page);
  expect(syncCalls).toHaveLength(1);
  expect(syncCalls[0].operations.map((operation) => operation.type)).toEqual([
    "stock.upsert",
    "stock.upsert",
    "deck.create",
    "deck_card.upsert",
    "deck_card.upsert",
  ]);
  expect(syncCalls[0].operations.map((operation) => operation.operation_id)).toEqual(queued);
  await expect(page.getByTestId("rejected-operations")).toHaveCount(0);

  // 5. Côté serveur : deux entrées de stock distinctes, jamais fusionnées.
  const stock = await api.get<StockLine[]>("/stock");
  const aweStock = stock.filter((line) => line.card_id === awe.id);
  expect(aweStock).toHaveLength(2);
  const byCardSet = new Map(aweStock.map((line) => [line.card_set_id, line]));
  expect(byCardSet.get(firstSetId)).toMatchObject({ language_code: "EN", quantity_owned: 2 });
  expect(byCardSet.get(secondSetId)).toMatchObject({ language_code: "EN", quantity_owned: 3 });

  // Et deux lignes de deck distinctes, quantités et proxies corrects sur chacune.
  const decks = await api.get<Array<{ id: number }>>("/decks");
  expect(decks).toHaveLength(1);
  const deck = await api.get<DeckRead>(`/decks/${decks[0].id}`);
  expect(deck.proxy_allowed).toBe(true);
  expect(deck.discriminator).toMatch(/^\d{4}$/);
  const deckLines = deck.cards.filter((line) => line.card_id === awe.id);
  expect(deckLines).toHaveLength(2);
  const linesByCardSet = new Map(deckLines.map((line) => [line.card_set_id, line]));
  expect(linesByCardSet.get(firstSetId)).toMatchObject({
    language_code: "EN",
    quantity: 2,
    proxy_quantity: 1,
  });
  expect(linesByCardSet.get(secondSetId)).toMatchObject({
    language_code: "EN",
    quantity: 2,
    proxy_quantity: 0,
  });

  // Aucun renvoi superflu, file vide, rien à corriger.
  expect(await readOutbox(page)).toEqual([]);
  expect(syncCalls).toHaveLength(1);
});
