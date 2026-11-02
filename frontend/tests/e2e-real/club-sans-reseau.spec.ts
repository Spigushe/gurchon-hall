import { test } from "./support/backend";
import { runClubScenario } from "./support/play";

/**
 * Lot 7, étape E : le scénario pilote « au club sans réseau » à 390 px, contre le VRAI back
 * (critère de fin de lot). Le même scénario tourne à 1440 px dans `tests/e2e-desktop-real/`.
 * Corps partagé : `support/play.ts` (`runClubScenario`).
 */
test("au club sans réseau : tournoi multi-deck, deux rondes, bilan provisoire, rechargement, synchronisation", async ({
  page,
  context,
  api,
}) => {
  await runClubScenario(page, context, api, false);
});
