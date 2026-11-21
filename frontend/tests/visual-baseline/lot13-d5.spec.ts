import { mkdirSync } from "node:fs";
import path from "node:path";
import { expectCatalogDownloaded, expectSynced } from "../e2e-real/support/app";
import { expect, test } from "../e2e-real/support/backend";
import { FRONTEND_DIR } from "../e2e-real/support/env";
import { openAppAt } from "../e2e-real/support/play";

/**
 * Captures de « Dupliquer » et « Comparer » une liste partagée (Lot 13, D5,
 * `docs/lot13-plan-partage.md`) à 390 et 1440 px, contre un vrai back : feuille de duplication,
 * feuille de choix du deck, écran de comparaison (listes différentes, puis avec une révision),
 * message hors ligne. Le propriétaire duplique son propre lien (P7 l'autorise), ce qui évite un
 * second compte.
 *
 * Outil de capture, comme `lot13-d3.spec.ts` : aucune assertion sur les images. Sortie :
 * `docs/qa-baselines/lot13-d5/<largeur>/`.
 *
 *     npm run build:e2e
 *     npx playwright test --config tests/visual-baseline/playwright.config.ts lot13-d5
 */

const ROOT = path.join(FRONTEND_DIR, "..", "docs", "qa-baselines", "lot13-d5");

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

    test(`captures D5 à ${width.label}`, async ({ page, context, api }) => {
      await api.get("/moi");
      const out = path.join(ROOT, width.label);
      mkdirSync(out, { recursive: true });

      const catalog = (await api.get<CatalogCard[]>("/cartes?limit=50")).filter((card) => card.latest_card_set_id !== null);
      const deck = await api.post<{ id: number }>(
        "/decks",
        { name: "Banu Princes", archetype: "bleed", notes: "Un deck de saignement.", proxy_allowed: true },
        201,
      );
      for (const card of catalog.slice(0, 5)) {
        await api.post(
          `/decks/${deck.id}/cartes`,
          { card_id: card.id, language_code: "EN", card_set_id: card.latest_card_set_id, quantity: 2, proxy_quantity: 2 },
          201,
        );
      }
      const share = await api.post<{ token: string }>(`/decks/${deck.id}/partages`, { kind: "live", show_notes: true }, 201);

      await openAppAt(page, width.desktop);
      await expectCatalogDownloaded(page);
      await expectSynced(page);
      const shot = async (name: string, fullPage = false) => {
        await page.waitForTimeout(700);
        await page.screenshot({ path: path.join(out, `${name}.png`), fullPage });
      };
      const go = async (hash: string) => {
        await page.evaluate((target) => {
          window.location.hash = target;
        }, hash);
      };

      // Dupliquer : la feuille d'aperçu, puis une carte inconnue du miroir (révision qui en ajoute une).
      await go(`#/decks?action=dupliquer&liste=${share.token}`);
      await expect(page.getByTestId("list-duplicate-create")).toBeEnabled({ timeout: 30_000 });
      await shot("01-dupliquer-apercu");
      await go(`#/decks?action=dupliquer&liste=${share.token}&revision=999999=1`);
      await shot("02-dupliquer-revision-carte-inconnue");
      await page.keyboard.press("Escape");

      // Comparer : choix du deck, puis l'écran.
      await go(`#/decks?action=comparer&liste=${share.token}`);
      await expect(page.getByTestId("list-compare-choose").first()).toBeVisible();
      await shot("03-comparer-choix-du-deck");
      await page.keyboard.press("Escape");
      await go(`#/decks/id:${deck.id}/comparer/${share.token}`);
      await expect(page.getByTestId("compare-identical")).toBeVisible();
      await shot("04-comparer-identiques", true);
      await go(`#/decks/id:${deck.id}/comparer/${share.token}?revision=${catalog[0].id}=1;${catalog[1].id}=-2;${catalog[5].id}=2`);
      await expect(page.getByTestId("compare-different-qty")).toBeVisible();
      await shot("05-comparer-revision", true);

      // Hors ligne : la liste demande le réseau. Un lien jamais lu : la réponse
      // publique se met en cache 60 s (`Cache-Control: public, max-age=60`), et
      // le navigateur resservirait hors ligne celle du premier lien.
      const unread = await api.post<{ token: string }>(`/decks/${deck.id}/partages`, { kind: "frozen" }, 201);
      await context.setOffline(true);
      await go(`#/decks?action=dupliquer&liste=${unread.token}`);
      await expect(page.getByTestId("list-intent-read-error")).toBeVisible();
      await shot("06-hors-ligne");
      await context.setOffline(false);
    });
  });
}
