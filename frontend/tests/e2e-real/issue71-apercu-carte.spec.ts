import { test } from "./support/backend";
import { cardPreviewScenario } from "./support/cardPreview";

/** Image de la carte au toucher sur la page d'une liste partagée, à 390 px (issue #71). */
test("au toucher, le nom d'une carte montre son image, en lecture comme en révision", async ({ browser, api }) => {
  await cardPreviewScenario({ browser, api }, { width: 390, height: 844 }, "touch");
});
