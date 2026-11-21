import { test } from "../e2e-real/support/backend";
import { duplicateAndCompareScenario } from "../e2e-real/support/lot13share";

/** Dupliquer et comparer une liste partagée à 1440 px depuis un second compte, contre un vrai back (Lot 13, D5). */
test("une liste partagée se duplique puis se compare depuis un second compte, l'intention survivant à l'inscription", async ({
  browser,
  api,
}) => {
  await duplicateAndCompareScenario({ browser, api }, { width: 1440, height: 900 });
});
