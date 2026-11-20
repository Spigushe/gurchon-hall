import { expect, type Browser } from "@playwright/test";
import type { Api } from "./backend";
import { WEB_ORIGIN } from "./env";

/**
 * Page publique d'une liste partagée (Lot 13, D3), contre un vrai back : un lien
 * vivant et un lien figé créés par l'API sous session, lus dans un **contexte de
 * navigateur sans session** (aucun cookie, aucune base IndexedDB). Scénario
 * commun aux deux largeurs (`tests/e2e-real/lot13-liste-publique.spec.ts` et
 * `tests/e2e-desktop-real/lot13-liste-publique.spec.ts`).
 */

interface CatalogCard {
  id: number;
  latest_card_set_id: number | null;
}

export async function publicListScenario(
  { browser, api }: { browser: Browser; api: Api },
  viewport: { width: number; height: number },
): Promise<void> {
  await api.get("/moi");
  const catalog = (await api.get<CatalogCard[]>("/cartes?limit=50")).filter((card) => card.latest_card_set_id !== null);
  expect(catalog.length).toBeGreaterThan(4);

  const deck = await api.post<{ id: number }>(
    "/decks",
    { name: "Banu Princes", archetype: "bleed", notes: "Notes publiques du deck.", proxy_allowed: true },
    201,
  );
  const addCard = (card: CatalogCard, quantity: number) =>
    api.post(
      `/decks/${deck.id}/cartes`,
      {
        card_id: card.id,
        language_code: "EN",
        card_set_id: card.latest_card_set_id,
        quantity,
        proxy_quantity: quantity,
      },
      201,
    );
  for (const card of catalog.slice(0, 3)) await addCard(card, 2);

  const live = await api.post<{ token: string }>(`/decks/${deck.id}/partages`, { kind: "live", show_notes: true }, 201);
  const frozen = await api.post<{ token: string }>(`/decks/${deck.id}/partages`, { kind: "frozen" }, 201);

  // Un contexte neuf par lecture : la route publique se met en cache une minute (`max-age=60`),
  // un rechargement dans le même contexte resservirait la liste d'avant la modification.
  let context = await browser.newContext({ baseURL: WEB_ORIGIN, viewport });
  let page = await context.newPage();
  const readList = async (token: string, fresh = false) => {
    if (fresh) {
      await context.close();
      context = await browser.newContext({ baseURL: WEB_ORIGIN, viewport });
      page = await context.newPage();
    }
    await page.goto(`/#/liste/${token}`);
    await page.reload();
    await expect(page.getByTestId("public-list-name")).toHaveText("Banu Princes");
  };
  try {

    // Lien vivant : en-tête, notes, tableaux, et rien d'une session.
    await readList(live.token);
    await expect(page.getByTestId("public-list-meta")).toContainText(`par @${api.account.username}`);
    await expect(page.getByTestId("public-list-meta")).toContainText("Bleed");
    await expect(page.getByTestId("public-list-notes")).toHaveText("Notes publiques du deck.");
    await expect(page.getByTestId("public-list-frozen")).toHaveCount(0);
    await expect(page.getByTestId("deck-tables")).toHaveAttribute("data-editable", "false");
    await expect(page.getByTestId("deck-card")).toHaveCount(3);
    await expect(page).toHaveTitle("Banu Princes");
    expect(await context.cookies()).toEqual([]);
    expect(await page.evaluate(async () => (await indexedDB.databases()).map((db) => db.name))).toEqual([]);

    // Un deck modifié : le vivant suit, le figé non.
    await addCard(catalog[3], 1);
    await readList(live.token, true);
    await expect(page.getByTestId("deck-card")).toHaveCount(4);
    await readList(frozen.token, true);
    await expect(page.getByTestId("deck-card")).toHaveCount(3);
    await expect(page.getByTestId("public-list-frozen")).toContainText("Liste du");
    await expect(page.getByTestId("public-list-notes")).toHaveCount(0);

    // Export depuis la page : le texte reprend le nom des cartes.
    await page.getByTestId("public-list-export").click();
    await expect(page.getByTestId("deck-export-text")).toHaveValue(/Deck Name: Banu Princes/);
    await page.getByTestId("deck-export-format-jol").click();
    await expect(page.getByTestId("deck-export-text")).toHaveValue(/^2x/);
    await expect(page.getByTestId("deck-export-filename")).toHaveText("Banu Princes (JOL).txt");
    await page.keyboard.press("Escape");

    // Un jeton inconnu : 404 uniforme.
    await page.goto("/#/liste/Zz9_Zz9_");
    await page.reload();
    await expect(page.getByTestId("public-list-not-found")).toHaveText("Liste introuvable.");
    expect(await page.evaluate(async () => (await indexedDB.databases()).map((db) => db.name))).toEqual([]);
  } finally {
    await context.close();
  }
}
