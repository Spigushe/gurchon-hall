import { test } from "./support/backend";
import { revisionScenario } from "./support/lot13revision";

/** Révision d'une liste partagée à 390 px, contre un vrai back (Lot 13, D6). */
test("une liste partagée se révise dans l'adresse et se relit dans un contexte neuf", async ({ browser, api }) => {
  await revisionScenario({ browser, api }, { width: 390, height: 844 });
});
