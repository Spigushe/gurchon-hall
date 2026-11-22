import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test } from "../e2e-real/support/backend";
import { WEB_ORIGIN, FRONTEND_DIR } from "../e2e-real/support/env";

/**
 * Captures de la révision d'une liste partagée (Lot 13, D6, `docs/lot13-plan-partage.md`)
 * à 390 et 1440 px, contre un vrai back : liste en édition (steppers, recherche), révision
 * relue depuis son adresse (écarts marqués, cartes retirées), avis d'écarts ignorés.
 *
 * Outil de capture : aucune assertion sur les images. Sortie : `docs/qa-baselines/lot13-d6/<largeur>/`.
 *
 *     npm run build:e2e
 *     npx playwright test --config tests/visual-baseline/playwright.config.ts lot13-d6
 */

const ROOT = path.join(FRONTEND_DIR, "..", "docs", "qa-baselines", "lot13-d6");

interface CatalogCard {
  id: number;
  name: string;
  latest_card_set_id: number | null;
}

for (const width of [
  { label: "mobile-390x844", viewport: { width: 390, height: 844 } },
  { label: "desktop-1440x900", viewport: { width: 1440, height: 900 } },
]) {
  test.describe(width.label, () => {
    test.use({ viewport: width.viewport });
    test.setTimeout(240_000);

    test(`captures D6 à ${width.label}`, async ({ browser, api }) => {
      await api.get("/moi");
      const out = path.join(ROOT, width.label);
      mkdirSync(out, { recursive: true });

      const catalog = (await api.get<CatalogCard[]>("/cartes?limit=50")).filter((card) => card.latest_card_set_id !== null);
      const deck = await api.post<{ id: number }>("/decks", { name: "Banu Princes", archetype: "bleed", proxy_allowed: true }, 201);
      // Le catalogue de test est court : toutes ses cartes sauf une dans le deck,
      // la dernière servant à l'ajout par la recherche.
      const inDeck = catalog.slice(0, Math.min(12, catalog.length - 1));
      for (const card of inDeck) {
        await api.post(
          `/decks/${deck.id}/cartes`,
          { card_id: card.id, language_code: "EN", card_set_id: card.latest_card_set_id, quantity: 2, proxy_quantity: 2 },
          201,
        );
      }
      const live = await api.post<{ token: string }>(`/decks/${deck.id}/partages`, { kind: "live" }, 201);
      const extra = catalog[inDeck.length];

      const context = await browser.newContext({ baseURL: WEB_ORIGIN, viewport: width.viewport });
      try {
        const page = await context.newPage();
        const shot = (name: string, fullPage = true) => page.screenshot({ path: path.join(out, `${name}.png`), fullPage });
        const open = async (hash: string) => {
          await page.goto(`/#${hash}`);
          await page.reload();
        };
        const rowOf = (id: number) => page.locator(`[data-testid="deck-card"][data-card-id="${id}"]`);

        await open(`/liste/${live.token}`);
        await expect(page.getByTestId("deck-tables")).toBeVisible();
        await page.waitForTimeout(800);
        await page.getByTestId("public-list-revise").click();
        await rowOf(inDeck[0].id).getByTestId("revision-plus").click();
        await rowOf(inDeck[1].id).getByTestId("revision-minus").click();
        await rowOf(inDeck[1].id).getByTestId("revision-minus").click();
        await page.getByTestId("revision-search").fill(extra.name.slice(0, 10));
        await expect(page.getByTestId("revision-search-result").first()).toBeVisible();
        await shot("01-edition-et-recherche");
        await page.getByTestId("revision-search-result").filter({ hasText: extra.name }).first().getByTestId("revision-add").click();
        await page.waitForTimeout(400);
        await shot("02-edition-ecarts-marques");

        const address = page.url().split("#")[1];
        await open(address);
        await expect(page.getByTestId("revision-banner")).toBeVisible();
        await page.waitForTimeout(800);
        await shot("03-revision-relue-depuis-l-adresse");

        await open(`${address};abc=1;999999999=1`);
        await expect(page.getByTestId("revision-notices")).toBeVisible();
        await shot("04-ecarts-ignores");
      } finally {
        await context.close();
      }
    });
  });
}
