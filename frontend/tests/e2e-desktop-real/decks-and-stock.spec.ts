import { expect, test } from "../e2e-real/support/backend";
import { CARDS, cardInfo, expectCatalogDownloaded, expectSynced } from "../e2e-real/support/app";
import { goToDecksDesktop, goToStockDesktop, openAppDesktop } from "./support/nav";

/**
 * Deux écrans bureau qui n'ont pas d'équivalent mobile direct, non redondants
 * avec `deckbuilder.spec.ts` et `sync-correction.spec.ts` (plan § répartition
 * qa-tests) : le maître/détail des Decks (étape 6) et le tableau de la
 * Collection (étape 8).
 */

test("maître/détail Decks : sélectionner une ligne met à jour l'aperçu sans quitter /decks", async ({
  page,
  api,
}) => {
  const awe = await cardInfo(api, CARDS.awe);
  await api.post(
    "/stock",
    { card_id: awe.id, language_code: "EN", card_set_id: awe.latest_card_set_id, quantity_owned: 3 },
    201,
  );
  const deckA = await api.post<{ id: number }>("/decks", { name: "Aperçu bureau" }, 201);
  await api.post(
    `/decks/${deckA.id}/cartes`,
    { card_id: awe.id, language_code: "EN", card_set_id: awe.latest_card_set_id, quantity: 3 },
    201,
  );
  await api.post("/decks", { name: "Second deck bureau" }, 201);

  await openAppDesktop(page);
  await expectCatalogDownloaded(page);
  await expectSynced(page);
  await goToDecksDesktop(page);

  await expect(page.getByTestId("decks-detail")).toBeVisible();
  await page.getByTestId("deck-select").filter({ hasText: "Aperçu bureau" }).click();
  await expect(page.getByTestId("decks-detail-title")).toHaveText("Aperçu bureau");
  await expect(page.getByTestId("decks-detail-library")).toContainText(CARDS.awe);
  // Rester sur /decks : la sélection n'ouvre pas le deckbuilder plein écran.
  await expect(page).toHaveURL(/#\/decks$/);

  await page.getByTestId("deck-select").filter({ hasText: "Second deck bureau" }).click();
  await expect(page.getByTestId("decks-detail-title")).toHaveText("Second deck bureau");
  await expect(page.getByTestId("decks-detail-empty-composition")).toBeVisible();
});

test("tableau bureau de la Collection : tri par colonne et édition en place de la quantité", async ({ page, api }) => {
  const awe = await cardInfo(api, CARDS.awe);
  const aura = await cardInfo(api, CARDS.aura);
  await api.post(
    "/stock",
    { card_id: awe.id, language_code: "EN", card_set_id: awe.latest_card_set_id, quantity_owned: 1 },
    201,
  );
  await api.post(
    "/stock",
    { card_id: aura.id, language_code: "EN", card_set_id: aura.latest_card_set_id, quantity_owned: 2 },
    201,
  );

  await openAppDesktop(page);
  await expectCatalogDownloaded(page);
  await expectSynced(page);
  await goToStockDesktop(page);

  const table = page.getByTestId("stock-table");
  await expect(table).toBeVisible();
  const rows = table.getByTestId("stock-entry");
  await expect(rows).toHaveCount(2);

  // Tri par nom, croissant par défaut : Aura Absorption avant Awe.
  await expect(rows.first()).toContainText(CARDS.aura);

  // Reclique la même colonne : bascule décroissant, Awe passe devant.
  await table.getByTestId("stock-table-sort-name").click();
  await expect(rows.first()).toContainText(CARDS.awe);

  // Édition en place : double-clic sur la cellule « Ex. », saisie, Entrée —
  // même écriture (`actions.saveStock`) que le stepper mobile, sans second
  // chemin (revue pwa-offline de l'étape 8, `docs/lot5bis-plan-design.md`).
  const aweRow = rows.filter({ hasText: CARDS.awe });
  await aweRow.getByTestId("stock-entry-quantity-cell").dblclick();
  const input = aweRow.getByTestId("stock-table-qty-input");
  await input.fill("5");
  await input.press("Enter");
  await expect(aweRow.getByTestId("stock-entry-quantity")).toHaveText("5");
});
