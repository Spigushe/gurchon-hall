import { expect, test } from "../e2e-real/support/backend";
import { CARDS, expectCatalogDownloaded } from "../e2e-real/support/app";
import { openAppDesktop } from "./support/nav";

/**
 * Lot Chercher, étape D1b, à 1440 px et contre le vrai back. Pas d'onglet Chercher dans la
 * barre haute (P8 : pas de sixième onglet, le champ global viendra à l'étape D3) : la page
 * s'ouvre par son adresse. Recherche par nom, puis rechargement hors ligne.
 */
test("Chercher (bureau) : recherche par nom et rechargement hors ligne", async ({ page, context, api }) => {
  expect(await api.get<unknown[]>("/stock")).toEqual([]); // le compte de test existe
  await openAppDesktop(page);
  await expectCatalogDownloaded(page);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);

  await page.evaluate(() => {
    window.location.hash = "#/chercher";
  });
  await expect(page.getByTestId("search-page")).toBeVisible();
  await page.getByTestId("search-input").fill("awe");
  await expect(page.getByTestId("search-row").filter({ hasText: CARDS.awe })).toHaveCount(1);

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId("search-input")).toHaveValue("awe");
  await expect(page.getByTestId("search-row").filter({ hasText: CARDS.awe })).toHaveCount(1);
});
