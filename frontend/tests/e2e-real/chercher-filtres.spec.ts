import { expect, test } from "./support/backend";
import {
  CARDS,
  expectCatalogDownloaded,
  expectSynced,
  goToStock,
  openApp,
  openStockForm,
  waitForServiceWorkerControl,
} from "./support/app";
import {
  SEARCH_CARDS,
  addTextLine,
  backToFilterList,
  expectSheetCount,
  openFilter,
  openFilterSheet,
  readCatalogStores,
  rebuildAsDexieV5,
  searchRows,
  setCryptDiscipline,
  toggleChip,
} from "./support/search";

/**
 * Lot Chercher, étape E2, à 390 px et contre le vrai back : les filtres de P1
 * sur le miroir local, hors ligne, et la montée d'une base Dexie 5.
 *
 * Les filtres ne passent jamais par le serveur (P5) : une fois le catalogue
 * téléchargé, tout ce qui suit se joue réseau coupé. L'échantillon compte cinq
 * cartes de crypte, ce qui suffit à faire retirer une carte à chaque filtre :
 * Potence supérieure garde Tarbaby Jack et Aaradhya, le clan Ventrue garde
 * Aaradhya, et la ligne de texte confirme ou écarte.
 */

test("filtres combinés hors ligne : discipline supérieure, clan et texte, puis la fiche", async ({ page, context, api }) => {
  void api; // démarre le vrai back : sans lui ni connexion ni catalogue
  await openApp(page);
  await expectCatalogDownloaded(page);
  await waitForServiceWorkerControl(page);
  await expectSynced(page);

  await context.setOffline(true);
  await page.getByTestId("nav-search").click();
  await expect(page.getByTestId("search-page")).toBeVisible();
  await expect(page.getByTestId("search-outdated")).toHaveCount(0);
  await page.getByTestId("search-category-crypt").click();
  await expect(searchRows(page)).toHaveCount(5);

  const sheet = await openFilterSheet(page);
  await openFilter(sheet, "cryptDisciplines");
  await setCryptDiscipline(sheet, "Potence", "superior");
  await expectSheetCount(sheet, 2);
  await backToFilterList(sheet);
  await expect(sheet.getByTestId("search-filter-cryptDisciplines-open")).toContainText("Potence sup.");

  await openFilter(sheet, "cryptClans");
  await toggleChip(sheet.getByTestId("search-filter-crypt-clans"), "Ventrue");
  await expectSheetCount(sheet, 1);
  await backToFilterList(sheet);

  await openFilter(sheet, "text");
  const line = await addTextLine(sheet, "bleed");
  await expectSheetCount(sheet, 1);
  // Les filtres se combinent en ET : « transfer » est dans le texte de Tarbaby
  // Jack, que le clan Ventrue écarte déjà.
  await line.getByTestId("search-text-line-input").fill("transfer");
  await expectSheetCount(sheet, 0);
  await line.getByTestId("search-text-line-input").fill("bleed");
  await expectSheetCount(sheet, 1);
  await sheet.getByTestId("search-filters-done").click();
  await expect(sheet).toHaveCount(0);

  await expect(searchRows(page)).toHaveCount(1);
  const row = searchRows(page).first();
  await expect(row).toContainText(SEARCH_CARDS.aaradhya);
  await expect(page.getByTestId("search-filters-count")).toHaveText(/3 filtres/);

  await row.getByRole("button").click();
  const detailSheet = page.getByTestId("search-detail-sheet");
  await expect(detailSheet).toBeVisible();
  const detail = detailSheet.getByTestId("search-detail");
  await expect(detail).toContainText(SEARCH_CARDS.aaradhya);
  await expect(detail).toContainText("+1 bleed");
  await detailSheet.getByTestId("search-detail-close").click();
  await expect(detailSheet).toHaveCount(0);

  // Réinitialiser rend les cinq cartes de crypte.
  const again = await openFilterSheet(page);
  await again.getByTestId("search-filters-reset").click();
  await expectSheetCount(again, 5);
  await again.getByTestId("search-filters-done").click();
  await expect(searchRows(page)).toHaveCount(5);
  await context.setOffline(false);
});

