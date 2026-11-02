import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { hrefFor } from "../../../src/app/routes";
import {
  duplicateName,
  playerDeleteRefusal,
  tablesLabel,
  venueDeleteRefusal,
  venueUsageLabel,
} from "../../../src/features/games/notebookModel";
import {
  bestRoundOf,
  canAddRound,
  deleteRefusal,
  finalDeckInfo,
  forbidsMultiDeck,
  roundCountEffect,
  formatTournamentDates,
  lastRoundLine,
  localDay,
  nextRoundOf,
  ordinal,
  provisionalLine,
  rankingProblem,
  roundsOf,
  summaryLine,
  tournamentFormErrors,
  tournamentInProgress,
  withPolicy,
  withTier,
  draftOf,
  type TournamentRounds,
} from "../../../src/features/games/tournamentModel";
import type { LocalGame, LocalTournament } from "../../../src/offline/vtes";
import type { VtesOfflineRuntime } from "../../../src/offline/vtes/runtime";
import { createFakeServer, type FakeServer } from "../offline/fakeServer";
import { flushEffects, renderApp, setOnline, type AppOptions } from "./harness";

function setViewportWidth(width: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: width });
}

afterEach(() => {
  setViewportWidth(1024);
});

const go = (route: Parameters<typeof hrefFor>[0]) =>
  act(() => {
    window.location.hash = hrefFor(route);
  });

// --- Fabriques pour les fonctions pures -----------------------------------------------

function tournament(overrides: Partial<LocalTournament> = {}): LocalTournament {
  return {
    key: "id:1",
    id: 1,
    clientRef: null,
    aliases: [],
    pending: false,
    name: "Open de Lyon",
    startDate: "2026-10-24",
    endDate: null,
    venueKey: null,
    deckPolicy: "multi",
    format: "constructed",
    eventTier: "standard",
    finalDeckRule: "best_performing",
    roundCount: 3,
    playerCount: null,
    myRanking: null,
    notes: null,
    summary: {
      preliminaryGameWins: 2,
      preliminaryVictoryPoints: 7.5,
      roundsPlayed: 3,
      finalVictoryPoints: null,
      finalGameWin: null,
    },
    summaryProvisional: false,
    admissibleFinalDecks: null,
    ...overrides,
  };
}

function game(overrides: Partial<LocalGame> & { number?: number | null; deck?: string | null; vp?: number | null; gw?: boolean | null } = {}): LocalGame {
  const { number = 1, deck = "id:1", vp = 3, gw = false, ...rest } = overrides;
  return {
    key: `id:${number ?? 99}`,
    id: number ?? 99,
    clientRef: null,
    aliases: [],
    pending: false,
    playedAt: "2026-10-24T14:10:00Z",
    venueKey: null,
    tournamentKey: "id:1",
    tournamentName: "Open de Lyon",
    roundNumber: number,
    roundType: number === null ? "final" : "preliminary",
    playerCount: 5,
    me: { deckKey: deck as LocalGame["me"]["deckKey"], seat: null, victoryPoints: vp, gameWin: gw },
    notes: null,
    table: null,
    ...rest,
  } as LocalGame;
}

const rounds = (preliminaries: LocalGame[], final: LocalGame | null = null): TournamentRounds => ({
  preliminaries,
  final,
});

describe("règles des tournois (fonctions pures)", () => {
  it("interdit le multi-deck hors tournoi standard et bascule en mono avec un niveau interdit", () => {
    expect(forbidsMultiDeck("standard")).toBe(false);
    expect(forbidsMultiDeck("national_championship")).toBe(true);
    expect(forbidsMultiDeck("grand_prix")).toBe(true);
    expect(forbidsMultiDeck("continental_championship")).toBe(true);

    const multi = { ...draftOf(undefined, "2026-10-24"), deckPolicy: "multi" as const, finalDeckRule: "free_choice" as const };
    expect(withTier(multi, "grand_prix")).toMatchObject({ eventTier: "grand_prix", deckPolicy: "mono", finalDeckRule: null });
    expect(withTier(multi, "standard")).toMatchObject({ deckPolicy: "multi", finalDeckRule: "free_choice" });
    // Choisir multi à un niveau qui l'interdit ne change rien ; repasser en mono efface la règle.
    const grandPrix = withTier(multi, "grand_prix");
    expect(withPolicy(grandPrix, "multi")).toBe(grandPrix);
    expect(withPolicy(multi, "mono")).toMatchObject({ deckPolicy: "mono", finalDeckRule: null });
  });

  it("valide le nom et les dates du formulaire", () => {
    const draft = draftOf(undefined, "2026-10-24");
    expect(tournamentFormErrors(draft)).toEqual({ name: "Le nom du tournoi est obligatoire." });
    expect(tournamentFormErrors({ ...draft, name: "Open", endDate: "2026-10-23" })).toEqual({
      endDate: "La fin ne peut pas précéder le début.",
    });
    expect(tournamentFormErrors({ ...draft, name: "Open", endDate: "2026-10-25" })).toEqual({});
  });

  it("propose la ronde suivante, la finale une fois les rondes prévues jouées, puis rien", () => {
    const t = tournament({ roundCount: 3 });
    const two = rounds([game({ number: 1 }), game({ number: 2 })]);
    expect(nextRoundOf(t, two)).toEqual({ kind: "preliminary", number: 3 });
    expect(canAddRound(t, two)).toBe(3);
    const three = rounds([game({ number: 1 }), game({ number: 2 }), game({ number: 3 })]);
    expect(nextRoundOf(t, three)).toEqual({ kind: "final" });
    expect(canAddRound(t, three)).toBeNull();
    expect(nextRoundOf(t, { ...three, final: game({ number: null }) })).toBeNull();
    // Sans nombre de rondes prévu, il y en a toujours une de plus.
    expect(canAddRound(tournament({ roundCount: null }), three)).toBe(4);
  });

  it("masque la ronde de plus après la finale, round_count connu ou non, et la finale suit round_count", () => {
    const three = rounds([game({ number: 1 }), game({ number: 2 }), game({ number: 3 })]);
    const done = { ...three, final: game({ number: null }) };
    for (const roundCount of [null, 3, 5]) {
      expect(canAddRound(tournament({ roundCount }), done)).toBeNull();
      expect(nextRoundOf(tournament({ roundCount }), done)).toBeNull();
    }
    // Hausse : une ronde de plus ; baisse : la finale reprend la main.
    expect(nextRoundOf(tournament({ roundCount: 4 }), three)).toEqual({ kind: "preliminary", number: 4 });
    expect(nextRoundOf(tournament({ roundCount: 3 }), three)).toEqual({ kind: "final" });
    expect(roundCountEffect(2, three)).toMatchObject({ kind: "convert", round: 3 });
  });

  it("range les parties d'un tournoi : préliminaires par ronde, finale à part", () => {
    const t = tournament();
    const all = [game({ number: 2 }), game({ number: null }), game({ number: 1 }), game({ number: 3, tournamentKey: "id:9" })];
    const sorted = roundsOf(all, [t], t);
    expect(sorted.preliminaries.map((g) => g.roundNumber)).toEqual([1, 2]);
    expect(sorted.final?.roundType).toBe("final");
  });

  it("dit le classement : au plus le nombre de joueurs, 1 avec un GW en finale, 1 à 5 en finaliste", () => {
    expect(rankingProblem(null, 27, { played: false, gameWin: null })).toBeNull();
    expect(rankingProblem(3, 27, { played: false, gameWin: null })).toBeNull();
    expect(rankingProblem(30, 27, { played: false, gameWin: null })).toBe("Au plus 27e sur 27 joueurs.");
    expect(rankingProblem(0, null, { played: false, gameWin: null })).toBe("La place va de 1 au nombre de joueurs.");
    expect(rankingProblem(2, 27, { played: true, gameWin: true })).toBe("Un Game Win en finale donne la première place.");
    expect(rankingProblem(1, 27, { played: true, gameWin: true })).toBeNull();
    expect(rankingProblem(6, 27, { played: true, gameWin: false })).toBe("Finaliste : votre place va de 1 à 5.");
    expect(rankingProblem(5, 27, { played: true, gameWin: false })).toBeNull();
    // Sans finale jouée, 6e place sur 27 est une place de préliminaires, pas une erreur.
    expect(rankingProblem(6, 27, { played: false, gameWin: null })).toBeNull();
  });

  it("met en forme les rangs, bilans, dates et la ligne de dernière ronde", () => {
    expect(ordinal(1)).toBe("1er");
    expect(ordinal(3)).toBe("3e");
    expect(summaryLine(tournament())).toBe("2 GW · 7,5 VP · 3 rondes");
    expect(
      summaryLine(
        tournament({
          summary: { preliminaryGameWins: 1, preliminaryVictoryPoints: 3, roundsPlayed: 1, finalVictoryPoints: 2, finalGameWin: false },
        }),
      ),
    ).toBe("1 GW · 3 VP · 1 ronde · finaliste");
    const now = new Date(2026, 9, 25);
    expect(formatTournamentDates("2026-10-24", null, now)).toBe("24 oct.");
    expect(formatTournamentDates("2026-10-10", "2026-10-11", now)).toBe("10–11 oct.");
    expect(formatTournamentDates("2026-10-30", "2026-11-01", now)).toBe("30 oct. – 1 nov.");
    expect(formatTournamentDates("2025-10-24", null, now)).toBe("24 oct. 2025");
    expect(lastRoundLine(rounds([]), () => null)).toBe("Aucune ronde saisie");
    expect(lastRoundLine(rounds([game({ number: 2, gw: true })]), () => "Banu Princes")).toBe(
      "Dernière ronde : ronde 2 · Banu Princes · 3 VP · GW",
    );
  });

  it("repère le tournoi en cours : commencé aujourd'hui ou hier, sans classement", () => {
    const now = new Date(2026, 9, 25, 10);
    const today = localDay(now);
    expect(tournamentInProgress([tournament({ startDate: today })], now)?.key).toBe("id:1");
    expect(tournamentInProgress([tournament({ startDate: "2026-10-24" })], now)?.key).toBe("id:1");
    expect(tournamentInProgress([tournament({ startDate: "2026-10-23" })], now)).toBeNull();
    expect(tournamentInProgress([tournament({ startDate: today, myRanking: 3 })], now)).toBeNull();
    expect(tournamentInProgress([tournament({ startDate: "2026-10-26" })], now)).toBeNull();
  });

  it("dit le bilan provisoire, la meilleure ronde et le deck de finale", () => {
    expect(provisionalLine(rounds([game({ number: 3, pending: true })]))).toBe(
      "Bilan provisoire : la ronde 3 attend le réseau",
    );
    expect(provisionalLine(rounds([game({ number: 1, pending: true }), game({ number: 2, pending: true })]))).toBe(
      "Bilan provisoire : 2 parties attendent le réseau",
    );
    const played = [game({ number: 1, deck: "id:2", vp: 1.5 }), game({ number: 2, deck: "id:1", vp: 3, gw: true })];
    expect(bestRoundOf(played, null)?.roundNumber).toBe(2);
    const names = (key: string) => (key === "id:1" ? "Banu Princes" : "Toreador Mass Vote");
    expect(finalDeckInfo(tournament({ admissibleFinalDecks: ["id:1"] }), rounds(played), names)).toEqual({
      title: "En finale : Banu Princes",
      help: "Règle « meilleur deck » : le deck de votre meilleure ronde, ici la ronde 2.",
    });
    expect(finalDeckInfo(tournament({ finalDeckRule: null }), rounds(played), names)).toBeNull();
    expect(finalDeckInfo(tournament({ deckPolicy: "mono", finalDeckRule: null }), rounds(played), names)?.title).toBe(
      "Deck du tournoi : Toreador Mass Vote",
    );
    expect(finalDeckInfo(tournament({ finalDeckRule: "free_choice" }), rounds(played), names)?.title).toBe(
      "En finale : un deck parmi Toreador Mass Vote, Banu Princes",
    );
  });

  it("refuse la suppression d'un tournoi qui contient des parties", () => {
    expect(deleteRefusal(0)).toBeNull();
    expect(deleteRefusal(4)).toBe(
      "Ce tournoi contient 4 parties : supprimez-les ou détachez-les du tournoi d'abord.",
    );
    expect(deleteRefusal(1)).toContain("1 partie :");
  });
});

