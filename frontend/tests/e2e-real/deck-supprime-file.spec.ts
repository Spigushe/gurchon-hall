import { expect, test } from "./support/backend";
import {
  CARDS,
  cardInfo,
  addDeckCard,
  createDeck,
  expectCatalogDownloaded,
  expectPending,
  goToDecks,
  goToRejectedOperations,
  goToStock,
  openApp,
  readOutbox,
  recordSyncRequests,
  stockEntry,
  syncStatus,
} from "./support/app";

/**
 * Deck composé hors ligne, archivé puis supprimé avant que la file se vide
 * (`docs/issues/2026-10-01-deck-inconnu-apres-suppression.md`).
 *
 * Tout part dans un seul lot, dans l'ordre de saisie : création, lignes,
 * archivage, suppression. Les lignes passent donc avant la suppression : le
 * serveur ne refuse que ce qu'il aurait refusé en ligne (ici, des exemplaires
 * insuffisants : un autre appareil a réservé le second exemplaire pendant la
 * coupure, que le miroir local croyait encore libre). Le refus survit à la suppression du deck, et
 * sa description doit rester lisible : le deck a quitté les lectures locales, et
 * sa création, appliquée, n'est plus dans la file.
 */
test("deck supprimé avec une ligne refusée en file : le refus nomme encore le deck, un renvoi est refusé, « Abandonner » en sort", async ({
  page,
  context,
  api,
}) => {
  const syncCalls = recordSyncRequests(page);
  const aweInfo = await cardInfo(api, CARDS.awe);
  // Deux exemplaires possédés, un seul alloué : le miroir croit le second libre.
  await api.post(
    "/stock",
    { card_id: aweInfo.id, language_code: "EN", card_set_id: aweInfo.latest_card_set_id, quantity_owned: 2 },
    201,
  );
  const served = await api.post<{ id: number }>("/decks", { name: "Déjà servi" }, 201);
  await api.post(
    `/decks/${served.id}/cartes`,
    { card_id: aweInfo.id, language_code: "EN", card_set_id: aweInfo.latest_card_set_id, quantity: 1 },
    201,
  );

  await openApp(page);
  await expectCatalogDownloaded(page);
  await goToStock(page);
  await expect(stockEntry(page, aweInfo.id, "EN")).toHaveAttribute("data-quantity", "2");
  await context.setOffline(true);
  // Un autre appareil réserve le second exemplaire pendant la coupure.
  await api.patch(
    `/decks/${served.id}/cartes/${aweInfo.id}/EN/${aweInfo.latest_card_set_id}`,
    { quantity: 2 },
  );

  await goToDecks(page);
  await createDeck(page, "Éphémère");
  await addDeckCard(page, { search: "awe", card: CARDS.awe, language: "EN", quantity: 1 });
  await page.keyboard.press("Escape");
  await page.getByTestId("deck-archive").click();
  await page.getByTestId("deck-delete").click();
  await page.getByTestId("deck-delete-confirm").click();
  await expect(page.getByTestId("decks-page")).toBeVisible();
  await expectPending(page, 4); // création, ligne, archivage, suppression

  await context.setOffline(false);
  await expect(syncStatus(page)).toHaveAttribute("data-rejected", "1");
  await expectPending(page, 0);
  // Un seul lot, dans l'ordre de saisie : rien n'est réordonné ni fusionné.
  expect(syncCalls).toHaveLength(1);
  expect(syncCalls[0].operations.map((operation) => operation.type)).toEqual([
    "deck.create",
    "deck_card.upsert",
    "deck.update",
    "deck.delete",
  ]);

  await goToRejectedOperations(page);
  const rejected = page.getByTestId("rejected-operation");
  await expect(rejected).toHaveCount(1);
  await expect(rejected).toHaveAttribute("data-rejection-code", "conflict");
  await expect(page.getByTestId("rejection-reason")).toContainText(/insuffisant/i);
  const description = page.getByTestId("rejected-description").first();
  await expect(description).toContainText("1 × « Awe »");
  await expect(description).toContainText("Deck introuvable localement");
  await expect(description).not.toContainText("deck inconnu");

  // « Renvoyer tel quel » : la ligne vise désormais un deck supprimé. Le serveur
  // refuse comme il l'aurait fait en ligne (écriture sur un deck supprimé).
  await page.getByTestId("reissue-button").first().click();
  await expect(syncStatus(page)).toHaveAttribute("data-rejected", "1");
  await expectPending(page, 0);
  expect(syncCalls).toHaveLength(2);
  expect(syncCalls[1].operations.map((operation) => operation.type)).toEqual(["deck_card.upsert"]);
  await expect(rejected).toHaveCount(1);
  await expect(rejected).toHaveAttribute("data-rejection-code", "conflict");
  await expect(page.getByTestId("rejection-reason")).toContainText(/supprim/i);
  await expect(page.getByTestId("rejected-description").first()).not.toContainText("deck inconnu");

  // « Abandonner » suffit à en sortir.
  await page.getByTestId("discard-button").first().click();
  await page.getByTestId("discard-confirm").first().click();
  await expect(page.getByTestId("rejected-operation")).toHaveCount(0);
  expect(await readOutbox(page)).toEqual([]);
});
