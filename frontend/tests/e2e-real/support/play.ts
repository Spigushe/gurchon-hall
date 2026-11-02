import { expect, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { openAppDesktop } from "../../e2e-desktop-real/support/nav";
import type { Api } from "./backend";
import { expectCatalogDownloaded, expectPending, expectSynced, openApp, readOutbox, recordSyncRequests, syncStatus } from "./app";

/**
 * Gestes de la pratique de jeu (Lot 7, étape E), partagés par les e2e mobile (390 px) et bureau
 * (1440 px). Les écrans sont les mêmes composants aux deux largeurs ; seuls changent la
 * navigation (tab bar ou barre haute) et la façon d'ouvrir une création (pilule flottante ou
 * bouton de l'en-tête). Tout passe par les `data-testid` et les libellés stables.
 */

export const openAppAt = (page: Page, desktop: boolean) => (desktop ? openAppDesktop(page) : openApp(page));

/** Même rôle que `waitForServiceWorkerControl`, sans exiger le `<h1>` que le bureau masque. */
export async function waitForServiceWorkerControlAt(page: Page, desktop: boolean): Promise<void> {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  await expect(page.getByTestId(desktop ? "topnav-games" : "nav-games")).toBeVisible();
}

export async function goToGamesAt(page: Page, desktop: boolean): Promise<void> {
  await page.getByTestId(desktop ? "topnav-games" : "nav-games").click();
  await expect(page.getByTestId("games-page")).toBeVisible();
}

export async function goToTournamentsAt(page: Page, desktop: boolean): Promise<void> {
  await goToGamesAt(page, desktop);
  await page.getByTestId("play-switch-tournaments").click();
  await expect(page.getByTestId("tournaments-page")).toBeVisible();
}

export async function goToSyncAt(page: Page, desktop: boolean): Promise<void> {
  if (desktop) {
    await page.getByTestId("topnav-sync").click();
  } else {
    await page.getByTestId("nav-home").click();
    await page.getByTestId("sync-alert-link").click();
  }
  await expect(page.getByTestId("sync-page")).toBeVisible();
}

/** Ouvre la feuille « Nouveau tournoi » depuis la liste des tournois. */
export async function openTournamentForm(page: Page, desktop: boolean): Promise<Locator> {
  await page.getByTestId(desktop ? "tournaments-new-desktop" : "tournament-add").click();
  const form = page.getByTestId("tournament-form");
  await expect(form).toBeVisible();
  return form;
}

export interface TournamentInput {
  name: string;
  /** Lieu créé au fil de la frappe dans le sélecteur. */
  venue?: string;
  policy?: "mono" | "multi";
  /** Libellé de la règle de finale (multi seulement). */
  finalRule?: "Meilleur deck" | "Choix libre";
}

/** Crée un tournoi par la feuille ; rend le `data-tournament-key` du détail qui s'affiche ensuite. */
export async function createTournamentByForm(page: Page, desktop: boolean, input: TournamentInput): Promise<string> {
  const form = await openTournamentForm(page, desktop);
  await form.getByTestId("tournament-form-name").fill(input.name);
  if (input.venue) {
    await form.getByTestId("tournament-form-venue-change").click();
    await page.getByTestId("tournament-venue-picker-search").fill(input.venue);
    await page.getByTestId("tournament-venue-picker-create").click();
    await expect(page.getByTestId("tournament-form-venue")).toContainText(input.venue);
  }
  if (input.policy === "multi") {
    await form.locator("label.seg__option").filter({ hasText: "Multi-deck" }).click();
    await expect(form.getByTestId("tournament-form-policy-multi")).toBeChecked();
    if (input.finalRule) {
      await form.locator("label.chip").filter({ hasText: input.finalRule }).click();
    }
  }
  await form.getByTestId("tournament-form-submit").click();
  await expect(page.getByTestId("tournament-form")).toHaveCount(0);
  const detail = page.getByTestId("tournament-detail");
  await expect(detail).toBeVisible();
  await expect(detail.getByTestId("tournament-detail-title")).toHaveText(input.name);
  const key = await detail.getAttribute("data-tournament-key");
  expect(key).toMatch(/^ref:/);
  return key as string;
}

export interface GameInput {
  /** Nom du deck joué, choisi dans le sélecteur ; absent : aucun deck. */
  deck?: string;
  /** 4 ou 5 (puces), 5 par défaut. */
  players?: 4 | 5;
  /** Nombre de demi-points de VP ajoutés au départ (0). */
  halfPoints?: number;
  /** Adversaires : nom, `existing` s'il est déjà au carnet, `lend` = nom du deck prêté. */
  opponents?: Array<{ name: string; existing?: boolean; lend?: string }>;
}

export async function chooseDeck(page: Page, name: string): Promise<void> {
  await page.getByTestId("game-form-deck-change").click();
  await page
    .getByTestId("game-deck-picker-options")
    .locator("button.choice-row")
    .filter({ hasText: name })
    .first()
    .click();
  await expect(page.getByTestId("game-form-deck")).toHaveText(name);
}

/** Remplit la feuille de saisie (déjà ouverte) selon `input`, sans l'envoyer. */
export async function fillGame(page: Page, input: GameInput): Promise<void> {
  const form = page.getByTestId("game-form");
  await expect(form).toBeVisible();
  if (input.players) {
    await form.getByTestId("game-form-count").getByText(String(input.players), { exact: true }).click();
    await expect(form.getByTestId(`game-form-count-${input.players}`)).toBeChecked();
  }
  if (input.deck) await chooseDeck(page, input.deck);
  for (let i = 0; i < (input.halfPoints ?? 0); i += 1) {
    await form.getByLabel("Ajouter un demi-point de VP").click();
  }
  if (input.opponents?.length) {
    const toggle = form.getByTestId("game-form-opponents-toggle");
    if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
    for (const opponent of input.opponents) {
      await form.getByTestId("game-form-opponent-input").fill(opponent.name);
      if (opponent.existing) {
        await form
          .getByTestId("game-form-opponent-suggestions")
          .getByRole("button", { name: opponent.name, exact: true })
          .click();
      } else {
        await form.getByTestId("game-form-opponent-create").click();
      }
      const row = form.getByTestId("game-form-opponent").filter({ hasText: opponent.name });
      await expect(row).toHaveCount(1);
      if (opponent.lend) {
        await row.getByLabel(`Deck prêté à ${opponent.name}`).selectOption({ label: `Joue mon ${opponent.lend}` });
      }
    }
  }
}

/** Enregistre la feuille de saisie et attend qu'elle se referme. */
export async function submitGame(page: Page): Promise<void> {
  await page.getByTestId("game-form-submit").click();
  await expect(page.getByTestId("game-form")).toHaveCount(0);
}

/** Date locale du jour au format ISO (`AAAA-MM-JJ`), comme le client la calcule. */
export function localDay(offsetDays = 0): string {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// --- Lectures côté serveur (par l'API) ---------------------------------------------

export interface PlayerRow {
  id: number;
  name: string;
  is_me: boolean;
  game_count: number;
}
export interface VenueRow {
  id: number;
  name: string;
  game_count: number;
  tournament_count: number;
}
export interface TournamentRow {
  id: number;
  name: string;
  venue_id: number | null;
  deck_policy: "mono" | "multi";
  final_deck_rule: string | null;
  round_count: number | null;
  player_count: number | null;
  my_ranking: number | null;
  my_summary: {
    preliminary_game_wins: number;
    preliminary_victory_points: number;
    rounds_played: number;
    final_victory_points: number | null;
    final_game_win: boolean | null;
  };
}
export interface TournamentDetailRow extends TournamentRow {
  admissible_final_decks: number[] | null;
}
export interface GameRow {
  id: number;
  tournament_id: number | null;
  round_type: "casual" | "preliminary" | "final";
  round_number: number | null;
  player_count: number;
  venue_id: number | null;
  me: { deck_id: number | null; seat: number | null; victory_points: number | null; game_win: boolean | null };
}
export interface GameDetailRow extends GameRow {
  participations: Array<{
    player_id: number;
    is_me: boolean;
    deck_id: number | null;
    victory_points: number | null;
    game_win: boolean | null;
  }>;
}

/** Correspondances référence client -> identifiant serveur de la base IndexedDB du compte (lecture seule). */
export async function readBindings(page: Page): Promise<Array<{ ref: string; id: number; kind?: string }>> {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        indexedDB
          .databases()
          .then((entries) => {
            const name = entries
              .map((entry) => entry.name)
              .find((candidate): candidate is string => !!candidate && /^gurchon-hall-offline-u\d+$/.test(candidate));
            if (!name) {
              resolve([]);
              return;
            }
            const opening = indexedDB.open(name);
            opening.onerror = () => reject(opening.error);
            opening.onsuccess = () => {
              const db = opening.result;
              const all = db.transaction("refs", "readonly").objectStore("refs").getAll();
              all.onerror = () => reject(all.error);
              all.onsuccess = () => {
                db.close();
                resolve(all.result);
              };
            };
          })
          .catch(reject);
      }),
  );
}