describe("règles du Carnet (fonctions pures)", () => {
  it("dit l'usage et les motifs de refus", () => {
    expect(tablesLabel(0)).toBe("à aucune table");
    expect(tablesLabel(1)).toBe("à 1 table");
    expect(tablesLabel(4)).toBe("à 4 tables");
    expect(venueUsageLabel({ games: 7, tournaments: 1 })).toBe("7 parties · 1 tournoi");
    expect(venueUsageLabel({ games: 0, tournaments: 0 })).toBe("aucune partie");
    expect(playerDeleteRefusal("Marc F.", 6)).toBe(
      "Marc F. figure à 6 tables : retirez-le d'abord de ces parties pour le supprimer.",
    );
    expect(playerDeleteRefusal("Yann B.", 0)).toBeNull();
    expect(venueDeleteRefusal("Le Bar à Dés", { games: 7, tournaments: 1 })).toBe(
      "Le Bar à Dés sert à 7 parties et 1 tournoi : impossible de le supprimer.",
    );
    expect(venueDeleteRefusal("Chez Marc", { games: 2, tournaments: 0 })).toBe(
      "Chez Marc sert à 2 parties : impossible de le supprimer.",
    );
    expect(venueDeleteRefusal("Chez Marc", { games: 0, tournaments: 0 })).toBeNull();
  });

  it("compare les noms repliés, casse et accents ignorés, sans compter la ressource elle-même", () => {
    const others = [
      { key: "id:1", name: "Moi" },
      { key: "id:2", name: "Marc F." },
    ];
    expect(duplicateName("marc f.", others, "id:3")).toBe(true);
    expect(duplicateName("  MOI ", others, "id:3")).toBe(true);
    expect(duplicateName("Marc F.", others, "id:2")).toBe(false);
    expect(duplicateName("Julie", others, "id:2")).toBe(false);
  });
});

// --- Interface -----------------------------------------------------------------------

/** Un serveur peuplé : deux decks, un lieu, un adversaire, un tournoi multi-deck et deux rondes. */
function seededServer(overrides: { startDate?: string } = {}): FakeServer {
  const server = createFakeServer();
  server.state.decks.push(
    { id: 1, name: "Banu Princes", discriminator: "0001", client_ref: null, proxy_allowed: false, archived_at: null },
    { id: 2, name: "Toreador Mass Vote", discriminator: "0002", client_ref: null, proxy_allowed: false, archived_at: null },
  );
  server.state.venues.push({ id: 1, name: "Le Bar à Dés", city: "Lyon", notes: null });
  server.state.players.push({ id: 2, name: "Marc F.", is_me: false });
  server.state.tournaments.push({
    id: 1,
    name: "Open de Lyon",
    start_date: overrides.startDate ?? "2026-10-24",
    end_date: null,
    venue_id: 1,
    deck_policy: "multi",
    format: "constructed",
    event_tier: "standard",
    final_deck_rule: "best_performing",
    round_count: 3,
    player_count: null,
    my_ranking: null,
    notes: null,
    updated_at: "2026-10-24T10:00:00Z",
  });
  server.state.admissible.set(1, [1]);
  const me = (deck_id: number, victory_points: number, game_win: boolean) => ({
    player_id: 1,
    is_me: true,
    deck_id,
    seat: 2,
    victory_points,
    game_win,
    notes: null,
  });
  const marc = { player_id: 2, is_me: false, deck_id: 2, seat: 3, victory_points: null, game_win: null, notes: null };
  server.state.games.push(
    {
      id: 1,
      played_at: "2026-10-24T12:00:00Z",
      venue_id: 1,
      tournament_id: 1,
      round_number: 1,
      round_type: "preliminary",
      player_count: 5,
      notes: null,
      updated_at: "2026-10-24T12:00:00Z",
      participations: [me(2, 1.5, false)],
    },
    {
      id: 2,
      played_at: "2026-10-24T15:00:00Z",
      venue_id: 1,
      tournament_id: 1,
      round_number: 2,
      round_type: "preliminary",
      player_count: 5,
      notes: null,
      updated_at: "2026-10-24T15:00:00Z",
      participations: [me(1, 3, true), marc],
    },
  );
  return server;
}

async function openSeeded(options: AppOptions & { startDate?: string } = {}) {
  const { startDate, ...rest } = options;
  const server = seededServer({ startDate });
  // Les miroirs se remplissent en ligne ; la suite se joue hors ligne (sauf `online: true`) pour
  // que la file garde ses opérations au lieu de les envoyer aussitôt au serveur factice.
  const app = await renderApp({ server, hash: "#/tournois", ...rest, online: true });
  await act(async () => {
    await app.runtime.refresh();
  });
  await app.settle();
  if (options.online !== true) {
    await act(async () => {
      setOnline(false);
    });
  }
  app.server.state.requests.length = 0;
  return app;
}

