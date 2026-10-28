import { expect, test } from "@playwright/test";
import { openAppMocked } from "../e2e/support/mockAuth";

/**
 * Panneau latéral bureau (`Sheet` en disposition ≥1024px, Lot 5bis étape 3,
 * `docs/lot5bis-plan-design.md`) : focus piégé, retour du focus au
 * déclencheur, fond `inert` pendant l'ouverture. Sans vrai back : la feuille
 * « Nouveau deck » s'ouvre et se referme sans jamais valider (Échap, pas de
 * clic sur « Créer »), donc aucune écriture ne part en file et aucun backend
 * n'est nécessaire pour la feuille elle-même — seul le mur de connexion
 * (Lot 6, `AuthGate`) est contourné par `openAppMocked`.
 */
test.describe("panneau latéral bureau", () => {
  test("focus piégé, retour du focus et fond inerte pendant l'ouverture", async ({ page }) => {
    await openAppMocked(page, "/#/decks");
    await expect(page.getByTestId("decks-page")).toBeVisible();

    const opener = page.getByTestId("decks-new-desktop");
    await opener.click();
    const sheet = page.getByTestId("deck-form-sheet");
    await expect(sheet).toBeVisible();

    // Le reste de l'application est inert pendant que le panneau est ouvert
    // (`acquireBackgroundInert`, `Sheet.tsx`) : le conteneur racine React en
    // porte l'attribut, jamais le portail de la feuille elle-même.
    await expect(page.locator("#root")).toHaveAttribute("inert", "");

    const closeButton = sheet.getByLabel("Fermer");
    const submitButton = sheet.getByTestId("deck-form-submit");

    // Shift+Tab depuis le premier élément focalisable boucle sur le dernier.
    await closeButton.focus();
    await page.keyboard.press("Shift+Tab");
    await expect(submitButton).toBeFocused();

    // Tab depuis le dernier élément focalisable boucle sur le premier.
    await page.keyboard.press("Tab");
    await expect(closeButton).toBeFocused();

    // Échap ferme le panneau et rend le focus à l'élément qui l'avait ouvert.
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    await expect(opener).toBeFocused();
    await expect(page.locator("#root")).not.toHaveAttribute("inert");
  });
});
