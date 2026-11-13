import { expect, test } from "../e2e-real/support/backend";
import { bilanFilteredOnADeck, frozenListSurvivesAnOfflineEdit, type Lot8Width } from "../e2e-real/support/lot8";
import { goToDecksDesktop } from "./support/nav";

/**
 * Lot 8, étape E, à 1440 px contre le VRAI back : les scénarios de `tests/e2e-real/lot8-analyse`
 * (liste figée au rejeu, bilan filtré sur un deck), au maître/détail des parties et dans la
 * grille du bilan. Corps partagé : `../e2e-real/support/lot8.ts`.
 */
const desktop: Lot8Width = {
  desktop: true,
  openDeck: async (page, name) => {
    await goToDecksDesktop(page);
    await page.getByTestId("deck-select").filter({ hasText: name }).click();
    await page.getByTestId("decks-detail-open").click();
    await expect(page.getByTestId("deck-builder-columns")).toBeVisible();
  },
};

test("une partie saisie hors ligne garde la liste d'avant la retouche du deck, faite hors ligne ensuite", async ({
  page,
  context,
  api,
}) => {
  await frozenListSurvivesAnOfflineEdit(desktop, { page, context, api });
});

test("bilan filtré sur un deck, lu hors ligne : sa proie et son prédateur", async ({ page, context, api }) => {
  await bilanFilteredOnADeck(desktop, { page, context, api });
});
