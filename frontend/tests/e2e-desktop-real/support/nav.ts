import { expect, type Page } from "@playwright/test";

/**
 * Navigation par la barre haute (bureau, ≥1024px). Les helpers de
 * `tests/e2e-real/support/app.ts` (`goToStock`, `goToDecks`, `goToDecksList`,
 * `goToRejectedOperations`…) ciblent `nav-*`, la tab bar basse — masquée par
 * `index.css` à partir de 1024px (Lot 5bis, étape 1). Cliquer dessus depuis un
 * test à la largeur bureau échouerait (« element is not visible »). Ces
 * équivalents ciblent `topnav-*` à la place, sans dupliquer le reste des
 * helpers de `support/app.ts` (`openApp`, `expectCatalogDownloaded`,
 * `expectSynced`, `cardInfo`…) qui ne dépendent pas de la largeur et restent
 * partagés tels quels.
 */

/**
 * Ouvre l'app et attend l'Atelier. Remplace `openApp` de `support/app.ts` pour
 * ces scénarios : celui-ci attend un `heading` « Gurchon Hall » qui n'existe
 * qu'en dessous de 1024px (`.shell-bar__brand`, un `<h1>`, masqué par
 * `index.css` à partir de 1024px puisque `TopBar` porte déjà la marque, dans
 * un lien sans rôle `heading`) — un `expect().toBeVisible()` dessus reste en
 * échec à la largeur bureau. `home-page` existe aux deux largeurs.
 */
export async function openAppDesktop(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId("home-page")).toBeVisible();
}

export async function goToStockDesktop(page: Page): Promise<void> {
  await page.getByTestId("topnav-stock").click();
  await expect(page.getByTestId("stock-page")).toBeVisible();
}

export async function goToDecksDesktop(page: Page): Promise<void> {
  await page.getByTestId("topnav-decks").click();
  await expect(page.getByTestId("decks-page")).toBeVisible();
}

export async function goToSyncDesktop(page: Page): Promise<void> {
  await page.getByTestId("topnav-sync").click();
  await expect(page.getByTestId("sync-page")).toBeVisible();
}
