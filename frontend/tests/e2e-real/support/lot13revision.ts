import { expect, type Browser } from "@playwright/test";
import type { Api } from "./backend";
import { WEB_ORIGIN } from "./env";

/**
 * Révision d'une liste partagée (Lot 13, D6), contre un vrai back : une liste vivante
 * créée sous session, ouverte dans un contexte sans compte, modifiée (quantité, retrait,
 * carte du catalogue ajoutée par la recherche), puis l'adresse obtenue est relue dans un
 * contexte neuf. Scénario commun aux deux largeurs.
 */

interface CatalogCard {
  id: number;
  name: string;
  latest_card_set_id: number | null;
}

export async function revisionScenario(
  { browser, api }: { browser: Browser; api: Api },
  viewport: { width: number; height: number },
): Promise<void> {
  await api.get("/moi");
  const catalog = (await api.get<CatalogCard[]>("/cartes?limit=50")).filter((card) => card.latest_card_set_id !== null);
  expect(catalog.length).toBeGreaterThan(4);
  const [first, second, third, extra] = catalog;

  const deck = await api.post<{ id: number }>("/decks", { name: "Banu Princes", proxy_allowed: true }, 201);
  for (const card of [first, second, third]) {
    await api.post(
      `/decks/${deck.id}/cartes`,
      { card_id: card.id, language_code: "EN", card_set_id: card.latest_card_set_id, quantity: 2, proxy_quantity: 2 },
      201,
    );
  }
  const live = await api.post<{ token: string }>(`/decks/${deck.id}/partages`, { kind: "live" }, 201);

  const open = async (url: string) => {
    const context = await browser.newContext({ baseURL: WEB_ORIGIN, viewport });
    const page = await context.newPage();
    await page.goto(url);
    await page.reload();
    return { context, page };
  };
  const rowOf = (page: Awaited<ReturnType<typeof open>>["page"], id: number) =>
    page.locator(`[data-testid="deck-card"][data-card-id="${id}"]`);

  const editing = await open(`/#/liste/${live.token}`);
  let address: string;
  try {
    const { page } = editing;
    await expect(page.getByTestId("public-list-name")).toHaveText("Banu Princes");
    await page.getByTestId("public-list-revise").click();
    await rowOf(page, first.id).getByTestId("revision-plus").click();
    await rowOf(page, second.id).getByTestId("revision-minus").click();
    await rowOf(page, second.id).getByTestId("revision-minus").click();
    await page.getByTestId("revision-search").fill(extra.name.slice(0, 12));
    await page.getByTestId("revision-search-result").filter({ hasText: extra.name }).first().getByTestId("revision-add").click();

    await expect(page.getByTestId("revision-banner")).toContainText(`@${api.account.username}`);
    const expected = [
      { cardId: first.id, delta: 1 },
      { cardId: second.id, delta: -2 },
      { cardId: extra.id, delta: 1 },
    ]
      .sort((a, b) => a.cardId - b.cardId)
      .map(({ cardId, delta }) => `${cardId}=${delta}`)
      .join(";");
    await expect.poll(() => page.url().split("#")[1]).toBe(`/liste/${live.token}?revision=${expected}`);
    // Ni rechargement ni changement de côté : la page reste la même, sans base.
    expect(await page.evaluate(async () => (await indexedDB.databases()).map((db) => db.name))).toEqual([]);
    await expect(page.getByTestId("revision-removed-row")).toHaveCount(1);
    address = page.url();
  } finally {
    await editing.context.close();
  }

  // Un contexte neuf, sans compte : l'adresse seule redonne la révision.
  const reading = await open(address);
  try {
    const { page } = reading;
    await expect(page.getByTestId("revision-banner")).toBeVisible();
    await expect(rowOf(page, first.id).getByTestId("revision-delta")).toHaveText("+1");
    await expect(rowOf(page, extra.id).getByTestId("revision-delta")).toHaveText("nouvelle");
    await expect(page.getByTestId("revision-removed-row")).toHaveCount(1);
    await expect(page.getByTestId("revision-notices")).toHaveCount(0);
    await expect(page.getByTestId("deck-tables")).toHaveAttribute("data-editable", "false");

    // Une révision se révise à son tour, et s'exporte.
    await page.getByTestId("public-list-revise").click();
    await rowOf(page, first.id).getByTestId("revision-minus").click();
    await expect.poll(() => page.url()).not.toContain(`${first.id}=`);
    await page.getByTestId("public-list-export").click();
    await expect.poll(() => page.getByTestId("deck-export-text").inputValue()).toContain(extra.name);
    await page.keyboard.press("Escape");
  } finally {
    await reading.context.close();
  }

  // Un écart illisible est signalé, jamais deviné.
  const broken = await open(`${address};abc=1`);
  try {
    await expect(broken.page.getByTestId("revision-notice")).toHaveText("1 modification illisible ignorée");
  } finally {
    await broken.context.close();
  }
}
