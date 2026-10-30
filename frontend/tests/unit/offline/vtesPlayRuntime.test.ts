import { afterEach, describe, expect, it } from "vitest";
import { GameTableUnknownError, createVtesOffline, type VtesOfflineRuntime } from "../../../src/offline/vtes/runtime";
import { findByKey } from "../../../src/offline/vtes/overlay";
import {
  readGame,
  readGames,
  readPlayers,
  readTournament,
  readTournaments,
  readVenues,
} from "../../../src/offline/vtes/reads";
import {
  refreshGames,
  refreshPlayers,
  RefreshAuthError,
} from "../../../src/offline/vtes/refresh";
import { createFakeServer, type FakeServer } from "./fakeServer";
import { freshDbName, manualTimers, restoreNavigatorOnLine } from "./helpers";

const runtimes: VtesOfflineRuntime[] = [];

async function boot(options: { online?: boolean; server?: FakeServer } = {}) {
  const server = options.server ?? createFakeServer();
  const state = { online: options.online ?? true };
  const clock = manualTimers();
  const runtime = createVtesOffline({
    client: server.client,
    dbName: freshDbName("play"),
    autoRefresh: false,
    engine: { isOnline: () => state.online, lockName: null, timers: clock.timers, backoff: { jitter: 0 } },
  });
  runtimes.push(runtime);
  return { server, runtime, state };
}

afterEach(async () => {
  for (const runtime of runtimes.splice(0)) {
    runtime.stop();
    await runtime.engine.whenIdle();
    runtime.dispose();
  }
  restoreNavigatorOnLine();
});

const detailCalls = (server: FakeServer, prefix: string) =>
  server.state.requests.filter((r) => r.method === "GET" && new RegExp(`^${prefix}/\\d+$`).test(r.path));

