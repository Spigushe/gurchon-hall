import { expect, test } from "../e2e-real/support/backend";
import { expectCatalogDownloaded, expectSynced } from "../e2e-real/support/app";
import { openAppDesktop } from "./support/nav";

/**
 * Lot 7, étape D1 : « nouvelle partie » à 1440 px, contre le VRAI back (d10, d11). Onglet
 * « Parties » de la barre haute, raccourci `N`, panneau latéral validé par `⌘↵` / `Ctrl↵`,
 * puis tableau et détail à droite. Le scénario complet du plan vient avec l'étape E.
 */
test("saisit une partie au clavier dans le panneau latéral et la retrouve dans le tableau", async ({ page, api }) => {
  await api.post("/decks", { name: "Banu Princes" }, 201);

  await openAppDesktop(page);
  await expectCatalogDownloaded(page);
  await expectSynced(page);

  await page.getByTestId("topnav-games").click();
  await expect(page.getByTestId("games-page")).toBeVisible();
  await expect(page.getByTestId("topnav-games")).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("games-empty")).toBeVisible();

  await page.keyboard.press("n");
  const form = page.getByTestId("game-form");
  await expect(form).toBeVisible();

  await form.getByTestId("game-form-deck-change").click();
  await page.getByTestId("game-deck-picker-options").getByText("Banu Princes").click();
  await expect(page.getByTestId("game-form-deck")).toContainText("Banu Princes");

  // Les puces cachent leur case : on clique l'étiquette.
  await form.getByTestId("game-form-count").getByText("4", { exact: true }).click();
  await expect(form.getByTestId("game-form-count-4")).toBeChecked();
  for (let i = 0; i < 5; i += 1) await page.getByLabel("Ajouter un demi-point de VP").click();
  // 2,5 VP à quatre joueurs : seul en tête, le GW est certain.
  await expect(page.getByTestId("game-form-gw")).toBeChecked();
  await expect(page.getByTestId("game-form-gw-help")).toContainText("2,5 VP à 4 joueurs");

  await form.getByTestId("game-form-opponents-toggle").click();
  await form.getByTestId("game-form-opponent-input").fill("Marc");
  await form.getByTestId("game-form-opponent-create").click();
  await expect(form.getByTestId("game-form-opponent")).toContainText("Marc");

  await page.keyboard.press("Control+Enter");
  await expect(page.getByTestId("game-form")).toHaveCount(0);

  const row = page.getByTestId("game-item");
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("Banu Princes");
  await expect(row.getByTestId("game-result")).toContainText("2,5 VP · GW");
  await expect(page.getByTestId("games-detail").getByTestId("game-detail-title")).toContainText("2,5 VP · Game Win");
  await expectSynced(page);

  const games = await api.get<Array<{ player_count: number; me: { victory_points: number | null; game_win: boolean | null } }>>(
    "/parties",
  );
  expect(games).toHaveLength(1);
  expect(games[0]).toMatchObject({ player_count: 4, me: { victory_points: 2.5, game_win: true } });

  const players = await api.get<Array<{ id: number; name: string; is_me: boolean }>>("/joueurs");
  const marc = players.find((player) => player.name === "Marc");
  expect(marc?.is_me).toBe(false);
  const detail = await api.get<{ participations: Array<{ player_id: number; is_me: boolean }> }>(
    `/parties/${(games[0] as unknown as { id: number }).id}`,
  );
  expect(detail.participations).toHaveLength(2);
  expect(detail.participations.some((line) => !line.is_me && line.player_id === marc?.id)).toBe(true);
});
