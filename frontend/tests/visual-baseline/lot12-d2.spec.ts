import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { CARDS, addStock, cardInfo, expectPending, expectSynced, goToStock, openApp } from "../e2e-real/support/app";
import { expect, test } from "../e2e-real/support/backend";
import { FRONTEND_DIR } from "../e2e-real/support/env";
import { openAppDesktop } from "../e2e-desktop-real/support/nav";

/**
 * Captures de l'étape D2 du Lot 12 (`docs/lot12-plan-consolidation.md`) :
 * bandeau « nouvelle version », légende `?` et « Catalogue en cours de
 * chargement », à 390 et 1440 px, contre un vrai back : à comparer au handoff
 * (`docs/design-handoff/LOT12.md`, 1b-72 à 1b-78, d44 à d49).
 *
 * Le bandeau vient d'une vraie mise à jour : `dist-real/sw.js` est réécrit
 * d'une ligne le temps que la page demande une vérification ; la nouvelle
 * version s'installe et attend (mode `prompt`). Le catalogue est retenu par
 * une route Playwright, le temps de la capture.
 *
 * Outil de capture, sans assertion sur les images. Sortie :
 * `docs/qa-baselines/lot12-d2/<largeur>/`.
 *
 *     npm run build:e2e
 *     npx playwright test --config tests/visual-baseline/playwright.config.ts lot12-d2
 */

const ROOT = path.join(FRONTEND_DIR, "..", "docs", "qa-baselines", "lot12-d2");

const go = (page: Page, hash: string) =>
  page.evaluate((target) => {
    window.location.hash = target;
  }, hash);

const SW_PATH = path.join(FRONTEND_DIR, "dist-real", "sw.js");

/** La page est contrôlée par son service worker (sans dépendre du titre, masqué au bureau). */
async function waitForControl(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  await expect(page.getByTestId("home-page")).toBeVisible();
}

/**
 * Fait servir un service worker « nouveau » et le fait installer : le bandeau
 * apparaît. Une route Playwright ne suffit pas, elle ne voit pas la lecture du
 * script du service worker par le navigateur : le fichier est réécrit d'une
 * ligne sur disque, puis rendu tel quel.
 */
async function offerNewVersion(page: Page): Promise<void> {
  const original = readFileSync(SW_PATH, "utf-8");
  writeFileSync(SW_PATH, `${original}\n// version suivante\n`);
  try {
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      await registration?.update();
    });
    await expect(page.getByTestId("app-update-banner")).toBeVisible({ timeout: 20_000 });
  } finally {
    writeFileSync(SW_PATH, original);
  }
}

for (const width of [
  { desktop: false, label: "mobile-390x844", viewport: { width: 390, height: 844 } },
  { desktop: true, label: "desktop-1440x900", viewport: { width: 1440, height: 900 } },
]) {
  test.describe(width.label, () => {
    test.use({ viewport: width.viewport });

    test(`captures D2 à ${width.label}`, async ({ page, context, api }) => {
      const out = path.join(ROOT, width.label);
      mkdirSync(out, { recursive: true });
      const shot = (name: string, fullPage = false) =>
        // Animations figées : le panneau latéral se capture ouvert, pas en fondu.
        page.screenshot({ path: path.join(out, `${name}.png`), fullPage, animations: "disabled" });

      // Deux decks joués en proxy, pour la liste et l'aperçu.
      const cards = [await cardInfo(api, CARDS.awe), await cardInfo(api, CARDS.tarbaby)];
      for (const [name, archetype] of [
        ["Banu Princes", "bleed"],
        ["Toreador Mass Vote", "vote"],
      ]) {
        const deck = await api.post<{ id: number }>("/decks", { name, proxy_allowed: true, archetype }, 201);
        for (const card of cards) {
          await api.post(
            `/decks/${deck.id}/cartes`,
            {
              card_id: card.id,
              language_code: "EN",
              card_set_id: card.latest_card_set_id,
              quantity: 2,
              proxy_quantity: 2,
            },
            201,
          );
        }
      }

      // Catalogue retenu à la première lecture (1b-77, 1b-78, d49).
      let releaseCatalog = () => {};
      const held = new Promise<void>((resolve) => {
        releaseCatalog = resolve;
      });
      await context.route("**/cartes?*", async (route) => {
        await held;
        // Une lecture déjà relâchée par `unroute` ne se reprend pas deux fois.
        await route.continue().catch(() => {});
      });
      if (width.desktop) await openAppDesktop(page);
      else await openApp(page);
      await go(page, "#/decks");
      await expect(page.getByTestId("catalog-loading").first()).toBeVisible();
      await shot("01-catalogue-decks");
      if (!width.desktop) {
        await page.getByTestId("deck-link").first().click();
        await expect(page.getByTestId("catalog-loading-composition")).toBeVisible();
        await shot("02-catalogue-deck");
      }
      releaseCatalog();
      await context.unroute("**/cartes?*");
      await expect(page.getByTestId("catalog-loading")).toHaveCount(0, { timeout: 30_000 });
      await expectSynced(page);

      // Légende des raccourcis (bureau, d44 à d46).
      if (width.desktop) {
        await go(page, "#/decks");
        await expect(page.getByTestId("decks-detail-title")).toBeVisible();
        await page.keyboard.press("?");
        await expect(page.getByTestId("shortcuts-legend")).toBeVisible();
        await shot("03-raccourcis-decks");
        await page.keyboard.press("Escape");

        await go(page, "#/chercher");
        await expect(page.getByTestId("search-page")).toBeVisible();
        await page.locator("body").click({ position: { x: 5, y: 300 } });
        await page.keyboard.press("?");
        await expect(page.getByTestId("shortcuts-legend")).toBeVisible();
        await shot("04-raccourcis-chercher");
        await page.keyboard.press("Escape");

        await page.getByTestId("account-menu-toggle").click();
        await expect(page.getByTestId("account-menu-panel")).toBeVisible();
        await shot("05-menu-raccourcis");
        await page.getByTestId("account-menu-account").click();
        await expect(page.getByTestId("account-page")).toBeVisible();
        await page.getByTestId("account-menu-toggle").click();
        await page.getByTestId("account-menu-shortcuts").click();
        await expect(page.getByTestId("shortcuts-legend")).toBeVisible();
        await shot("06-raccourcis-compte");
        await page.keyboard.press("Escape");
      }

      // Bandeau « nouvelle version » (1b-72 à 1b-75, d47, d48).
      await go(page, "#/");
      await waitForControl(page);
      await offerNewVersion(page);
      await expect(page.getByTestId("app-update-banner")).toHaveAttribute("data-state", "ready");
      await shot("07-maj-disponible");

      await context.setOffline(true);
      if (width.desktop) {
        await go(page, "#/collection");
        await page.getByTestId("stock-add-desktop").click();
      } else {
        await goToStock(page);
      }
      await addStock(page, { search: "awe", card: CARDS.awe, quantity: 1, language: "EN" });
      await page.keyboard.press("Escape");
      await expectPending(page, 1);
      await go(page, "#/");
      await expect(page.getByTestId("app-update-banner")).toHaveAttribute("data-state", "waiting");
      await shot("08-maj-en-attente-hors-ligne");

      await context.setOffline(false);
      await expectSynced(page);
      await expect(page.getByTestId("app-update-banner")).toHaveAttribute("data-state", "ready");
      await shot("09-maj-de-nouveau-prete");
    });
  });
}
