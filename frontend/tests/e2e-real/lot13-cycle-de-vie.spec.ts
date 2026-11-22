import { test } from "./support/backend";
import { MOBILE_NAV } from "./support/lot12";
import { shareLifecycleScenario } from "./support/lot13cycle";

/** Cycle de vie des liens de partage à 390 px, contre un vrai back (Lot 13, étape E). */
test("purge d'une sélection, suppression du deck, purge des decks supprimés : le visiteur voit la liste tomber", async ({
  page,
  browser,
  api,
}) => {
  await shareLifecycleScenario({ page, browser, api }, MOBILE_NAV, { width: 390, height: 844 });
});
