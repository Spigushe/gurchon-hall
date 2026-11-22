import { expect, type Browser, type Page } from "@playwright/test";
import type { Api } from "./backend";
import { WEB_ORIGIN } from "./env";
import type { Lot12Nav } from "./lot12";

/**
 * Cycle de vie des liens de partage (Lot 13, étape E, P5), contre un vrai back : purge d'une
 * sélection depuis l'écran Compte, suppression du deck (le vivant tombe, le figé reste), puis
 * purge des liens des decks supprimés. Le visiteur est un **contexte neuf à chaque lecture**,
 * sans cookie ni base : la route publique se met en cache une minute (`max-age=60`).
 * Scénario commun aux deux largeurs (`lot13-cycle-de-vie.spec.ts` dans `e2e-real` et
 * `e2e-desktop-real`).
 */

interface CatalogCard {
  id: number;
  latest_card_set_id: number | null;
}

export async function shareLifecycleScenario(
  { page, browser, api }: { page: Page; browser: Browser; api: Api },
  nav: Lot12Nav,
  viewport: { width: number; height: number },
): Promise<void> {
  await api.get("/moi");
  const catalog = (await api.get<CatalogCard[]>("/cartes?limit=50")).filter((card) => card.latest_card_set_id !== null);
  expect(catalog.length).toBeGreaterThan(2);
  const deck = await api.post<{ id: number }>("/decks", { name: "Banu Princes", proxy_allowed: true }, 201);
  for (const card of catalog.slice(0, 3)) {
    await api.post(
      `/decks/${deck.id}/cartes`,
      { card_id: card.id, language_code: "EN", card_set_id: card.latest_card_set_id, quantity: 2, proxy_quantity: 2 },
      201,
    );
  }
  const live = await api.post<{ token: string }>(`/decks/${deck.id}/partages`, { kind: "live" }, 201);
  const frozen = await api.post<{ token: string }>(`/decks/${deck.id}/partages`, { kind: "frozen" }, 201);

  /** Lit la page publique dans un contexte neuf : `true` si la liste s'affiche, `false` si « introuvable ». */
  const visitorSees = async (token: string): Promise<boolean> => {
    const context = await browser.newContext({ baseURL: WEB_ORIGIN, viewport });
    try {
      const visitor = await context.newPage();
      await visitor.goto(`/#/liste/${token}`);
      await visitor.reload();
      const name = visitor.getByTestId("public-list-name");
      const missing = visitor.getByTestId("public-list-not-found");
      await expect(name.or(missing)).toBeVisible();
      if (await missing.isVisible()) {
        await expect(missing).toHaveText("Liste introuvable.");
        return false;
      }
      await expect(name).toHaveText("Banu Princes");
      return true;
    } finally {
      await context.close();
    }
  };

  expect(await visitorSees(live.token)).toBe(true);
  expect(await visitorSees(frozen.token)).toBe(true);

  // Purge d'une sélection depuis l'écran Compte : le seul lien vivant.
  await nav.open(page);
  await nav.goToAccount(page);
  await expect(page.getByTestId("account-shares-row")).toHaveCount(2);
  await page
    .locator('[data-testid="account-shares-row"][data-kind="live"]')
    .getByTestId("account-shares-select")
    .check();
  await page.getByTestId("account-shares-purge-selected").click();
  await page.getByTestId("account-shares-purge-confirm").click();
  await expect(page.getByTestId("account-shares-feedback")).toBeVisible();
  await expect(page.getByTestId("account-shares-row")).toHaveCount(1);
  expect(await visitorSees(live.token)).toBe(false);
  expect(await visitorSees(frozen.token)).toBe(true);

  // Un nouveau lien vivant, puis la suppression du deck : le vivant tombe, le figé reste.
  const second = await api.post<{ token: string }>(`/decks/${deck.id}/partages`, { kind: "live" }, 201);
  expect(await visitorSees(second.token)).toBe(true);
  await api.patch(`/decks/${deck.id}`, { archived: true }, 200);
  await api.delete(`/decks/${deck.id}`, 204);
  expect(await visitorSees(second.token)).toBe(false);
  expect(await visitorSees(frozen.token)).toBe(true);

  // L'écran Compte range le figé parmi les decks supprimés ; la purge dédiée le fait tomber.
  await page.reload();
  await expect(page.getByTestId("account-page")).toBeVisible();
  await expect(page.getByTestId("account-shares-deleted-item")).toHaveCount(1);
  await page.getByTestId("account-shares-purge-deleted_decks").click();
  await page.getByTestId("account-shares-purge-confirm").click();
  await expect(page.getByTestId("account-shares-empty")).toBeVisible();
  expect(await visitorSees(frozen.token)).toBe(false);
}