/** Attend que le détail ait lu ses rondes et son lieu (lectures locales asynchrones). */
async function detailLoaded(venueName = "Le Bar à Dés") {
  await screen.findAllByTestId("tournament-round");
  await waitFor(() => expect(screen.getByTestId("tournament-detail-meta")).toHaveTextContent(venueName));
}

const queuedOps = async (app: { runtime: VtesOfflineRuntime }) =>
  (await app.runtime.outbox.list()).map((entry) => entry.operation);

/** Ouvre « Modifier » et rend le stepper des rondes prévues. */
async function openRoundCountForm() {
  fireEvent.click(await screen.findByTestId("tournament-edit"));
  await screen.findByTestId("tournament-form");
  return within(screen.getByTestId("tournament-form-round-count"));
}

/** Change les rondes prévues de `delta` crans et enregistre. */
async function editRoundCount(delta: number) {
  const stepper = await openRoundCountForm();
  const label = delta < 0 ? "Retirer : Rondes prévues" : "Ajouter : Rondes prévues";
  for (let i = 0; i < Math.abs(delta); i += 1) fireEvent.click(stepper.getByLabelText(label));
  await waitFor(() => expect(screen.getByTestId("tournament-form-submit")).not.toBeDisabled());
  fireEvent.click(screen.getByTestId("tournament-form-submit"));
  await waitFor(() => expect(screen.queryByTestId("tournament-form")).not.toBeInTheDocument());
}

describe("navigation des tournois", () => {
  it("garde l'onglet Parties actif sur le détail d'un tournoi et sur le carnet", async () => {
    await openSeeded();
    await screen.findByTestId("tournaments-page");
    await go({ name: "tournament", key: "id:1" });
    await screen.findByTestId("tournament-page");
    expect(screen.getByTestId("nav-games")).toHaveAttribute("aria-current", "page");
    expect(screen.getByTestId("topnav-games")).toHaveAttribute("aria-current", "page");
    await go({ name: "notebook" });
    await screen.findByTestId("notebook-page");
    expect(screen.getByTestId("nav-games")).toHaveAttribute("aria-current", "page");
    expect(screen.getByTestId("topnav-games")).toHaveAttribute("aria-current", "page");
    expect(screen.getByTestId("nav-decks")).not.toHaveAttribute("aria-current");
  });

  it("ouvre les deux écrans par leur adresse, hors ligne, sans rien demander au serveur sur la pratique de jeu", async () => {
    const app = await openSeeded({ hash: "#/carnet" });
    await screen.findByTestId("notebook-page");
    await go({ name: "tournament", key: "id:1" });
    expect(await screen.findByTestId("tournament-detail")).toBeInTheDocument();
    // Le catalogue peut se rafraîchir de lui-même (`/extensions`) ; ni les écrans ni leurs lectures n'appellent l'API.
    const play = /^\/(joueurs|lieux|tournois|parties)/;
    expect(app.server.state.requests.filter((request) => play.test(request.path) || request.method !== "GET")).toEqual([]);
  });

  it("dit « Tournoi introuvable » pour une clé inconnue", async () => {
    await renderApp({ online: false, hash: "#/tournois/id:999" });
    expect(await screen.findByTestId("tournament-not-found")).toHaveTextContent("Tournoi introuvable");
    expect(screen.getByTestId("tournament-not-found")).toHaveTextContent(
      "Il a peut-être été supprimé depuis un autre appareil.",
    );
  });

  it("pose le bouton Carnet en tête des écrans Parties et Tournois, et le retour mène aux parties", async () => {
    await openSeeded({ hash: "#/parties" });
    await screen.findByTestId("games-page");
    expect(screen.getByTestId("notebook-open")).toHaveAttribute("href", "#/carnet");
    fireEvent.click(screen.getByTestId("notebook-open"));
    await screen.findByTestId("notebook-page");
    fireEvent.click(screen.getByTestId("notebook-back"));
    await screen.findByTestId("games-page");
    expect(window.location.hash).toBe("#/parties");
  });
});

describe("liste des tournois", () => {
  it("au mobile : ligne nom, méta, bilan et classement, qui mène au détail", async () => {
    setViewportWidth(390);
    const app = await openSeeded();
    await app.runtime.actions.createTournament({
      name: "Coupe du Rhône",
      startDate: "2025-09-19",
      myRanking: 3,
      playerCount: 27,
      deckPolicy: "mono",
    });
    await waitFor(() => expect(screen.getAllByTestId("tournament-item")).toHaveLength(2));
    const open = screen.getAllByTestId("tournament-item").find((item) => item.textContent?.includes("Open de Lyon"))!;
    expect(within(open).getByTestId("tournament-meta")).toHaveTextContent("24 oct. · Le Bar à Dés · multi-deck");
    expect(within(open).getByTestId("tournament-summary-line")).toHaveTextContent("1 GW · 4,5 VP · 2 rondes");
    expect(within(open).getByTestId("tournament-ranking-cell")).toHaveTextContent("en cours");
    const cup = screen.getAllByTestId("tournament-item").find((item) => item.textContent?.includes("Coupe du Rhône"))!;
    expect(within(cup).getByTestId("tournament-ranking-cell")).toHaveTextContent("3e / 27");
    expect(within(cup).getByTestId("pending-badge")).toHaveTextContent("En attente de synchronisation");

    fireEvent.click(within(open).getByTestId("tournament-link"));
    await screen.findByTestId("tournament-page");
    expect(window.location.hash).toBe("#/tournois/id%3A1");
  });

  it("au bureau : maître/détail, la sélection change le détail, N ouvre la création d'un tournoi", async () => {
    const app = await openSeeded();
    await app.runtime.actions.createTournament({ name: "Grand Prix de Paris", startDate: "2026-10-10", deckPolicy: "mono" });
    await waitFor(() => expect(screen.getAllByTestId("tournament-item")).toHaveLength(2));
    const detail = screen.getByTestId("tournaments-detail");
    expect(within(detail).getByTestId("tournament-detail-title")).toHaveTextContent("Open de Lyon");
    expect(screen.getByTestId("tournaments-count")).toHaveTextContent("2 tournois");

    const rows = screen.getAllByTestId("tournament-item");
    fireEvent.click(within(rows[1]).getByTestId("tournament-select"));
    await waitFor(() =>
      expect(within(screen.getByTestId("tournaments-detail")).getByTestId("tournament-detail-title")).toHaveTextContent(
        "Grand Prix de Paris",
      ),
    );

    await flushEffects();
    fireEvent.keyDown(document, { key: "n" });
    await screen.findByTestId("tournament-form");
    // `N` ne rouvre rien derrière la feuille, ni dans un champ.
    const name = screen.getByTestId("tournament-form-name");
    name.focus();
    fireEvent.keyDown(name, { key: "n" });
    expect(screen.getAllByTestId("tournament-form")).toHaveLength(1);
  });

  it("affiche l'état vide avec son bouton, qui ouvre la création", async () => {
    setViewportWidth(390);
    await renderApp({ online: false, hash: "#/tournois" });
    expect(await screen.findByTestId("tournaments-empty")).toHaveTextContent("Aucun tournoi");
    fireEvent.click(screen.getByTestId("tournaments-empty-create"));
    expect(await screen.findByTestId("tournament-form")).toBeInTheDocument();
  });
});

