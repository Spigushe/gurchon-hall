import { mkdirSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { CARDS, addStock, expectPending, expectSynced, goToStock, openApp } from "../e2e-real/support/app";
import { TEST_ACCOUNT, expect, test } from "../e2e-real/support/backend";
import { API_URL, FRONTEND_DIR } from "../e2e-real/support/env";
import { openAppDesktop } from "../e2e-desktop-real/support/nav";

/**
 * Captures de l'écran Compte et de l'accès à Synchronisation (Lot 12, étapes
 * D1 et D5, `docs/lot12-plan-consolidation.md`), à 390 et 1440 px, contre un
 * vrai back : à comparer au handoff (`docs/design-handoff/LOT12.md`, 1b-59 à
 * 1b-71, d35 à d43).
 *
 * Outil de capture, comme `lot12-d4.spec.ts` : aucune assertion sur les
 * images. Sortie : `docs/qa-baselines/lot12-d1/<largeur>/`.
 *
 *     npm run build:e2e
 *     npx playwright test --config tests/visual-baseline/playwright.config.ts lot12-d1
 */

const ROOT = path.join(FRONTEND_DIR, "..", "docs", "qa-baselines", "lot12-d1");

const go = (page: Page, hash: string) =>
  page.evaluate((target) => {
    window.location.hash = target;
  }, hash);

async function openAccountAt(page: Page, desktop: boolean): Promise<void> {
  if (desktop) {
    await page.getByTestId("account-menu-toggle").click();
    await page.getByTestId("account-menu-account").click();
  } else {
    await page.getByTestId("account-menu-link").click();
  }
  await expect(page.getByTestId("account-page")).toBeVisible();
  await expect(page.getByTestId("account-session").first()).toBeVisible();
}

for (const width of [
  { desktop: false, label: "mobile-390x844", viewport: { width: 390, height: 844 } },
  { desktop: true, label: "desktop-1440x900", viewport: { width: 1440, height: 900 } },
]) {
  test.describe(width.label, () => {
    test.use({ viewport: width.viewport });

    test(`captures D1 et D5 à ${width.label}`, async ({ page, context, browser, api }) => {
      // La fixture `api` démarre le back du test sur une base neuve, compte de test compris.
      await api.get("/moi");
      const out = path.join(ROOT, width.label);
      mkdirSync(out, { recursive: true });
      const shot = (name: string, fullPage = !width.desktop) =>
        page.screenshot({ path: path.join(out, `${name}.png`), fullPage });

      // Deux autres appareils connectés au même compte, pour que la liste ait de quoi montrer.
      for (const userAgent of [
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0",
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
      ]) {
        const other = await browser.newContext({ userAgent });
        // Sans échec sur un refus : la limite de débit de la connexion ne doit pas arrêter les captures.
        await other.request.post(`${API_URL.replace("localhost", "127.0.0.1")}/connexion`, {
          data: { email: TEST_ACCOUNT.email, password: TEST_ACCOUNT.password },
          failOnStatusCode: false,
        });
        await other.close();
      }

      if (width.desktop) await openAppDesktop(page);
      else await openApp(page);
      await expectSynced(page);

      // Menu du compte (bureau, d36).
      if (width.desktop) {
        await page.getByTestId("account-menu-toggle").click();
        await expect(page.getByTestId("account-menu-panel")).toBeVisible();
        await shot("01-menu-compte", false);
        await page.keyboard.press("Escape");
      }

      // Compte (1b-59, 1b-60, d35).
      await openAccountAt(page, width.desktop);
      await expect(page.getByTestId("account-versions")).toContainText("Serveur");
      await shot("02-compte");

      // Mot de passe : vide, en saisie, actuel incorrect (1b-65 à 1b-67, d38, d39).
      await page.getByTestId("account-password-open").click();
      const sheet = page.getByTestId("change-password-sheet");
      await expect(sheet).toBeVisible();
      await shot("03-mdp-vide", false);
      await sheet.getByTestId("change-password-current").fill("Mauvais-Mot-2passe");
      await sheet.getByTestId("change-password-new").fill("Nuit-de-Lyon7");
      await shot("04-mdp-saisie", false);
      await sheet.getByTestId("change-password-confirm").fill("Nuit-de-Lyon7");
      await sheet.getByTestId("change-password-submit").click();
      await expect(sheet.getByTestId("change-password-current-error")).toBeVisible();
      await shot("05-mdp-actuel-incorrect", false);
      await page.keyboard.press("Escape");

      // Session fermée, puis « fermer les autres » en confirmation (1b-62, 1b-63, d42, d43).
      const others = page.getByTestId("account-session-close");
      if ((await others.count()) > 1) {
        await others.first().click();
        await expect(page.getByTestId("account-sessions-feedback")).toBeVisible();
        await shot("06-session-fermee");
      }
      if ((await page.getByTestId("account-sessions-close-others").count()) > 0) {
        await page.getByTestId("account-sessions-close-others").click();
        await expect(page.getByTestId("account-sessions-close-others-warning")).toBeVisible();
        await shot("07-fermer-autres");
        await page.getByTestId("account-sessions-close-others-cancel").click();
      }

      // Hors ligne, avec une saisie en file (1b-61, d37, 1b-70) ; Atelier et Synchronisation (D5).
      await context.setOffline(true);
      // La saisie passe par les aides du mobile ; au bureau, le réseau coupé suffit.
      if (!width.desktop) {
        await goToStock(page);
        await addStock(page, { search: "awe", card: CARDS.awe, quantity: 1, language: "EN" });
        await page.keyboard.press("Escape");
        await expectPending(page, 1);
      }
      await go(page, "#/compte");
      await expect(page.getByTestId("account-sessions-offline")).toBeVisible();
      await shot("08-compte-hors-ligne");
      if (!width.desktop) {
        await go(page, "#/");
        await expect(page.getByTestId("sync-alert")).toBeVisible();
        await shot("09-atelier-alerte-sans-lien", false);
      }
      await go(page, "#/compte");
      await page.getByTestId("account-sync-row").click();
      await expect(page.getByTestId("sync-back")).toBeVisible();
      await shot("10-synchronisation-retour", false);
      await context.setOffline(false);
    });
  });
}
