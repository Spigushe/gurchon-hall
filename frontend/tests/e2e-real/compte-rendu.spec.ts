import { test } from "./support/backend";
import { runReportScenario } from "./support/report";

/** Compte-rendu de tournoi à 390 px, contre le vrai back (lot Compte-rendu). */
test("compte-rendu : mise à jour hors ligne, version au retour du réseau, lien public, impression, purge", async ({
  page,
  context,
  browser,
  api,
}) => {
  await runReportScenario({ page, context, browser, api }, false);
});
