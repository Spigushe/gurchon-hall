import { test } from "../e2e-real/support/backend";
import { revisionScenario } from "../e2e-real/support/lot13revision";

/** Révision d'une liste partagée à 1440 px, contre un vrai back (Lot 13, D6). */
test("une liste partagée se révise dans l'adresse et se relit dans un contexte neuf", async ({ browser, api }) => {
  await revisionScenario({ browser, api }, { width: 1440, height: 900 });
});
