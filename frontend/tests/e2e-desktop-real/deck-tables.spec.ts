import { expect, test } from "../e2e-real/support/backend";
import { expectCatalogDownloaded, expectSynced } from "../e2e-real/support/app";
import {
  steppersOfflineThenSync,
  twoPrintingsFromDetail,
  type DeckTablesWidth,
} from "../e2e-real/support/deckTables";
import { goToDecksDesktop, openAppDesktop } from "./support/nav";

/**
 * Deckbuilder éditable au bureau (lot Affichage des decks, D4 et D5) : les
 * scénarios communs aux deux largeurs (`e2e-real/support/deckTables.ts`),
 * plus le picker repliable, propre au bureau, mémorisé par l'appareil (P9).
 */
const desktop: DeckTablesWidth = {
  openApp: (page) => openAppDesktop(page),
  openDeck: async (page, name) => {
    await goToDecksDesktop(page);
    await page.getByTestId("deck-select").filter({ hasText: name }).click();
    await page.getByTestId("decks-detail-open").click();
    await expect(page.getByTestId("deck-builder-columns")).toBeVisible();
    await expect(page.getByTestId("deck-page")).toBeVisible();
  },
};

test("steppers hors ligne : + au stock puis désactivé, − à 1 retire la ligne, puis rejeu", async ({
  page,
  context,
  api,
}) => {
  await steppersOfflineThenSync(desktop, { page, context, api });
});

test("deux impressions de la même carte : une ligne fusionnée, éditée depuis le détail, puis rejeu", async ({
  page,
  context,
  api,
}) => {
  await twoPrintingsFromDetail(desktop, { page, context, api });
});

test("le picker replié le reste après un rechargement, puis se rouvre", async ({ page, api }) => {
  await api.post("/decks", { name: "Picker replié" }, 201);
  await openAppDesktop(page);
  await expectCatalogDownloaded(page);
  await expectSynced(page);
  await desktop.openDeck(page, "Picker replié");

  await expect(page.getByTestId("deck-builder-picker")).toBeVisible();
  await page.getByTestId("deck-picker-collapse").click();
  await expect(page.getByTestId("deck-builder-picker")).toHaveCount(0);
  await expect(page.getByTestId("deck-picker-expand")).toBeVisible();

  await page.reload();
  await expect(page.getByTestId("deck-page")).toBeVisible();
  await expect(page.getByTestId("deck-picker-expand")).toBeVisible();
  await expect(page.getByTestId("deck-builder-picker")).toHaveCount(0);

  await page.getByTestId("deck-picker-expand").click();
  await expect(page.getByTestId("deck-builder-picker")).toBeVisible();
});