describe("la saisie d'un tournoi au club, hors ligne puis rejouée", () => {
  it("passe par la file sans réseau, se lit tout de suite, puis se raccorde à ses identifiants", async () => {
    const { server, runtime, state } = await boot({ online: false });
    const a = runtime.actions;

    const deck = await a.createDeck({ name: "Banu" });
    const venue = await a.createVenue({ name: "Club", city: "Lyon" });
    const tournament = await a.createTournament({
      name: "Régionaux",
      startDate: "2026-10-24",
      venue: venue.key,
      deckPolicy: "multi",
      finalDeckRule: "free_choice",
      roundCount: 3,
    });
    const marc = await a.ensurePlayer("Marc");
    const julie = await a.ensurePlayer("Julie");
    if (!marc.created || !julie.created) throw new Error("joueurs créés attendus");
    const round = (n: number) =>
      a.createGame({
        playedAt: `2026-10-24T${19 + n}:00:00+02:00`,
        venue: venue.key,
        tournament: tournament.key,
        roundNumber: n,
        roundType: "preliminary",
        playerCount: 4,
        participations: [
          { player: "me", deck: deck.key, seat: n, victoryPoints: n === 1 ? 3 : 1, gameWin: n === 1 ? true : null },
          { player: marc.key, seat: 1 },
          { player: julie.key, seat: 3 },
        ],
      });
    const r1 = await round(1);
    const r2 = await round(2);
    const finale = await a.createGame({
      playedAt: "2026-10-24T22:00:00+02:00",
      tournament: tournament.key,
      roundType: "final",
      playerCount: 5,
      participations: [{ player: "me", deck: deck.key, victoryPoints: 2.5, gameWin: true }],
    });
    await a.updateTournament(tournament.key, { playerCount: 27 });

    expect(server.state.requests).toEqual([]); // §10 : jamais d'appel dans le chemin de saisie

    // Lecture locale, avant tout réseau.
    expect((await readVenues(runtime.db)).map((v) => v.key)).toEqual([venue.key]);
    const [t] = await readTournaments(runtime.db);
    expect(t).toMatchObject({ key: tournament.key, venueKey: venue.key, playerCount: 27, pending: true });
    expect(t.summary).toMatchObject({ preliminaryGameWins: 1, preliminaryVictoryPoints: 4, roundsPlayed: 2, finalVictoryPoints: 2.5 });
    expect(t.summaryProvisional).toBe(true);
    expect((await readGames(runtime.db, { tournamentKey: tournament.key })).map((g) => g.roundNumber)).toEqual([null, 2, 1]);
    expect((await readGame(runtime.db, r1.key))?.table).toHaveLength(3);
    // Le « Moi » vient du serveur : il n'est dans le miroir qu'après un premier rafraîchissement.
    expect((await readPlayers(runtime.db)).map((p) => p.name)).toEqual(["Julie", "Marc"]);
    expect((await readGame(runtime.db, r1.key))?.table?.[0]).toMatchObject({ isMe: true, deckKey: deck.key });

    // Retour du réseau : un seul lot, dans l'ordre de saisie, tout appliqué.
    state.online = true;
    const summary = await runtime.engine.flush();
    expect(summary).toMatchObject({ result: "drained", sent: 9, applied: 9, rejected: 0 });
    const sent = (server.state.requests.find((r) => r.path === "/sync")!.body as { operations: Array<{ type: string }> }).operations;
    expect(sent.map((op) => op.type)).toEqual([
      "deck.create",
      "venue.create",
      "tournament.create",
      "player.create",
      "player.create",
      "game.create",
      "game.create",
      "game.create",
      "tournament.update",
    ]);

    // Chaque référence est liée à l'identifiant de SON genre, qui se recouvrent tous (1) côté serveur.
    const bound = async (ref: string) => runtime.db.refs.get(ref);
    expect(await bound(deck.clientRef)).toMatchObject({ id: 1 });
    expect((await bound(deck.clientRef))?.kind).toBeUndefined(); // deck = absent
    expect(await bound(venue.clientRef)).toMatchObject({ id: 1, kind: "venue" });
    expect(await bound(tournament.clientRef)).toMatchObject({ id: 1, kind: "tournament" });
    expect(await bound(r1.clientRef)).toMatchObject({ id: 1, kind: "game" });
    expect(await bound(finale.clientRef)).toMatchObject({ id: 3, kind: "game" });
    expect(await bound(marc.clientRef)).toMatchObject({ kind: "player" });

    // Tant que le miroir n'est pas relu, tout reste lisible (opérations tranchées).
    expect(await readGames(runtime.db)).toHaveLength(3);

    // Rafraîchissement : les clés ne bougent pas, les identifiants arrivent, le bilan est celui du serveur.
    const report = await runtime.refresh();
    expect(report).toMatchObject({ complete: true, errors: [], authRequired: false });
    expect(report.refreshed).toEqual(
      expect.arrayContaining(["players", "venues", "tournaments", "games"]),
    );
    expect(await runtime.db.settled.count()).toBe(0);

    const [after] = await readTournaments(runtime.db);
    expect(after).toMatchObject({ key: tournament.key, id: 1, pending: false, summaryProvisional: false, playerCount: 27 });
    expect(after.summary).toMatchObject({ preliminaryGameWins: 1, preliminaryVictoryPoints: 4, roundsPlayed: 2, finalVictoryPoints: 2.5 });
    const game1 = await readGame(runtime.db, r1.key);
    expect(game1).toMatchObject({ id: 1, clientRef: r1.clientRef, tournamentKey: tournament.key, pending: false });
    expect(game1?.table?.map((line) => line.playerKey)).toEqual(["id:1", marc.key, julie.key]); // clés inchangées
    expect(game1?.table?.[0]).toMatchObject({ isMe: true, deckKey: deck.key, victoryPoints: 3, gameWin: true });
    // Retrouvable aussi par l'identifiant.
    expect((await readGame(runtime.db, "id:1"))?.key).toBe(r1.key);
    expect((await readGame(runtime.db, r2.key))?.id).toBe(2);
  });

  it("le tournoi se passe de mono à multi puis de multi à mono avec final_deck_rule: null", async () => {
    const { server, runtime, state } = await boot({ online: false });
    const t = await runtime.actions.createTournament({
      name: "T",
      startDate: "2026-10-24",
      deckPolicy: "multi",
      finalDeckRule: "best_performing",
    });
    const entry = await runtime.actions.updateTournament(t.key, { deckPolicy: "mono" });
    expect((entry.operation as { data: object }).data).toEqual({ deck_policy: "mono", final_deck_rule: null });

    state.online = true;
    // Sans le null, le serveur factice (comme le vrai) aurait refusé le passage en mono.
    expect(await runtime.engine.flush()).toMatchObject({ applied: 2, rejected: 0 });
    expect(server.state.tournaments[0]).toMatchObject({ deck_policy: "mono", final_deck_rule: null });
  });
});

