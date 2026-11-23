import { test } from "../e2e-real/support/backend";
import { cardPreviewScenario } from "../e2e-real/support/cardPreview";

/** Image de la carte au survol sur la page d'une liste partagée, à 1440 px (issue #71). */
test("au survol, le nom d'une carte montre son image, en lecture comme en révision", async ({ browser, api }) => {
  await cardPreviewScenario({ browser, api }, { width: 1440, height: 900 }, "hover");
});
