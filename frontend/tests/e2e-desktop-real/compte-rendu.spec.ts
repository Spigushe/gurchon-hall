import { test } from "../e2e-real/support/backend";
import { runReportScenario } from "../e2e-real/support/report";

/** Compte-rendu de tournoi à 1440 px, contre le vrai back (lot Compte-rendu). */
test("compte-rendu : mise à jour hors ligne, version au retour du réseau, lien public, impression, purge", async ({
  page,
  context,
  browser,
  api,
}) => {
  await runReportScenario({ page, context, browser, api }, true);
});
