import { expect, test, type Api } from "./support/backend";
import {
  CARDS,
  addStock,
  cardInfo,
  chooseLanguage,
  expectCatalogDownloaded,
  expectPending,
  expectSynced,
  goToDecksList,
  goToStock,
  openApp,
  stockEntry,
} from "./support/app";

/**
 * Lot 5c (symétrie mobile / bureau) : les écarts « bureau vers mobile » portés
 * par les étapes 2 à 5 (`docs/lot5c-plan-design.md`), vérifiés à 390 px contre
 * le vrai back. Ce projet (`real-backend`) tourne à la largeur mobile : les
 * éléments qui n'existaient qu'au bureau doivent y être atteignables sans
 * `isDesktop`.
 */

async function seedStock(api: Api, name: string, language: string, quantity: number) {
  const card = await cardInfo(api, name);
  await api.post(
    "/stock",
    { card_id: card.id, language_code: language, card_set_id: card.latest_card_set_id, quantity_owned: quantity },
    201,
  );
  return card;
}

async function seedDeckLine(
  api: Api,
  deckId: number,
  card: { id: number; latest_card_set_id: number },
  language: string,
  quantity: number,
) {
  await api.post(
    `/decks/${deckId}/cartes`,
    { card_id: card.id, language_code: language, card_set_id: card.latest_card_set_id, quantity },
    201,
  );
}

test("n°1+2 : hors ligne, une saisie en file et aucun refus, l'alerte mène à la page Synchronisation et à sa file", async ({
  page,
  context,
  api,
}) => {
  await openApp(page);
  await expectCatalogDownloaded(page);
  await expectSynced(page);
  await context.setOffline(true);

  await goToStock(page);
  await addStock(page, { search: "awe", card: CARDS.awe, quantity: 1, language: "EN" });
  await expectPending(page, 1);

  // Aucun refus : avant le Lot 5c, le lien n'existait que s'il y en avait.
  await page.getByTestId("nav-home").click();
  const link = page.getByTestId("sync-alert-link");
  await expect(link).toBeVisible();
  await expect(link).toContainText("Voir la synchronisation");
  await link.click();

  await expect(page.getByTestId("sync-page")).toBeVisible();
  const list = page.getByTestId("sync-pending-list");
  await expect(list).toBeVisible();
  await expect(list.getByTestId("pending-operation")).toHaveCount(1);

  // Retour du réseau : la file se vide, rien n'a été perdu côté serveur.
  await context.setOffline(false);
  await expectSynced(page);
  await expect(page.getByTestId("pending-operation")).toHaveCount(0);
  expect(await api.get<unknown[]>("/stock")).toHaveLength(1);
});

test("n°3, 5, 6 : la collection mobile montre clan, capacité, « dans N decks », compteurs d'onglets et total", async ({
  page,
  api,
}) => {
  const tarbaby = await seedStock(api, CARDS.tarbaby, "EN", 2);
  const awe = await seedStock(api, CARDS.awe, "EN", 1);
  await seedStock(api, CARDS.aura, "EN", 0);
  const deck = await api.post<{ id: number }>("/decks", { name: "Deck compte" }, 201);
  await seedDeckLine(api, deck.id, tarbaby, "EN", 1);

  await openApp(page);
  await expectCatalogDownloaded(page);
  await expectSynced(page);
  await goToStock(page);

  // Cette largeur est bien la disposition mobile (liste, pas tableau).
  await expect(page.getByTestId("stock-list")).toBeVisible();
  await expect(page.getByTestId("stock-table")).toHaveCount(0);

  const crypt = stockEntry(page, tarbaby.id, "EN");
  await expect(crypt.getByTestId("stock-entry-clan")).toHaveText("Nosferatu antitribu");
  await expect(crypt.getByTestId("stock-entry-capacity")).toHaveText("cap. 8");
  await expect(crypt.getByTestId("stock-entry-decks")).toHaveText("dans 1 deck");

  // Une carte de bibliothèque hors deck : ni clan, ni capacité, ni compte de decks.
  const library = stockEntry(page, awe.id, "EN");
  await expect(library).toBeVisible();
  await expect(library.getByTestId("stock-entry-clan")).toHaveCount(0);
  await expect(library.getByTestId("stock-entry-capacity")).toHaveCount(0);
  await expect(library.getByTestId("stock-entry-decks")).toHaveCount(0);

  // Compteurs d'onglets : 3 entrées, 1 crypte, 2 bibliothèque, 1 à zéro.
  await expect(page.getByTestId("stock-tab-count-all")).toContainText("3");
  await expect(page.getByTestId("stock-tab-count-crypt")).toContainText("1");
  await expect(page.getByTestId("stock-tab-count-library")).toContainText("2");
  await expect(page.getByTestId("stock-tab-count-proxy")).toContainText("1");
  // Total d'exemplaires : 2 + 1 + 0.
  await expect(page.getByTestId("stock-total-copies")).toHaveText("3 exemplaires");
});

