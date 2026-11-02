import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { GameRow } from "../../../src/offline/vtes/db";
import {
  useLocalGame,
  useLocalPlayer,
  useLocalTournament,
  useLocalVenue,
} from "../../../src/offline/vtes/hooks";
import { readGames, readPlayers, readTournaments, readVenues } from "../../../src/offline/vtes/reads";
import {
  refreshGames,
  refreshPlayers,
  refreshTournaments,
  refreshVenues,
} from "../../../src/offline/vtes/refresh";
import { VtesOfflineProvider } from "../../../src/offline/vtes/VtesOfflineProvider";
import { createVtesOffline, type VtesOfflineRuntime } from "../../../src/offline/vtes/runtime";
import type { ResourceKey } from "../../../src/offline/vtes/types";
import { createFakeServer, type FakeServer } from "./fakeServer";
import { freshDbName, manualTimers, restoreNavigatorOnLine } from "./helpers";

const runtimes: VtesOfflineRuntime[] = [];

async function boot(options: { online?: boolean } = {}) {
  const server = createFakeServer();
  const state = { online: options.online ?? true };
  const runtime = createVtesOffline({
    client: server.client,
    dbName: freshDbName("playcov"),
    autoRefresh: false,
    engine: { isOnline: () => state.online, lockName: null, timers: manualTimers().timers, backoff: { jitter: 0 } },
  });
  runtimes.push(runtime);
  return { server, runtime, state };
}

afterEach(async () => {
  cleanup();
  for (const runtime of runtimes.splice(0)) {
    runtime.stop();
    await runtime.engine.whenIdle();
    runtime.dispose();
  }
  restoreNavigatorOnLine();
});

type Get = (path: string, init: never) => Promise<unknown>;

/** Remplace `GET` : les chemins qui correspondent rendent ce statut. Rend la fonction d'origine. */
function failOn(server: FakeServer, match: (path: string) => boolean, status: number): Get {
  const original = server.client.GET.bind(server.client) as unknown as Get;
  (server.client as { GET: unknown }).GET = async (path: string, init: never) => {
    if (match(path)) {
      return { data: undefined, error: { detail: "erreur" }, response: new Response("{}", { status }) };
    }
    return original(path, init);
  };
  return original;
}

const tournamentRow = (id: number, name: string, start: string) => ({
  id,
  name,
  start_date: start,
  end_date: null,
  venue_id: null,
  deck_policy: "mono",
  format: "constructed",
  event_tier: "standard",
  final_deck_rule: null,
  round_count: null,
  player_count: null,
  my_ranking: null,
  notes: null,
  updated_at: "2026-10-24T10:00:00Z",
});

const serverGame = (id: number, playedAt: string, extra: Record<string, unknown> = {}) => ({
  id,
  played_at: playedAt,
  venue_id: null,
  tournament_id: null,
  round_number: null,
  round_type: "casual",
  player_count: 4,
  notes: null,
  updated_at: playedAt,
  participations: [
    { player_id: 1, is_me: true, deck_id: null, seat: null, victory_points: null, game_win: null, notes: null },
  ],
  ...extra,
});

describe("élagage de settled par famille (tournois, lieux)", () => {
  async function settledAll() {
    const booted = await boot();
    await booted.runtime.actions.createVenue({ name: "Club" });
    await booted.runtime.actions.createTournament({ name: "T", startDate: "2026-10-24" });
    await booted.runtime.actions.createPlayer({ name: "Marc" });
    await booted.runtime.engine.flush();
    expect((await booted.runtime.db.settled.toArray()).map((e) => e.type)).toEqual([
      "venue.create",
      "tournament.create",
      "player.create",
    ]);
    return booted;
  }

  it("refreshTournaments n'efface que tournament.*", async () => {
    const { server, runtime } = await settledAll();
    await refreshTournaments(server.client, runtime.db);
    expect((await runtime.db.settled.toArray()).map((e) => e.type)).toEqual(["venue.create", "player.create"]);
  });

  it("refreshVenues n'efface que venue.*", async () => {
    const { server, runtime } = await settledAll();
    await refreshVenues(server.client, runtime.db);
    expect((await runtime.db.settled.toArray()).map((e) => e.type)).toEqual(["tournament.create", "player.create"]);
    await refreshPlayers(server.client, runtime.db);
    expect((await runtime.db.settled.toArray()).map((e) => e.type)).toEqual(["tournament.create"]);
  });
});

