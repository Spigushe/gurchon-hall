import { expect, test } from "./support/backend";
import {
  CARDS,
  cardInfo,
  expectCatalogDownloaded,
  expectPending,
  expectSynced,
  goToDecksList,
  openApp,
  readOutbox,
  recordSyncRequests,
  waitForServiceWorkerControl,
  type DeckRead,
  type StockLine,
} from "./support/app";
import { SEARCH_CARDS, imageLoaded, searchRows, serveKrcgImages } from "./support/search";

/**
 * Lot Chercher, étape E3, à 390 px et contre le vrai back : la feuille d'ajout
 * (P10) hors ligne et son rejeu, l'entrée depuis un deck (P12) et les images
 * (P7). Les filtres eux-mêmes sont couverts par `chercher-filtres.spec.ts` ;
 * ici la carte se trouve par son nom.
 */

interface DeckCreated {
  id: number;
  name: string;
}

/** Ouvre la fiche de la seule carte affichée et sa feuille d'ajout. */
async function openAddSheet(page: import("@playwright/test").Page, name: string) {
  const row = searchRows(page).filter({ hasText: name });
  await expect(row).toHaveCount(1);
  await row.getByRole("button").click();
  const detail = page.getByTestId("search-detail-sheet");
  await expect(detail).toBeVisible();
  await detail.getByTestId("search-detail-add").click();
  const sheet = page.getByTestId("search-add-sheet");
  await expect(sheet).toBeVisible();
  return sheet;
}

test("ajout hors ligne à un deck, puis aux deux : rechargé hors ligne, rejoué au retour du réseau", async ({ page, context, api }) => {
  const deck = await api.post<DeckCreated>("/decks", { name: "Ventrue de table", proxy_allowed: true }, 201);
  const aaradhya = (await api.get<Array<{ id: number; name: string; latest_card_set_id: number }>>("/cartes?limit=200")).find(
    (card) => card.name.startsWith(SEARCH_CARDS.aaradhya),
  );
  expect(aaradhya).toBeDefined();
  const syncCalls = recordSyncRequests(page);

  await openApp(page);
  await expectCatalogDownloaded(page);
  await waitForServiceWorkerControl(page);
  await expectSynced(page);
  await context.setOffline(true);

  await page.getByTestId("nav-search").click();
  await page.getByTestId("search-input").fill("aaradhya");

  // 1. Au deck : deux copies, aucune au stock, donc deux proxies.
  let sheet = await openAddSheet(page, SEARCH_CARDS.aaradhya);
  await expect(sheet.getByTestId("search-add-target-collection")).toHaveAttribute("aria-checked", "true");
  await sheet.getByTestId("search-add-target-deck").click();
  await expect(sheet.getByTestId("search-add-deck")).toHaveValue(`id:${deck.id}`);
  await sheet.getByTestId("search-add-copies").getByRole("spinbutton").fill("2");
  await expect(sheet.getByTestId("search-add-possessed")).toContainText("0 disponible au stock");
  await expect(sheet.getByTestId("search-add-effect")).toContainText("2 en proxy");
  await sheet.getByTestId("search-add-submit").click();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByTestId("search-row-confirmed")).toContainText("+2 à l'instant");
  await expect(page.getByTestId("search-add-feedback")).toContainText("+2 au deck Ventrue de table");
  await expectPending(page, 1);

  // 2. Aux deux : un exemplaire acheté remplace un des deux proxies.
  sheet = await openAddSheet(page, SEARCH_CARDS.aaradhya);
  await sheet.getByTestId("search-add-target-both").click();
  await expect(sheet.getByTestId("search-add-effect")).toContainText("1 exemplaire remplace 1 proxy");
  await sheet.getByTestId("search-add-submit").click();
  await expect(sheet).toHaveCount(0);
  await expectPending(page, 2);
  expect((await readOutbox(page)).map((entry) => entry.type)).toEqual(["deck_card.upsert", "deck_card.upsert"]);

  // Rechargé hors ligne : la file et la projection survivent.
  await page.reload();
  await expectPending(page, 2);
  await page.getByTestId("nav-search").click();
  await page.getByTestId("search-input").fill("aaradhya");
  await expect(searchRows(page).first().getByTestId("search-row-owned")).toHaveText("1 en collection");
  expect(syncCalls).toHaveLength(0);

  await context.setOffline(false);
  await expectSynced(page);
  expect(syncCalls.flatMap((call) => call.operations.map((operation) => operation.type))).toEqual(["deck_card.upsert", "deck_card.upsert"]);

  const served = await api.get<DeckRead>(`/decks/${deck.id}`);
  expect(served.cards).toEqual([
    expect.objectContaining({ card_id: aaradhya!.id, language_code: "FR", card_set_id: aaradhya!.latest_card_set_id, quantity: 2, proxy_quantity: 1 }),
  ]);
  const stock = await api.get<StockLine[]>("/stock");
  expect(stock).toEqual([
    expect.objectContaining({ card_id: aaradhya!.id, language_code: "FR", card_set_id: aaradhya!.latest_card_set_id, quantity_owned: 1 }),
  ]);
});