test("n°4 : le tri de la collection se règle dans la feuille de filtres, critère et sens", async ({ page, api }) => {
  await seedStock(api, CARDS.aura, "EN", 2);
  await seedStock(api, CARDS.awe, "EN", 1);
  await seedStock(api, CARDS.tarbaby, "EN", 3);

  await openApp(page);
  await expectCatalogDownloaded(page);
  await expectSynced(page);
  await goToStock(page);

  const names = page.getByTestId("stock-entry-name");
  await expect(names).toHaveCount(3);
  // Tri par défaut : nom croissant.
  await expect(names).toHaveText([/^Aura Absorption/, /^Awe/, /^Tarbaby Jack/]);

  await page.getByTestId("stock-filters-open").click();
  const sheet = page.getByTestId("stock-filters-sheet");
  await expect(sheet).toBeVisible();
  const column = sheet.getByTestId("stock-sort-column");
  const direction = sheet.getByTestId("stock-sort-dir");

  // Même critère, sens inversé.
  await direction.getByText("Décroissant", { exact: true }).click();
  await expect(names).toHaveText([/^Tarbaby Jack/, /^Awe/, /^Aura Absorption/]);

  // Autre critère (quantité), croissant : 1, 2, 3.
  await column.selectOption("quantity");
  await direction.getByText("Croissant", { exact: true }).click();
  await expect(names).toHaveText([/^Awe/, /^Aura Absorption/, /^Tarbaby Jack/]);

  // Quantité décroissante : 3, 2, 1.
  await direction.getByText("Décroissant", { exact: true }).click();
  await expect(names).toHaveText([/^Tarbaby Jack/, /^Aura Absorption/, /^Awe/]);

  await sheet.getByTestId("stock-filters-done").click();
  await expect(sheet).toHaveCount(0);
  // Le tri tient une fois la feuille refermée.
  await expect(names).toHaveText([/^Tarbaby Jack/, /^Aura Absorption/, /^Awe/]);
});

test("n°7 : le picker mobile annonce « Dans le deck : N » pour la carte et la langue choisies", async ({
  page,
  api,
}) => {
  const awe = await seedStock(api, CARDS.awe, "EN", 5);
  const deck = await api.post<{ id: number }>("/decks", { name: "Deck picker" }, 201);
  await seedDeckLine(api, deck.id, awe, "EN", 2);

  await openApp(page);
  await expectCatalogDownloaded(page);
  await expectSynced(page);
  await goToDecksList(page);
  await page.getByTestId("deck-link").click();
  await page.getByTestId("deck-card-add").click();

  const form = page.getByTestId("deck-card-form");
  await expect(form).toBeVisible();
  await form.getByLabel("Rechercher une carte").fill("awe");
  await form.getByTestId("card-picker-option").filter({ hasText: CARDS.awe }).first().click();
  await expect(form.getByTestId("deck-card-form-chosen")).toBeVisible();

  // Langue par défaut FR : la ligne du deck est en EN, rien n'y est compté.
  await expect(form.getByTestId("deck-card-form-in-deck")).toHaveText("Dans le deck : 0");
  await chooseLanguage(form, "EN");
  await expect(form.getByTestId("deck-card-form-in-deck")).toHaveText("Dans le deck : 2");
});

test("n°17b : la liste « En cours » de l'Atelier mobile porte les comptes crypte et bibliothèque", async ({
  page,
  api,
}) => {
  const tarbaby = await seedStock(api, CARDS.tarbaby, "EN", 1);
  const awe = await seedStock(api, CARDS.awe, "EN", 3);
  const deck = await api.post<{ id: number }>("/decks", { name: "Deck en cours" }, 201);
  await seedDeckLine(api, deck.id, tarbaby, "EN", 1);
  await seedDeckLine(api, deck.id, awe, "EN", 3);
  await api.post("/decks", { name: "Deck vide" }, 201);

  await openApp(page);
  await expectCatalogDownloaded(page);
  await expectSynced(page);

  const counts = page.getByTestId("home-deck-counts");
  await expect(counts).toHaveCount(2); // un par deck, y compris le deck vide
  await expect(counts.filter({ hasText: "1 crypte · 3 bibliothèque" })).toHaveCount(1);
  await expect(counts.filter({ hasText: "0 crypte · 0 bibliothèque" })).toHaveCount(1);
});
