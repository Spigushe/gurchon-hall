import { expect, type Browser, type Locator, type Page } from "@playwright/test";
import type { Api } from "./backend";
import { WEB_ORIGIN } from "./env";

/**
 * Image de la carte sur la page publique d'une liste partagée (issue #71),
 * contre un vrai back : au survol à 1440 px, au toucher à 390 px (contexte
 * tactile), en lecture puis en révision, où la quantité garde ses boutons.
 * Les images de krcg sont servies par une route locale : le test ne joint
 * pas static.krcg.org.
 */

interface CatalogCard {
  id: number;
  name: string;
  image_url: string | null;
  latest_card_set_id: number | null;
}

/** PNG transparent de 1 × 1. */
const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

export type PreviewInput = "hover" | "touch";

async function openPreview(page: Page, name: Locator, input: PreviewInput) {
  if (input === "hover") await name.hover();
  else await name.tap();
  await expect(page.getByTestId("deck-card-preview")).toBeVisible();
}

async function expectInViewport(page: Page, viewport: { width: number; height: number }) {
  const box = await page.getByTestId("deck-card-preview").boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
}

async function closePreview(page: Page, name: Locator, input: PreviewInput) {
  if (input === "hover") await page.mouse.move(0, 0);
  else await page.getByTestId("public-list-name").tap();
  await expect(page.getByTestId("deck-card-preview")).toHaveCount(0);
  await expect(name).toHaveAttribute("aria-expanded", "false");
}

export async function cardPreviewScenario(
  { browser, api }: { browser: Browser; api: Api },
  viewport: { width: number; height: number },
  input: PreviewInput,
): Promise<void> {
  await api.get("/moi");
  const catalog = (await api.get<CatalogCard[]>("/cartes?limit=50")).filter(
    (card) => card.latest_card_set_id !== null && card.image_url !== null,
  );
  expect(catalog.length).toBeGreaterThan(2);
  const cards = catalog.slice(0, 3);

  const deck = await api.post<{ id: number }>("/decks", { name: "Aperçu", proxy_allowed: true }, 201);
  for (const card of cards) {
    await api.post(
      `/decks/${deck.id}/cartes`,
      { card_id: card.id, language_code: "EN", card_set_id: card.latest_card_set_id, quantity: 2, proxy_quantity: 2 },
      201,
    );
  }
  const live = await api.post<{ token: string }>(`/decks/${deck.id}/partages`, { kind: "live" }, 201);

  const context = await browser.newContext({ baseURL: WEB_ORIGIN, viewport, hasTouch: input === "touch" });
  await context.route(/static\.krcg\.org/, (route) => route.fulfill({ status: 200, contentType: "image/png", body: PIXEL }));
  const page = await context.newPage();
  try {
    await page.goto(`/#/liste/${live.token}`);
    await expect(page.getByTestId("public-list-name")).toHaveText("Aperçu");

    const target = cards[0];
    const row = page.getByTestId("deck-card").filter({ has: page.getByTestId("deck-card-name").getByText(target.name, { exact: true }) });
    const name = row.getByTestId("deck-card-name");

    // En lecture : le nom montre l'image de la carte, dans la fenêtre.
    await openPreview(page, name, input);
    await expect(page.getByTestId("deck-card-preview").getByRole("img", { name: target.name })).toHaveAttribute(
      "src",
      target.image_url!,
    );
    await expectInViewport(page, viewport);
    await closePreview(page, name, input);

    // En révision : « + » change la quantité sans ouvrir l'image, le nom l'ouvre toujours.
    await page.getByTestId("public-list-revise").click();
    const plus = row.getByTestId("revision-plus");
    if (input === "touch") await plus.tap();
    else await plus.click();
    await expect(row.getByTestId("revision-delta")).toHaveText("+1");
    await expect(page.getByTestId("deck-card-preview")).toHaveCount(0);
    await openPreview(page, name, input);
    await expectInViewport(page, viewport);
  } finally {
    await context.close();
  }
}