describe("upsert par nom", () => {
  it("deux références au même nom désignent un seul joueur, et la partie qui cite la seconde s'applique", async () => {
    const { server, runtime, state } = await boot({ online: false });
    const first = await runtime.actions.createPlayer({ name: "Marc" });
    const second = await runtime.actions.createPlayer({ name: "marc" }); // même nom, autre référence
    await runtime.actions.createGame({
      playerCount: 4,
      participations: [{ player: "me" }, { player: second.key }],
    });
    // Avant le verdict, la surcouche ne montre déjà qu'un Marc.
    expect((await readPlayers(runtime.db)).filter((p) => !p.isMe)).toHaveLength(1);

    state.online = true;
    expect(await runtime.engine.flush()).toMatchObject({ applied: 3, rejected: 0 });
    expect(server.state.players.filter((p) => !p.is_me)).toHaveLength(1); // le serveur n'a créé qu'un joueur
    const [a, b] = await Promise.all([runtime.db.refs.get(first.clientRef), runtime.db.refs.get(second.clientRef)]);
    expect(a?.id).toBe(b?.id); // deux références, un identifiant

    await runtime.refresh();
    const players = (await readPlayers(runtime.db)).filter((p) => !p.isMe);
    expect(players).toHaveLength(1);
    // Clé canonique : l'une des deux références ; l'autre et l'identifiant restent des alias.
    expect([first.key, second.key]).toContain(players[0].key);
    expect(players[0].aliases).toEqual(
      expect.arrayContaining([players[0].key === first.key ? second.key : first.key, `id:${a!.id}`]),
    );
    expect(findByKey(players, first.key)).toBe(players[0]);
    expect(findByKey(players, second.key)).toBe(players[0]);
    const [game] = await readGames(runtime.db);
    expect(game.table![1].playerKey).toBe(players[0].key);
  });

  it("ensurePlayer ne met rien en file pour un joueur connu, mais ne confond pas le « Moi »", async () => {
    const { runtime } = await boot({ online: false });
    await runtime.db.players.bulkPut([
      { id: 1, name: "Moi", foldedName: "moi", isMe: true, gameCount: 0 },
      { id: 5, name: "Éloïse", foldedName: "eloise", isMe: false, gameCount: 2 },
    ]);
    const known = await runtime.actions.ensurePlayer("  eloise ");
    expect(known).toMatchObject({ created: false, key: "id:5", entry: null });
    expect(await runtime.outbox.counts()).toMatchObject({ pending: 0 });

    const asMe = await runtime.actions.ensurePlayer("Moi"); // le serveur arbitrera : jamais la ligne du « Moi »
    expect(asMe.created).toBe(true);

    const venue = await runtime.actions.ensureVenue("Club");
    const again = await runtime.actions.ensureVenue("CLUB");
    expect(venue.created).toBe(true);
    expect(again).toMatchObject({ created: false, key: venue.created ? venue.key : "" });
  });
});

