import { test } from "../e2e-real/support/backend";
import { publicListScenario } from "../e2e-real/support/lot13share";

/** Page publique d'une liste partagée à 1440 px, contre un vrai back (Lot 13, D3). */
test("une liste partagée se lit sans compte, le vivant suit le deck et le figé non", async ({ browser, api }) => {
  await publicListScenario({ browser, api }, { width: 1440, height: 900 });
});
