import { test } from "./support/backend";
import { publicListScenario } from "./support/lot13share";

/** Page publique d'une liste partagée à 390 px, contre un vrai back (Lot 13, D3). */
test("une liste partagée se lit sans compte, le vivant suit le deck et le figé non", async ({ browser, api }) => {
  await publicListScenario({ browser, api }, { width: 390, height: 844 });
});
