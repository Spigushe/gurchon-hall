import { expect, test } from "../e2e-real/support/backend";
import { CARDS, expectCatalogDownloaded, expectSynced } from "../e2e-real/support/app";
import {
  SEARCH_CARDS,
  addTextLine,
  openFilter,
  openSearchByHash,
  readCatalogStores,
  rebuildAsDexieV5,
  searchRows,
  setCryptDiscipline,
  toggleChip,
} from "../e2e-real/support/search";
import { openAppDesktop } from "./support/nav";

/**
 * Lot Chercher, étape E2, à 1440 px et contre le vrai back : la colonne de
 * filtres (lignes qui se déplient, grilles de disciplines ouvertes d'emblée),
 * le tableau et la fiche toujours visible, hors ligne ; puis la variante bureau
 * du scénario de la base Dexie 5 (scénario 4 du plan).
 */

async function controlledBySw(page: import("@playwright/test").Page): Promise<void> {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  await expect(page.getByTestId("home-page")).toBeVisible();
}

test("colonne de filtres hors ligne : discipline supérieure, clan et texte, fiche à droite", async ({ page, context, api }) => {
  void api;
  await openAppDesktop(page);
  await expectCatalogDownloaded(page);
  await controlledBySw(page);
  await expectSynced(page);

  await context.setOffline(true);
  await openSearchByHash(page);
  await page.getByTestId("search-category-crypt").click();
  await expect(searchRows(page)).toHaveCount(5);
  const column = page.getByTestId("search-filters-column");

  await openFilter(column, "cryptDisciplines");
  await setCryptDiscipline(column, "Potence", "superior");
  await expect(searchRows(page)).toHaveCount(2);

  await openFilter(column, "cryptClans");
  await toggleChip(column.getByTestId("search-filter-crypt-clans"), "Ventrue");
  await expect(searchRows(page)).toHaveCount(1);

  await openFilter(column, "text");
  const line = await addTextLine(column, "transfer");
  await expect(page.getByTestId("search-no-result")).toBeVisible();
  await line.getByTestId("search-text-line-input").fill("bleed");
  await expect(searchRows(page)).toHaveCount(1);
  await expect(column.getByTestId("search-filters-count")).toHaveText(/·\s*3$/);

  const row = searchRows(page).first();
  await expect(row).toContainText(SEARCH_CARDS.aaradhya);
  await row.click();
  const detail = page.getByTestId("search-detail");
  await expect(detail).toContainText(SEARCH_CARDS.aaradhya);
  await expect(detail).toContainText("+1 bleed");

  await column.getByTestId("search-filters-reset").click();
  await expect(searchRows(page)).toHaveCount(5);
  await context.setOffline(false);
});

test("base Dexie 5 avec un catalogue ancien (bureau) : colonne de filtres éteinte hors ligne, rallumée au retour du réseau", async ({
  page,
  context,
  api,
}) => {
  void api;
  await openAppDesktop(page);
  await expectCatalogDownloaded(page);
  await controlledBySw(page);
  await expectSynced(page);

  await context.setOffline(true);
  expect((await rebuildAsDexieV5(page, { dropCard: CARDS.tarbaby })).cards).toBe(9);
  await page.reload();
  await expect(page.getByTestId("home-page")).toBeVisible();
  await expectCatalogDownloaded(page, 9);
  await expect.poll(() => readCatalogStores(page)).toEqual({ version: 70, cards: 9, details: 0 });

  // Le picker de la Collection (feuille latérale au bureau) lit `cards`.
  await page.evaluate(() => {
    window.location.hash = "#/collection?action=ajouter";
  });
  const form = page.getByTestId("stock-form");
  await expect(form).toBeVisible();
  await form.getByLabel("Rechercher une carte").fill("awe");
  await expect(form.getByTestId("card-picker-option").filter({ hasText: CARDS.awe })).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(form).toHaveCount(0);

  await openSearchByHash(page);
  await expect(page.getByTestId("search-outdated")).toBeVisible();
  // La colonne reste à sa place, éteinte et sans pointeur (`.search-desktop--outdated`).
  await expect(page.locator(".search-desktop--outdated")).toHaveCount(1);
  await expect(page.getByTestId("search-filters-column")).toHaveCSS("pointer-events", "none");
  const input = page.getByTestId("search-input");
  await input.fill("aura");
  await expect(searchRows(page).filter({ hasText: CARDS.aura })).toHaveCount(1);
  await input.fill("intercept");
  await expect(page.getByTestId("search-no-result")).toBeVisible();

  await context.setOffline(false);
  await expect(page.getByTestId("search-outdated")).toHaveCount(0, { timeout: 30_000 });
  await expect(page.locator(".search-desktop--outdated")).toHaveCount(0);
  await expect(searchRows(page).filter({ hasText: CARDS.aura })).toHaveCount(1);
  await expect.poll(() => readCatalogStores(page)).toEqual({ version: 70, cards: 10, details: 10 });
});