test("secte de crypte et exigences de bibliothèque, lues par le serveur et filtrées hors ligne", async ({ page, context, api }) => {
  void api;
  await openApp(page);
  await expectCatalogDownloaded(page);
  await context.setOffline(true);
  await page.getByTestId("nav-search").click();

  // Crypte : la secte est dérivée du texte à l'import (P13).
  await page.getByTestId("search-category-crypt").click();
  let sheet = await openFilterSheet(page);
  await openFilter(sheet, "cryptSects");
  await toggleChip(sheet.getByTestId("search-filter-crypt-sects"), "Camarilla");
  await expectSheetCount(sheet, 1);
  await toggleChip(sheet.getByTestId("search-filter-crypt-sects"), "Camarilla");
  await toggleChip(sheet.getByTestId("search-filter-crypt-sects"), "Sabbat");
  await expectSheetCount(sheet, 2);
  await toggleChip(sheet.getByTestId("search-filter-crypt-sects"), "Sabbat");
  await toggleChip(sheet.getByTestId("search-filter-crypt-sects"), "Camarilla");
  await sheet.getByTestId("search-filters-done").click();
  await expect(searchRows(page)).toHaveCount(1);
  await expect(searchRows(page).first()).toContainText(SEARCH_CARDS.aidan);

  // Bibliothèque : l'exigence vient de `vteslibmeta.csv` (P15), lue par le serveur.
  await page.getByTestId("search-category-library").click();
  sheet = await openFilterSheet(page);
  await openFilter(sheet, "libraryTitles");
  await toggleChip(sheet.getByTestId("search-filter-library-titles"), "Prince");
  await expectSheetCount(sheet, 1);
  await sheet.getByTestId("search-filter-clear").click();
  await backToFilterList(sheet);

  // Un titre exigé implique sa secte (419 Operation : Prince, Justicar), et
  // « non-anarch » répond à toute autre secte de vampire (Absolute Tyranny).
  await openFilter(sheet, "librarySects");
  const sects = sheet.getByTestId("search-filter-library-sects");
  await toggleChip(sects, "Camarilla");
  await expectSheetCount(sheet, 2);
  await sheet.getByTestId("search-filters-done").click();
  await expect(searchRows(page)).toHaveCount(2);
  await expect(searchRows(page).filter({ hasText: SEARCH_CARDS.operation419 })).toHaveCount(1);
  await expect(searchRows(page).filter({ hasText: SEARCH_CARDS.tyranny })).toHaveCount(1);

  sheet = await openFilterSheet(page);
  await openFilter(sheet, "librarySects");
  await toggleChip(sheet.getByTestId("search-filter-library-sects"), "Camarilla");
  await toggleChip(sheet.getByTestId("search-filter-library-sects"), "Sabbat");
  // Seule Absolute Tyranny (« non-anarch ») répond au Sabbat.
  await expectSheetCount(sheet, 1);
  await sheet.getByTestId("search-filters-done").click();
  await expect(searchRows(page).first()).toContainText(SEARCH_CARDS.tyranny);
  await context.setOffline(false);
});

/**
 * Scénario 3 du plan : un téléphone resté en version 5 (avant le lot), avec un
 * catalogue ancien, ouvre le nouveau code hors ligne. La montée en version 7
 * ajoute `cardDetails` (6) et `deckVersions` (7) et ne vide pas `cards` : le picker de la Collection
 * marche, Chercher cherche par le nom seulement et désactive ses filtres. Au
 * retour du réseau, la relecture du catalogue part seule (P11) et tout
 * s'active.
 */
test("base Dexie 5 avec un catalogue ancien : ouverte hors ligne, puis complétée au retour du réseau", async ({
  page,
  context,
  api,
}) => {
  void api;
  await openApp(page);
  await expectCatalogDownloaded(page);
  await waitForServiceWorkerControl(page);
  await expectSynced(page);

  await context.setOffline(true);
  const { cards } = await rebuildAsDexieV5(page, { dropCard: CARDS.tarbaby });
  expect(cards).toBe(9);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Gurchon Hall" })).toBeVisible();
  await expectCatalogDownloaded(page, 9);
  await expect.poll(() => readCatalogStores(page)).toEqual({ version: 70, cards: 9, details: 0 });

  // Le picker de la Collection lit `cards`, inchangé par la montée.
  await goToStock(page);
  await openStockForm(page);
  const form = page.getByTestId("stock-form");
  await form.getByLabel("Rechercher une carte").fill("awe");
  await expect(form.getByTestId("card-picker-option").filter({ hasText: CARDS.awe })).toHaveCount(1);
  await page.keyboard.press("Escape");

  // Chercher : le nom seulement, filtres désactivés.
  await page.getByTestId("nav-search").click();
  await expect(page.getByTestId("search-outdated")).toBeVisible();
  await expect(page.getByTestId("search-outdated-update")).toBeDisabled();
  await expect(page.getByTestId("search-filters-open")).toBeDisabled();
  const input = page.getByTestId("search-input");
  await input.fill("aura");
  await expect(searchRows(page).filter({ hasText: CARDS.aura })).toHaveCount(1);
  // « intercept » n'est que dans le texte d'Aura Absorption : sans détails, rien.
  await input.fill("intercept");
  await expect(page.getByTestId("search-no-result")).toBeVisible();

  await context.setOffline(false);
  await expect(page.getByTestId("search-outdated")).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByTestId("search-filters-open")).toBeEnabled();
  await expect(searchRows(page).filter({ hasText: CARDS.aura })).toHaveCount(1);
  await expect.poll(() => readCatalogStores(page)).toEqual({ version: 70, cards: 10, details: 10 });
  await input.fill("tarbaby");
  await expect(searchRows(page).filter({ hasText: CARDS.tarbaby })).toHaveCount(1);
});
