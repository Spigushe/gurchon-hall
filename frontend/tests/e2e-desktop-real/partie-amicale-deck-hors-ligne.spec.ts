import { expect, test } from "../e2e-real/support/backend";
import {
  createDeck,
  expectCatalogDownloaded,
  expectPending,
  expectSynced,
  readOutbox,
  recordSyncRequests,
  syncStatus,
} from "../e2e-real/support/app";
import {
  fillGame,
  readBindings,
  submitGame,
  type GameDetailRow,
  type GameRow,
  type PlayerRow,
} from "../e2e-real/support/play";
import { goToDecksDesktop, openAppDesktop } from "./support/nav";

/**
 * Lot 7, étape E : une partie amicale jouée avec un deck créé hors ligne **dans le même lot**,
 * contre le VRAI back, à 1440 px.
 *
 * Choix de la largeur : la saisie passe ici par le panneau latéral et le tableau du bureau ; la
 * création de deck hors ligne a déjà son parcours mobile (`journey.spec.ts`) et la saisie mobile
 * d'une partie son e2e (`games-saisie.spec.ts`). Reste à prouver que la file résout la référence
 * du deck dans la partie (mon deck et le deck prêté à un adversaire), sans réseau entre les deux.
 */
test("partie amicale avec un deck créé hors ligne : deck, adversaire et partie partent dans le même lot", async ({
  page,
  context,
  api,
}) => {
  const syncCalls = recordSyncRequests(page);
  await openAppDesktop(page);
  await expectCatalogDownloaded(page);
  await expectSynced(page);

  await context.setOffline(true);
  await expect(syncStatus(page)).toHaveAttribute("data-state", "offline");

  // Le deck naît hors ligne : il n'a qu'une référence `ref:<uuid>`.
  await goToDecksDesktop(page);
  await page.getByTestId("decks-new-desktop").click();
  const deckKey = await createDeck(page, "Deck du bar");
  expect(await api.get<unknown[]>("/decks")).toEqual([]);

  // La partie amicale, dans le panneau latéral : le deck neuf est proposé, et prêté à Marc.
  await page.getByTestId("topnav-games").click();
  await expect(page.getByTestId("games-page")).toBeVisible();
  await page.getByTestId("games-empty-create").or(page.getByTestId("games-new-desktop")).first().click();
  await expect(page.getByTestId("game-form-tournament")).toContainText("Amicale");
  await fillGame(page, {
    deck: "Deck du bar",
    players: 4,
    halfPoints: 5, // 2,5 VP à quatre : GW certain
    opponents: [{ name: "Marc", lend: "Deck du bar" }],
  });
  await expect(page.getByTestId("game-form-gw")).toBeChecked();
  await submitGame(page);

  const row = page.getByTestId("game-item");
  await expect(row).toHaveCount(1);
  await expect(row).toHaveAttribute("data-pending", "true");
  await expect(row).toContainText("Deck du bar");
  await expect(row.getByTestId("game-result")).toContainText("2,5 VP · GW");

  // Trois opérations dans l'ordre : le deck d'abord, puis l'adversaire, puis la partie qui les cite.
  const queued = await readOutbox(page);
  expect(queued.map((entry) => entry.type)).toEqual(["deck.create", "player.create", "game.create"]);
  await expectPending(page, 3);
  const ids = queued.map((entry) => entry.operationId);
  expect(await api.get<unknown[]>("/parties")).toEqual([]);

  // Rechargement hors ligne : rien ne se perd, la partie cite toujours le même deck.
  await page.reload();
  await expect(syncStatus(page)).toHaveAttribute("data-state", "offline");
  await expectPending(page, 3);
  await page.getByTestId("topnav-games").click();
  await expect(page.getByTestId("game-item")).toHaveCount(1);
  await expect(page.getByTestId("game-item")).toContainText("Deck du bar");

  // Le réseau revient : un lot, trois verdicts « appliquée », une seule fois chaque objet.
  await context.setOffline(false);
  await expectSynced(page);
  await expect(syncStatus(page)).toHaveAttribute("data-rejected", "0");
  expect(syncCalls).toHaveLength(1);
  expect(syncCalls[0].operations.map((operation) => operation.operation_id)).toEqual(ids);

  const decks = await api.get<Array<{ id: number; name: string; discriminator: string }>>("/decks");
  expect(decks).toHaveLength(1);
  expect(decks[0].name).toBe("Deck du bar");
  const games = await api.get<GameRow[]>("/parties");
  expect(games).toHaveLength(1);
  expect(games[0]).toMatchObject({
    tournament_id: null,
    round_type: "casual",
    player_count: 4,
    me: { deck_id: decks[0].id, victory_points: 2.5, game_win: true },
  });
  const players = await api.get<PlayerRow[]>("/joueurs");
  const marc = players.find((player) => player.name === "Marc") as PlayerRow;
  expect(marc).toBeDefined();
  const detail = await api.get<GameDetailRow>(`/parties/${games[0].id}`);
  expect(detail.participations.find((line) => line.player_id === marc.id)?.deck_id).toBe(decks[0].id);

  // La référence du deck est liée à son identifiant ; l'écran garde la partie, sans « en attente ».
  const bindings = await readBindings(page);
  expect(bindings.find((binding) => binding.kind === undefined || binding.kind === "deck")).toMatchObject({
    ref: deckKey.slice("ref:".length),
    id: decks[0].id,
  });
  await expect(page.getByTestId("game-item")).toHaveAttribute("data-pending", "false");
  await expect(page.getByTestId("game-item")).toContainText("Deck du bar");
  expect(syncCalls, "aucun renvoi superflu").toHaveLength(1);
});
