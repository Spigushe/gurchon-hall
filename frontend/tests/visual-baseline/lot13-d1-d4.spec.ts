import { mkdirSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import {
  CARDS,
  cardInfo,
  cardSetOptionLabel,
  cardSets,
  expectCatalogDownloaded,
  expectSynced,
  openStockForm,
} from "../e2e-real/support/app";
import { expect, test } from "../e2e-real/support/backend";
import { FRONTEND_DIR } from "../e2e-real/support/env";
import { openAppAt } from "../e2e-real/support/play";

/**
 * Captures des exports `TEXT` / `TWD` / `JOL` / `LACKEY` (D1) et de l'art de
 * l'extension dans la Collection (D4) du Lot 13, `docs/lot13-plan-partage.md`,
 * à 390 et 1440 px, contre un vrai back.
 *
 * Outil de capture, comme `lot12-d1.spec.ts` : aucune assertion sur les
 * images. Sortie : `docs/qa-baselines/lot13-d1-d4/<largeur>/`. Les images de
 * cartes viennent de krcg : elles ne s'affichent que si la machine joint
 * static.krcg.org ; sinon la capture montre le pictogramme de repli.
 *
 *     npm run build:e2e
 *     npx playwright test --config tests/visual-baseline/playwright.config.ts lot13-d1-d4
 */

const ROOT = path.join(FRONTEND_DIR, "..", "docs", "qa-baselines", "lot13-d1-d4");

const go = (page: Page, hash: string) =>
  page.evaluate((target) => {
    window.location.hash = target;
  }, hash);

/** Laisse une image distante se charger (ou échouer) avant la capture. */
const settleImages = (page: Page) => page.waitForTimeout(2500);

for (const width of [
  { desktop: false, label: "mobile-390x844", viewport: { width: 390, height: 844 } },
  { desktop: true, label: "desktop-1440x900", viewport: { width: 1440, height: 900 } },
]) {
  test.describe(width.label, () => {
    test.use({ viewport: width.viewport });

    test(`captures D1 et D4 à ${width.label}`, async ({ page, context, api }) => {
      await api.get("/moi");
      const out = path.join(ROOT, width.label);
      mkdirSync(out, { recursive: true });
      const shot = (name: string, fullPage = false) => page.screenshot({ path: path.join(out, `${name}.png`), fullPage });

      // Un deck de tout le catalogue d'essai, joué à un tournoi de 13 joueurs : sa version v1 est liée au tournoi.
      const catalog = await api.get<Array<{ id: number; latest_card_set_id: number }>>("/cartes?limit=50");
      const deck = await api.post<{ id: number; discriminator: string }>(
        "/decks",
        { name: "Banu Princes", proxy_allowed: true },
        201,
      );
      for (const card of catalog.filter((entry) => entry.latest_card_set_id !== null)) {
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
      const venue = await api.post<{ id: number }>("/lieux", { name: "Le Repaire", city: "Lyon" }, 201);
      const tournament = await api.post<{ id: number }>(
        "/tournois",
        {
          name: "Championnat de Lyon",
          start_date: "2026-10-24",
          venue: { venue_id: venue.id },
          player_count: 13,
        },
        201,
      );
      await api.post(
        "/parties",
        {
          played_at: "2026-10-24T14:00:00Z",
          tournament: { tournament_id: tournament.id },
          round_number: 1,
          round_type: "preliminary",
          player_count: 5,
          participations: [{ player: { me: true }, deck: { deck_id: deck.id }, victory_points: 2, game_win: true }],
        },
        201,
      );

      // Collection : Awe sous deux extensions, pour l'aperçu et la feuille d'entrée.
      const awe = await cardInfo(api, CARDS.awe);
      const [firstSetId, secondSetId] = awe.card_set_ids;
      for (const cardSetId of [firstSetId, secondSetId]) {
        await api.post("/stock", { card_id: awe.id, language_code: "EN", card_set_id: cardSetId, quantity_owned: 1 }, 201);
      }
      const sets = new Map((await cardSets(api)).map((set) => [set.id, set]));
      const secondLabel = cardSetOptionLabel(sets.get(secondSetId)!);

      await openAppAt(page, width.desktop);
      await expectCatalogDownloaded(page);
      await expectSynced(page);

      // 1. Export depuis un deck : TEXT puis les trois autres formats.
      await go(page, `#/decks/id:${deck.id}`);
      await page.getByTestId("deck-export").click();
      await expect(page.getByTestId("deck-export-text")).toBeVisible();
      await shot("01-export-deck-text");
      await page.getByTestId("deck-export-format-twd").click();
      await expect(page.getByTestId("deck-export-text")).toHaveValue(/^\[Event Name\]/);
      await shot("02-export-deck-twd");
      await page.getByTestId("deck-export-format-jol").click();
      await shot("03-export-deck-jol");
      await page.getByTestId("deck-export-format-lackey").click();
      await shot("04-export-deck-lackey");
      await page.getByTestId("deck-export-format-text").click(); // remet le défaut mémorisé
      await page.keyboard.press("Escape");

      // 2. Export de la version jouée en tournoi : l'en-tête du TWD est rempli.
      await go(page, `#/decks/id:${deck.id}/versions/1`);
      await expect(page.getByTestId("deck-version-title")).toContainText("v1");
      await page.getByTestId("deck-version-export").click();
      await page.getByTestId("deck-export-format-twd").click();
      await expect(page.getByTestId("deck-export-text")).toHaveValue(/^Championnat de Lyon\nLe Repaire, Lyon\n2026-10-24\n13\n/);
      await shot("05-export-version-twd-tournoi");
      await page.getByTestId("deck-export-format-text").click();
      await page.keyboard.press("Escape");

      // 3. Collection : aperçu au survol (bureau seulement : pas d'image dans la liste mobile).
      await go(page, "#/collection");
      await expect(page.getByTestId("stock-page")).toBeVisible();
      await expect(page.getByTestId("stock-entry").first()).toBeVisible();
      if (width.desktop) {
        const name = page.getByTestId("stock-entry-name").first();
        await name.hover();
        await expect(page.getByTestId("stock-table-preview")).toBeVisible();
        await settleImages(page);
        await shot("06-collection-apercu-en-ligne");
        await page.mouse.move(0, 0);
        await context.setOffline(true);
        await name.hover();
        await expect(page.getByTestId("stock-table-preview")).toBeVisible();
        await shot("07-collection-apercu-hors-ligne");
        await context.setOffline(false);
        await page.mouse.move(0, 0);
      } else {
        await shot("06-collection-liste-sans-image", true);
      }

      // 4. Feuille d'entrée en création : l'image suit l'extension choisie.
      if (width.desktop) await page.getByTestId("stock-add-desktop").click();
      else await openStockForm(page);
      const form = page.getByTestId("stock-form");
      await form.getByLabel("Rechercher une carte").fill("awe");
      await form.getByTestId("card-picker-option").filter({ hasText: CARDS.awe }).first().click();
      await form.getByRole("spinbutton", { name: "Exemplaires possédés" }).fill("2");
      await settleImages(page);
      await shot("08-feuille-creation-extension-recente");
      await form.getByTestId("stock-form-card-set").selectOption({ label: secondLabel });
      await settleImages(page);
      await shot("09-feuille-creation-extension-changee");
      if (!width.desktop) {
        await form.getByTestId("stock-form-image").getByRole("button").click();
        await shot("10-feuille-creation-image-agrandie");
      }
      await page.keyboard.press("Escape");

      // 5. Feuille d'entrée en modification.
      await go(page, "#/collection");
      await page.getByRole("button", { name: /^Modifier Awe/ }).first().click();
      await expect(page.getByTestId("stock-form")).toBeVisible();
      await settleImages(page);
      await shot("11-feuille-modification");
      if (!width.desktop) {
        await page.getByTestId("stock-form-image").getByRole("button").click();
        await shot("12-feuille-modification-image-agrandie");
      }

      // 6. Feuille d'entrée hors ligne : pas d'image (mobile) ou pictogramme (bureau).
      await context.setOffline(true);
      await shot("13-feuille-modification-hors-ligne");
    });
  });
}