describe("édition de la table d'une partie", () => {
  it("refuse une table inconnue sans rien mettre en file, accepte les champs, et une table connue", async () => {
    const { runtime } = await boot({ online: false });
    await runtime.db.games.bulkPut([
      {
        id: 7,
        playedAt: "2026-10-24T18:00:00Z",
        venueId: null,
        tournamentId: null,
        tournamentName: null,
        roundNumber: null,
        roundType: "casual",
        playerCount: 4,
        me: { deckId: null, seat: null, victoryPoints: null, gameWin: null },
        notes: null,
        updatedAt: "2026-10-24T18:00:00Z",
        table: null,
      },
      {
        id: 8,
        playedAt: "2026-10-23T18:00:00Z",
        venueId: null,
        tournamentId: null,
        tournamentName: null,
        roundNumber: null,
        roundType: "casual",
        playerCount: 4,
        me: { deckId: null, seat: null, victoryPoints: null, gameWin: null },
        notes: null,
        updatedAt: "2026-10-23T18:00:00Z",
        table: [{ playerId: 1, isMe: true, deckId: null, seat: null, victoryPoints: null, gameWin: null, notes: null }],
      },
    ]);
    const table = [{ player: "me" as const, victoryPoints: 2 }];

    await expect(runtime.actions.updateGame("id:7", { table })).rejects.toBeInstanceOf(GameTableUnknownError);
    await expect(runtime.actions.updateGame("id:99", { table })).rejects.toBeInstanceOf(GameTableUnknownError);
    expect(await runtime.outbox.counts()).toMatchObject({ pending: 0 });

    await runtime.actions.updateGame("id:7", { fields: { notes: "x" } }); // champs : toujours permis
    await runtime.actions.updateGame("id:8", { table });
    expect((await runtime.outbox.list()).map((e) => e.type)).toEqual(["game.update", "game.update"]);
  });
});