describe("création et modification d'un tournoi", () => {
  it("crée hors ligne : une opération en file, puis le détail du nouveau tournoi au mobile", async () => {
    setViewportWidth(390);
    const app = await renderApp({ online: false, hash: "#/tournois" });
    await screen.findByTestId("tournaments-empty");
    fireEvent.click(screen.getByTestId("tournament-add"));
    await screen.findByTestId("tournament-form");

    // Un nom obligatoire : l'envoi est refusé sans rien mettre en file.
    fireEvent.click(screen.getByTestId("tournament-form-submit"));
    expect(await screen.findByTestId("tournament-form-name-error")).toHaveTextContent(
      "Le nom du tournoi est obligatoire.",
    );
    expect(await queuedOps(app)).toEqual([]);

    fireEvent.change(screen.getByTestId("tournament-form-name"), { target: { value: "Open de Lyon" } });
    fireEvent.change(screen.getByTestId("tournament-form-start"), { target: { value: "2026-10-24" } });
    fireEvent.click(screen.getByTestId("tournament-form-policy-multi"));
    fireEvent.click(screen.getByTestId("tournament-form-rule-best_performing"));
    expect(screen.getByTestId("tournament-form-rule-help")).toHaveTextContent(
      "En finale, le deck de votre meilleure ronde préliminaire (GW, puis VP).",
    );
    fireEvent.click(screen.getByTestId("tournament-form-more-toggle"));
    fireEvent.click(within(screen.getByTestId("tournament-form-round-count")).getByLabelText("Ajouter : Rondes prévues"));
    fireEvent.click(screen.getByTestId("tournament-form-venue-change"));
    fireEvent.change(await screen.findByTestId("tournament-venue-picker-search"), { target: { value: "Le Bar à Dés" } });
    fireEvent.click(screen.getByTestId("tournament-venue-picker-create"));
    await waitFor(() => expect(screen.getByTestId("tournament-form-venue")).toHaveTextContent("Le Bar à Dés"));
    fireEvent.click(screen.getByTestId("tournament-form-submit"));

    await screen.findByTestId("tournament-page");
    expect(window.location.hash).toMatch(/^#\/tournois\/ref%3A/);
    const ops = await queuedOps(app);
    expect(ops.map((op) => op.type)).toEqual(["venue.create", "tournament.create"]);
    const created = ops[1];
    if (created.type !== "tournament.create") throw new Error("tournament.create attendu");
    expect(created.data).toMatchObject({
      name: "Open de Lyon",
      start_date: "2026-10-24",
      deck_policy: "multi",
      final_deck_rule: "best_performing",
      event_tier: "standard",
      format: "constructed",
      round_count: 1,
    });
    expect(created.data.player_count ?? null).toBeNull();
    expect(app.server.state.requests).toEqual([]);
    expect(screen.getByTestId("tournament-detail-title")).toHaveTextContent("Open de Lyon");
    expect(screen.getByTestId("pending-badge")).toBeInTheDocument();
  });

  it("un niveau qui interdit le multi-deck grise l'option, bascule en mono et masque la règle de finale", async () => {
    await renderApp({ online: false, hash: "#/tournois" });
    fireEvent.click(await screen.findByTestId("tournaments-new-desktop"));
    await screen.findByTestId("tournament-form");
    fireEvent.click(screen.getByTestId("tournament-form-policy-multi"));
    expect(screen.getByTestId("tournament-form-final-rule")).toBeInTheDocument();
    expect(screen.queryByTestId("tournament-form-multi-forbidden")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("tournament-form-tier-grand_prix"));
    expect(screen.getByTestId("tournament-form-policy-mono")).toBeChecked();
    expect(screen.getByTestId("tournament-form-policy-multi")).toBeDisabled();
    expect(screen.getByTestId("tournament-form-multi-forbidden")).toHaveTextContent(
      "Le règlement VEKN interdit le multi-deck en championnat national, en Grand Prix et en championnat continental.",
    );
    expect(screen.queryByTestId("tournament-form-final-rule")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("tournament-form-tier-standard"));
    expect(screen.getByTestId("tournament-form-policy-multi")).not.toBeDisabled();
    expect(screen.queryByTestId("tournament-form-multi-forbidden")).not.toBeInTheDocument();
  });

  it("modifie en n'envoyant que les champs changés ; passer en mono efface la règle de finale", async () => {
    const app = await openSeeded({ hash: "#/tournois/id:1" });
    fireEvent.click(await screen.findByTestId("tournament-edit"));
    await screen.findByTestId("tournament-form");
    expect(screen.getByTestId("tournament-form-name")).toHaveValue("Open de Lyon");
    expect(screen.getByTestId("tournament-form-venue")).toHaveTextContent("Le Bar à Dés");

    fireEvent.change(screen.getByTestId("tournament-form-name"), { target: { value: "Open de Lyon 2026" } });
    fireEvent.click(screen.getByTestId("tournament-form-submit"));
    await waitFor(() => expect(screen.queryByTestId("tournament-form")).not.toBeInTheDocument());
    let ops = await queuedOps(app);
    expect(ops).toHaveLength(1);
    if (ops[0].type !== "tournament.update") throw new Error("tournament.update attendu");
    expect(ops[0].data).toEqual({ name: "Open de Lyon 2026" });

    fireEvent.click(screen.getByTestId("tournament-edit"));
    await screen.findByTestId("tournament-form");
    fireEvent.click(screen.getByTestId("tournament-form-policy-mono"));
    fireEvent.click(screen.getByTestId("tournament-form-submit"));
    await waitFor(() => expect(screen.queryByTestId("tournament-form")).not.toBeInTheDocument());
    ops = await queuedOps(app);
    expect(ops).toHaveLength(2);
    if (ops[1].type !== "tournament.update") throw new Error("tournament.update attendu");
    expect(ops[1].data).toEqual({ deck_policy: "mono", final_deck_rule: null });
    await waitFor(() =>
      expect(screen.getByTestId("tournament-detail-kicker")).toHaveTextContent("Tournoi standard · mono-deck"),
    );

    // Sans changement, la feuille se ferme sans rien envoyer.
    fireEvent.click(screen.getByTestId("tournament-edit"));
    await screen.findByTestId("tournament-form");
    fireEvent.click(screen.getByTestId("tournament-form-submit"));
    await waitFor(() => expect(screen.queryByTestId("tournament-form")).not.toBeInTheDocument());
    expect(await queuedOps(app)).toHaveLength(2);
  });
});

describe("baisse des rondes prévues d'un tournoi", () => {
  it("d'une ronde sous la plus haute ronde saisie : la partie devient la finale, deux opérations dans l'ordre", async () => {
    const app = await openSeeded({ hash: "#/tournois/id:1" });
    await screen.findByTestId("tournament-detail");
    await detailLoaded();
    const stepper = await openRoundCountForm();
    expect(screen.queryByTestId("tournament-form-round-convert")).not.toBeInTheDocument();
    fireEvent.click(stepper.getByLabelText("Retirer : Rondes prévues"));
    fireEvent.click(stepper.getByLabelText("Retirer : Rondes prévues"));
    expect(await screen.findByTestId("tournament-form-round-convert")).toHaveTextContent(
      "La ronde 2, déjà saisie, deviendra la finale.",
    );
    await waitFor(() => expect(screen.getByTestId("tournament-form-submit")).not.toBeDisabled());
    fireEvent.click(screen.getByTestId("tournament-form-submit"));
    await waitFor(() => expect(screen.queryByTestId("tournament-form")).not.toBeInTheDocument());

    const ops = await queuedOps(app);
    expect(ops.map((op) => op.type)).toEqual(["game.update", "tournament.update"]);
    const [gameOp, tournamentOp] = ops;
    if (gameOp.type !== "game.update" || tournamentOp.type !== "tournament.update") throw new Error("types inattendus");
    expect(gameOp.game).toEqual({ game_id: 2 });
    expect(gameOp.data).toEqual({ round_type: "final", round_number: null });
    expect(tournamentOp.tournament).toEqual({ tournament_id: 1 });
    expect(tournamentOp.data).toEqual({ round_count: 1 });
    expect(app.server.state.requests.filter((request) => request.method !== "GET")).toEqual([]);

    // La surcouche montre la partie en finale, le bilan suit et il reste une préliminaire.
    await waitFor(() => expect(screen.queryByTestId("tournament-final-idle")).not.toBeInTheDocument());
    expect(screen.getAllByTestId("tournament-round")).toHaveLength(2);
    expect(screen.getByTestId("tournament-stat-final-vp")).toHaveTextContent("3");
    expect(screen.getByTestId("tournament-stat-vp")).toHaveTextContent("1,5");
    expect(screen.getByTestId("tournament-provisional")).toBeInTheDocument();
    expect(screen.queryByTestId("tournament-add-round")).not.toBeInTheDocument();
    expect(screen.queryByTestId("tournament-add-final")).not.toBeInTheDocument();
  });

  it("passer de « inconnu » à N − 1 convertit aussi", async () => {
    const app = await openSeeded({ hash: "#/tournois/id:1" });
    await screen.findByTestId("tournament-detail");
    await detailLoaded();
    await app.runtime.actions.updateTournament("id:1", { roundCount: null });
    await waitFor(() => expect(screen.getByTestId("tournament-add-round")).toBeInTheDocument());
    const stepper = await openRoundCountForm();
    fireEvent.click(stepper.getByLabelText("Ajouter : Rondes prévues"));
    expect(await screen.findByTestId("tournament-form-round-convert")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("tournament-form-submit")).not.toBeDisabled());
    fireEvent.click(screen.getByTestId("tournament-form-submit"));
    await waitFor(() => expect(screen.queryByTestId("tournament-form")).not.toBeInTheDocument());
    expect((await queuedOps(app)).map((op) => op.type)).toEqual([
      "tournament.update",
      "game.update",
      "tournament.update",
    ]);
  });

  it("de plus d'une ronde : l'envoi est refusé sur place, le focus va à l'alerte, rien n'est mis en file", async () => {
    const app = await openSeeded({ hash: "#/tournois/id:1" });
    await screen.findByTestId("tournament-detail");
    await detailLoaded();
    await app.runtime.actions.createGame({
      playedAt: "2026-10-24T21:42:00Z",
      tournament: "id:1",
      roundType: "preliminary",
      roundNumber: 3,
      playerCount: 5,
      participations: [{ player: "me", deck: "id:1", victoryPoints: 3, gameWin: true }],
    });
    await waitFor(() => expect(screen.getAllByTestId("tournament-round")).toHaveLength(3));
    const stepper = await openRoundCountForm();
    fireEvent.click(stepper.getByLabelText("Retirer : Rondes prévues"));
    fireEvent.click(stepper.getByLabelText("Retirer : Rondes prévues"));
    expect(screen.queryByTestId("tournament-form-round-refusal")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("tournament-form-submit")).not.toBeDisabled());
    fireEvent.click(screen.getByTestId("tournament-form-submit"));
    const alert = await screen.findByTestId("tournament-form-round-refusal");
    expect(alert).toHaveAttribute("role", "alert");
    expect(alert).toHaveTextContent("La ronde 3 est déjà saisie : le tournoi ne peut pas compter moins de 3 ronde(s).");
    await waitFor(() => expect(alert).toHaveFocus());
    expect(screen.queryByTestId("tournament-form-round-convert")).not.toBeInTheDocument();
    expect(await queuedOps(app)).toHaveLength(1);
    expect(screen.getByTestId("tournament-form")).toBeInTheDocument();
  });

  it("sous la plus haute ronde alors qu'une finale existe : refusé sur place", async () => {
    const app = await openSeeded({ hash: "#/tournois/id:1" });
    await screen.findByTestId("tournament-detail");
    await detailLoaded();
    await app.runtime.actions.createGame({
      playedAt: "2026-10-24T23:00:00Z",
      tournament: "id:1",
      roundType: "final",
      playerCount: 5,
      participations: [{ player: "me", deck: "id:1", victoryPoints: 2, gameWin: false }],
    });
    await waitFor(() => expect(screen.queryByTestId("tournament-add-final")).not.toBeInTheDocument());
    const stepper = await openRoundCountForm();
    fireEvent.click(stepper.getByLabelText("Retirer : Rondes prévues"));
    fireEvent.click(stepper.getByLabelText("Retirer : Rondes prévues"));
    await waitFor(() => expect(screen.getByTestId("tournament-form-submit")).not.toBeDisabled());
    fireEvent.click(screen.getByTestId("tournament-form-submit"));
    const alert = await screen.findByTestId("tournament-form-round-refusal");
    expect(alert).toHaveTextContent("La ronde 2 est déjà saisie : le tournoi ne peut pas compter moins de 2 ronde(s).");
    await waitFor(() => expect(alert).toHaveFocus());
    expect(await queuedOps(app)).toHaveLength(1);
  });
});

