import { expect, test } from "./support/backend";
import {
  CARDS,
  addDeckCard,
  addStock,
  cardId,
  createDeck,
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
  syncStatus,
  waitForServiceWorkerControl,
  type DeckRead,
  type StockLine,
} from "./support/app";

/**
 * Lot 3, parcours complet contre le VRAI back (CLAUDE.md §3 points 1 à 3) :
 * catalogue en ligne, saisie hors ligne, rechargement hors ligne, retour du
 * réseau, rejeu, vérification côté serveur. Chaque étape attend un état
 * observable, jamais un délai.
 */
test("saisie hors ligne, rechargement hors ligne, rejeu au retour du réseau", async ({
  page,
  context,
  api,
}) => {
  const syncCalls = recordSyncRequests(page);
  const aura = await cardId(api, CARDS.aura);
  const awe = await cardId(api, CARDS.awe);

  // 1. En ligne : l'app shell est en cache et le catalogue est téléchargé.
  await openApp(page);
  await waitForServiceWorkerControl(page);
  await expectCatalogDownloaded(page);
  await expectSynced(page);
  expect(syncCalls, "rien à synchroniser au démarrage").toHaveLength(0);

  // 2. Le réseau coupe : la barre l'annonce, et la saisie reste possible.
  await context.setOffline(true);
  await expect(syncStatus(page)).toHaveAttribute("data-state", "offline");
  await expect(page.getByRole("status")).toHaveText("Hors ligne");

  await goToStock(page);
  await addStock(page, { search: "aura", card: CARDS.aura, quantity: 3, language: "FR" });
  await addStock(page, { search: "awe", card: CARDS.awe, quantity: 2, language: "EN" });
  await expect(stockEntry(page, aura, "FR")).toHaveAttribute("data-quantity", "3");
  await expect(stockEntry(page, aura, "FR")).toHaveAttribute("data-pending", "true");
  await expect(stockEntry(page, awe, "EN")).toHaveAttribute("data-quantity", "2");
  await expectPending(page, 2);
  await expect(page.getByTestId("sync-label")).toHaveText("Hors ligne : 2 opérations en attente");

  await goToDecks(page);
  const deckKey = await createDeck(page, "Malkavien e2e");
  await expect(page.getByTestId("deck-discriminator")).toHaveText("numéro à l'attribution");
  await addDeckCard(page, { search: "aura", card: CARDS.aura, language: "FR", quantity: 2 });
  await expect(deckCardLine(page, aura, "FR")).toHaveAttribute("data-quantity", "2");
  await expect(deckCardLine(page, aura, "FR")).toHaveAttribute("data-pending", "true");
  await expectPending(page, 4);

  // Rien n'a atteint le serveur.
  expect(await api.get<StockLine[]>("/stock")).toEqual([]);
  expect(await api.get<unknown[]>("/decks")).toEqual([]);
  expect(syncCalls).toHaveLength(0);

  const idsBeforeReload = (await readOutbox(page)).map((row) => row.operationId);
  expect(idsBeforeReload).toHaveLength(4);

  // 3. Rechargement hors ligne : l'app shell s'ouvre depuis le cache, la file survit.
  const reloaded = await page.reload();
  expect(reloaded?.fromServiceWorker()).toBe(true);
  await expect(page.getByRole("heading", { name: "Gurchon Hall" })).toBeVisible();
  await expect(syncStatus(page)).toHaveAttribute("data-state", "offline");
  await expectPending(page, 4);
  await expect(page.getByTestId("deck-page")).toHaveAttribute("data-deck-key", deckKey);
  await expect(deckCardLine(page, aura, "FR")).toHaveAttribute("data-pending", "true");
  await expect(page.getByTestId("pending-badge").first()).toBeVisible();
  // Les clés d'idempotence ne changent pas au rechargement.
  expect((await readOutbox(page)).map((row) => row.operationId)).toEqual(idsBeforeReload);

  // 4. Retour du réseau : un seul lot, dans l'ordre de la saisie, sous les mêmes clés.
  await context.setOffline(false);
  await expectSynced(page);
  expect(syncCalls).toHaveLength(1);
  expect(syncCalls[0].operations.map((operation) => operation.type)).toEqual([
    "stock.upsert",
    "stock.upsert",
    "deck.create",
    "deck_card.upsert",
  ]);
  expect(syncCalls[0].operations.map((operation) => operation.operation_id)).toEqual(idsBeforeReload);
  await expect(page.getByTestId("rejected-operations")).toHaveCount(0);
  await expect(syncStatus(page)).toHaveAttribute("data-rejected", "0");

  // 5. Côté serveur : stock, deck et composition sont bien là, une seule fois.
  const stock = await api.get<StockLine[]>("/stock");
  expect(stock).toHaveLength(2);
  expect(stock.find((line) => line.card_id === aura)).toMatchObject({
    language_code: "FR",
    quantity_owned: 3,
  });
  expect(stock.find((line) => line.card_id === awe)).toMatchObject({
    language_code: "EN",
    quantity_owned: 2,
  });
  const decks = await api.get<Array<{ id: number }>>("/decks");
  expect(decks).toHaveLength(1);
  const deck = await api.get<DeckRead>(`/decks/${decks[0].id}`);
  expect(deck).toMatchObject({ name: "Malkavien e2e", status: "draft" });
  expect(deck.discriminator).toMatch(/^\d{4}$/);
  expect(deck.cards).toHaveLength(1);
  expect(deck.cards[0]).toMatchObject({ card_id: aura, language_code: "FR", quantity: 2, proxy_quantity: 0 });

  // 6. Le numéro attribué par le serveur s'affiche après le rafraîchissement,
  //    et reste affiché après un rechargement (en ligne, cette fois).
  await expect(page.getByTestId("deck-discriminator")).toHaveText(`#${deck.discriminator}`);
  await expect(page.getByTestId("pending-badge")).toHaveCount(0);
  await expect(page.getByTestId("deck-page")).toHaveAttribute("data-deck-key", deckKey);
  await page.reload();
  await expect(page.getByTestId("deck-discriminator")).toHaveText(`#${deck.discriminator}`);
  await expect(deckCardLine(page, aura, "FR")).toHaveAttribute("data-quantity", "2");
  await expect(deckCardLine(page, aura, "FR")).toHaveAttribute("data-pending", "false");
  await expectSynced(page);
  expect(await readOutbox(page)).toEqual([]);
  expect(syncCalls, "aucun renvoi superflu").toHaveLength(1);
});
