import { test } from "../e2e-real/support/backend";
import { runClubScenario } from "../e2e-real/support/play";

/**
 * Lot 7, étape E : le scénario pilote « au club sans réseau » à 1440 px, contre le VRAI back
 * (critère de fin de lot). Maître/détail des tournois, saisie dans le panneau latéral. Le même
 * scénario tourne à 390 px dans `tests/e2e-real/`. Corps partagé : `support/play.ts`.
 */
test("au club sans réseau : tournoi multi-deck, deux rondes, bilan provisoire, rechargement, synchronisation", async ({
  page,
  context,
  api,
}) => {
  await runClubScenario(page, context, api, true);
});