describe("rafraîchissement des miroirs de la pratique de jeu", () => {
  async function seeded() {
    const booted = await boot();
    const { server } = booted;
    server.state.venues.push({ id: 1, name: "Club", city: null, notes: null });
    server.state.players.push({ id: 2, name: "Marc", is_me: false });
    server.state.tournaments.push({
      id: 1,
      name: "Locaux",
      start_date: "2026-10-24",
      end_date: null,
      venue_id: 1,
      deck_policy: "multi",
      format: "constructed",
      event_tier: "standard",
      final_deck_rule: "free_choice",
      round_count: 3,
      player_count: null,
      my_ranking: null,
      notes: null,
      updated_at: "2026-10-24T10:00:00Z",
    });
    server.state.admissible.set(1, [4]);
    for (const id of [1, 2, 3]) {
      server.state.games.push({
        id,
        played_at: `2026-10-2${id}T18:00:00Z`,
        venue_id: 1,
        tournament_id: id === 3 ? null : 1,
        round_number: id === 3 ? null : id,
        round_type: id === 3 ? "casual" : "preliminary",
        player_count: 4,
        notes: null,
        updated_at: `2026-10-2${id}T18:00:00Z`,
        participations: [
          { player_id: 1, is_me: true, deck_id: null, seat: 1, victory_points: 2, game_win: id === 1, notes: null },
          { player_id: 2, is_me: false, deck_id: null, seat: 2, victory_points: null, game_win: null, notes: null },
        ],
      });
    }
    return booted;
  }

  it("lit les quatre miroirs, le bilan et les decks admis sur le détail du tournoi", async () => {
    const { server, runtime } = await seeded();
    const report = await runtime.refresh();
    expect(report).toMatchObject({ complete: true, errors: [] });
    expect(await runtime.db.players.count()).toBe(2);
    expect(await runtime.db.venues.count()).toBe(1);
    const t = await runtime.db.tournaments.get(1);
    expect(t).toMatchObject({
      name: "Locaux",
      deckPolicy: "multi",
      finalDeckRule: "free_choice",
      admissibleFinalDecks: [4],
      summary: { preliminaryGameWins: 1, preliminaryVictoryPoints: 4, roundsPlayed: 2 },
    });
    const games = await runtime.db.games.toArray();
    expect(games.every((g) => g.table !== null && g.table.length === 2)).toBe(true);
    expect(detailCalls(server, "/tournois")).toHaveLength(1);
    expect(detailCalls(server, "/parties")).toHaveLength(3);
    expect((await readTournament(runtime.db, "id:1"))?.venueKey).toBe("id:1");
  });

  it("n'relit que les tables des parties dont updated_at a changé", async () => {
    const { server, runtime } = await seeded();
    await runtime.refresh();
    server.state.requests.length = 0;

    await runtime.refresh();
    expect(detailCalls(server, "/parties")).toEqual([]); // rien n'a changé : aucune table relue
    expect(server.state.requests.some((r) => r.path === "/parties")).toBe(true);

    // Une table modifiée sur un autre appareil : seul updated_at de CETTE partie change.
    server.state.games[1].participations.push({
      player_id: 3,
      is_me: false,
      deck_id: null,
      seat: 3,
      victory_points: null,
      game_win: null,
      notes: null,
    });
    server.state.games[1].updated_at = "2026-10-25T09:00:00Z";
    server.state.requests.length = 0;
    await runtime.refresh();
    expect(detailCalls(server, "/parties").map((r) => r.path)).toEqual(["/parties/2"]);
    expect((await runtime.db.games.get(2))?.table).toHaveLength(3);
    expect((await runtime.db.games.get(1))?.table).toHaveLength(2);
  });

  it("une partie supprimée entre la liste et le détail est omise, sans faire échouer le rafraîchissement", async () => {
    const { server, runtime } = await seeded();
    const original = server.client.GET.bind(server.client);
    (server.client as { GET: unknown }).GET = async (path: string, init: never) => {
      const result = await (original as (p: string, i: never) => Promise<unknown>)(path, init);
      if (path === "/parties") server.state.games.pop(); // la partie 3 disparaît juste après la liste
      return result;
    };
    await expect(refreshGames(server.client, runtime.db)).resolves.toBe(2);
    expect((await runtime.db.games.toArray()).map((g) => g.id)).toEqual([1, 2]);
  });

  it("un 401 laisse les miroirs tels quels et se signale à part", async () => {
    const { server, runtime } = await seeded();
    await runtime.refresh();
    const before = await runtime.db.games.toArray();
    server.state.players.push({ id: 9, name: "Nouveau", is_me: false });
    server.next.getStatus = 401;

    const report = await runtime.refresh();
    expect(report).toMatchObject({ complete: false, authRequired: true });
    expect(report.errors).toEqual([]);
    expect(await runtime.db.players.count()).toBe(2); // le nouveau joueur n'est pas entré
    expect(await runtime.db.games.toArray()).toEqual(before);

    await expect(refreshPlayers(server.client, runtime.db)).rejects.toBeInstanceOf(RefreshAuthError);
  });

  it("n'efface de settled que la famille qu'il reflète", async () => {
    const { server, runtime } = await boot();
    const venue = await runtime.actions.createVenue({ name: "Club" });
    const tournament = await runtime.actions.createTournament({ name: "T", startDate: "2026-10-24" });
    await runtime.actions.createGame({
      tournament: tournament.key,
      venue: venue.key,
      roundType: "preliminary",
      roundNumber: 1,
      playerCount: 4,
      participations: [{ player: "me", victoryPoints: 2 }],
    });
    await runtime.engine.flush();
    expect((await runtime.db.settled.toArray()).map((e) => e.type)).toEqual([
      "venue.create",
      "tournament.create",
      "game.create",
    ]);

    await refreshPlayers(server.client, runtime.db);
    expect(await runtime.db.settled.count()).toBe(3); // joueurs : aucune de ces opérations
    await refreshGames(server.client, runtime.db);
    expect((await runtime.db.settled.toArray()).map((e) => e.type)).toEqual(["venue.create", "tournament.create"]);
    await runtime.refresh();
    expect(await runtime.db.settled.count()).toBe(0);
  });

  it("un refus laisse la partie hors de la surcouche, motif unresolved_client_ref", async () => {
    const { runtime } = await boot();
    const orphan = await runtime.actions.createGame({
      tournament: "ref:jamais-cree",
      roundType: "preliminary",
      roundNumber: 1,
      playerCount: 4,
      participations: [{ player: "me" }],
    });
    await runtime.engine.flush();
    const [refused] = await runtime.outbox.list("rejected");
    expect(refused.operationId).toBe(orphan.entry.operationId);
    expect(refused.rejection?.code).toBe("unresolved_client_ref");
    expect(await readGames(runtime.db)).toEqual([]);
  });
});