describe("détail d'un tournoi", () => {
  it("au mobile : kicker, bilan, deck de finale, rondes, finale à venir, actions", async () => {
    setViewportWidth(390);
    await openSeeded({ hash: "#/tournois/id:1" });
    await screen.findByTestId("tournament-detail");
    await detailLoaded();
    expect(screen.getByTestId("tournament-detail-kicker")).toHaveTextContent("Tournoi standard · multi-deck");
    expect(screen.getByTestId("tournament-detail-title")).toHaveTextContent("Open de Lyon");
    expect(screen.getByTestId("tournament-detail-meta")).toHaveTextContent("Samedi 24 octobre · Le Bar à Dés · construit");
    expect(screen.getByTestId("tournament-stat-gw")).toHaveTextContent("1");
    expect(screen.getByTestId("tournament-stat-vp")).toHaveTextContent("4,5");
    expect(screen.getByTestId("tournament-stat-final-vp")).toHaveTextContent("—");
    expect(screen.queryByTestId("tournament-provisional")).not.toBeInTheDocument();
    expect(screen.getByTestId("tournament-final-deck-title")).toHaveTextContent("En finale : Banu Princes");
    expect(screen.getByTestId("tournament-final-deck-help")).toHaveTextContent(
      "Règle « meilleur deck » : le deck de votre meilleure ronde, ici la ronde 2.",
    );
    const rounds = screen.getAllByTestId("tournament-round");
    expect(rounds).toHaveLength(2);
    expect(rounds[0]).toHaveTextContent("Ronde 1");
    expect(rounds[0]).toHaveTextContent("Toreador Mass Vote");
    expect(rounds[0]).toHaveTextContent("1,5 VP");
    expect(rounds[1]).toHaveTextContent("3 VP · GW");
    expect(screen.getByTestId("tournament-final-idle")).toHaveTextContent("pas encore jouée");
    expect(screen.getByTestId("tournament-add-round")).toHaveTextContent("Ajouter la ronde 3");
    expect(screen.getByTestId("tournament-add-final")).toHaveTextContent("Saisir la finale");
    // Une ronde mène à sa partie.
    expect(within(rounds[1]).getByTestId("tournament-round-link")).toHaveAttribute("href", "#/parties/id%3A2");
    fireEvent.click(screen.getByTestId("tournament-back"));
    await screen.findByTestId("tournaments-page");
  });

  it("n'annonce aucun deck de finale tant que la règle n'est pas annoncée", async () => {
    const server = seededServer();
    server.state.tournaments[0].final_deck_rule = null;
    server.state.admissible.delete(1);
    const app = await renderApp({ server, hash: "#/tournois/id:1" });
    await act(async () => {
      await app.runtime.refresh();
    });
    await screen.findByTestId("tournament-detail");
    expect(screen.queryByTestId("tournament-final-deck")).not.toBeInTheDocument();
  });

  it("« Ajouter la ronde N » ouvre la saisie préremplie, et disparaît quand les rondes prévues sont jouées", async () => {
    setViewportWidth(390);
    const app = await openSeeded({ hash: "#/tournois/id:1" });
    await screen.findByTestId("tournament-detail");
    await detailLoaded();
    fireEvent.click(await screen.findByTestId("tournament-add-round"));
    await screen.findByTestId("game-form");
    expect(screen.getByTestId("game-form-tournament")).toHaveTextContent("Open de Lyon");
    expect(screen.getByTestId("game-form-round")).toHaveTextContent("Ronde 3");
    fireEvent.click(within(screen.getByTestId("game-form-sheet")).getByRole("button", { name: "Fermer" }));
    await waitFor(() => expect(screen.queryByTestId("game-form")).not.toBeInTheDocument());

    // La ronde 3 saisie hors ligne : le bilan devient provisoire et la ronde disparaît du menu.
    await app.runtime.actions.createGame({
      playedAt: "2026-10-24T21:42:00Z",
      tournament: "id:1",
      roundType: "preliminary",
      roundNumber: 3,
      playerCount: 5,
      participations: [{ player: "me", deck: "id:1", victoryPoints: 3, gameWin: true }],
    });
    await waitFor(() => expect(screen.queryByTestId("tournament-add-round")).not.toBeInTheDocument());
    expect(screen.getByTestId("tournament-provisional")).toHaveTextContent(
      "Bilan provisoire : la ronde 3 attend le réseau",
    );
    expect(screen.getByTestId("tournament-stat-gw")).toHaveTextContent("2");
    expect(screen.getByTestId("tournament-stat-vp")).toHaveTextContent("7,5");
    expect(screen.getAllByTestId("tournament-round")).toHaveLength(3);

    // « Saisir la finale » ouvre la saisie en finale ; une fois la finale saisie, le bouton disparaît.
    fireEvent.click(screen.getByTestId("tournament-add-final"));
    await screen.findByTestId("game-form");
    expect(screen.getByTestId("game-form-round")).toHaveTextContent("Finale");
    fireEvent.click(within(screen.getByTestId("game-form-sheet")).getByRole("button", { name: "Fermer" }));
    await app.runtime.actions.createGame({
      playedAt: "2026-10-24T23:00:00Z",
      tournament: "id:1",
      roundType: "final",
      playerCount: 5,
      participations: [{ player: "me", deck: "id:1", victoryPoints: 2, gameWin: false }],
    });
    await waitFor(() => expect(screen.queryByTestId("tournament-add-final")).not.toBeInTheDocument());
    expect(screen.getByTestId("tournament-final-line")).toHaveTextContent("2 VP en finale · sans GW");
    expect(screen.queryByTestId("tournament-final-idle")).not.toBeInTheDocument();
  });

  it("à round_count atteint, « Saisir la finale » devient le bouton principal ; une hausse ramène la ronde", async () => {
    const app = await openSeeded({ hash: "#/tournois/id:1" });
    await screen.findByTestId("tournament-detail");
    await detailLoaded();
    expect(screen.getByTestId("tournament-add-final")).toHaveClass("btn-secondary");

    // Baisse à 2 rondes : les deux rondes saisies suffisent, la finale est l'action suivante.
    await editRoundCount(-1);
    await waitFor(() => expect(screen.queryByTestId("tournament-add-round")).not.toBeInTheDocument());
    expect(screen.getByTestId("tournament-add-final")).toHaveClass("btn-primary");
    expect(await queuedOps(app)).toHaveLength(1);

    // Hausse à 4 : la ronde 3 revient, la finale repasse en secondaire.
    await editRoundCount(2);
    await waitFor(() => expect(screen.getByTestId("tournament-add-round")).toHaveTextContent("Ajouter la ronde 3"));
    expect(screen.getByTestId("tournament-add-round")).toHaveClass("btn-primary");
    expect(screen.getByTestId("tournament-add-final")).toHaveClass("btn-secondary");
  });

  it("une fois la finale saisie, plus de bouton de ronde, même sans round_count", async () => {
    const app = await openSeeded({ hash: "#/tournois/id:1" });
    await screen.findByTestId("tournament-detail");
    await detailLoaded();
    await app.runtime.actions.updateTournament("id:1", { roundCount: null });
    await waitFor(() => expect(screen.getByTestId("tournament-add-round")).toHaveTextContent("Ajouter la ronde 3"));
    await app.runtime.actions.createGame({
      playedAt: "2026-10-24T23:00:00Z",
      tournament: "id:1",
      roundType: "final",
      playerCount: 5,
      participations: [{ player: "me", deck: "id:1", victoryPoints: 2, gameWin: false }],
    });
    await waitFor(() => expect(screen.queryByTestId("tournament-add-final")).not.toBeInTheDocument());
    expect(screen.queryByTestId("tournament-add-round")).not.toBeInTheDocument();
  });

  it("au bureau : quatre chiffres, tableau des rondes, et R puis F ouvrent la saisie (inactifs dans un champ)", async () => {
    await openSeeded();
    const detail = await screen.findByTestId("tournaments-detail");
    await within(detail).findByTestId("tournament-detail");
    await detailLoaded();
    expect(within(detail).getByTestId("tournament-stat-final-gw")).toHaveTextContent("—");
    expect(within(detail).getByTestId("tournament-detail-meta")).toHaveTextContent("nombre de joueurs inconnu");
    expect(within(within(detail).getAllByTestId("tournament-round")[1]).getByText("Marc F.", { exact: false })).toBeInTheDocument();

    await flushEffects();
    // Dans un champ (le classement), `r` n'ouvre rien.
    const place = within(detail).getByTestId("tournament-ranking-place");
    place.focus();
    fireEvent.keyDown(place, { key: "r" });
    expect(screen.queryByTestId("game-form")).not.toBeInTheDocument();
    place.blur();

    fireEvent.keyDown(document, { key: "r" });
    await screen.findByTestId("game-form");
    expect(screen.getByTestId("game-form-round")).toHaveTextContent("Ronde 3");
    // Derrière la feuille, ni `r`, ni `f`, ni `n` n'agissent.
    fireEvent.keyDown(document, { key: "f" });
    fireEvent.keyDown(document, { key: "n" });
    expect(screen.getAllByTestId("game-form")).toHaveLength(1);
    expect(screen.queryByTestId("tournament-form")).not.toBeInTheDocument();
    fireEvent.click(within(screen.getByTestId("game-form-sheet")).getByRole("button", { name: "Fermer" }));
    await waitFor(() => expect(screen.queryByTestId("game-form")).not.toBeInTheDocument());

    await flushEffects();
    fireEvent.keyDown(document, { key: "f" });
    await screen.findByTestId("game-form");
    expect(screen.getByTestId("game-form-round")).toHaveTextContent("Finale");
  });
});

