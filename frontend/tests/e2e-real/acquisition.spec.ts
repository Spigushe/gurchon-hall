import { expect, test } from "./support/backend";
import {
  CARDS,
  addDeckCard,
  cardInfo,
  createDeck,
  deckCardLine,
  expectCatalogDownloaded,
  expectPending,
  expectSynced,
  goToDecks,
  openApp,
  readOutbox,
  recordSyncRequests,
  type DeckRead,
  type StockLine,
} from "./support/app";

/**
 * Lot 4b (acquisition depuis le deck) : le picker fusionné (`AddDeckCardForm`,
 * Lot 5) laisse composer un deck directement depuis le catalogue, au-delà de ce
 * qui est déjà possédé — la différence entre les copies voulues et ce qui reste
 * disponible en collection entre en collection avec la ligne
 * (`acquired_quantity`, une seule opération `deck_card.upsert`, pas de
 * `stock.upsert` séparé). Ce scénario monte un deck entièrement hors ligne, sans
 * rien posséder au départ, puis vérifie contre le vrai back que le rejeu a
 * réellement fait entrer les exemplaires en collection ET composé la ligne de
 * deck en conséquence.
 */
test("deck monté hors ligne avec acquisition, puis rejeu : la ligne de deck ET la collection reflètent l'acquisition", async ({
  page,
  context,
  api,
}) => {
  const syncCalls = recordSyncRequests(page);
  const aweInfo = await cardInfo(api, CARDS.awe);
  const awe = aweInfo.id;
  expect(await api.get<StockLine[]>("/stock")).toEqual([]); // rien en collection au départ

  await openApp(page);
  await expectCatalogDownloaded(page);
  await context.setOffline(true);

  await goToDecks(page);
  const deckKey = await createDeck(page, "Acquisition e2e");
  // Trois copies voulues, rien de possédé : le formulaire acquiert les trois
  // (un seul exemplaire proxy resterait à zéro puisque aucune autorisation de
  // proxy n'est nécessaire ici, tout entre comme exemplaire réel).
  await addDeckCard(page, { search: "awe", card: CARDS.awe, language: "EN", quantity: 3 });
  await page.keyboard.press("Escape"); // ferme la feuille « Ajouter », restée ouverte après l'envoi
  await expect(deckCardLine(page, awe, "EN")).toHaveAttribute("data-quantity", "3");
  await expect(deckCardLine(page, awe, "EN")).toHaveAttribute("data-proxy-quantity", "0");
  await expectPending(page, 2); // deck.create, puis un seul deck_card.upsert (avec acquisition)

  // Rien n'a atteint le serveur avant le retour du réseau.
  expect(await api.get<StockLine[]>("/stock")).toEqual([]);
  expect(await api.get<unknown[]>("/decks")).toEqual([]);
  expect(syncCalls).toHaveLength(0);

  await context.setOffline(false);
  await expectSynced(page);
  expect(syncCalls).toHaveLength(1);
  expect(syncCalls[0].operations.map((operation) => operation.type)).toEqual([
    "deck.create",
    "deck_card.upsert",
  ]);

  // Côté serveur réel : la ligne de deck ET l'entrée de collection reflètent
  // l'acquisition, une fois chacune (pas de double effet).
  const stock = await api.get<StockLine[]>("/stock");
  expect(stock).toHaveLength(1);
  expect(stock[0]).toMatchObject({
    card_id: awe,
    language_code: "EN",
    card_set_id: aweInfo.latest_card_set_id,
    quantity_owned: 3,
  });

  const decks = await api.get<Array<{ id: number }>>("/decks");
  expect(decks).toHaveLength(1);
  const deck = await api.get<DeckRead>(`/decks/${decks[0].id}`);
  expect(deck.cards).toHaveLength(1);
  expect(deck.cards[0]).toMatchObject({
    card_id: awe,
    language_code: "EN",
    card_set_id: aweInfo.latest_card_set_id,
    quantity: 3,
    proxy_quantity: 0,
  });

  // Et côté client : file vide, aucun refus, le miroir local reprend le stock acquis.
  expect(await readOutbox(page)).toEqual([]);
  await expect(page.getByTestId("deck-page")).toHaveAttribute("data-deck-key", deckKey);
  await expect(deckCardLine(page, awe, "EN")).toHaveAttribute("data-quantity", "3");
});

/**
 * Acquisition d'une partie seulement de la ligne : le deck autorise les
 * proxies, une partie des copies reste proxy, le reste (au-delà de ce qui est
 * déjà possédé) est acquis. Vérifie que l'acquisition ne porte que sur le
 * manquant réel, pas sur la ligne entière.
 */
test("acquisition partielle : seul ce qui manque au-delà des exemplaires déjà possédés entre en collection", async ({
  page,
  context,
  api,
}) => {
  const syncCalls = recordSyncRequests(page);
  const aweInfo = await cardInfo(api, CARDS.awe);
  const awe = aweInfo.id;

  await openApp(page);
  await expectCatalogDownloaded(page);
  await context.setOffline(true);

  await goToDecks(page);
  const deckForm = page.getByTestId("deck-form");
  await deckForm.getByLabel("Nom du deck").fill("Acquisition partielle e2e");
  await deckForm.getByTestId("deck-form-proxy-allowed").check();
  await deckForm.getByTestId("deck-form-submit").click();
  const deckPage = page.getByTestId("deck-page");
  await expect(deckPage).toBeVisible();

  // 4 copies voulues : 1 en proxy, 3 déclarées possédées, rien en collection au
  // départ — donc 3 exemplaires à acquérir (pas 4 : le proxy n'en a pas besoin).
  await addDeckCard(page, {
    search: "awe",
    card: CARDS.awe,
    language: "EN",
    quantity: 4,
    proxyQuantity: 1,
  });
  await page.keyboard.press("Escape");
  await expect(deckCardLine(page, awe, "EN")).toHaveAttribute("data-quantity", "4");
  await expect(deckCardLine(page, awe, "EN")).toHaveAttribute("data-proxy-quantity", "1");

  await context.setOffline(false);
  await expectSynced(page);
  expect(syncCalls).toHaveLength(1);

  const stock = await api.get<StockLine[]>("/stock");
  expect(stock).toHaveLength(1);
  expect(stock[0]).toMatchObject({ card_id: awe, language_code: "EN", quantity_owned: 3 });

  const decks = await api.get<Array<{ id: number }>>("/decks");
  const deck = await api.get<DeckRead>(`/decks/${decks[0].id}`);
  expect(deck.cards[0]).toMatchObject({ card_id: awe, quantity: 4, proxy_quantity: 1 });
  expect(await readOutbox(page)).toEqual([]);
});
