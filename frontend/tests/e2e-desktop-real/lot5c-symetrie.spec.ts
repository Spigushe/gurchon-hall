import { expect, test, type Api } from "../e2e-real/support/backend";
import { CARDS, cardInfo, expectCatalogDownloaded, expectSynced } from "../e2e-real/support/app";
import { goToDecksDesktop, goToStockDesktop, goToSyncDesktop, openAppDesktop } from "./support/nav";

/**
 * Lot 5c (symétrie mobile / bureau) : les écarts « mobile vers bureau » et les
 * décisions D1 à D3 (`docs/lot5c-plan-design.md`), vérifiés à 1440 px contre le
 * vrai back. Les écarts « bureau vers mobile » sont dans
 * `tests/e2e-real/lot5c-symetrie.spec.ts`.
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

async function openDeckbuilder(page: import("@playwright/test").Page, deckName: string) {
  await goToDecksDesktop(page);
  await page.getByTestId("deck-select").filter({ hasText: deckName }).click();
  await page.getByTestId("decks-detail-open").click();
  await expect(page.getByTestId("deck-builder-columns")).toBeVisible();
}

test("n°14 : l'en-tête du Deckbuilder détaille la légalité (motifs, carte bannie, note de brouillon)", async ({
  page,
  api,
}) => {
  // Tarbaby Jack est bannie dans l'échantillon krcg (banned_on 2020-08-01), et une
  // crypte d'une carte est bien en dessous du minimum de 12.
  const tarbaby = await seedStock(api, CARDS.tarbaby, "EN", 1);
  const deck = await api.post<{ id: number }>("/decks", { name: "Légalité bureau" }, 201);
  await api.post(
    `/decks/${deck.id}/cartes`,
    { card_id: tarbaby.id, language_code: "EN", card_set_id: tarbaby.latest_card_set_id, quantity: 1 },
    201,
  );

  await openAppDesktop(page);
  await expectCatalogDownloaded(page);
  await expectSynced(page);
  await openDeckbuilder(page, "Légalité bureau");

  const details = page.getByTestId("legality-details");
  await expect(details).toBeVisible();
  const issues = details.getByTestId("legality-issues");
  await expect(issues).toContainText("Crypt trop petite");
  await expect(issues).toContainText("bannie");
  await expect(details.getByTestId("legality-banned-names")).toContainText(CARDS.tarbaby);
  // Brouillon : l'illégalité ne bloque rien, la note le dit ; pas d'alerte « actif ».
  await expect(details.getByTestId("legality-draft-note")).toBeVisible();
  await expect(details.getByTestId("legality-active-illegal")).toHaveCount(0);
  await expect(details.getByTestId("legality-not-yet-legal-names")).toHaveCount(0);
});

test("n°15 : une opération refusée affiche sa date de saisie, dans la liste et dans le panneau de droite", async ({
  page,
  context,
  api,
}) => {
  const awe = await seedStock(api, CARDS.awe, "EN", 6);
  const deck = await api.post<{ id: number }>("/decks", { name: "Datée bureau" }, 201);
  await api.post(
    `/decks/${deck.id}/cartes`,
    { card_id: awe.id, language_code: "EN", card_set_id: awe.latest_card_set_id, quantity: 1 },
    201,
  );

  await openAppDesktop(page);
  await expectCatalogDownloaded(page);
  await expectSynced(page);

  await context.setOffline(true);
  await api.patch(`/decks/${deck.id}`, { archived: true }); // même motif que sync-correction
  await goToDecksDesktop(page);
  await page.getByTestId("deck-select").filter({ hasText: "Datée bureau" }).click();
  await page.getByTestId("decks-detail-open").click();
  await page.getByRole("button", { name: /Ajouter un exemplaire de Awe/ }).click();
  await context.setOffline(false);
  await expect(page.getByTestId("sync-status")).toHaveAttribute("data-rejected", "1");

  await goToSyncDesktop(page);
  const row = page.getByTestId("rejected-operation");
  await expect(row).toHaveCount(1);
  // Format fr-FR « jj/mm/aaaa hh:mm » : on vérifie la forme, pas l'horloge.
  const stamp = /^Saisie du \d{2}\/\d{2}\/\d{4}.*\d{2}:\d{2}$/;
  await expect(row.getByTestId("rejected-recorded-at")).toHaveText(stamp);
  await expect(page.getByTestId("sync-detail-recorded-at")).toHaveText(stamp);
  // Même instant dans les deux vues.
  expect(await page.getByTestId("sync-detail-recorded-at").textContent()).toBe(
    await row.getByTestId("rejected-recorded-at").textContent(),
  );
});

test("n°12 : « Changer » du picker bureau efface la carte choisie et rend la recherche", async ({ page, api }) => {
  await api.post("/decks", { name: "Changer bureau" }, 201);

  await openAppDesktop(page);
  await expectCatalogDownloaded(page);
  await expectSynced(page);
  await openDeckbuilder(page, "Changer bureau");

  const picker = page.getByTestId("deck-builder-picker");
  await picker.getByLabel("Rechercher une carte").fill(CARDS.aura);
  await picker.getByTestId("card-picker-option").filter({ hasText: CARDS.aura }).first().click();
  await expect(picker.getByTestId("deck-card-form-selected")).toBeVisible();

  await picker.getByTestId("deck-card-form-clear").click();
  await expect(picker.getByTestId("deck-card-form-selected")).toHaveCount(0);
  await expect(picker.getByLabel("Rechercher une carte")).toBeVisible();
  // Le picker reste utilisable : on peut en choisir une autre.
  await picker.getByLabel("Rechercher une carte").fill(CARDS.awe);
  await picker.getByTestId("card-picker-option").filter({ hasText: CARDS.awe }).first().click();
  await expect(picker.getByTestId("deck-card-form-selected")).toContainText(CARDS.awe);
});

test("n°17c : le tableau « En cours » de l'Atelier bureau montre discriminant et statut de chaque deck", async ({
  page,
  api,
}) => {
  const created = await api.post<{ discriminator: string }>("/decks", { name: "Table brouillon" }, 201);

  await openAppDesktop(page);
  await expectCatalogDownloaded(page);
  await expectSynced(page);

  const row = page.getByTestId("home-deck-row").filter({ hasText: "Table brouillon" });
  await expect(row).toBeVisible();
  await expect(row.getByTestId("home-deck-row-discriminator")).toHaveText(`#${created.discriminator}`);
  await expect(row.getByTestId("home-deck-row-discriminator")).toHaveText(/^#\d{4}$/);
  await expect(row.getByTestId("home-deck-row-status")).toHaveText("brouillon");
  await expect(row.getByTestId("home-deck-row-status")).toHaveAttribute("data-status", "draft");
});

test.describe("D2 : les raccourcis de l'Atelier ouvrent la feuille annoncée", () => {
  test("« Nouveau deck » ouvre la feuille de création, une seule fois", async ({ page, api }) => {
    void api; // démarre le vrai back : sans lui le catalogue ne se télécharge pas
    await openAppDesktop(page);
    await expectCatalogDownloaded(page);

    await page.getByTestId("home-shortcut-deck").click();
    await expect(page.getByTestId("decks-page")).toBeVisible();
    await expect(page.getByTestId("deck-form")).toBeVisible();
    // L'intention est consommée : l'adresse est nue, sans `?action=`.
    await expect(page).toHaveURL(/#\/decks$/);

    // Un rechargement ne rouvre pas la feuille.
    await page.reload();
    await expect(page.getByTestId("decks-page")).toBeVisible();
    await expect(page.getByTestId("deck-form")).toHaveCount(0);

    // Retour arrière puis avant : l'entrée d'historique a été remplacée, pas rejouée.
    await page.goBack();
    await expect(page.getByTestId("home-page")).toBeVisible();
    await page.goForward();
    await expect(page.getByTestId("decks-page")).toBeVisible();
    await expect(page.getByTestId("deck-form")).toHaveCount(0);
  });

  test("« Ajouter une carte » ouvre la feuille d'ajout à la collection, une seule fois", async ({ page, api }) => {
    void api; // démarre le vrai back : sans lui le catalogue ne se télécharge pas
    await openAppDesktop(page);
    await expectCatalogDownloaded(page);

    await page.getByTestId("home-shortcut-stock").click();
    await expect(page.getByTestId("stock-page")).toBeVisible();
    await expect(page.getByTestId("stock-form")).toBeVisible();
    await expect(page.getByTestId("bundle-deposit")).toHaveCount(0);
    await expect(page).toHaveURL(/#\/collection$/);

    await page.reload();
    await expect(page.getByTestId("stock-page")).toBeVisible();
    await expect(page.getByTestId("stock-form")).toHaveCount(0);

    await page.goBack();
    await expect(page.getByTestId("home-page")).toBeVisible();
    await page.goForward();
    await expect(page.getByTestId("stock-page")).toBeVisible();
    await expect(page.getByTestId("stock-form")).toHaveCount(0);
  });

  test("« Verser un produit » ouvre la feuille de versement, une seule fois", async ({ page, api }) => {
    void api; // démarre le vrai back : sans lui le catalogue ne se télécharge pas
    await openAppDesktop(page);
    await expectCatalogDownloaded(page);

    await page.getByTestId("home-shortcut-bundle").click();
    await expect(page.getByTestId("stock-page")).toBeVisible();
    await expect(page.getByTestId("bundle-deposit")).toBeVisible();
    await expect(page.getByTestId("stock-form")).toHaveCount(0);
    await expect(page).toHaveURL(/#\/collection$/);

    await page.reload();
    await expect(page.getByTestId("stock-page")).toBeVisible();
    await expect(page.getByTestId("bundle-deposit")).toHaveCount(0);

    await page.goBack();
    await expect(page.getByTestId("home-page")).toBeVisible();
    await page.goForward();
    await expect(page.getByTestId("stock-page")).toBeVisible();
    await expect(page.getByTestId("bundle-deposit")).toHaveCount(0);
  });
});

test("la barre haute n'a plus de champ de recherche global (Lot 5c, étape 6)", async ({ page }) => {
  await openAppDesktop(page);
  await expect(page.getByTestId("topnav-home")).toBeVisible();
  await expect(page.locator("header").getByRole("searchbox")).toHaveCount(0);
  await expect(page.getByRole("searchbox", { name: "Recherche", exact: true })).toHaveCount(0);

  // Sur la Collection, la seule recherche est celle de l'écran, pas celle de la barre.
  await goToStockDesktop(page);
  await expect(page.locator("header").getByRole("searchbox")).toHaveCount(0);
  await expect(page.getByRole("searchbox", { name: "Recherche", exact: true })).toHaveCount(0);
});

test("D1 : Entrée sur un bouton de la page Decks l'active au lieu d'ouvrir le deck sélectionné", async ({
  page,
  api,
}) => {
  await api.post("/decks", { name: "Entrée bureau" }, 201);

  await openAppDesktop(page);
  await expectCatalogDownloaded(page);
  await expectSynced(page);
  await goToDecksDesktop(page);
  await expect(page.getByTestId("deck-select").filter({ hasText: "Entrée bureau" })).toBeVisible();

  // Sur le bouton « Nouveau » : il s'active, la page ne navigue pas.
  await page.getByTestId("decks-new-desktop").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("deck-form")).toBeVisible();
  await expect(page).toHaveURL(/#\/decks$/);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("deck-form")).toHaveCount(0);

  // Témoin : sans contrôle interactif focalisé, le raccourci Entrée ouvre toujours le deck sélectionné.
  await page.getByTestId("decks-page").getByRole("heading", { name: "Decks" }).click();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("deck-page")).toBeVisible();
  await expect(page).toHaveURL(/#\/decks\/.+/);
});

test("D3 : la quantité du tableau de la Collection s'édite au clavier (Tab, Entrée, saisie, Entrée)", async ({
  page,
  api,
}) => {
  const awe = await seedStock(api, CARDS.awe, "EN", 1);

  await openAppDesktop(page);
  await expectCatalogDownloaded(page);
  await expectSynced(page);
  await goToStockDesktop(page);

  const row = page.getByTestId("stock-entry").and(page.locator(`[data-card-id="${awe.id}"]`));
  await expect(row).toBeVisible();
  const cell = row.getByTestId("stock-entry-quantity-cell");

  // Tab depuis le nom de la carte atteint la cellule de quantité.
  await row.getByRole("button", { name: /^Modifier Awe/ }).focus();
  await page.keyboard.press("Tab");
  await expect(cell).toBeFocused();

  // Entrée ouvre le champ, saisie, Entrée valide : même écriture que le double-clic.
  await page.keyboard.press("Enter");
  const input = row.getByTestId("stock-table-qty-input");
  await expect(input).toBeFocused();
  await page.keyboard.press("Control+A");
  await page.keyboard.type("4");
  await page.keyboard.press("Enter");
  await expect(row.getByTestId("stock-entry-quantity")).toHaveText("4");
  await expect(input).toHaveCount(0);

  // Échap annule une seconde édition sans rien écrire.
  await cell.focus();
  await page.keyboard.press("Enter");
  await expect(input).toBeFocused();
  await input.fill("9");
  await page.keyboard.press("Escape");
  await expect(input).toHaveCount(0);
  await expect(row.getByTestId("stock-entry-quantity")).toHaveText("4");

  // Rien n'est resté bloqué côté serveur : la quantité validée est celle qui part.
  await expectSynced(page);
  const stock = await api.get<Array<{ card_id: number; quantity_owned: number }>>("/stock");
  expect(stock.find((line) => line.card_id === awe.id)?.quantity_owned).toBe(4);
});
