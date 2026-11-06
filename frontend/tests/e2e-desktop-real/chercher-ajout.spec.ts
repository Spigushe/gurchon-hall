import type { Page } from "@playwright/test";
import { expect, test } from "../e2e-real/support/backend";
import {
  CARDS,
  cardInfo,
  expectCatalogDownloaded,
  expectPending,
  expectSynced,
  recordSyncRequests,
  type DeckRead,
  type StockLine,
} from "../e2e-real/support/app";
import { SEARCH_CARDS, imageLoaded, searchRows, serveKrcgImages } from "../e2e-real/support/search";
import { goToDecksDesktop, openAppDesktop } from "./support/nav";

/**
 * Lot Chercher, étape E3, à 1440 px et contre le vrai back : le champ global
 * et `/` (P8), la feuille d'ajout au clavier (`N`, `⌘↵`), son rejeu ; puis le
 * deckbuilder, où `/` reste au picker, avec l'image de l'impression choisie et
 * le lien vers Chercher pour ce deck (P12).
 */

const blur = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

async function controlledBySw(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  await expect(page.getByTestId("home-page")).toBeVisible();
}

/** `N` sur la carte choisie, puis le choix de destination. */
async function openAddPanel(page: Page) {
  await blur(page);
  await page.keyboard.press("n");
  const sheet = page.getByTestId("search-add-sheet");
  await expect(sheet).toBeVisible();
  return sheet;
}

test("champ global et `/` vers Chercher, ajout au clavier hors ligne, rejoué au retour du réseau", async ({ page, context, api }) => {
  const deck = await api.post<{ id: number }>("/decks", { name: "Ventrue de table", proxy_allowed: true }, 201);
  const aaradhya = (await api.get<Array<{ id: number; name: string; latest_card_set_id: number }>>("/cartes?limit=200")).find(
    (card) => card.name.startsWith(SEARCH_CARDS.aaradhya),
  );
  const syncCalls = recordSyncRequests(page);

  await openAppDesktop(page);
  await expectCatalogDownloaded(page);
  await controlledBySw(page);
  await expectSynced(page);
  await context.setOffline(true);

  // `/` sur l'Atelier focalise le champ global ; `↵` ouvre Chercher avec le texte.
  await blur(page);
  await page.keyboard.press("/");
  const global = page.getByTestId("topbar-search");
  await expect(global).toBeFocused();
  await expect(global).toHaveAttribute("placeholder", "Chercher une carte (catalogue)");
  await page.keyboard.type("aaradhya");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("search-page")).toBeVisible();
  await expect(page.getByTestId("search-input")).toHaveValue("aaradhya");
  await expect(searchRows(page)).toHaveCount(1);
  // Sur Chercher, le champ global devient un renvoi vers le champ de la page, et `/` y mène.
  await expect(page.getByTestId("topbar-search")).toHaveText(/sur cette page/);
  await blur(page);
  await page.keyboard.press("/");
  await expect(page.getByTestId("search-input")).toBeFocused();
  await expect(page.getByTestId("topbar-search").locator("input")).toHaveCount(0);

  // ↓ choisit la carte, N ouvre le panneau, ⌘↵ (ou Ctrl+↵) valide.
  await blur(page);
  await page.keyboard.press("ArrowDown");
  await expect(page.getByTestId("search-detail")).toContainText(SEARCH_CARDS.aaradhya);
  let sheet = await openAddPanel(page);
  await sheet.getByTestId("search-add-target-deck").click();
  await expect(sheet.getByTestId("search-add-deck")).toHaveValue(`id:${deck.id}`);
  await sheet.getByTestId("search-add-copies").getByRole("spinbutton").fill("2");
  await expect(sheet.getByTestId("search-add-effect")).toContainText("2 en proxy");
  await page.keyboard.press("Control+Enter");
  await expect(sheet).toHaveCount(0);
  await expect(page.getByTestId("search-row-confirmed")).toContainText("+2 à l'instant");

  sheet = await openAddPanel(page);
  await sheet.getByTestId("search-add-target-both").click();
  await expect(sheet.getByTestId("search-add-effect")).toContainText("1 exemplaire remplace 1 proxy");
  await page.keyboard.press("Control+Enter");
  await expect(sheet).toHaveCount(0);
  await expectPending(page, 2);

  await page.reload();
  await expectPending(page, 2);
  expect(syncCalls).toHaveLength(0);
  await context.setOffline(false);
  await expectSynced(page);
  expect(syncCalls.flatMap((call) => call.operations.map((operation) => operation.type))).toEqual(["deck_card.upsert", "deck_card.upsert"]);

  const served = await api.get<DeckRead>(`/decks/${deck.id}`);
  expect(served.cards).toEqual([
    expect.objectContaining({ card_id: aaradhya!.id, card_set_id: aaradhya!.latest_card_set_id, quantity: 2, proxy_quantity: 1 }),
  ]);
  expect(await api.get<StockLine[]>("/stock")).toEqual([
    expect.objectContaining({ card_id: aaradhya!.id, card_set_id: aaradhya!.latest_card_set_id, quantity_owned: 1 }),
  ]);
});

test("deckbuilder : `/` reste au picker, image de l'impression choisie, lien vers Chercher pour ce deck (P12)", async ({ page, api }) => {
  const requested = await serveKrcgImages(page);
  const deck = await api.post<{ id: number }>("/decks", { name: "Deck à compléter", proxy_allowed: true }, 201);
  const awe = await cardInfo(api, CARDS.awe);
  await api.post(
    `/decks/${deck.id}/cartes`,
    { card_id: awe.id, language_code: "EN", card_set_id: awe.latest_card_set_id, quantity: 1, proxy_quantity: 1 },
    201,
  );
  const aura = await cardInfo(api, CARDS.aura);
  const auraSheet = await api.get<{ printings: Array<{ card_set: { id: number }; image_url: string | null }> }>(`/cartes/${aura.id}`);
  const auraImage = auraSheet.printings.find((printing) => printing.card_set.id === aura.latest_card_set_id)?.image_url;
  expect(auraImage).toMatch(/^https:\/\/static\.krcg\.org\//);

  await openAppDesktop(page);
  await expectCatalogDownloaded(page);
  await expectSynced(page);
  await goToDecksDesktop(page);
  await page.getByTestId("deck-select").filter({ hasText: "Deck à compléter" }).click();
  await page.getByTestId("decks-detail-open").click();
  const picker = page.getByTestId("deck-builder-picker");
  await expect(picker).toBeVisible();

  // Un seul `/` à la fois : sur le deckbuilder, c'est celui du picker.
  await blur(page);
  await page.keyboard.press("/");
  const search = picker.getByLabel("Rechercher une carte");
  await expect(search).toBeFocused();
  await expect(page.getByTestId("topbar-search")).not.toBeFocused();

  await search.fill("aura");
  await picker.getByTestId("card-picker-option").filter({ hasText: CARDS.aura }).first().click();
  const image = picker.getByTestId("deck-card-form-image").locator("img");
  await expect(image).toHaveAttribute("src", auraImage!);
  await expect.poll(() => imageLoaded(image)).toBe(true);
  expect(requested).toContain(auraImage);

  await picker.getByTestId("search-from-deck").click();
  await expect(page.getByTestId("search-page")).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`#/chercher\\?deck=id%3A${deck.id}$`));
  await expect(page.getByTestId("search-deck-banner")).toContainText("Deck à compléter");
  await expect(searchRows(page)).toHaveCount(9);
  await expect(searchRows(page).filter({ hasText: CARDS.awe })).toHaveCount(0);
});
