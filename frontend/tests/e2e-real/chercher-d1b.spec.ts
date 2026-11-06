import { expect, test } from "./support/backend";
import { CARDS, expectCatalogDownloaded, openApp, waitForServiceWorkerControl } from "./support/app";

/**
 * Lot Chercher, étape D1b, à 390 px et contre le vrai back : l'onglet Chercher s'ouvre,
 * la recherche par nom marche sur le miroir local, et la page se rouvre hors ligne après
 * un rechargement (route chargée paresseuse, précachée). Le texte cherché voyage dans
 * l'adresse, réécrite sans entrée d'historique.
 */
test("Chercher : onglet, recherche par nom, rechargement hors ligne", async ({ page, context, api }) => {
  expect(await api.get<unknown[]>("/stock")).toEqual([]); // le compte de test existe
  await openApp(page);
  await expectCatalogDownloaded(page);
  await waitForServiceWorkerControl(page);

  await page.getByTestId("nav-search").click();
  await expect(page.getByTestId("search-page")).toBeVisible();
  await expect(page.getByTestId("nav-search")).toHaveAttribute("aria-current", "page");

  await page.getByTestId("search-input").fill("awe");
  await expect(page.getByTestId("search-row").filter({ hasText: CARDS.awe })).toHaveCount(1);
  await expect(page).toHaveURL(/#\/chercher\?q=awe$/);

  await page.getByTestId("search-input").fill("zzzzzz");
  await expect(page.getByTestId("search-no-result")).toBeVisible();

  await context.setOffline(true);
  await page.goto("/#/chercher?q=awe");
  await page.reload();
  await expect(page.getByTestId("search-input")).toHaveValue("awe");
  await expect(page.getByTestId("search-row").filter({ hasText: CARDS.awe })).toHaveCount(1);
});
