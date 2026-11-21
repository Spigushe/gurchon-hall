import { test } from "./support/backend";
import { duplicateAndCompareScenario } from "./support/lot13share";

/** Dupliquer et comparer une liste partagée à 390 px depuis un second compte, contre un vrai back (Lot 13, D5). */
test("une liste partagée se duplique puis se compare depuis un second compte, l'intention survivant à l'inscription", async ({
  browser,
  api,
}) => {
  await duplicateAndCompareScenario({ browser, api }, { width: 390, height: 844 });
});