export const sortedGames = (games: GameRow[]) =>
  [...games].sort((a, b) => (a.round_number ?? 99) - (b.round_number ?? 99) || a.id - b.id);

// --- Scénario pilote : « au club sans réseau » --------------------------------------

/**
 * Le scénario du pilote (CLAUDE.md §3, plan du Lot 7, « Tests attendus (E) »), contre le VRAI
 * back : hors ligne, créer un tournoi multi-deck et un lieu, saisir deux rondes avec des
 * adversaires nommés (un deck prêté), lire le bilan provisoire, recharger hors ligne, revenir en
 * ligne, vérifier le rejeu, les identifiants (`ref:` devenus `id:`) et le bilan, côté serveur.
 */
export async function runClubScenario(
  page: Page,
  context: BrowserContext,
  api: Api,
  desktop: boolean,
): Promise<void> {
  const syncCalls = recordSyncRequests(page);
  const alpha = await api.post<{ id: number }>("/decks", { name: "Alpha club" }, 201);
  const beta = await api.post<{ id: number }>("/decks", { name: "Beta club" }, 201);

  // 1. En ligne : coquille en cache, catalogue et decks lus.
  await openAppAt(page, desktop);
  await waitForServiceWorkerControlAt(page, desktop);
  await expectCatalogDownloaded(page);
  await expectSynced(page);
  expect(syncCalls, "rien à synchroniser au démarrage").toHaveLength(0);

  // 2. Au club, plus de réseau : le tournoi multi-deck et son lieu se créent sur place.
  await context.setOffline(true);
  await expect(syncStatus(page)).toHaveAttribute("data-state", "offline");
  await goToTournamentsAt(page, desktop);
  await expect(page.getByTestId("tournaments-empty")).toBeVisible();
  const tournamentKey = await createTournamentByForm(page, desktop, {
    name: "Open du Club",
    venue: "Le Bar à Dés",
    policy: "multi",
    finalRule: "Meilleur deck",
  });
  const detail = page.getByTestId("tournament-detail");
  await expect(detail.getByTestId("tournament-final-deck-title")).toBeVisible(); // règle annoncée, decks à lire plus tard
  await expect(detail.getByTestId("tournament-add-round")).toContainText("Ajouter la ronde 1");

  // 3. Ronde 1 : Alpha, 3 VP à cinq joueurs (GW certain, coché d'office), Marc joue mon Beta.
  await detail.getByTestId("tournament-add-round").click();
  await expect(page.getByTestId("game-form-round")).toContainText("Ronde 1");
  await expect(page.getByTestId("game-form-venue")).toContainText("Le Bar à Dés"); // repris du tournoi
  await fillGame(page, {
    deck: "Alpha club",
    halfPoints: 6,
    opponents: [{ name: "Marc", lend: "Beta club" }],
  });
  await expect(page.getByTestId("game-form-gw")).toBeChecked();
  await submitGame(page);
  await expect(detail.getByTestId("tournament-round")).toHaveCount(1);

  // 4. Ronde 2 : proposée d'office, Beta, 1 VP à quatre joueurs, Marc (déjà au carnet) et Léa.
  await expect(detail.getByTestId("tournament-add-round")).toContainText("Ajouter la ronde 2");
  await detail.getByTestId("tournament-add-round").click();
  await expect(page.getByTestId("game-form-round")).toContainText("Ronde 2");
  await fillGame(page, {
    deck: "Beta club",
    players: 4,
    halfPoints: 2,
    opponents: [{ name: "Marc", existing: true }, { name: "Léa" }],
  });
  await expect(page.getByTestId("game-form-gw")).not.toBeChecked();
  await submitGame(page);

  // 5. Le bilan est calculé sur place, marqué provisoire.
  const rounds = detail.getByTestId("tournament-round");
  await expect(rounds).toHaveCount(2);
  await expect(rounds.first()).toHaveAttribute("data-pending", "true");
  await expect(detail.getByTestId("tournament-stat-gw")).toContainText("1");
  await expect(detail.getByTestId("tournament-stat-vp")).toContainText("4");
  await expect(detail.getByTestId("tournament-provisional")).toContainText("Bilan provisoire");
  await expect(detail.getByTestId("tournament-add-round")).toContainText("Ajouter la ronde 3");

  // La file : un lieu, un tournoi, deux adversaires, deux parties, dans l'ordre de la saisie.
  const queued = await readOutbox(page);
  expect(queued.map((row) => row.type).sort()).toEqual(
    ["game.create", "game.create", "player.create", "player.create", "tournament.create", "venue.create"].sort(),
  );
  await expectPending(page, 6);
  const idsBeforeReload = queued.map((row) => row.operationId);
  expect(await api.get<unknown[]>("/tournois")).toEqual([]); // rien n'a atteint le serveur
  expect(await api.get<unknown[]>("/parties")).toEqual([]);

  // 6. Rechargement hors ligne : tout est retrouvé, aux mêmes clés.
  const reloaded = await page.reload();
  expect(reloaded?.fromServiceWorker()).toBe(true);
  await expect(syncStatus(page)).toHaveAttribute("data-state", "offline");
  await expectPending(page, 6);
  expect((await readOutbox(page)).map((row) => row.operationId)).toEqual(idsBeforeReload);
  if (desktop) {
    await goToTournamentsAt(page, desktop);
  } else {
    await expect(page).toHaveURL(/#\/tournois\/ref(:|%3A)/);
  }
  const afterReload = page.getByTestId("tournament-detail");
  await expect(afterReload).toHaveAttribute("data-tournament-key", tournamentKey);
  await expect(afterReload.getByTestId("tournament-round")).toHaveCount(2);
  await expect(afterReload.getByTestId("tournament-stat-gw")).toContainText("1");
  await expect(afterReload.getByTestId("tournament-stat-vp")).toContainText("4");
  await expect(afterReload.getByTestId("tournament-provisional")).toBeVisible();

  // 7. Le réseau revient : un seul lot, sous les mêmes clés, rien n'est refusé.
  await context.setOffline(false);
  await expectSynced(page);
  expect(syncCalls).toHaveLength(1);
  expect(syncCalls[0].operations.map((operation) => operation.operation_id)).toEqual(idsBeforeReload);
  await expect(syncStatus(page)).toHaveAttribute("data-rejected", "0");
  expect(await readOutbox(page)).toEqual([]);

  // 8. Côté serveur, chaque objet existe une seule fois, correctement relié.
  const venues = await api.get<VenueRow[]>("/lieux");
  expect(venues).toHaveLength(1);
  expect(venues[0]).toMatchObject({ name: "Le Bar à Dés", game_count: 2, tournament_count: 1 });
  const tournaments = await api.get<TournamentRow[]>("/tournois");
  expect(tournaments).toHaveLength(1);
  expect(tournaments[0]).toMatchObject({
    name: "Open du Club",
    deck_policy: "multi",
    final_deck_rule: "best_performing",
    venue_id: venues[0].id,
    my_summary: { preliminary_game_wins: 1, preliminary_victory_points: 4, rounds_played: 2 },
  });
  const players = await api.get<PlayerRow[]>("/joueurs");
  expect(players.filter((player) => player.name === "Marc")).toHaveLength(1);
  expect(players.filter((player) => player.name === "Léa")).toHaveLength(1);
  expect(players.filter((player) => player.is_me)).toHaveLength(1);
  expect(players).toHaveLength(3);
  const marc = players.find((player) => player.name === "Marc") as PlayerRow;
  const lea = players.find((player) => player.name === "Léa") as PlayerRow;
  expect(marc.game_count).toBe(2);

  const games = sortedGames(await api.get<GameRow[]>("/parties"));
  expect(games).toHaveLength(2);
  expect(games[0]).toMatchObject({
    tournament_id: tournaments[0].id,
    round_type: "preliminary",
    round_number: 1,
    player_count: 5,
    venue_id: venues[0].id,
    me: { deck_id: alpha.id, victory_points: 3, game_win: true },
  });
  expect(games[1]).toMatchObject({
    tournament_id: tournaments[0].id,
    round_type: "preliminary",
    round_number: 2,
    player_count: 4,
    me: { deck_id: beta.id, victory_points: 1, game_win: false },
  });
  const round1 = await api.get<GameDetailRow>(`/parties/${games[0].id}`);
  expect(round1.participations).toHaveLength(2);
  expect(round1.participations.find((line) => line.player_id === marc.id)).toMatchObject({
    is_me: false,
    deck_id: beta.id, // le deck prêté
    victory_points: null,
    game_win: null,
  });
  const round2 = await api.get<GameDetailRow>(`/parties/${games[1].id}`);
  expect(round2.participations.map((line) => line.player_id).sort()).toEqual(
    [marc.id, lea.id, round2.participations.find((line) => line.is_me)?.player_id].sort(),
  );

  // 9. Les références sont résolues : chaque `ref:` est liée à l'identifiant serveur (la clé de
  //    l'écran reste la `ref:` d'origine, c'est son alias `id:<n>` qui s'y ajoute), le bilan n'est
  //    plus provisoire.
  const bindings = await readBindings(page);
  expect(bindings.filter((binding) => binding.kind === "tournament")).toEqual([
    expect.objectContaining({ ref: tournamentKey.slice("ref:".length), id: tournaments[0].id }),
  ]);
  expect(bindings.filter((binding) => binding.kind === "venue").map((binding) => binding.id)).toEqual([venues[0].id]);
  expect(bindings.filter((binding) => binding.kind === "player").map((binding) => binding.id).sort()).toEqual(
    [marc.id, lea.id].sort(),
  );
  expect(bindings.filter((binding) => binding.kind === "game").map((binding) => binding.id).sort()).toEqual(
    games.map((game) => game.id).sort(),
  );
  await expect(page.getByTestId("tournament-detail")).toHaveAttribute("data-tournament-key", tournamentKey);
  await expect(page.getByTestId("tournament-provisional")).toHaveCount(0);
  await expect(page.getByTestId("tournament-round")).toHaveCount(2);
  await expect(page.getByTestId("tournament-round").first()).toHaveAttribute("data-pending", "false");
  await expect(page.getByTestId("tournament-stat-gw")).toContainText("1");
  await expect(page.getByTestId("tournament-stat-vp")).toContainText("4");
  // L'identifiant serveur désigne le même tournoi que la référence d'origine.
  await page.evaluate((id) => {
    window.location.hash = `#/tournois/id:${id}`;
  }, tournaments[0].id);
  await expect(page.getByTestId("tournament-detail")).toHaveAttribute("data-tournament-key", tournamentKey);
  await expect(page.getByTestId("tournament-round")).toHaveCount(2);

  // 10. Idempotence de bout en bout : le même lot rejoué à l'identique ne crée rien de plus.
  const replay = await api.post<{ applied: number; replayed: number; rejected: number }>(
    "/sync",
    syncCalls[0],
    200,
  );
  expect(replay).toMatchObject({ applied: 0, replayed: 6, rejected: 0 });
  expect(await api.get<unknown[]>("/tournois")).toHaveLength(1);
  expect(await api.get<unknown[]>("/parties")).toHaveLength(2);
  expect(await api.get<unknown[]>("/lieux")).toHaveLength(1);
  expect(await api.get<unknown[]>("/joueurs")).toHaveLength(3);
  expect(syncCalls, "aucun renvoi superflu").toHaveLength(1);
}
