import { expect, test } from "./support/backend";
import { goToDecksList, openApp } from "./support/app";
import { steppersOfflineThenSync, twoPrintingsFromDetail, type DeckTablesWidth } from "./support/deckTables";

/**
 * Deckbuilder éditable au téléphone (lot Affichage des decks, D4) : steppers
 * hors ligne puis rejeu, et deux impressions éditées depuis le détail. Les
 * scénarios sont communs aux deux largeurs (`support/deckTables.ts`).
 */
const mobile: DeckTablesWidth = {
  openApp: (page) => openApp(page),
  openDeck: async (page, name) => {
    await goToDecksList(page);
    await page.getByTestId("deck-link").filter({ hasText: name }).click();
    await expect(page.getByTestId("deck-page")).toBeVisible();
  },
};

test("steppers hors ligne : + au stock puis désactivé, − à 1 retire la ligne, puis rejeu", async ({
  page,
  context,
  api,
}) => {
  await steppersOfflineThenSync(mobile, { page, context, api });
});

test("deux impressions de la même carte : une ligne fusionnée, éditée depuis le détail, puis rejeu", async ({
  page,
  context,
  api,
}) => {
  await twoPrintingsFromDetail(mobile, { page, context, api });
});
