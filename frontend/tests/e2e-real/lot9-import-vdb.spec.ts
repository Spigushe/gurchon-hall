import { expect, test } from "./support/backend";
import { goToDecksList } from "./support/app";
import {
  linkedDeckIsUpdatedFromVdb,
  pastedTextBecomesAProxyDeck,
  playedVersionIsExportedAsAFile,
  vdbLinkOfflineIsRefused,
  type Lot9Width,
} from "./support/lot9";

/**
 * Lot 9, étape E, à 390 px contre le VRAI back : import d'une liste `TEXT` collée hors ligne,
 * lien VDB refusé hors ligne, mise à jour d'un deck lié (lecture de VDB simulée côté serveur,
 * jamais vdb.im) et export d'une version jouée. Les mêmes scénarios tournent à 1440 px dans
 * `tests/e2e-desktop-real/`. Corps partagé : `support/lot9.ts`.
 */
const mobile: Lot9Width = {
  desktop: false,
  openDeck: async (page, name) => {
    await goToDecksList(page);
    await page.getByTestId("deck-link").filter({ hasText: name }).click();
    await expect(page.getByTestId("deck-page")).toBeVisible();
  },
};

test("une liste TEXT de VDB collée hors ligne devient un deck tout en proxy, rejoué au retour du réseau", async ({
  page,
  context,
  api,
}) => {
  await pastedTextBecomesAProxyDeck(mobile, { page, context, api });
});

test("un lien de deck VDB collé hors ligne affiche son message et grise « Lire chez VDB »", async ({
  page,
  context,
  api,
}) => {
  await vdbLinkOfflineIsRefused(mobile, { page, context, api });
});

test("un deck importé par son lien se met à jour depuis VDB : cartes ajoutées en proxy, ligne en conflit refaite", async ({
  page,
  context,
  api,
}) => {
  await linkedDeckIsUpdatedFromVdb(mobile, { page, context, api });
});

test("la liste d'une version jouée s'exporte en .txt au format TEXT de VDB", async ({ page, context, api }) => {
  await playedVersionIsExportedAsAFile(mobile, { page, context, api });
});