describe("classement final", () => {
  async function openWithFinal(gameWin: boolean) {
    setViewportWidth(390);
    const app = await openSeeded({ hash: "#/tournois/id:1" });
    await screen.findByTestId("tournament-detail");
    await detailLoaded();
    await app.runtime.actions.createGame({
      playedAt: "2026-10-24T23:00:00Z",
      tournament: "id:1",
      roundType: "final",
      playerCount: 5,
      participations: [{ player: "me", deck: "id:1", victoryPoints: gameWin ? 3 : 1, gameWin }],
    });
    await screen.findByTestId("tournament-final");
    await waitFor(() => expect(screen.queryByTestId("tournament-final-idle")).not.toBeInTheDocument());
    return app;
  }

  it("préremplit la première place avec un GW en finale, redemande le nombre de joueurs et l'enregistre", async () => {
    const app = await openWithFinal(true);
    const place = screen.getByTestId("tournament-ranking-place");
    expect(place).toHaveValue(1);
    expect(screen.getByTestId("tournament-ranking-players-help")).toHaveTextContent(
      "Le nombre de joueurs n'avait pas été saisi : renseignez-le en même temps.",
    );
    expect(screen.getByTestId("tournament-ranking-submit")).not.toBeDisabled();
    fireEvent.change(screen.getByTestId("tournament-ranking-players"), { target: { value: "27" } });
    fireEvent.click(screen.getByTestId("tournament-ranking-submit"));
    expect(await screen.findByTestId("tournament-ranking-saved")).toBeInTheDocument();
    const ops = await queuedOps(app);
    const update = ops.find((op) => op.type === "tournament.update");
    if (!update || update.type !== "tournament.update") throw new Error("tournament.update attendu");
    expect(update.data).toEqual({ my_ranking: 1, player_count: 27 });
  });

  it("refuse l'envoi tant qu'une erreur vérifiable s'affiche, et met le focus sur l'alerte", async () => {
    const app = await openWithFinal(true);
    const before = (await queuedOps(app)).length;
    fireEvent.change(screen.getByTestId("tournament-ranking-place"), { target: { value: "3" } });
    const alert = await screen.findByTestId("tournament-ranking-error");
    expect(alert).toHaveTextContent("Un Game Win en finale donne la première place.");
    expect(alert).toHaveAttribute("role", "alert");
    // Le bouton reste actif : il refuse, il ne se grise pas.
    const submit = screen.getByTestId("tournament-ranking-submit");
    expect(submit).not.toBeDisabled();
    fireEvent.click(submit);
    await waitFor(() => expect(alert).toHaveFocus());
    expect((await queuedOps(app)).length).toBe(before);
    expect(screen.queryByTestId("tournament-ranking-saved")).not.toBeInTheDocument();

    // Corrigée, la place part.
    fireEvent.change(screen.getByTestId("tournament-ranking-place"), { target: { value: "1" } });
    await waitFor(() => expect(screen.queryByTestId("tournament-ranking-error")).not.toBeInTheDocument());
    fireEvent.click(submit);
    await waitFor(async () => expect((await queuedOps(app)).length).toBe(before + 1));
  });

  it("dit « votre place va de 1 à 5 » à un finaliste, et refuse une place au-delà du nombre de joueurs", async () => {
    await openWithFinal(false);
    expect(screen.getByTestId("tournament-ranking-final-help")).toHaveTextContent("Finaliste : votre place va de 1 à 5.");
    expect(screen.getByTestId("tournament-ranking-place")).toHaveValue(null);
    expect(screen.getByTestId("tournament-ranking-submit")).toBeDisabled();
    fireEvent.change(screen.getByTestId("tournament-ranking-place"), { target: { value: "7" } });
    expect(await screen.findByTestId("tournament-ranking-error")).toHaveTextContent("Finaliste : votre place va de 1 à 5.");
    fireEvent.change(screen.getByTestId("tournament-ranking-players"), { target: { value: "6" } });
    expect(screen.getByTestId("tournament-ranking-error")).toHaveTextContent("Au plus 6e sur 6 joueurs.");
    fireEvent.change(screen.getByTestId("tournament-ranking-place"), { target: { value: "2" } });
    expect(screen.queryByTestId("tournament-ranking-error")).not.toBeInTheDocument();
  });
});