describe("rafraîchissement des tournois et des parties", () => {
  it("un détail de tournoi en 404 omet la ligne, rafraîchissement complet", async () => {
    const { server, runtime } = await boot();
    server.state.tournaments.push(tournamentRow(1, "Garde", "2026-10-24"), tournamentRow(2, "Disparu", "2026-10-25"));
    const original = server.client.GET.bind(server.client) as unknown as Get;
    (server.client as { GET: unknown }).GET = async (path: string, init: never) => {
      const result = await original(path, init);
      if (path === "/tournois") server.state.tournaments.pop(); // le 2 disparaît juste après la liste
      return result;
    };
    await expect(refreshTournaments(server.client, runtime.db)).resolves.toBe(1);
    expect((await runtime.db.tournaments.toArray()).map((t) => t.id)).toEqual([1]);
    expect(await runtime.refresh()).toMatchObject({ complete: true, errors: [] });
  });

  it("les tournois se rafraîchissent avant les parties", async () => {
    const { server, runtime } = await boot();
    server.state.tournaments.push(tournamentRow(1, "T", "2026-10-24"));
    server.state.games.push(serverGame(1, "2026-10-24T18:00:00Z", { tournament_id: 1 }));
    const report = await runtime.refresh();
    expect(report.refreshed).toContain("tournaments");
    expect(report.refreshed.indexOf("tournaments")).toBeLessThan(report.refreshed.indexOf("games"));
    const paths = server.state.requests.filter((r) => r.method === "GET").map((r) => r.path);
    expect(paths.indexOf("/tournois")).toBeLessThan(paths.indexOf("/parties"));
  });

  it("le nom du tournoi d'une partie vient de GET /parties", async () => {
    const { server, runtime } = await boot();
    server.state.tournaments.push(tournamentRow(1, "Régionaux", "2026-10-24"));
    server.state.games.push(
      serverGame(1, "2026-10-24T18:00:00Z", { tournament_id: 1, round_type: "preliminary", round_number: 1 }),
    );
    await refreshGames(server.client, runtime.db); // seul : le miroir des tournois reste vide
    expect(await runtime.db.games.get(1)).toMatchObject({ tournamentId: 1, tournamentName: "Régionaux" });
  });

  for (const status of [401, 500]) {
    it(`GET /tournois en ${status} : les parties ne sont ni relues ni élaguées`, async () => {
      const { server, runtime } = await boot();
      const tournament = await runtime.actions.createTournament({ name: "T", startDate: "2026-10-24" });
      await runtime.actions.createGame({
        tournament: tournament.key,
        roundType: "preliminary",
        roundNumber: 1,
        playerCount: 4,
        participations: [{ player: "me", victoryPoints: 3 }],
      });
      await runtime.engine.flush();
      expect(await runtime.db.settled.count()).toBe(2);

      failOn(server, (path) => path.startsWith("/tournois"), status);
      const report = await runtime.refresh();
      expect(report.complete).toBe(false);
      expect(report.authRequired).toBe(status === 401);
      expect(report.refreshed).not.toContain("tournaments");
      expect(report.refreshed).not.toContain("games");
      expect((await runtime.db.settled.toArray()).map((e) => e.type)).toContain("game.create");
      expect(server.state.requests.some((r) => r.method === "GET" && r.path === "/parties")).toBe(false);
      // Le bilan continue de se projeter depuis la partie tranchée.
      const [t] = await readTournaments(runtime.db);
      expect(t.summary).toMatchObject({ roundsPlayed: 1, preliminaryVictoryPoints: 3 });
    });
  }

  it("un rafraîchissement sain après l'échec reprend tout", async () => {
    const { server, runtime } = await boot();
    const tournament = await runtime.actions.createTournament({ name: "T", startDate: "2026-10-24" });
    await runtime.actions.createGame({
      tournament: tournament.key,
      roundType: "preliminary",
      roundNumber: 1,
      playerCount: 4,
      participations: [{ player: "me", victoryPoints: 3 }],
    });
    await runtime.engine.flush();
    const original = failOn(server, (path) => path.startsWith("/tournois"), 500);
    expect((await runtime.refresh()).complete).toBe(false);
    (server.client as { GET: unknown }).GET = original;
    expect(await runtime.refresh()).toMatchObject({ complete: true, errors: [] });
    expect(await runtime.db.settled.count()).toBe(0);
    expect((await readTournaments(runtime.db))[0].summary.roundsPlayed).toBe(1);
  });
});

