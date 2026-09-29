import { expect, test, type Api } from "./support/backend";
import {
  CARDS,
  addDeckCard,
  addStock,
  cardId,
  cardInfo,
  createDeck,
  deckCardLine,
  expectCatalogDownloaded,
  expectPending,
  expectSynced,
  goToDecks,
  goToDecksList,
  goToRejectedOperations,
  goToStock,
  openApp,
  readOutbox,
  recordSyncRequests,
  stockEntry,
  syncStatus,
  type DeckRead,
  type StockLine,
} from "./support/app";

/**
 * Refus et conflits (contrat `/sync`, « Politique de conflit ») : la file fait
 * foi, les invariants font loi. Une opération n'est refusée que si le serveur
 * l'aurait refusée en ligne ; le refus n'arrête pas le lot, il apparaît avec son
 * motif, et se corrige (nouvelle clé) ou s'abandonne.
 */

const rejected = (page: import("@playwright/test").Page) => page.getByTestId("rejected-operation");

/** Seme une entrée de collection sous la dernière impression connue de la carte (D2a). */
async function seedStock(api: Api, card: number, language: string, quantity: number, cardSetId: number) {
  await api.post(
    "/stock",
    { card_id: card, language_code: language, card_set_id: cardSetId, quantity_owned: quantity },
    201,
  );
}

async function seedDeck(
  api: Api,
  name: string,
  lines: Array<[number, string, number, number]> = [],
) {
  const deck = await api.post<DeckRead>("/decks", { name }, 201);
  for (const [card, language, quantity, cardSetId] of lines) {
    await api.post(
      `/decks/${deck.id}/cartes`,
      { card_id: card, language_code: language, card_set_id: cardSetId, quantity },
      201,
    );
  }
  return deck;
}

test("proxy non autorisé : refus motivé, les opérations suivantes passent, « Corriger et renvoyer » sous une nouvelle clé", async ({
  page,
  context,
  api,
}) => {
  const syncCalls = recordSyncRequests(page);
  const awe = await cardId(api, CARDS.awe);
  const aura = await cardId(api, CARDS.aura);
  // Le deck autorise les proxies à sa création : le miroir local l'apprend au
  // démarrage (`refreshDecks`), et l'appareil part hors ligne sur cette base.
  const deck = await api.post<DeckRead>("/decks", { name: "Refus proxy", proxy_allowed: true }, 201);

  await openApp(page);
  await expectCatalogDownloaded(page);
  await context.setOffline(true);
  // La file fait foi, les invariants font loi : le tournoi visé change ailleurs
  // (un autre appareil retire l'autorisation) pendant que celui-ci est hors
  // ligne et continue de croire, à raison sur sa dernière lecture, qu'il joue.
  await api.patch(`/decks/${deck.id}`, { proxy_allowed: false });

  await goToStock(page);
  await addStock(page, { search: "awe", card: CARDS.awe, quantity: 1, language: "EN" });
  await addStock(page, { search: "aura", card: CARDS.aura, quantity: 2, language: "EN" });
  await goToDecksList(page);
  await page.getByTestId("deck-link").click();
  await expect(page.getByTestId("deck-proxy-allowed")).toBeVisible(); // encore autorisé, localement
  await addDeckCard(page, { search: "awe", card: CARDS.awe, language: "EN", quantity: 1, proxyQuantity: 1 });
  await addDeckCard(page, { search: "aura", card: CARDS.aura, language: "EN", quantity: 1 });
  await page.keyboard.press("Escape"); // ferme la feuille « Ajouter », restée ouverte après l'envoi
  await expectPending(page, 4); // le deck existe déjà côté serveur : deux entrées de stock, deux lignes

  await context.setOffline(false);
  await expect(syncStatus(page)).toHaveAttribute("data-rejected", "1");
  await expectPending(page, 0);
  expect(syncCalls).toHaveLength(1); // un seul lot de quatre opérations

  // Le refus est visible, avec son type, son code et son motif (page Synchronisation, Lot 5).
  await goToRejectedOperations(page);
  await expect(rejected(page)).toHaveCount(1);
  await expect(rejected(page)).toHaveAttribute("data-operation-type", "deck_card.upsert");
  await expect(rejected(page)).toHaveAttribute("data-rejection-code", "conflict");
  await expect(page.getByTestId("rejection-reason")).toContainText("Règle de gestion non respectée");
  await expect(page.getByTestId("rejection-reason")).toContainText(/proxy/i);

  // Les autres opérations du lot ont passé : la carte de bibliothèque est au deck.
  const deckRead = await api.get<DeckRead>(`/decks/${deck.id}`);
  expect(deckRead.cards).toEqual([expect.objectContaining({ card_id: aura, quantity: 1 })]);
  expect(await api.get<StockLine[]>("/stock")).toHaveLength(2);
  // Un refus n'a aucun effet local : la ligne refusée n'est pas affichée dans le deck.
  await goToDecksList(page);
  await page.getByTestId("deck-link").click();
  await expect(deckCardLine(page, aura, "EN")).toBeVisible();
  await expect(deckCardLine(page, awe, "EN")).toHaveCount(0);

  // Corriger : zéro proxy. L'opération corrigée est NOUVELLE (autre clé), à la même place.
  await goToRejectedOperations(page);
  const refusedId = (await rejected(page).getAttribute("data-operation-id")) as string;
  await page.getByTestId("correct-button").click();
  await expect(page.getByTestId("correction-form")).toBeVisible();
  await page
    .getByTestId("correction-form")
    .getByRole("spinbutton", { name: "Dont proxies" })
    .fill("0");
  await page.getByTestId("correction-submit").click();

  await expect(page.getByTestId("rejected-operation")).toHaveCount(0);
  await expectSynced(page);
  await expect(syncStatus(page)).toHaveAttribute("data-rejected", "0");
  expect(syncCalls).toHaveLength(2);
  expect(syncCalls[1].operations).toHaveLength(1);
  expect(syncCalls[1].operations[0].operation_id).not.toBe(refusedId);
  expect(syncCalls[0].operations.map((operation) => operation.operation_id)).toContain(refusedId);

  const corrected = await api.get<DeckRead>(`/decks/${deck.id}`);
  expect(corrected.cards).toHaveLength(2);
  expect(corrected.cards.find((line) => line.card_id === awe)).toMatchObject({
    quantity: 1,
    proxy_quantity: 0,
  });
  await goToDecksList(page);
  await page.getByTestId("deck-link").click();
  await expect(deckCardLine(page, awe, "EN")).toHaveAttribute("data-proxy-quantity", "0");
  expect(await readOutbox(page)).toEqual([]);
});