describe("suppression d'un tournoi", () => {
  it("est refusée sur place quand le tournoi contient des parties, sans rien mettre en file", async () => {
    setViewportWidth(390);
    const app = await openSeeded({ hash: "#/tournois/id:1" });
    await screen.findByTestId("tournament-detail");
    await detailLoaded();
    fireEvent.click(screen.getByTestId("tournament-delete"));
    expect(await screen.findByTestId("tournament-delete-refused")).toHaveTextContent(
      "Ce tournoi contient 2 parties : supprimez-les ou détachez-les du tournoi d'abord.",
    );
    expect(screen.getByTestId("tournament-delete-refused")).toHaveAttribute("role", "alert");
    expect(screen.queryByTestId("tournament-delete-confirmation")).not.toBeInTheDocument();
    expect(await queuedOps(app)).toEqual([]);
  });

  it("est permise en deux temps quand le tournoi est vide, puis ramène à la liste", async () => {
    setViewportWidth(390);
    const app = await renderApp({ online: false, hash: "#/tournois" });
    const created = await app.runtime.actions.createTournament({ name: "Rien à jouer", startDate: "2026-10-24" });
    await go({ name: "tournament", key: created.key });
    await screen.findByTestId("tournament-detail");
    await waitFor(() => expect(screen.getByTestId("tournament-delete")).not.toBeDisabled());
    fireEvent.click(screen.getByTestId("tournament-delete"));
    expect(await screen.findByTestId("tournament-delete-confirmation")).toHaveTextContent("Supprimer ce tournoi ?");
    // « Garder » abandonne.
    fireEvent.click(screen.getByTestId("tournament-delete-keep"));
    expect(screen.queryByTestId("tournament-delete-confirmation")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("tournament-delete"));
    fireEvent.click(await screen.findByTestId("tournament-delete-confirm"));
    await screen.findByTestId("tournaments-page");
    expect(window.location.hash).toBe("#/tournois");
    const ops = await queuedOps(app);
    expect(ops.map((op) => op.type)).toContain("tournament.delete");
  });
});

