import { expect, test } from "./support/backend";
import { expectCatalogDownloaded, expectSynced, openApp, recordSyncRequests, syncStatus } from "./support/app";
import {
  createTournamentByForm,
  fillGame,
  goToSyncAt,
  goToTournamentsAt,
  sortedGames,
  submitGame,
  type GameRow,
  type TournamentDetailRow,
  type TournamentRow,
} from "./support/play";

/**
 * Lot 7, étape E : une finale refusée pour son deck, puis corrigée depuis l'écran
 * Synchronisation, contre le VRAI back, à 390 px.
 *
 * Choix de la largeur : au mobile, la correction est une feuille plein écran, le chemin le plus
 * contraint ; la correction à deux colonnes du bureau est déjà couverte par
 * `tests/e2e-desktop-real/sync-correction.spec.ts` (mêmes composants de champs).
 *
 * Deux refus, deux types d'opération :
 *  1. `game.create` : en choix libre, une finale jouée avec un deck qui n'a joué aucune
 *     préliminaire (le client ne sait pas calculer les decks admis : le serveur tranche) ;
 *  2. `tournament.update` : passer ensuite à « meilleur deck » alors que la finale a été jouée avec
 *     un autre deck que celui de la meilleure ronde.
 */
test("une finale refusée pour son deck, puis une règle de finale refusée, corrigées depuis l'écran Synchronisation", async ({
  page,
  context,
  api,
}) => {
  const syncCalls = recordSyncRequests(page);
  const alpha = await api.post<{ id: number }>("/decks", { name: "Alpha finale" }, 201);
  const beta = await api.post<{ id: number }>("/decks", { name: "Beta finale" }, 201);
  await api.post("/decks", { name: "Gamma finale" }, 201);

  await openApp(page);
  await expectCatalogDownloaded(page);
  await expectSynced(page);

  // --- Hors ligne : tournoi en choix libre, deux préliminaires (Alpha, Beta), finale avec Gamma ---
  await context.setOffline(true);
  await goToTournamentsAt(page, false);
  await createTournamentByForm(page, false, {
    name: "Open de la finale",
    policy: "multi",
    finalRule: "Choix libre",
  });
  const detail = page.getByTestId("tournament-detail");

  await detail.getByTestId("tournament-add-round").click();
  await fillGame(page, { deck: "Alpha finale", halfPoints: 6 }); // 3 VP, GW d'office : la meilleure ronde
  await submitGame(page);
  await detail.getByTestId("tournament-add-round").click();
  await fillGame(page, { deck: "Beta finale", halfPoints: 2 }); // 1 VP
  await submitGame(page);

  await detail.getByTestId("tournament-add-final").click();
  await expect(page.getByTestId("game-form-round")).toContainText("Finale");
  await fillGame(page, { deck: "Gamma finale", halfPoints: 4 }); // 2 VP, jamais joué en préliminaire
  await submitGame(page);
  await expect(detail.getByTestId("tournament-final").getByTestId("tournament-round")).toHaveCount(1);

  // --- Le réseau revient : la finale est refusée, le reste du lot passe ---
  await context.setOffline(false);
  await expect(syncStatus(page)).toHaveAttribute("data-rejected", "1");
  expect(syncCalls).toHaveLength(1);
  const firstLot = syncCalls[0].operations.map((operation) => operation.type);
  expect(firstLot).toEqual(["tournament.create", "game.create", "game.create", "game.create"]);

  const afterFirstLot = sortedGames(await api.get<GameRow[]>("/parties"));
  expect(afterFirstLot.map((game) => game.round_type)).toEqual(["preliminary", "preliminary"]);

  await goToSyncAt(page, false);
  const rejected = page.getByTestId("rejected-operation");
  await expect(rejected).toHaveCount(1);
  await expect(rejected).toHaveAttribute("data-operation-type", "game.create");
  await expect(rejected).toHaveAttribute("data-rejection-code", "conflict");
  await expect(rejected.getByTestId("rejected-description")).toContainText("finale"); // « Partie du …, finale »
  await expect(page.getByTestId("rejection-reason")).toContainText("Règle de gestion non respectée");
  await expect(page.getByTestId("rejection-reason")).toContainText("Finale jouée avec");
  const refusedId = (await rejected.getAttribute("data-operation-id")) as string;

  // --- Correction : le deck de la finale, avec les decks admis cités ---
  await page.getByTestId("correct-button").click();
  const form = page.getByTestId("correction-form");
  await expect(form).toBeVisible();
  const admitted = form.getByTestId("correction-admitted-decks");
  await expect(admitted).toContainText("Alpha finale");
  await expect(admitted).toContainText("Beta finale");
  await expect(admitted).not.toContainText("Gamma finale");
  const deckSelect = form.getByLabel("Mon deck");
  const betaValue = await deckSelect.locator("option").filter({ hasText: "Beta finale" }).first().getAttribute("value");
  expect(betaValue).toMatch(/^id:\d+$/);
  await deckSelect.selectOption(betaValue as string);
  await page.getByTestId("correction-submit").click();

  await expect(page.getByTestId("rejected-operation")).toHaveCount(0);
  await expectSynced(page);
  await expect(syncStatus(page)).toHaveAttribute("data-rejected", "0");
  expect(syncCalls).toHaveLength(2);
  expect(syncCalls[1].operations).toHaveLength(1);
  expect(syncCalls[1].operations[0].operation_id).not.toBe(refusedId); // nouvelle clé, jamais rejouée

  const afterCorrection = sortedGames(await api.get<GameRow[]>("/parties"));
  expect(afterCorrection).toHaveLength(3);
  const final = afterCorrection.find((game) => game.round_type === "final");
  expect(final?.me).toMatchObject({ deck_id: beta.id, victory_points: 2 });
  const tournamentId = final?.tournament_id as number;
  const tournament = await api.get<TournamentDetailRow>(`/tournois/${tournamentId}`);
  expect(tournament).toMatchObject({
    final_deck_rule: "free_choice",
    my_summary: { preliminary_game_wins: 1, preliminary_victory_points: 4, final_victory_points: 2 },
  });
  expect([...(tournament.admissible_final_decks ?? [])].sort()).toEqual([alpha.id, beta.id].sort());

  // --- Deuxième refus : « meilleur deck » alors que la finale a été jouée avec Beta, pas Alpha ---
  await context.setOffline(true);
  await page.getByTestId("nav-games").click();
  await page.getByTestId("play-switch-tournaments").click();
  await page.getByTestId("tournament-link").click();
  await expect(page.getByTestId("tournament-detail")).toBeVisible();
  await page.getByTestId("tournament-edit").click();
  const tournamentForm = page.getByTestId("tournament-form");
  await expect(tournamentForm).toBeVisible();
  await tournamentForm.locator("label.chip").filter({ hasText: "Meilleur deck" }).click();
  await tournamentForm.getByTestId("tournament-form-submit").click();
  await expect(page.getByTestId("tournament-form")).toHaveCount(0);

  await context.setOffline(false);
  await expect(syncStatus(page)).toHaveAttribute("data-rejected", "1");
  expect(syncCalls).toHaveLength(3);
  expect(syncCalls[2].operations.map((operation) => operation.type)).toEqual(["tournament.update"]);
  expect((await api.get<TournamentRow>(`/tournois/${tournamentId}`)).final_deck_rule).toBe("free_choice");

  await goToSyncAt(page, false);
  await expect(rejected).toHaveCount(1);
  await expect(rejected).toHaveAttribute("data-operation-type", "tournament.update");
  await expect(rejected).toHaveAttribute("data-rejection-code", "conflict");
  await expect(rejected.getByTestId("rejected-description")).toContainText("Open de la finale");
  await expect(rejected.getByTestId("rejected-description")).toContainText("règle du deck de finale");
  await expect(page.getByTestId("rejection-reason")).toContainText("meilleur deck des préliminaires");

  // La correction d'une opération de tournoi : la règle de finale, à ne plus annoncer.
  await page.getByTestId("correct-button").click();
  const ruleForm = page.getByTestId("correction-form");
  await expect(ruleForm).toBeVisible();
  await expect(ruleForm.getByLabel("Deck de la finale")).toHaveValue("best_performing");
  await expect(ruleForm.getByLabel("Mon deck")).toHaveCount(0); // champs limités à ce que l'opération porte
  await ruleForm.getByLabel("Deck de la finale").selectOption("");
  await page.getByTestId("correction-submit").click();

  await expect(page.getByTestId("rejected-operation")).toHaveCount(0);
  await expectSynced(page);
  expect(syncCalls).toHaveLength(4);
  expect((await api.get<TournamentRow>(`/tournois/${tournamentId}`)).final_deck_rule).toBeNull();
  expect(await api.get<unknown[]>("/tournois")).toHaveLength(1);
  expect(await api.get<unknown[]>("/parties")).toHaveLength(3);
});