test("exemplaires insuffisants : refus motivé, la suite du lot passe, « Abandonner » clôt le refus", async ({
  page,
  context,
  api,
}) => {
  const aweInfo = await cardInfo(api, CARDS.awe);
  const auraInfo = await cardInfo(api, CARDS.aura);
  const awe = aweInfo.id;
  const aura = auraInfo.id;
  // Deux exemplaires possédés, un seul déjà alloué : l'appareil part hors ligne
  // en pensant le second disponible (le picker fusionné acquiert automatiquement
  // ce qui manque, donc une simple pénurie ne suffit plus à provoquer un refus).
  await seedStock(api, awe, "EN", 2, aweInfo.latest_card_set_id);
  await seedStock(api, aura, "EN", 2, auraInfo.latest_card_set_id);
  const servedDeck = await seedDeck(api, "Déjà servi", [[awe, "EN", 1, aweInfo.latest_card_set_id]]);

  await openApp(page);
  await expectCatalogDownloaded(page);
  await goToStock(page);
  await expect(stockEntry(page, awe, "EN")).toHaveAttribute("data-quantity", "2");
  await context.setOffline(true);
  // La file fait foi, les invariants font loi : un autre appareil réserve le
  // second exemplaire pendant que celui-ci est hors ligne et le croit encore
  // disponible, sur sa dernière lecture d'avant la coupure.
  await api.patch(`/decks/${servedDeck.id}/cartes/${awe}/EN/${aweInfo.latest_card_set_id}`, { quantity: 2 });

  await goToDecks(page);
  await createDeck(page, "Second deck");
  await addDeckCard(page, { search: "awe", card: CARDS.awe, language: "EN", quantity: 1 });
  await addDeckCard(page, { search: "aura", card: CARDS.aura, language: "EN", quantity: 1 });
  await page.keyboard.press("Escape"); // ferme la feuille « Ajouter », restée ouverte après l'envoi
  await expectPending(page, 3);

  await context.setOffline(false);
  await expect(syncStatus(page)).toHaveAttribute("data-rejected", "1");
  await goToRejectedOperations(page);
  await expect(rejected(page)).toHaveAttribute("data-operation-type", "deck_card.upsert");
  await expect(rejected(page)).toHaveAttribute("data-rejection-code", "conflict");
  await expect(page.getByTestId("rejection-reason")).toContainText(/insuffisant/i);

  const decks = await api.get<Array<{ id: number; name: string }>>("/decks");
  const second = decks.find((deck) => deck.name === "Second deck");
  expect(second).toBeDefined();
  const secondRead = await api.get<DeckRead>(`/decks/${second!.id}`);
  expect(secondRead.cards.map((line) => line.card_id)).toEqual([aura]); // la suite du lot a passé

  // Abandonner demande une confirmation, puis le refus disparaît sans rien renvoyer.
  await page.getByTestId("discard-button").click();
  await expect(rejected(page)).toHaveCount(1); // pas encore : la confirmation est explicite
  await page.getByTestId("discard-confirm").click();
  await expect(page.getByTestId("rejected-operation")).toHaveCount(0);
  await expect(syncStatus(page)).toHaveAttribute("data-rejected", "0");
  await expectSynced(page);
  expect(await readOutbox(page)).toEqual([]);
  expect((await api.get<DeckRead>(`/decks/${second!.id}`)).cards.map((line) => line.card_id)).toEqual([aura]);
});