test("Chercher depuis un deck (P12) : bandeau, « pas dans ce deck », et pas de lien sur un deck archivé", async ({ page, api }) => {
  const deck = await api.post<DeckCreated>("/decks", { name: "Deck à compléter", proxy_allowed: true }, 201);
  const awe = await cardInfo(api, CARDS.awe);
  await api.post(
    `/decks/${deck.id}/cartes`,
    { card_id: awe.id, language_code: "EN", card_set_id: awe.latest_card_set_id, quantity: 1, proxy_quantity: 1 },
    201,
  );

  await openApp(page);
  await expectCatalogDownloaded(page);
  await expectSynced(page);
  await goToDecksList(page);
  await page.getByTestId("deck-link").filter({ hasText: "Deck à compléter" }).click();
  await expect(page.getByTestId("deck-page")).toBeVisible();
  await page.getByTestId("search-from-deck").click();

  await expect(page.getByTestId("search-page")).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`#/chercher\\?deck=id:${deck.id}$`));
  await expect(page.getByTestId("search-deck-banner")).toContainText("Deck à compléter");
  // Awe est déjà dans le deck : « pas dans ce deck » l'écarte, les neuf autres restent.
  await expect(searchRows(page)).toHaveCount(9);
  await expect(searchRows(page).filter({ hasText: CARDS.awe })).toHaveCount(0);
  await page.getByTestId("search-deck-clear").click();
  await expect(page.getByTestId("search-deck-banner")).toHaveCount(0);
  await expect(searchRows(page)).toHaveCount(10);
  await expect(searchRows(page).filter({ hasText: CARDS.awe })).toHaveCount(1);

  await api.patch(`/decks/${deck.id}`, { archived: true });
  await page.reload();
  await goToDecksList(page);
  await page.locator("label.tab-option").filter({ hasText: "Tous" }).click();
  await page.getByTestId("deck-link").filter({ hasText: "Deck à compléter" }).click();
  await expect(page.getByTestId("deck-archived-note")).toBeVisible();
  await expect(page.getByTestId("search-from-deck")).toHaveCount(0);
});

test("images (P7) : la fiche montre le scan en ligne et dit qu'il manque hors ligne ; le picker montre l'impression", async ({
  page,
  context,
  api,
}) => {
  const requested = await serveKrcgImages(page);
  const deck = await api.post<DeckCreated>("/decks", { name: "Deck aux images", proxy_allowed: true }, 201);
  const awe = await cardInfo(api, CARDS.awe);
  const sheetOf = await api.get<{ printings: Array<{ card_set: { id: number }; image_url: string | null }> }>(`/cartes/${awe.id}`);
  const latestImage = sheetOf.printings.find((printing) => printing.card_set.id === awe.latest_card_set_id)?.image_url;
  expect(latestImage).toMatch(/^https:\/\/static\.krcg\.org\//);

  await openApp(page);
  await expectCatalogDownloaded(page);
  await waitForServiceWorkerControl(page);

  // La fiche, étendue, en ligne : l'image générique de la carte.
  await page.getByTestId("nav-search").click();
  await page.getByTestId("search-input").fill("awe");
  await searchRows(page).filter({ hasText: CARDS.awe }).getByRole("button").click();
  const detailSheet = page.getByTestId("search-detail-sheet");
  await detailSheet.getByTestId("search-detail-expand").click();
  const image = detailSheet.getByTestId("search-detail-image").locator("img");
  await expect(image).toHaveAttribute("src", "https://static.krcg.org/card/awe.jpg");
  await expect.poll(() => imageLoaded(image)).toBe(true);

  // Hors ligne : aucune requête, un repli qui dit pourquoi.
  const before = requested.length;
  await context.setOffline(true);
  await expect(detailSheet.getByTestId("search-detail-image").getByRole("img", { name: /Image indisponible hors ligne/ })).toBeVisible();
  await detailSheet.getByTestId("search-detail-close").click();
  await context.setOffline(false);

  // Le picker du deck, en ligne : l'image de l'impression choisie, lue par GET /cartes/{id}.
  await goToDecksList(page);
  await page.getByTestId("deck-link").filter({ hasText: deck.name }).click();
  await page.getByTestId("deck-card-add").click();
  const form = page.getByTestId("deck-card-form");
  await form.getByLabel("Rechercher une carte").fill("awe");
  await form.getByTestId("card-picker-option").filter({ hasText: CARDS.awe }).first().click();
  const picked = form.getByTestId("deck-card-form-image");
  await expect(picked.locator("img")).toHaveAttribute("src", latestImage!);
  await expect.poll(() => imageLoaded(picked.locator("img"))).toBe(true);
  await picked.click();
  await expect(picked).toHaveAttribute("aria-pressed", "true");

  // Hors ligne, la ligne de la carte choisie redevient celle d'avant, sans image.
  await context.setOffline(true);
  await expect(form.getByTestId("deck-card-form-image")).toHaveCount(0);
  expect(requested.slice(before).every((url) => url.startsWith("https://static.krcg.org/"))).toBe(true);
  expect(requested).toContain(latestImage);
  await context.setOffline(false);
});
