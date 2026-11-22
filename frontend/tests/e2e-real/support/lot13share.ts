import { expect, type Browser } from "@playwright/test";
import type { Api } from "./backend";
import { expectSynced } from "./app";
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

/**
 * Dupliquer et comparer une liste partagée (Lot 13, D5), contre un vrai back : le deck et le
 * lien sont ceux du compte de test (par l'API) ; le visiteur est un **second compte**, inscrit
 * par l'UI dans un contexte neuf. Parcours : page publique sans compte, lien « Se connecter pour
 * dupliquer ou comparer » (qui recharge), inscription, **intention reprise** (feuille de
 * duplication), création du deck par la file, puis, la page publique connaissant désormais un
 * compte, « Comparer » à ce deck, avec et sans révision.
 *
 * Suppose que `PublicListAccountActions` est monté dans `public-list-actions` (étape de
 * montage de D5).
 */
export async function duplicateAndCompareScenario(
  { browser, api }: { browser: Browser; api: Api },
  viewport: { width: number; height: number },
): Promise<void> {
  await api.get("/moi");
  const catalog = (await api.get<CatalogCard[]>("/cartes?limit=50")).filter((card) => card.latest_card_set_id !== null);
  expect(catalog.length).toBeGreaterThan(3);
  const deck = await api.post<{ id: number }>(
    "/decks",
    { name: "Banu Princes", archetype: "bleed", notes: "Notes publiques.", proxy_allowed: true },
    201,
  );
  for (const card of catalog.slice(0, 3)) {
    await api.post(
      `/decks/${deck.id}/cartes`,
      { card_id: card.id, language_code: "EN", card_set_id: card.latest_card_set_id, quantity: 2, proxy_quantity: 2 },
      201,
    );
  }
  const share = await api.post<{ token: string }>(`/decks/${deck.id}/partages`, { kind: "live", show_notes: true }, 201);

  const context = await browser.newContext({ baseURL: WEB_ORIGIN, viewport });
  try {
    const page = await context.newPage();
    // Sans compte connu : un seul lien, qui garde l'intention à travers l'écran de connexion.
    await page.goto(`/#/liste/${share.token}`);
    await page.reload();
    await expect(page.getByTestId("public-list-name")).toHaveText("Banu Princes");
    await expect(page.getByTestId("public-list-duplicate")).toHaveCount(0);
    await page.getByTestId("public-list-sign-in").click();
    await expect(page.getByTestId("auth-screen")).toBeVisible();
    expect(page.url()).toContain(`action=dupliquer&liste=${share.token}`);

    await page.locator("label.tab-option").filter({ hasText: "Inscription" }).click();
    const form = page.getByTestId("signup-form");
    await form.getByTestId("signup-email").fill("visiteur-d5@example.com");
    await form.getByTestId("signup-username").fill("visiteur-d5");
    await form.getByTestId("signup-password").fill("Sup3r-Secret-5!");
    await form.getByTestId("signup-submit").click();

    // L'intention est reprise après l'inscription : la feuille s'ouvre sur la liste lue en ligne.
    const preview = page.getByTestId("list-duplicate-preview");
    await expect(preview).toBeVisible();
    await expect(page.getByTestId("list-duplicate-name")).toHaveValue("Banu Princes");
    await expect(page.getByTestId("list-duplicate-notes")).toHaveValue(/^Notes publiques\.\n\nDupliqué de la liste partagée le /);
    await expect(page.getByTestId("list-duplicate-create")).toBeEnabled({ timeout: 30_000 });
    await page.getByTestId("list-duplicate-create").click();
    await expect(page.getByTestId("deck-page")).toBeVisible();
    await expect(page.getByTestId("deck-title")).toHaveText("Banu Princes");
    await expectSynced(page);

    // Comparer : la page publique connaît maintenant un compte. Liste identique, puis une révision.
    // Depuis l'application, le changement de hash vers `#/liste/` fait recharger
    // la page par `Root` lui-même (C1) : on attend la page publique, sans
    // `page.reload()`, qui entrerait en course avec ce rechargement.
    await page.goto(`/#/liste/${share.token}`);
    await expect(page.getByTestId("public-list-name")).toHaveText("Banu Princes");
    await page.getByTestId("public-list-compare").click();
    const choose = page.getByTestId("list-compare-choose").filter({ hasText: "Banu Princes" });
    await expect(choose).toBeVisible();
    await choose.click();
    await expect(page.getByTestId("compare-page")).toBeVisible();
    await expect(page.getByTestId("compare-identical")).toBeVisible();
    await expect(page.getByTestId("compare-counts-shared")).toBeVisible();

    await page.goto(`/#/liste/${share.token}?revision=${catalog[0].id}=1;${catalog[1].id}=-2`);
    await expect(page.getByTestId("revision-banner")).toBeVisible();
    await page.getByTestId("public-list-compare").click();
    await page.getByTestId("list-compare-choose").filter({ hasText: "Banu Princes" }).click();
    await expect(page.getByTestId("compare-different-qty")).toContainText("3 → 2");
    await expect(page.getByTestId("compare-only-out")).toBeVisible();
    // Lecture seule : aucune action d'écriture sur l'écran.
    await expect(page.getByTestId("compare-page").getByRole("button", { name: /appliquer|ajouter|retirer/i })).toHaveCount(0);
    // L'adresse se recharge telle quelle.
    await page.reload();
    await expect(page.getByTestId("compare-different-qty")).toContainText("3 → 2");
  } finally {
    await context.close();
  }
}
