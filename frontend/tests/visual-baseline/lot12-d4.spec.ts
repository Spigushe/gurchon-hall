import { execFile } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { Locator, Page } from "@playwright/test";
import { CARDS, cardInfo, expectPending, expectSynced, openApp, syncStatus } from "../e2e-real/support/app";
import { TEST_ACCOUNT, backendPython, expect, sqliteUrl, test, type Api } from "../e2e-real/support/backend";
import { BACKEND_DIR, FRONTEND_DIR } from "../e2e-real/support/env";
import { openAppDesktop } from "../e2e-desktop-real/support/nav";

/**
 * Captures avant et après des deux corrections CSS du Lot 12 (étape D4,
 * `docs/lot12-plan-consolidation.md`) : le champ « Nom du deck »
 * (`.underline-field`), « Se reconnecter → » (`.btn-ghost`), « Effacer les
 * filtres » du bilan (`.btn-ghost`, feuille du mobile seulement) et
 * « Abandonner » (`.chip-action--text`), à 390 et 1440 px.
 *
 * Outil de capture, comme `capture.spec.ts` : aucune assertion sur les images.
 * La phase se choisit par `D4_PHASE` (`avant` ou `apres`, `apres` par défaut) ;
 * pour la phase `avant`, construire `dist-real` sur l'`index.css` d'avant la
 * correction. Sortie : `docs/qa-baselines/lot12-d4/<phase>/<largeur>/`.
 *
 *     npm run build:e2e
 *     $env:D4_PHASE = "apres"
 *     npx playwright test --config tests/visual-baseline/playwright.config.ts lot12-d4
 */

const PHASE = process.env.D4_PHASE === "avant" ? "avant" : "apres";
const ROOT = path.join(FRONTEND_DIR, "..", "docs", "qa-baselines", "lot12-d4", PHASE);
const execFileAsync = promisify(execFile);

async function revokeSessions(dbFile: string): Promise<void> {
  await execFileAsync(
    backendPython(),
    [path.join("scripts", "manage_accounts.py"), "revoke-sessions", "--email", TEST_ACCOUNT.email],
    { cwd: BACKEND_DIR, env: { ...process.env, DATABASE_URL: sqliteUrl(dbFile), PYTHONIOENCODING: "utf-8" } },
  );
}

/** Capture la zone autour d'un élément, avec une marge pour voir ses bords. */
async function shotAround(page: Page, target: Locator, file: string, pad = 24): Promise<void> {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (box === null) throw new Error(`${file} : élément invisible`);
  const viewport = page.viewportSize()!;
  const x = Math.max(0, box.x - pad);
  const y = Math.max(0, box.y - pad);
  await page.screenshot({
    path: file,
    clip: {
      x,
      y,
      width: Math.min(viewport.width - x, box.width + 2 * pad),
      height: Math.min(viewport.height - y, box.height + 2 * pad),
    },
  });
}

async function seedDeck(api: Api, name: string, card: { id: number; latest_card_set_id: number }) {
  const deck = await api.post<{ id: number }>("/decks", { name }, 201);
  await api.post(
    `/decks/${deck.id}/cartes`,
    { card_id: card.id, language_code: "EN", card_set_id: card.latest_card_set_id, quantity: 1 },
    201,
  );
  return deck;
}

async function seedGames(api: Api, deckId: number): Promise<void> {
  const lea = (await api.post<{ id: number }>("/joueurs", { name: "Léa" }, 201)).id;
  for (const days of [3, 2]) {
    await api.post(
      "/parties",
      {
        played_at: new Date(Date.now() - days * 86_400_000).toISOString(),
        player_count: 5,
        participations: [
          { player: { me: true }, deck: { deck_id: deckId }, seat: 1, victory_points: 1 },
          { player: { player_id: lea }, seat: 2, opponent_deck_archetype: "bleed" },
        ],
      },
      201,
    );
  }
}

const go = (page: Page, hash: string) =>
  page.evaluate((target) => {
    window.location.hash = target;
  }, hash);

for (const width of [
  { desktop: false, label: "mobile-390x844", viewport: { width: 390, height: 844 } },
  { desktop: true, label: "desktop-1440x900", viewport: { width: 1440, height: 900 } },
]) {
  test.describe(width.label, () => {
    test.use({ viewport: width.viewport });

    test(`captures D4 (${PHASE}) à ${width.label}`, async ({ page, context, api }) => {
      const out = path.join(ROOT, width.label);
      mkdirSync(out, { recursive: true });
      const awe = await cardInfo(api, CARDS.awe);
      await api.post(
        "/stock",
        { card_id: awe.id, language_code: "EN", card_set_id: awe.latest_card_set_id, quantity_owned: 10 },
        201,
      );
      const archived = await seedDeck(api, "Archivé ailleurs", awe);
      const pending = await seedDeck(api, "En attente", awe);
      await seedGames(api, pending.id);

      if (width.desktop) await openAppDesktop(page);
      else await openApp(page);
      await expectSynced(page);

      // 1. « Nom du deck », feuille « Nouveau deck ».
      await go(page, "#/decks");
      await page.getByTestId(width.desktop ? "decks-new-desktop" : "deck-add").click();
      const name = page.getByTestId("deck-form").getByLabel("Nom du deck");
      await name.evaluate((element) => (element as HTMLElement).blur());
      await shotAround(page, name, path.join(out, "01-nom-du-deck.png"));
      await page.keyboard.press("Escape");

      // 2. « Effacer les filtres » : la feuille de filtres n'existe qu'au mobile,
      // le bureau a sa barre de filtres sans ce bouton.
      if (!width.desktop) {
        await go(page, "#/bilan");
        await page.getByTestId("bilan-filter-open").click();
        await shotAround(page, page.getByTestId("bilan-filter-clear"), path.join(out, "02-effacer-les-filtres.png"));
        await page.keyboard.press("Escape");
      }

      // 3. « Abandonner » : un deck archivé ailleurs pendant la coupure.
      await context.setOffline(true);
      await api.patch(`/decks/${archived.id}`, { archived: true });
      await go(page, `#/decks/id:${archived.id}`);
      await page.getByRole("button", { name: `Ajouter un exemplaire de ${CARDS.awe}` }).first().click();
      await expectPending(page, 1);
      await context.setOffline(false);
      await expect(syncStatus(page)).toHaveAttribute("data-rejected", "1");
      await go(page, "#/synchronisation");
      const rejected = page.getByTestId("rejected-operation");
      if (width.desktop) await rejected.click();
      await shotAround(page, page.getByTestId("discard-button").first(), path.join(out, "03-abandonner.png"));

      // 4. « Se reconnecter → » : session révoquée pendant une coupure, file non vide.
      await context.setOffline(true);
      await go(page, `#/decks/id:${pending.id}`);
      await page.getByRole("button", { name: `Ajouter un exemplaire de ${CARDS.awe}` }).first().click();
      await expect(syncStatus(page)).toHaveAttribute("data-pending", /[1-9]/);
      await revokeSessions(api.dbFile);
      await context.setOffline(false);
      const banner = page.getByTestId("reconnect-banner");
      await expect(banner).toBeVisible();
      await shotAround(page, page.getByTestId("reconnect-banner-link"), path.join(out, "04-se-reconnecter.png"));
      await shotAround(page, banner, path.join(out, "04b-bandeau-reconnexion.png"), 8);
    });
  });
}