describe("lectures locales de la pratique de jeu", () => {
  async function seeded() {
    const booted = await boot({ online: false });
    const { runtime } = booted;
    await runtime.db.players.bulkPut([
      { id: 1, name: "Zoé", foldedName: "zoe", isMe: true, gameCount: 0 },
      { id: 2, name: "Alice", foldedName: "alice", isMe: false, gameCount: 0 },
      { id: 3, name: "Éloïse", foldedName: "eloise", isMe: false, gameCount: 0 },
    ]);
    await runtime.db.venues.bulkPut([
      { id: 1, name: "Café Lyon", foldedName: "cafe lyon", city: null, notes: null, gameCount: 0, tournamentCount: 0 },
      { id: 2, name: "Boutique", foldedName: "boutique", city: null, notes: null, gameCount: 0, tournamentCount: 0 },
    ]);
    const t = (id: number, name: string, startDate: string) => ({
      id,
      name,
      startDate,
      endDate: null,
      venueId: null,
      deckPolicy: "mono" as const,
      format: "constructed" as const,
      eventTier: "standard" as const,
      finalDeckRule: null,
      roundCount: null,
      playerCount: null,
      myRanking: null,
      summary: {
        preliminaryGameWins: 0,
        preliminaryVictoryPoints: 0,
        roundsPlayed: 0,
        finalVictoryPoints: null,
        finalGameWin: null,
      },
      admissibleFinalDecks: null,
      notes: null,
      updatedAt: "2026-10-01T00:00:00Z",
    });
    await runtime.db.tournaments.bulkPut([
      t(1, "Nationaux", "2026-10-10"),
      t(2, "Régionaux", "2026-10-20"),
      t(3, "Éclair", "2026-10-20"),
    ]);
    const g = (id: number, playedAt: string, extra: Partial<GameRow> = {}): GameRow => ({
      id,
      playedAt,
      venueId: null,
      tournamentId: null,
      tournamentName: null,
      roundNumber: null,
      roundType: "casual",
      playerCount: 4,
      me: { deckId: null, seat: null, victoryPoints: null, gameWin: null },
      notes: null,
      updatedAt: playedAt,
      table: null,
      ...extra,
    });
    const withDeck = (deckId: number) => ({ deckId, seat: null, victoryPoints: null, gameWin: null });
    await runtime.db.games.bulkPut([
      g(1, "2026-10-10T18:00:00Z", { tournamentId: 1, roundType: "preliminary", roundNumber: 1, venueId: 1, me: withDeck(7) }),
      g(2, "2026-10-12T18:00:00Z", { venueId: 2, me: withDeck(8) }),
      g(3, "2026-10-14T18:00:00Z", { tournamentId: 2, roundType: "preliminary", roundNumber: 1, venueId: 1 }),
      g(4, "2026-10-16T18:00:00Z"),
    ]);
    return booted;
  }

  it("readPlayers : le Moi en tête malgré l'ordre alphabétique, recherche sans accent", async () => {
    const { runtime } = await seeded();
    expect((await readPlayers(runtime.db)).map((p) => p.name)).toEqual(["Zoé", "Alice", "Éloïse"]);
    expect((await readPlayers(runtime.db, { q: "ELOISE" })).map((p) => p.name)).toEqual(["Éloïse"]);
  });

  it("readVenues : tri par nom et recherche q", async () => {
    const { runtime } = await seeded();
    expect((await readVenues(runtime.db)).map((v) => v.name)).toEqual(["Boutique", "Café Lyon"]);
    expect((await readVenues(runtime.db, { q: "CAFE" })).map((v) => v.name)).toEqual(["Café Lyon"]);
    expect(await readVenues(runtime.db, { q: "absent" })).toEqual([]);
  });

  it("readTournaments : q, bornes de date incluses, plus récent d'abord", async () => {
    const { runtime } = await seeded();
    const ids = async (query: Parameters<typeof readTournaments>[1]) =>
      (await readTournaments(runtime.db, query)).map((x) => x.id);
    const all = await ids({});
    expect(all[2]).toBe(1); // le plus ancien en dernier
    expect(all.slice(0, 2).sort()).toEqual([2, 3]);
    // Même date de début : l'ordre des noms départage (« Régionaux » avant « Éclair »).
    expect(all.slice(0, 2)).toEqual([2, 3]);
    expect(await ids({ q: "NATIONAUX" })).toEqual([1]);
    expect(await ids({ q: "eclair" })).toEqual([3]);
    expect((await ids({ from: "2026-10-20" })).sort()).toEqual([2, 3]);
    expect(await ids({ to: "2026-10-10" })).toEqual([1]);
    expect(await ids({ from: "2026-10-10", to: "2026-10-10" })).toEqual([1]);
    expect(await ids({ from: "2026-10-11", to: "2026-10-19" })).toEqual([]);
  });

  it("readGames : casual, deckKey, venueKey, tournamentKey, from et to, du plus récent au plus ancien", async () => {
    const { runtime } = await seeded();
    const ids = async (query: Parameters<typeof readGames>[1]) => (await readGames(runtime.db, query)).map((x) => x.id);
    expect(await ids({})).toEqual([4, 3, 2, 1]);
    expect(await ids({ casual: true })).toEqual([4, 2]);
    expect(await ids({ casual: false })).toEqual([3, 1]);
    expect(await ids({ tournamentKey: "id:1" })).toEqual([1]);
    expect(await ids({ deckKey: "id:7" })).toEqual([1]);
    expect(await ids({ venueKey: "id:1" })).toEqual([3, 1]);
    expect(await ids({ from: "2026-10-12T18:00:00Z", to: "2026-10-14T18:00:00Z" })).toEqual([3, 2]);
    expect(await ids({ from: "2026-10-15T00:00:00Z" })).toEqual([4]);
    expect(await ids({ to: "2026-10-11T00:00:00Z" })).toEqual([1]);
    expect(await ids({ casual: true, venueKey: "id:2" })).toEqual([2]);
  });

  type Kind = "player" | "venue" | "tournament" | "game";

  function Probe({ kind, k }: { kind: Kind; k: ResourceKey }) {
    const player = useLocalPlayer(kind === "player" ? k : "id:0");
    const venue = useLocalVenue(kind === "venue" ? k : "id:0");
    const tournament = useLocalTournament(kind === "tournament" ? k : "id:0");
    const game = useLocalGame(kind === "game" ? k : "id:0");
    const value = { player, venue, tournament, game }[kind];
    const label = value === undefined ? "undefined" : value === null ? "null" : value.key;
    return <p data-testid="probe">{label}</p>;
  }

  it.each(["player", "venue", "tournament", "game"] as const)(
    "useLocal(%s) : undefined tant que non lu, puis la ressource, ou null si introuvable",
    async (kind) => {
      const { runtime } = await seeded();
      const view = render(
        <VtesOfflineProvider runtime={runtime}>
          <Probe kind={kind} k="id:2" />
        </VtesOfflineProvider>,
      );
      expect(screen.getByTestId("probe")).toHaveTextContent("undefined");
      await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("id:2"));

      view.rerender(
        <VtesOfflineProvider runtime={runtime}>
          <Probe kind={kind} k="id:999" />
        </VtesOfflineProvider>,
      );
      // La clé a changé : jamais la ressource de l'ancienne clé, d'abord rien, puis null.
      expect(screen.getByTestId("probe")).not.toHaveTextContent("id:2");
      await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("null"));
    },
  );

  it("retrouve une ressource créée hors ligne par son identifiant une fois lié (alias)", async () => {
    const { runtime, state } = await boot({ online: false });
    const created = await runtime.actions.createVenue({ name: "Nouveau lieu" });
    state.online = true;
    await runtime.engine.flush();
    const bound = await runtime.db.refs.get(created.clientRef);
    expect(bound?.id).toBeGreaterThan(0);
    render(
      <VtesOfflineProvider runtime={runtime}>
        <Probe kind="venue" k={`id:${bound?.id}`} />
      </VtesOfflineProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent(created.key));
  });
});
