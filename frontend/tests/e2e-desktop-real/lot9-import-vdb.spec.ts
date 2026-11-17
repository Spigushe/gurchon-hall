import { expect, test } from "../e2e-real/support/backend";
import {
  linkedDeckIsUpdatedFromVdb,
  pastedTextBecomesAProxyDeck,
  playedVersionIsExportedAsAFile,
  vdbLinkOfflineIsRefused,
  type Lot9Width,
} from "../e2e-real/support/lot9";
import { goToDecksDesktop } from "./support/nav";

/**
 * Lot 9, étape E, à 1440 px contre le VRAI back : les scénarios de `tests/e2e-real/lot9-import-vdb`
 * (liste `TEXT` collée hors ligne, lien VDB refusé hors ligne, mise à jour d'un deck lié, export
 * d'une version jouée), avec le bouton d'import de l'en-tête et le maître/détail des decks.
 * Corps partagé : `../e2e-real/support/lot9.ts`.
 */
const desktop: Lot9Width = {
  desktop: true,
  openDeck: async (page, name) => {
    await goToDecksDesktop(page);
    await page.getByTestId("deck-select").filter({ hasText: name }).click();
    await page.getByTestId("decks-detail-open").click();
    await expect(page.getByTestId("deck-builder-columns")).toBeVisible();
  },
};

test("une liste TEXT de VDB collée hors ligne devient un deck tout en proxy, rejoué au retour du réseau", async ({
  page,
  context,
  api,
}) => {
  await pastedTextBecomesAProxyDeck(desktop, { page, context, api });
});

test("un lien de deck VDB collé hors ligne affiche son message et grise « Lire chez VDB »", async ({
  page,
  context,
  api,
}) => {
  await vdbLinkOfflineIsRefused(desktop, { page, context, api });
});

test("un deck importé par son lien se met à jour depuis VDB : cartes ajoutées en proxy, ligne en conflit refaite", async ({
  page,
  context,
  api,
}) => {
  await linkedDeckIsUpdatedFromVdb(desktop, { page, context, api });
});

test("la liste d'une version jouée s'exporte en .txt au format TEXT de VDB", async ({ page, context, api }) => {
  await playedVersionIsExportedAsAFile(desktop, { page, context, api });
});
