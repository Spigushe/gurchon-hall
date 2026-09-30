import { expect, test } from "../e2e-real/support/backend";
import { CARDS, expectCatalogDownloaded, expectSynced } from "../e2e-real/support/app";
import { goToDecksDesktop, openAppDesktop } from "./support/nav";

/**
 * Deckbuilder bureau à deux colonnes (Lot 5bis, étape 11,
 * `docs/design-handoff-mobile/DESKTOP.md` « d01 ») : le picker fusionné reste
 * **toujours visible** dans la colonne de droite (`deck-builder-picker`),
 * sans jamais passer par la feuille plein écran du mobile
 * (`deck-card-form-sheet`) — c'est la seule différence de comportement avec
 * le mobile (disposition, pas interaction, cf. le plan § Risques). Un vrai
 * back est nécessaire : l'ajout acquiert automatiquement ce qui manque en
 * collection (Lot 4b), une écriture réelle vérifiée côté serveur.
 */
test("ajoute une carte depuis le picker toujours visible, sans passer par une feuille", async ({ page, api }) => {
  await api.post("/decks", { name: "Deckbuilder bureau" }, 201);

  await openAppDesktop(page);
  await expectCatalogDownloaded(page);
  await expectSynced(page);

  await goToDecksDesktop(page);
  await page.getByTestId("deck-select").filter({ hasText: "Deckbuilder bureau" }).click();
  await page.getByTestId("decks-detail-open").click();

  const columns = page.getByTestId("deck-builder-columns");
  await expect(columns).toBeVisible();
  const picker = page.getByTestId("deck-builder-picker");
  await expect(picker).toBeVisible();
  // Pas de feuille : le picker est rendu nu dans la colonne de droite.
  await expect(page.getByTestId("deck-card-form-sheet")).toHaveCount(0);

  // `/` focalise la recherche même sans clic préalable dedans (raccourci du
  // picker bureau, cf. `AddDeckCardForm`).
  await page.keyboard.press("/");
  const search = picker.getByLabel("Rechercher une carte");
  await expect(search).toBeFocused();

  await search.fill(CARDS.aura);
  await picker.getByTestId("card-picker-option").filter({ hasText: CARDS.aura }).first().click();
  await expect(picker.getByTestId("deck-card-form-selected")).toBeVisible();

  await picker.getByRole("spinbutton", { name: "Copies dans le deck" }).fill("2");
  await picker.getByTestId("deck-card-form-submit").click();

  await expect(picker.getByTestId("deck-card-form-feedback")).toContainText("au deck");
  // Le picker reste monté après l'envoi (contrairement au mobile, qui referme
  // sa feuille) : la recherche est toujours utilisable pour l'ajout suivant.
  await expect(picker.getByLabel("Rechercher une carte")).toBeVisible();

  const line = page.getByTestId("deck-card").filter({ hasText: CARDS.aura });
  await expect(line).toHaveAttribute("data-quantity", "2");
  // Écriture optimiste du miroir : la teinte « +N à l'instant » apparaît tout
  // de suite, avant tout aller-retour serveur (`DeckComposition`, § Risques du plan).
  await expect(line).toContainText("à l'instant");
});
