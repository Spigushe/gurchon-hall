import { expect, test } from "./support/backend";
import { goToDecksList } from "./support/app";
import { bilanFilteredOnADeck, frozenListSurvivesAnOfflineEdit, type Lot8Width } from "./support/lot8";

/**
 * Lot 8, étape E, à 390 px contre le VRAI back : liste figée au rejeu malgré une retouche hors
 * ligne, et bilan filtré sur un deck avec sa proie et son prédateur. Les mêmes scénarios
 * tournent à 1440 px dans `tests/e2e-desktop-real/`. Corps partagé : `support/lot8.ts`.
 */
const mobile: Lot8Width = {
  desktop: false,
  openDeck: async (page, name) => {
    await goToDecksList(page);
    await page.getByTestId("deck-link").filter({ hasText: name }).click();
    await expect(page.getByTestId("deck-page")).toBeVisible();
  },
};

test("une partie saisie hors ligne garde la liste d'avant la retouche du deck, faite hors ligne ensuite", async ({
  page,
  context,
  api,
}) => {
  await frozenListSurvivesAnOfflineEdit(mobile, { page, context, api });
});

test("bilan filtré sur un deck, lu hors ligne : sa proie et son prédateur", async ({ page, context, api }) => {
  await bilanFilteredOnADeck(mobile, { page, context, api });
});
