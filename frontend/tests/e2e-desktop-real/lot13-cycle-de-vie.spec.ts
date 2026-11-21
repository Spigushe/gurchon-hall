import { test } from "../e2e-real/support/backend";
import { DESKTOP_NAV } from "../e2e-real/support/lot12";
import { shareLifecycleScenario } from "../e2e-real/support/lot13cycle";

/** Cycle de vie des liens de partage à 1440 px, contre un vrai back (Lot 13, étape E). */
test("purge d'une sélection, suppression du deck, purge des decks supprimés : le visiteur voit la liste tomber", async ({
  page,
  browser,
  api,
}) => {
  await shareLifecycleScenario({ page, browser, api }, DESKTOP_NAV, { width: 1440, height: 900 });
});