test("deck archivé entre-temps : la modification saisie hors ligne est refusée, puis « Renvoyer tel quel » sous une nouvelle clé une fois désarchivé", async ({
  page,
  context,
  api,
}) => {
  const aweInfo = await cardInfo(api, CARDS.awe);
  const awe = aweInfo.id;
  await seedStock(api, awe, "EN", 3, aweInfo.latest_card_set_id);
  const deck = await seedDeck(api, "Archivable", [[awe, "EN", 1, aweInfo.latest_card_set_id]]);
  const syncCalls = recordSyncRequests(page);

  await openApp(page);
  await expectCatalogDownloaded(page);
  await goToDecksList(page);
  await page.getByTestId("deck-link").click();
  await expect(deckCardLine(page, awe, "EN")).toHaveAttribute("data-quantity", "1");

  // Hors ligne, l'appareil ne sait rien : le deck est archivé ailleurs.
  await context.setOffline(true);
  await api.patch(`/decks/${deck.id}`, { archived: true });
  await addDeckCard(page, { search: "awe", card: CARDS.awe, language: "EN", quantity: 2 });
  await page.keyboard.press("Escape"); // ferme la feuille « Ajouter », restée ouverte après l'envoi
  await expectPending(page, 1);

  await context.setOffline(false);
  await expect(syncStatus(page)).toHaveAttribute("data-rejected", "1");
  await goToRejectedOperations(page);
  await expect(rejected(page)).toHaveAttribute("data-operation-type", "deck_card.upsert");
  await expect(rejected(page)).toHaveAttribute("data-rejection-code", "conflict");
  await expect(page.getByTestId("rejection-reason")).toContainText(/archiv/i);
  expect((await api.get<DeckRead>(`/decks/${deck.id}`)).cards[0].quantity).toBe(1);
  const refusedId = (await rejected(page).getAttribute("data-operation-id")) as string;

  // Le rafraîchissement qui suit le rejeu apprend l'archivage : la liste, elle,
  // ne montre plus ce deck sous le filtre par défaut (« En cours »). Le radio
  // lui-même est masqué (accessibilité par étiquette) : cliquer l'étiquette.
  await goToDecksList(page);
  await page.locator("label.tab-option").filter({ hasText: "Tous" }).click();
  await page.getByTestId("deck-link").click();
  await expect(page.getByTestId("deck-archived-note")).toBeVisible();

  // La cause disparaît côté serveur ; renvoyer tel quel crée une NOUVELLE opération.
  await api.patch(`/decks/${deck.id}`, { archived: false });
  await goToRejectedOperations(page);
  await page.getByTestId("reissue-button").click();
  await expect(page.getByTestId("rejected-operation")).toHaveCount(0);
  await expectSynced(page);

  expect(syncCalls).toHaveLength(2);
  expect(syncCalls[1].operations[0].operation_id).not.toBe(refusedId);
  expect((await api.get<DeckRead>(`/decks/${deck.id}`)).cards[0].quantity).toBe(2);
  expect(await readOutbox(page)).toEqual([]);
});

test("la file fait foi, les invariants font loi : dernière écriture gagnante, jamais sous ce qu'un deck retient", async ({
  page,
  context,
  api,
}) => {
  const aweInfo = await cardInfo(api, CARDS.awe);
  const awe = aweInfo.id;
  await seedStock(api, awe, "EN", 5, aweInfo.latest_card_set_id);
  await seedDeck(api, "Retient trois", [[awe, "EN", 3, aweInfo.latest_card_set_id]]);

  await openApp(page);
  await expectCatalogDownloaded(page);
  await goToStock(page);
  const entry = stockEntry(page, awe, "EN");
  await expect(entry).toHaveAttribute("data-quantity", "5");
  await context.setOffline(true);

  // Pendant ce temps, le serveur change de valeur (8) : aucune comparaison de version.
  await api.patch(`/stock/${awe}/EN/${aweInfo.latest_card_set_id}`, { quantity_owned: 8 });

  // Trois saisies dans l'ordre : 4, 3, puis 2 (en dessous des 3 retenus par le deck).
  for (const expected of ["4", "3", "2"]) {
    await page.getByRole("button", { name: "Retirer un exemplaire de Awe (EN)" }).click();
    await expect(entry).toHaveAttribute("data-quantity", expected);
  }
  await expectPending(page, 3);

  await context.setOffline(false);
  await expect(syncStatus(page)).toHaveAttribute("data-rejected", "1");
  await expectPending(page, 0);

  // La file a écrasé le 8 du serveur (4 puis 3) ; le 2 est refusé par l'invariant.
  const [line] = await api.get<StockLine[]>("/stock");
  expect(line.quantity_owned).toBe(3);
  await goToRejectedOperations(page);
  await expect(rejected(page)).toHaveAttribute("data-operation-type", "stock.upsert");
  await expect(rejected(page)).toHaveAttribute("data-rejection-code", "conflict");
  await expect(page.getByTestId("rejection-reason")).toContainText(/decks/i);
  // Le refus n'a aucun effet local : l'affichage revient à ce que le serveur possède.
  await goToStock(page);
  await expect(entry).toHaveAttribute("data-quantity", "3");
});
