import { mkdirSync } from "node:fs";
import path from "node:path";
import { expectCatalogDownloaded, expectSynced } from "../e2e-real/support/app";
import { expect, test } from "../e2e-real/support/backend";
import { WEB_ORIGIN, FRONTEND_DIR } from "../e2e-real/support/env";
import { openAppAt } from "../e2e-real/support/play";

/**
 * Captures de la page publique d'une liste partagée (Lot 13, D3,
 * `docs/lot13-plan-partage.md`) à 390 et 1440 px, contre un vrai back : liste
 * vivante sans notes, liste figée avec notes, feuille d'export depuis la page,
 * « Liste introuvable », hors ligne.
 *
 * Outil de capture, comme `lot13-d1-d4.spec.ts` : aucune assertion sur les
 * images. Sortie : `docs/qa-baselines/lot13-d3/<largeur>/`.
 *
 *     npm run build:e2e
 *     npx playwright test --config tests/visual-baseline/playwright.config.ts lot13-d3
 */

const ROOT = path.join(FRONTEND_DIR, "..", "docs", "qa-baselines", "lot13-d3");

interface CatalogCard {
  id: number;
  latest_card_set_id: number | null;
}

for (const width of [
  { desktop: false, label: "mobile-390x844", viewport: { width: 390, height: 844 } },
  { desktop: true, label: "desktop-1440x900", viewport: { width: 1440, height: 900 } },
]) {
  test.describe(width.label, () => {
    test.use({ viewport: width.viewport });
    test.setTimeout(240_000);

    test(`captures D3 à ${width.label}`, async ({ browser, page, api }) => {
      await api.get("/moi");
      const out = path.join(ROOT, width.label);
      mkdirSync(out, { recursive: true });

      const catalog = (await api.get<CatalogCard[]>("/cartes?limit=50")).filter((card) => card.latest_card_set_id !== null);
      const deck = await api.post<{ id: number }>(
        "/decks",
        {
          name: "Banu Princes",
          archetype: "bleed",
          notes: "Un deck de saignement.\nÀ jouer avec trois proies au moins.",
          proxy_allowed: true,
        },
        201,
      );
      for (const card of catalog) {
        await api.post(
          `/decks/${deck.id}/cartes`,
          { card_id: card.id, language_code: "EN", card_set_id: card.latest_card_set_id, quantity: 2, proxy_quantity: 2 },
          201,
        );
      }
      const live = await api.post<{ token: string }>(`/decks/${deck.id}/partages`, { kind: "live" }, 201);
      const frozen = await api.post<{ token: string }>(`/decks/${deck.id}/partages`, { kind: "frozen", show_notes: true }, 201);

      const context = await browser.newContext({ baseURL: WEB_ORIGIN, viewport: width.viewport });
      try {
        const page = await context.newPage();
        const shot = (name: string, fullPage = true) => page.screenshot({ path: path.join(out, `${name}.png`), fullPage });
        const open = async (token: string) => {
          await page.goto(`/#/liste/${token}`);
          await page.reload();
        };

        await open(live.token);
        await expect(page.getByTestId("deck-tables")).toBeVisible();
        await page.waitForTimeout(800);
        await shot("01-liste-vivante-sans-notes");

        await open(frozen.token);
        await expect(page.getByTestId("public-list-frozen")).toBeVisible();
        await page.waitForTimeout(800);
        await shot("02-liste-figee-avec-notes");

        await page.getByTestId("public-list-export").click();
        await expect(page.getByTestId("deck-export-text")).toBeVisible();
        await page.waitForTimeout(600);
        await shot("03-feuille-export", false);
        await page.getByTestId("deck-export-format-twd").click();
        await shot("04-feuille-export-twd", false);
        await page.getByTestId("deck-export-format-text").click();
        await page.keyboard.press("Escape");

        await open("Zz9_Zz9_");
        await expect(page.getByTestId("public-list-not-found")).toBeVisible();
        await shot("05-liste-introuvable", false);

        // Hors ligne : la coquille vient du precache, la liste demande le réseau.
        await open(live.token);
        await page.evaluate(async () => {
          await navigator.serviceWorker.ready;
        });
        await page.reload();
        await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
        await context.setOffline(true);
        await open("Qq7_Qq7_");
        await expect(page.getByTestId("public-list-offline")).toBeVisible();
        await shot("06-hors-ligne", false);
      } finally {
        await context.close();
      }

      // Dans l'application : détail du même deck (la crypte, sans débordement), puis, au bureau,
      // la barre haute avec l'alerte « serveur injoignable ».
      await openAppAt(page, width.desktop);
      await expectCatalogDownloaded(page);
      await expectSynced(page);
      await page.evaluate((target) => {
        window.location.hash = target;
      }, `#/decks/id:${deck.id}`);
      await expect(page.getByTestId("deck-tables-crypt")).toBeVisible();
      await page.waitForTimeout(800);
      await page.getByTestId("deck-tables").screenshot({ path: path.join(out, "07-application-detail-deck.png") });
      if (width.desktop) {
        await page.route("**/sync", (route) => route.abort());
        await page.getByTestId("deck-status-toggle").click();
        await expect(page.getByTestId("topbar-sync-alert")).toBeVisible();
        await page.screenshot({ path: path.join(out, "08-barre-haute-alerte.png"), clip: { x: 0, y: 0, width: 1440, height: 120 } });
        await page.unroute("**/sync");
      }
    });
  });
}