describe("Carnet", () => {
  it("au mobile : segmenté Adversaires | Lieux, Moi en tête sans suppression", async () => {
    setViewportWidth(390);
    await openSeeded({ hash: "#/carnet" });
    await screen.findByTestId("notebook-player-list");
    expect(screen.getByTestId("notebook-tab-players").closest("label")).toHaveTextContent("Adversaires · 2");
    expect(screen.getByTestId("notebook-tab-venues").closest("label")).toHaveTextContent("Lieux · 1");
    const rows = screen.getAllByTestId("notebook-player");
    expect(rows[0]).toHaveAttribute("data-me", "true");
    expect(within(rows[0]).getByTestId("notebook-me-badge")).toHaveTextContent("Moi");
    expect(rows[0]).toHaveTextContent("Renommable, jamais supprimé");
    expect(within(rows[0]).queryByTestId("notebook-player-delete")).not.toBeInTheDocument();
    expect(within(rows[0]).getByTestId("notebook-player-rename-button")).toBeInTheDocument();
    expect(rows[1]).toHaveTextContent("Marc F.");
    expect(rows[1]).toHaveTextContent("à 1 table");

    fireEvent.click(screen.getByTestId("notebook-tab-venues"));
    const venue = await screen.findByTestId("notebook-venue");
    expect(venue).toHaveTextContent("Le Bar à Dés");
    expect(venue).toHaveTextContent("Lyon");
    expect(venue).toHaveTextContent("2 parties · 1 tournoi");
    expect(screen.queryByTestId("notebook-player-list")).not.toBeInTheDocument();
  });

  it("au bureau : deux colonnes côte à côte", async () => {
    await openSeeded({ hash: "#/carnet" });
    await screen.findByTestId("notebook-columns");
    expect(screen.getByTestId("notebook-players-title")).toHaveTextContent("Adversaires · 2");
    expect(screen.getByTestId("notebook-venues-title")).toHaveTextContent("Lieux · 1");
    expect(screen.getByTestId("notebook-player-list")).toBeInTheDocument();
    expect(screen.getByTestId("notebook-venue-list")).toBeInTheDocument();
  });

  it("renomme en place : Entrée valide, Échap annule, la file reçoit player.update", async () => {
    const app = await openSeeded({ hash: "#/carnet" });
    await screen.findByTestId("notebook-player-list");
    const marc = () => screen.getAllByTestId("notebook-player")[1];

    fireEvent.click(within(marc()).getByTestId("notebook-player-rename-button"));
    let input = await screen.findByTestId("notebook-player-rename-input");
    expect(input).toHaveValue("Marc F.");
    fireEvent.change(input, { target: { value: "Marc Fabre" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByTestId("notebook-player-rename-input")).not.toBeInTheDocument();
    expect(marc()).toHaveTextContent("Marc F.");
    expect(await queuedOps(app)).toEqual([]);

    fireEvent.click(within(marc()).getByTestId("notebook-player-rename-button"));
    input = await screen.findByTestId("notebook-player-rename-input");
    fireEvent.change(input, { target: { value: "Marc Fabre" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(screen.queryByTestId("notebook-player-rename-input")).not.toBeInTheDocument());
    const ops = await queuedOps(app);
    expect(ops).toHaveLength(1);
    if (ops[0].type !== "player.update") throw new Error("player.update attendu");
    expect(ops[0].data).toEqual({ name: "Marc Fabre" });
    await waitFor(() => expect(marc()).toHaveTextContent("Marc Fabre"));
  });

  it("refuse un renommage en doublon (casse et accents ignorés, Moi compris) et un nom vide", async () => {
    const app = await openSeeded({ hash: "#/carnet" });
    await screen.findByTestId("notebook-player-list");
    fireEvent.click(within(screen.getAllByTestId("notebook-player")[1]).getByTestId("notebook-player-rename-button"));
    const input = await screen.findByTestId("notebook-player-rename-input");
    fireEvent.change(input, { target: { value: "  MOI " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(await screen.findByTestId("notebook-player-rename-error")).toHaveTextContent(
      "Un adversaire porte déjà ce nom.",
    );
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByTestId("notebook-player-rename-error")).toHaveTextContent("Le nom ne peut pas être vide.");
    expect(await queuedOps(app)).toEqual([]);
  });

  it("renomme Moi et un lieu", async () => {
    const app = await openSeeded({ hash: "#/carnet" });
    await screen.findByTestId("notebook-player-list");
    fireEvent.click(within(screen.getAllByTestId("notebook-player")[0]).getByTestId("notebook-player-rename-button"));
    let input = await screen.findByTestId("notebook-player-rename-input");
    fireEvent.change(input, { target: { value: "Spigushe" } });
    fireEvent.click(screen.getByTestId("notebook-player-rename-ok"));
    await waitFor(() => expect(screen.queryByTestId("notebook-player-rename-input")).not.toBeInTheDocument());

    fireEvent.click(screen.getByTestId("notebook-venue-rename-button"));
    input = await screen.findByTestId("notebook-venue-rename-input");
    fireEvent.change(input, { target: { value: "Bar à Dés" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(screen.queryByTestId("notebook-venue-rename-input")).not.toBeInTheDocument());
    const ops = await queuedOps(app);
    expect(ops.map((op) => op.type)).toEqual(["player.update", "venue.update"]);
  });

  it("refuse la suppression d'un adversaire ou d'un lieu utilisé, avec le motif, sans rien mettre en file", async () => {
    const app = await openSeeded({ hash: "#/carnet" });
    await screen.findByTestId("notebook-player-list");
    fireEvent.click(within(screen.getAllByTestId("notebook-player")[1]).getByTestId("notebook-player-delete"));
    const refusal = await screen.findByTestId("notebook-player-refused");
    expect(refusal).toHaveTextContent("Marc F. figure à 1 table : retirez-le d'abord de cette partie pour le supprimer.");
    expect(refusal).toHaveAttribute("role", "alert");
    expect(screen.queryByTestId("notebook-player-confirmation")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("notebook-venue-delete"));
    expect(await screen.findByTestId("notebook-venue-refused")).toHaveTextContent(
      "Le Bar à Dés sert à 2 parties et 1 tournoi : impossible de le supprimer.",
    );
    expect(await queuedOps(app)).toEqual([]);
  });

  it("compte aussi ce que montrent les parties locales, au-delà du compteur serveur", async () => {
    const app = await openSeeded({ hash: "#/carnet" });
    await screen.findByTestId("notebook-player-list");
    const julie = await app.runtime.actions.ensurePlayer("Julie R.");
    const venue = await app.runtime.actions.ensureVenue("Chez Marc");
    await app.runtime.actions.createGame({
      playedAt: "2026-10-25T20:00:00Z",
      venue: venue.key,
      playerCount: 4,
      participations: [{ player: "me", victoryPoints: 1 }, { player: julie.key, seat: 3 }],
    });
    await waitFor(() => expect(screen.getAllByTestId("notebook-player")).toHaveLength(3));
    const row = screen.getAllByTestId("notebook-player").find((item) => item.textContent?.includes("Julie R."))!;
    await waitFor(() => expect(row).toHaveTextContent("à 1 table"));
    fireEvent.click(within(row).getByTestId("notebook-player-delete"));
    expect(await screen.findByTestId("notebook-player-refused")).toHaveTextContent("Julie R. figure à 1 table");
    const chez = screen.getAllByTestId("notebook-venue").find((item) => item.textContent?.includes("Chez Marc"))!;
    fireEvent.click(within(chez).getByTestId("notebook-venue-delete"));
    expect(await screen.findByTestId("notebook-venue-refused")).toHaveTextContent("Chez Marc sert à 1 partie");
  });

  it("supprime en deux temps un adversaire et un lieu qui ne servent à rien", async () => {
    const app = await openSeeded({ hash: "#/carnet" });
    await screen.findByTestId("notebook-player-list");
    await app.runtime.actions.ensurePlayer("Yann B.");
    await app.runtime.actions.ensureVenue("Salle Jean-Macé");
    const yann = await waitFor(() => {
      const row = screen.getAllByTestId("notebook-player").find((item) => item.textContent?.includes("Yann B."));
      if (!row) throw new Error("ligne attendue");
      return row;
    });
    expect(yann).toHaveTextContent("à aucune table");
    fireEvent.click(within(yann).getByTestId("notebook-player-delete"));
    expect(await screen.findByTestId("notebook-player-confirmation")).toHaveTextContent("Supprimer « Yann B. » ?");
    fireEvent.click(screen.getByTestId("notebook-player-delete-keep"));
    expect(screen.queryByTestId("notebook-player-confirmation")).not.toBeInTheDocument();
    fireEvent.click(within(yann).getByTestId("notebook-player-delete"));
    fireEvent.click(await screen.findByTestId("notebook-player-delete-confirm"));
    await waitFor(() => expect(screen.getAllByTestId("notebook-player")).toHaveLength(2));

    const salle = screen.getAllByTestId("notebook-venue").find((item) => item.textContent?.includes("Salle Jean-Macé"))!;
    expect(salle).toHaveTextContent("aucune partie");
    fireEvent.click(within(salle).getByTestId("notebook-venue-delete"));
    fireEvent.click(await screen.findByTestId("notebook-venue-delete-confirm"));
    await waitFor(() => expect(screen.getAllByTestId("notebook-venue")).toHaveLength(1));
    const types = (await queuedOps(app)).map((op) => op.type);
    expect(types).toContain("player.delete");
    expect(types).toContain("venue.delete");
  });
});

describe("Atelier : tournoi en cours et raccourci « Nouvelle partie »", () => {
  const today = () => localDay(new Date());

  it("affiche la carte d'un tournoi commencé aujourd'hui, avec sa dernière ronde et « Saisir la ronde N »", async () => {
    setViewportWidth(390);
    const server = seededServer({ startDate: today() });
    const app = await renderApp({ server, hash: "#/" });
    await act(async () => {
      await app.runtime.refresh();
    });
    const card = await screen.findByTestId("home-tournament");
    expect(within(card).getByTestId("home-tournament-name")).toHaveTextContent("Open de Lyon");
    expect(await within(card).findByTestId("home-tournament-last")).toHaveTextContent(
      "Dernière ronde : ronde 2 · Banu Princes · 3 VP · GW",
    );
    const enter = within(card).getByTestId("home-tournament-enter");
    expect(enter).toHaveTextContent("Saisir la ronde 3");
    fireEvent.click(enter);
    await screen.findByTestId("game-form");
    expect(screen.getByTestId("game-form-tournament")).toHaveTextContent("Open de Lyon");
    expect(screen.getByTestId("game-form-round")).toHaveTextContent("Ronde 3");
    // Mobile : la pilule « Nouvelle partie » ouvre la saisie par l'intention de route.
    expect(screen.getByTestId("home-shortcut-game")).toHaveAttribute("href", "#/parties?action=nouvelle");
  });

  it("propose la finale quand les rondes prévues sont jouées, et le classement une fois la finale saisie", async () => {
    setViewportWidth(390);
    const server = seededServer({ startDate: today() });
    server.state.tournaments[0].round_count = 2;
    const app = await renderApp({ server, hash: "#/" });
    await act(async () => {
      await app.runtime.refresh();
    });
    await waitFor(() =>
      expect(screen.getByTestId("home-tournament-enter")).toHaveTextContent("Saisir la finale"),
    );
    await app.runtime.actions.createGame({
      playedAt: new Date().toISOString(),
      tournament: "id:1",
      roundType: "final",
      playerCount: 5,
      participations: [{ player: "me", deck: "id:1", victoryPoints: 1, gameWin: false }],
    });
    expect(await screen.findByTestId("home-tournament-ranking")).toHaveTextContent("Saisir le classement");
    expect(screen.queryByTestId("home-tournament-enter")).not.toBeInTheDocument();
  });

  it("suit round_count : la finale à round_count atteint, la ronde après une hausse, la finale après une baisse", async () => {
    setViewportWidth(390);
    const server = seededServer({ startDate: today() });
    const app = await renderApp({ server, hash: "#/" });
    await act(async () => {
      await app.runtime.refresh();
    });
    await waitFor(() => expect(screen.getByTestId("home-tournament-enter")).toHaveTextContent("Saisir la ronde 3"));
    await app.runtime.actions.updateTournament("id:1", { roundCount: 2 });
    await waitFor(() => expect(screen.getByTestId("home-tournament-enter")).toHaveTextContent("Saisir la finale"));
    await app.runtime.actions.updateTournament("id:1", { roundCount: 4 });
    await waitFor(() => expect(screen.getByTestId("home-tournament-enter")).toHaveTextContent("Saisir la ronde 3"));
    await app.runtime.actions.updateTournament("id:1", { roundCount: 2 });
    await waitFor(() => expect(screen.getByTestId("home-tournament-enter")).toHaveTextContent("Saisir la finale"));
  });

  it("round_count inconnu : la finale saisie remplace le bouton de ronde par le classement", async () => {
    setViewportWidth(390);
    const server = seededServer({ startDate: today() });
    server.state.tournaments[0].round_count = null;
    const app = await renderApp({ server, hash: "#/" });
    await act(async () => {
      await app.runtime.refresh();
    });
    await waitFor(() => expect(screen.getByTestId("home-tournament-enter")).toHaveTextContent("Saisir la ronde 3"));
    await app.runtime.actions.createGame({
      playedAt: new Date().toISOString(),
      tournament: "id:1",
      roundType: "final",
      playerCount: 5,
      participations: [{ player: "me", deck: "id:1", victoryPoints: 1, gameWin: false }],
    });
    expect(await screen.findByTestId("home-tournament-ranking")).toBeInTheDocument();
    expect(screen.queryByTestId("home-tournament-enter")).not.toBeInTheDocument();
  });

  it("n'affiche rien pour un tournoi ancien ou déjà classé", async () => {
    const old = seededServer({ startDate: "2020-01-01" });
    const app = await renderApp({ server: old, hash: "#/" });
    await act(async () => {
      await app.runtime.refresh();
    });
    await screen.findByTestId("home-page");
    await screen.findByTestId("home-shortcuts");
    expect(screen.queryByTestId("home-tournament")).not.toBeInTheDocument();
  });

  it("au bureau : « Nouvelle partie » en tête des raccourcis, et Entrée hors contrôle ouvre la saisie de la ronde", async () => {
    const server = seededServer({ startDate: today() });
    const app = await renderApp({ server, hash: "#/" });
    await act(async () => {
      await app.runtime.refresh();
    });
    await screen.findByTestId("home-tournament");
    await screen.findByTestId("home-tournament-last");
    await waitFor(() => expect(screen.getByTestId("home-tournament-enter")).toHaveTextContent("Saisir la ronde 3"));
    const shortcuts = within(screen.getByTestId("home-shortcuts"));
    const first = screen.getByTestId("home-shortcuts").firstElementChild!;
    expect(first).toHaveAttribute("data-testid", "home-shortcut-game");
    expect(first).toHaveAttribute("href", "#/parties?action=nouvelle");
    expect(shortcuts.getByTestId("home-shortcut-deck")).toBeInTheDocument();

    await flushEffects();
    // Sur un contrôle interactif, `Entrée` garde son sens habituel.
    const link = screen.getByTestId("home-shortcut-deck");
    link.focus();
    fireEvent.keyDown(link, { key: "Enter" });
    expect(screen.queryByTestId("game-form")).not.toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: "Enter" });
    await screen.findByTestId("game-form");
    expect(screen.getByTestId("game-form-round")).toHaveTextContent("Ronde 3");
  });
});
