import { mkdirSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { expectSynced } from "../e2e-real/support/app";
import { expect, test } from "../e2e-real/support/backend";
import { FRONTEND_DIR } from "../e2e-real/support/env";
import { openAppAt } from "../e2e-real/support/play";

/**
 * Captures de la feuille de partage et de « Listes partagées » (D2) du Lot 13,
 * `docs/lot13-plan-partage.md`, à 390 et 1440 px, contre un vrai back.
 *
 * Outil de capture, comme `lot13-d1-d4.spec.ts` : aucune assertion sur les
 * images. Sortie : `docs/qa-baselines/lot13-d2/<largeur>/`.
 *
 *     npm run build:e2e
 *     npx playwright test --config tests/visual-baseline/playwright.config.ts lot13-d2
 */

const ROOT = path.join(FRONTEND_DIR, "..", "docs", "qa-baselines", "lot13-d2");

const go = (page: Page, hash: string) =>
  page.evaluate((target) => {
    window.location.hash = target;
  }, hash);

interface DeckRow {
  id: number;
}

for (const width of [
  { desktop: false, label: "mobile-390x844", viewport: { width: 390, height: 844 } },
  { desktop: true, label: "desktop-1440x900", viewport: { width: 1440, height: 900 } },
]) {
  test.describe(width.label, () => {
    test.use({ viewport: width.viewport });

    test(`captures D2 à ${width.label}`, async ({ page, api }) => {
      await api.get("/moi");
      const out = path.join(ROOT, width.label);
      mkdirSync(out, { recursive: true });
      // Une capture pleine page redimensionne la fenêtre, ce qui remonte l'écran Compte au bureau et lui
      // fait perdre sa confirmation en cours : au bureau, la capture reste à 1440 x 900, section amenée dans la vue.
      const shot = async (name: string, fullPage = false) => {
        // La feuille s'ouvre en glissant : on attend la fin de la transition (opacité et position stables).
        if ((await page.getByTestId("share-sheet").count()) > 0) {
          await page.waitForFunction(() => {
            const sheet = document.querySelector('[data-testid="share-sheet"]');
            if (!sheet) return true;
            const style = getComputedStyle(sheet);
            return style.opacity === "1" && (style.transform === "none" || style.transform === "matrix(1, 0, 0, 1, 0, 0)");
          });
          await page.waitForTimeout(300);
        }
        if (width.desktop && fullPage) {
          const section = page.getByTestId("account-shares");
          if ((await section.count()) > 0) await section.scrollIntoViewIfNeeded();
          return page.screenshot({ path: path.join(out, `${name}.png`) });
        }
        return page.screenshot({ path: path.join(out, `${name}.png`), fullPage });
      };

      // Un deck complet, avec archétype et notes, joué une fois (sa version v1 se partage).
      const catalog = await api.get<Array<{ id: number; latest_card_set_id: number | null }>>("/cartes?limit=50");
      const deck = await api.post<DeckRow>(
        "/decks",
        {
          name: "Banu Princes",
          archetype: "bleed",
          notes: "Auteur : Léa\nSaignée en milieu de partie, puis un mur de Deflection.",
          proxy_allowed: true,
        },
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
      await api.post(
        "/parties",
        {
          played_at: "2026-10-24T14:00:00Z",
          player_count: 5,
          participations: [{ player: { me: true }, deck: { deck_id: deck.id }, victory_points: 2, game_win: true }],
        },
        201,
      );
      // Deux liens déjà créés sur ce deck : un vivant, un figé de la version v1.
      await api.post(`/decks/${deck.id}/partages`, { kind: "live" }, 201);
      await api.post(`/decks/${deck.id}/partages`, { kind: "frozen", show_notes: true, deck_version_number: 1 }, 201);

      // Un deck archivé avec deux figés et un vivant : la confirmation de sa suppression en tient compte.
      const archived = await api.post<DeckRow>("/decks", { name: "Toreador Rush", archetype: "rush" }, 201);
      await api.post(`/decks/${archived.id}/partages`, { kind: "live" }, 201);
      await api.post(`/decks/${archived.id}/partages`, { kind: "frozen" }, 201);
      await api.post(`/decks/${archived.id}/partages`, { kind: "frozen", show_notes: true }, 201);
      await api.patch(`/decks/${archived.id}`, { archived: true });

      // Un deck supprimé qui garde un figé : sa ligne de l'écran Compte n'a pas de case.
      const gone = await api.post<DeckRow>("/decks", { name: "Ventrue Ancien", archetype: "wall" }, 201);
      await api.post(`/decks/${gone.id}/partages`, { kind: "frozen" }, 201);
      await api.patch(`/decks/${gone.id}`, { archived: true });

      // Un deck neuf, sans lien, pour la feuille vide.
      const fresh = await api.post<DeckRow>(
        "/decks",
        { name: "Malkavien 2022", archetype: "toolbox", notes: "Remarque privée sur la table." },
        201,
      );

      await openAppAt(page, width.desktop);
      await expect(page.getByTestId("catalog-state")).toHaveAttribute("data-count", "10", { timeout: 60_000 });
      await expectSynced(page);

      // La suppression passe par l'application : le figé reste, le vivant tombe.
      await go(page, `#/decks/id:${gone.id}`);
      await page.getByTestId("deck-delete").click();
      await expect(page.getByTestId("deck-delete-shares")).toContainText("1 lien figé restera public");
      await page.getByTestId("deck-delete-confirm").click();
      await expectSynced(page);

      // 1. Feuille d'un deck sans lien : aperçu, notes masquées, puis figé avec notes.
      await go(page, `#/decks/id:${fresh.id}`);
      await page.getByTestId("deck-share").click();
      await expect(page.getByTestId("share-empty")).toBeVisible();
      await expect(page.getByTestId("share-preview-author")).toContainText("@");
      await shot("01-feuille-vide-apercu-sans-notes");
      await page.getByTestId("share-kind-frozen").click();
      await page.getByTestId("share-show-notes").check();
      await expect(page.getByTestId("share-preview-notes")).toContainText("Remarque privée");
      await shot("02-apercu-fige-avec-notes");
      await page.keyboard.press("Escape");

      // 2. Feuille d'un deck qui a deux liens, puis la confirmation d'une purge.
      await go(page, `#/decks/id:${deck.id}`);
      await page.getByTestId("deck-share").click();
      await expect(page.getByTestId("share-row")).toHaveCount(2);
      await shot("03-feuille-avec-liens");
      await page.getByTestId("share-select").first().check();
      await page.getByTestId("share-purge").click();
      await expect(page.getByTestId("share-purge-warning")).toBeVisible();
      await shot("04-feuille-purge-confirmation");
      await page.getByTestId("share-purge-cancel").click();
      await page.keyboard.press("Escape");

      // 3. Un figé attend la file du deck : une modification coincée hors réseau.
      await page.route("**/sync", (route) => route.abort());
      await page.getByTestId("deck-status-toggle").click();
      await expect(page.getByTestId("pending-badge")).toBeVisible();
      await page.getByTestId("deck-share").click();
      await page.getByTestId("share-kind-frozen").click();
      await expect(page.getByTestId("share-blocked")).toContainText("à synchroniser avant de figer la liste");
      await shot("05-fige-bloque-par-la-file");
      await page.keyboard.press("Escape");
      await page.unroute("**/sync");

      // 4. Depuis la liste d'une version jouée.
      await go(page, `#/decks/id:${deck.id}/versions/1`);
      await page.getByTestId("deck-version-share").click();
      await expect(page.getByTestId("share-from-version")).toBeVisible();
      await shot("06-feuille-version-jouee");
      await page.keyboard.press("Escape");

      // 5. Écran Compte : tous les liens, ceux du deck supprimé à part, puis deux confirmations.
      await go(page, "#/compte");
      await expect(page.getByTestId("account-shares-group").first()).toBeVisible();
      await expect(page.getByTestId("account-shares-deleted")).toBeVisible();
      await shot("07-compte-listes-partagees", true);
      await page.getByTestId("account-shares-select").nth(1).check();
      await page.getByTestId("account-shares-purge-selected").click();
      await expect(page.getByTestId("account-shares-purge-warning")).toBeVisible();
      await shot("08-compte-purge-selection-confirmation", true);
      await page.getByTestId("account-shares-purge-cancel").click();
      await page.getByTestId("account-shares-purge-deleted_decks").click();
      await expect(page.getByTestId("account-shares-purge-warning")).toContainText("supprimés");
      await shot("09-compte-purge-decks-supprimes-confirmation", true);
      await page.getByTestId("account-shares-purge-cancel").click();

      // 6. Confirmation de suppression d'un deck archivé qui a des liens figés.
      await go(page, `#/decks/id:${archived.id}`);
      await page.getByTestId("deck-delete").click();
      await expect(page.getByTestId("deck-delete-shares")).toContainText("2 liens figés resteront publics");
      await shot("10-suppression-deck-avec-figes", true);
    });
  });
}
