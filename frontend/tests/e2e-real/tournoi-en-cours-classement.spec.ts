import { expect, test } from "./support/backend";
import { expectCatalogDownloaded, expectSynced, openApp, recordSyncRequests, syncStatus } from "./support/app";
import { fillGame, localDay, submitGame, type GameRow, type TournamentRow } from "./support/play";

/**
 * Lot 7, étape E : la carte « Tournoi en cours » de l'Atelier et le classement final, contre le
 * VRAI back, à 390 px (la carte a deux emplacements selon la largeur ; le mobile est la cible du
 * pilote, et le même `RankingSection` sert les deux largeurs).
 *
 * Un tournoi mono-deck de deux rondes prévues, commencé aujourd'hui, a déjà sa ronde 1 côté
 * serveur. La carte propose la ronde 2 avec le deck du mono-deck, puis la finale (rondes prévues
 * atteintes), puis le classement ; une place invalide est refusée sur place, sans rien envoyer.
 */
test("la carte « Tournoi en cours » ouvre la saisie préremplie, puis le classement final refuse une place invalide", async ({
  page,
  api,
}) => {
  const syncCalls = recordSyncRequests(page);
  const alpha = await api.post<{ id: number }>("/decks", { name: "Alpha du jour" }, 201);
  const tournament = await api.post<{ id: number }>(
    "/tournois",
    { name: "Open du jour", start_date: localDay(), deck_policy: "mono", round_count: 2 },
    201,
  );
  await api.post(
    "/parties",
    {
      // Deux heures plus tôt : la saisie arrondit son heure à la minute, « dernière ronde » se lit à l'heure.
      played_at: new Date(Date.now() - 2 * 3_600_000).toISOString(),
      tournament: { tournament_id: tournament.id },
      round_type: "preliminary",
      round_number: 1,
      player_count: 5,
      participations: [{ player: { me: true }, deck: { deck_id: alpha.id }, victory_points: 3, game_win: true }],
    },
    201,
  );

  await openApp(page);
  await expectCatalogDownloaded(page);
  await expectSynced(page);

  // La carte de l'Atelier : nom, dernière ronde, bouton vers la ronde 2.
  const card = page.getByTestId("home-tournament");
  await expect(card).toBeVisible();
  await expect(card.getByTestId("home-tournament-name")).toHaveText("Open du jour");
  await expect(card.getByTestId("home-tournament-last")).toContainText("ronde 1");
  await expect(card.getByTestId("home-tournament-last")).toContainText("Alpha du jour");
  await expect(card.getByTestId("home-tournament-enter")).toHaveText("Saisir la ronde 2");

  // La saisie s'ouvre préremplie : tournoi, ronde 2, deck du mono-deck (aucun avertissement).
  await card.getByTestId("home-tournament-enter").click();
  await expect(page.getByTestId("game-form")).toBeVisible();
  await expect(page.getByTestId("game-form-tournament")).toContainText("Open du jour");
  await expect(page.getByTestId("game-form-round")).toContainText("Ronde 2");
  await expect(page.getByTestId("game-form-deck")).toHaveText("Alpha du jour");
  await expect(page.getByTestId("game-form-deck-hint")).toContainText("mono-deck");
  await expect(page.getByTestId("game-form-mono-warning")).toHaveCount(0);
  await fillGame(page, { halfPoints: 2 }); // 1 VP, sans GW
  await submitGame(page);

  // Les rondes prévues sont atteintes : la carte propose la finale, préremplie elle aussi.
  await expect(card.getByTestId("home-tournament-last")).toContainText("ronde 2");
  await expect(card.getByTestId("home-tournament-enter")).toHaveText("Saisir la finale");
  await expect(card.getByTestId("home-tournament-enter")).toBeVisible();
  await card.getByTestId("home-tournament-enter").click();
  await expect(page.getByTestId("game-form-round")).toContainText("Finale");
  await expect(page.getByTestId("game-form-deck")).toHaveText("Alpha du jour");
  await fillGame(page, { halfPoints: 4 }); // 2 VP à cinq : à la déclaration, sans GW
  await submitGame(page);
  await expectSynced(page);

  // La finale saisie, le bouton devient un lien vers le classement.
  await expect(card.getByTestId("home-tournament-enter")).toHaveCount(0);
  await card.getByTestId("home-tournament-ranking").click();
  const ranking = page.getByTestId("tournament-ranking");
  await expect(ranking).toBeVisible();
  await expect(ranking.getByTestId("tournament-ranking-final-help")).toContainText("Finaliste");
  await expect(ranking.getByTestId("tournament-ranking-players-help")).toBeVisible(); // nombre de joueurs inconnu

  const rankingOps = () =>
    syncCalls.flatMap((call) => call.operations).filter((operation) => operation.type === "tournament.update");

  // Place invalide, 1 : au-delà de la cinquième après une finale. Rien ne part.
  await ranking.getByTestId("tournament-ranking-place").fill("6");
  await ranking.getByTestId("tournament-ranking-players").fill("27");
  await ranking.getByTestId("tournament-ranking-submit").click();
  await expect(ranking.getByTestId("tournament-ranking-error")).toContainText("Finaliste : votre place va de 1 à 5.");
  await expect(ranking.getByTestId("tournament-ranking-error")).toBeFocused();
  await expect(ranking.getByTestId("tournament-ranking-saved")).toHaveCount(0);

  // Place invalide, 2 : au-delà du nombre de joueurs.
  await ranking.getByTestId("tournament-ranking-place").fill("9");
  await ranking.getByTestId("tournament-ranking-players").fill("5");
  await ranking.getByTestId("tournament-ranking-submit").click();
  await expect(ranking.getByTestId("tournament-ranking-error")).toContainText("Au plus 5e sur 5 joueurs.");
  expect(rankingOps(), "une place invalide n'est jamais envoyée").toHaveLength(0);
  expect((await api.get<TournamentRow>(`/tournois/${tournament.id}`)).my_ranking).toBeNull();

  // Place valide : 3e sur 27, enregistrée puis envoyée.
  await ranking.getByTestId("tournament-ranking-place").fill("3");
  await ranking.getByTestId("tournament-ranking-players").fill("27");
  await expect(ranking.getByTestId("tournament-ranking-error")).toHaveCount(0);
  await ranking.getByTestId("tournament-ranking-submit").click();
  await expect(ranking.getByTestId("tournament-ranking-saved")).toBeVisible();
  await expectSynced(page);
  await expect(syncStatus(page)).toHaveAttribute("data-rejected", "0");
  expect(rankingOps()).toHaveLength(1);

  const saved = await api.get<TournamentRow>(`/tournois/${tournament.id}`);
  expect(saved).toMatchObject({
    my_ranking: 3,
    player_count: 27,
    my_summary: { preliminary_game_wins: 1, preliminary_victory_points: 4, final_victory_points: 2 },
  });
  const games = await api.get<GameRow[]>("/parties");
  expect(games).toHaveLength(3);
  expect(games.filter((game) => game.me.deck_id === alpha.id)).toHaveLength(3); // le même deck partout

  // La liste des tournois affiche « 3e / 27 » ; la carte de l'Atelier a disparu (classement saisi).
  await page.getByTestId("nav-games").click();
  await page.getByTestId("play-switch-tournaments").click();
  await expect(page.getByTestId("tournament-ranking-cell")).toContainText("3e");
  await expect(page.getByTestId("tournament-ranking-cell")).toContainText("27");
  await page.getByTestId("nav-home").click();
  await expect(page.getByTestId("home-page")).toBeVisible();
  await expect(page.getByTestId("home-tournament")).toHaveCount(0);
});
