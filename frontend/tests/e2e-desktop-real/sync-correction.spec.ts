import { expect, test, type Api } from "../e2e-real/support/backend";
import { CARDS, cardInfo, expectCatalogDownloaded, expectSynced, syncStatus } from "../e2e-real/support/app";
import { goToDecksDesktop, goToSyncDesktop, openAppDesktop } from "./support/nav";

/**
 * Synchronisation bureau à deux colonnes (Lot 5bis, étape 12,
 * `docs/design-handoff/DESKTOP.md` « d06 ») : la liste « Refusées »
 * devient sélectionnable, et la correction de l'entrée choisie s'affiche dans
 * le panneau de droite (`sync-detail`), sans jamais ouvrir de feuille. Deux
 * refus distincts (deux decks archivés pendant que l'appareil est hors ligne,
 * même motif que `tests/e2e-real/rejections.spec.ts`) permettent de vérifier
 * que **changer la sélection** change bien la correction affichée.
 */

async function seedArchivableDeck(
  api: Api,
  name: string,
  card: { id: number; latest_card_set_id: number },
  quantity: number,
) {
  await api.post(
    "/stock",
    { card_id: card.id, language_code: "EN", card_set_id: card.latest_card_set_id, quantity_owned: quantity + 5 },
    201,
  );
  const deck = await api.post<{ id: number }>("/decks", { name }, 201);
  await api.post(
    `/decks/${deck.id}/cartes`,
    { card_id: card.id, language_code: "EN", card_set_id: card.latest_card_set_id, quantity },
    201,
  );
  return deck;
}

test("sélectionner une opération refusée change la correction affichée dans le panneau de droite", async ({
  page,
  context,
  api,
}) => {
  const awe = await cardInfo(api, CARDS.awe);
  const aura = await cardInfo(api, CARDS.aura);
  const deckAlpha = await seedArchivableDeck(api, "Alpha bureau", awe, 1);
  const deckBeta = await seedArchivableDeck(api, "Beta bureau", aura, 1);

  await openAppDesktop(page);
  await expectCatalogDownloaded(page);
  await expectSynced(page);

  await context.setOffline(true);
  // La file fait foi, les invariants font loi (§11 CLAUDE.md) : les deux decks
  // sont archivés ailleurs pendant que l'appareil, hors ligne, les croit
  // encore actifs sur sa dernière lecture.
  await api.patch(`/decks/${deckAlpha.id}`, { archived: true });
  await api.patch(`/decks/${deckBeta.id}`, { archived: true });

  await goToDecksDesktop(page);
  await page.getByTestId("deck-select").filter({ hasText: "Alpha bureau" }).click();
  await page.getByTestId("decks-detail-open").click();
  await page.getByRole("button", { name: /Ajouter un exemplaire de Awe/ }).click();

  await goToDecksDesktop(page);
  await page.getByTestId("deck-select").filter({ hasText: "Beta bureau" }).click();
  await page.getByTestId("decks-detail-open").click();
  await page.getByRole("button", { name: new RegExp(`Ajouter un exemplaire de ${CARDS.aura}`) }).click();

  await context.setOffline(false);
  await expect(syncStatus(page)).toHaveAttribute("data-rejected", "2");

  await goToSyncDesktop(page);
  await expect(page.getByTestId("sync-columns")).toBeVisible();
  const rows = page.getByTestId("rejected-operation");
  await expect(rows).toHaveCount(2);

  // Sélectionner la ligne Beta : le panneau de droite en affiche la correction.
  await rows.filter({ hasText: "Beta bureau" }).click();
  await expect(page.getByTestId("sync-detail")).toContainText("Beta bureau");
  await expect(page.getByTestId("correction-form")).toBeVisible();

  // Sélectionner la ligne Alpha bascule le panneau sur cette autre opération.
  await rows.filter({ hasText: "Alpha bureau" }).click();
  await expect(page.getByTestId("sync-detail")).toContainText("Alpha bureau");
  await expect(page.getByTestId("sync-detail")).not.toContainText("Beta bureau");
});
