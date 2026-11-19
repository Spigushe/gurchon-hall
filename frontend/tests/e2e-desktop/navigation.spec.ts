import { expect, test } from "@playwright/test";
import { openAppMocked } from "../e2e/support/mockAuth";

/**
 * Navigation bureau (≥1024px, `docs/design-handoff/DESKTOP.md`), sans
 * vrai back : la barre haute et le chord clavier `G` puis une lettre
 * (Lot 5bis, étapes 1 et 2, `docs/lot5bis-plan-design.md`) ne dépendent
 * d'aucune donnée serveur — le catalogue reste absent (miroir local vide),
 * sans effet sur ces écrans. Le mur de connexion (Lot 6, `AuthGate`) est
 * contourné par `openAppMocked` (`POST /connexion` simulé, cf. ce module) :
 * ce projet n'a aucun back à authentifier.
 *
 * Miroir bureau de `tests/e2e/` : mêmes garanties (aucune écriture, aucun
 * réseau), sans reprendre les scénarios offline propres au mobile (déjà
 * couverts par `chromium`).
 */
test.describe("navigation bureau", () => {
  test("clic sur un onglet de la barre haute change d'écran", async ({ page }) => {
    await openAppMocked(page);
    await expect(page.getByTestId("home-page")).toBeVisible();
    await expect(page.getByTestId("topnav-home")).toHaveAttribute("aria-current", "page");

    await page.getByTestId("topnav-stock").click();
    await expect(page.getByTestId("stock-page")).toBeVisible();
    await expect(page.getByTestId("topnav-stock")).toHaveAttribute("aria-current", "page");

    await page.getByTestId("topnav-decks").click();
    await expect(page.getByTestId("decks-page")).toBeVisible();
    await expect(page.getByTestId("topnav-decks")).toHaveAttribute("aria-current", "page");

    // Synchronisation a quitté la barre haute (Lot 12, A11) : elle s'ouvre depuis
    // le menu du compte, puis l'écran Compte, et aucun onglet n'y est surligné.
    await expect(page.getByTestId("topnav-sync")).toHaveCount(0);
    await page.getByTestId("account-menu-toggle").click();
    await page.getByTestId("account-menu-account").click();
    await expect(page.getByTestId("account-page")).toBeVisible();
    await page.getByTestId("account-sync-row").click();
    await expect(page.getByTestId("sync-page")).toBeVisible();
    await expect(page.locator('.topbar__nav [aria-current="page"]')).toHaveCount(0);
    await page.getByTestId("sync-back").click();
    await expect(page.getByTestId("account-page")).toBeVisible();

    await page.getByTestId("topnav-home").click();
    await expect(page.getByTestId("home-page")).toBeVisible();
  });

  test("le chord clavier G puis une lettre navigue comme la barre haute", async ({ page }) => {
    await openAppMocked(page);
    await expect(page.getByTestId("home-page")).toBeVisible();

    await page.keyboard.press("g");
    await page.keyboard.press("c");
    await expect(page.getByTestId("stock-page")).toBeVisible();

    await page.keyboard.press("g");
    await page.keyboard.press("d");
    await expect(page.getByTestId("decks-page")).toBeVisible();

    // `G S` reste câblé alors que l'onglet a disparu (Lot 12, A11).
    await page.keyboard.press("g");
    await page.keyboard.press("s");
    await expect(page.getByTestId("sync-page")).toBeVisible();

    await page.keyboard.press("g");
    await page.keyboard.press("a");
    await expect(page.getByTestId("home-page")).toBeVisible();
  });
});
