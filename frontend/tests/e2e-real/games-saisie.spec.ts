import { expect, test } from "./support/backend";
import { expectCatalogDownloaded, expectSynced, openApp } from "./support/app";

/**
 * Lot 7, étape D1 : « nouvelle partie » à 390 px, contre le VRAI back. Une partie saisie
 * sans réseau (lieu créé au fil de la frappe, deck, siège, VP, GW certain, adversaire nommé)
 * apparaît aussitôt dans la liste avec sa pastille « en attente », puis part au retour du réseau.
 * Le scénario complet du plan (tournoi multi-deck, finale refusée) vient avec l'étape E.
 */
test("saisit une partie hors ligne, la voit en attente, puis la retrouve synchronisée", async ({
  page,
  context,
  api,
}) => {
  await api.post("/decks", { name: "Banu Princes" }, 201);

  await openApp(page);
  await expectCatalogDownloaded(page);
  await expectSynced(page);

  await context.setOffline(true);
  await page.getByTestId("nav-games").click();
  await expect(page.getByTestId("games-page")).toBeVisible();
  await expect(page.getByTestId("games-empty")).toBeVisible();

  await page.getByTestId("game-add").click();
  const form = page.getByTestId("game-form");
  await expect(form).toBeVisible();

  await form.getByTestId("game-form-venue").click();
  await page.getByTestId("game-venue-picker-search").fill("Chez Marc");
  await page.getByTestId("game-venue-picker-create").click();
  await expect(page.getByTestId("game-form-venue")).toContainText("Chez Marc");

  await page.getByTestId("game-form-deck-change").click();
  await page.getByTestId("game-deck-picker-options").getByText("Banu Princes").click();
  await expect(page.getByTestId("game-form-deck")).toContainText("Banu Princes");

  // Les puces cachent leur case : on clique l'étiquette, comme un doigt.
  await page.getByTestId("game-form-seats").getByText("2", { exact: true }).click();
  await expect(page.getByTestId("game-form-seat-2")).toBeChecked();
  for (let i = 0; i < 6; i += 1) await page.getByLabel("Ajouter un demi-point de VP").click();
  await expect(page.getByTestId("game-form-gw")).toBeChecked();
  await expect(page.getByTestId("game-form-gw-help")).toContainText("Coché d'office");

  await page.getByTestId("game-form-opponents-toggle").click();
  await page.getByTestId("game-form-opponent-input").fill("Marc");
  await page.getByTestId("game-form-opponent-create").click();
  await expect(page.getByTestId("game-form-opponent")).toContainText("Marc");

  await page.getByTestId("game-form-submit").click();
  await expect(page.getByTestId("game-form")).toHaveCount(0);

  const item = page.getByTestId("game-item");
  await expect(item).toHaveCount(1);
  await expect(item).toHaveAttribute("data-pending", "true");
  await expect(item).toContainText("Banu Princes");
  await expect(item.getByTestId("game-result")).toContainText("3 VP · GW");

  // Le réseau revient : la file part, la partie existe côté serveur, l'écran la garde.
  await context.setOffline(false);
  await expectSynced(page);
  await expect(page.getByTestId("game-item")).toHaveAttribute("data-pending", "false");

  const games = await api.get<
    Array<{ player_count: number; venue_id: number | null; me: { victory_points: number | null; game_win: boolean | null; seat: number | null } }>
  >("/parties");
  expect(games).toHaveLength(1);
  expect(games[0]).toMatchObject({ player_count: 5, me: { victory_points: 3, game_win: true, seat: 2 } });
  expect(games[0].venue_id).not.toBeNull();

  // La table côté serveur : mon deck, et l'adversaire nommé (créé par la file, sans siège ni score).
  const players = await api.get<Array<{ id: number; name: string; is_me: boolean }>>("/joueurs");
  const marc = players.find((player) => player.name === "Marc");
  expect(marc, "l'adversaire est créé côté serveur").toBeDefined();
  expect(marc?.is_me).toBe(false);
  const detail = await api.get<{
    participations: Array<{ player_id: number; is_me: boolean; deck_id: number | null; seat: number | null; victory_points: number | null; game_win: boolean | null }>;
  }>(`/parties/${(games[0] as unknown as { id: number }).id}`);
  expect(detail.participations).toHaveLength(2);
  expect(detail.participations.find((line) => line.is_me)).toMatchObject({ seat: 2, victory_points: 3, game_win: true });
  expect(detail.participations.find((line) => line.is_me)?.deck_id).not.toBeNull();
  expect(detail.participations.find((line) => !line.is_me)).toMatchObject({
    player_id: marc?.id,
    seat: null,
    victory_points: null,
    game_win: null,
  });

  await page.getByTestId("game-link").click();
  await expect(page.getByTestId("game-detail-title")).toContainText("3 VP · Game Win");
  // Marc, nommé sans siège, figure sous la table.
  await expect(page.getByTestId("game-seat").filter({ hasText: "Marc" })).toHaveCount(1);
});
