import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { GameRow, PlayerRow, TournamentRow, VenueRow } from "../../../src/offline/vtes/db";
import * as ops from "../../../src/offline/vtes/operations";
import { findByKey, project, type Snapshot } from "../../../src/offline/vtes/overlay";
import type { VtesOperation } from "../../../src/offline/vtes/types";

let counter = 0;
const clock: ops.OperationClock = {
  newId: () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`,
  now: () => "2026-10-24T20:00:00.000+02:00",
};

const ME: PlayerRow = { id: 1, name: "Moi", foldedName: "moi", isMe: true, gameCount: 0 };

const player = (id: number, name: string): PlayerRow => ({
  id,
  name,
  foldedName: name.toLowerCase(),
  isMe: false,
  gameCount: 0,
});

const venue = (id: number, name: string): VenueRow => ({
  id,
  name,
  foldedName: name.toLowerCase(),
  city: null,
  notes: null,
  gameCount: 0,
  tournamentCount: 0,
});

const tournament = (id: number, overrides: Partial<TournamentRow> = {}): TournamentRow => ({
  id,
  name: "Nationaux",
  startDate: "2026-10-24",
  endDate: null,
  venueId: null,
  deckPolicy: "multi",
  format: "constructed",
  eventTier: "standard",
  finalDeckRule: "free_choice",
  roundCount: 3,
  playerCount: null,
  myRanking: null,
  summary: {
    preliminaryGameWins: 1,
    preliminaryVictoryPoints: 2,
    roundsPlayed: 1,
    finalVictoryPoints: null,
    finalGameWin: null,
  },
  admissibleFinalDecks: [4],
  notes: null,
  updatedAt: "2026-10-24T10:00:00Z",
  ...overrides,
});

const game = (id: number, overrides: Partial<GameRow> = {}): GameRow => ({
  id,
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
  ...overrides,
});

function snapshot(partial: Partial<Snapshot> = {}): Snapshot {
  return { stock: [], decks: [], deckCards: [], cards: [], refs: [], players: [ME], ...partial };
}

const sorted = <T extends { key: string }>(items: T[]) => [...items].sort((a, b) => a.key.localeCompare(b.key));

describe("ressources créées hors ligne", () => {
  it("apparaissent sous ref:<uuid>, en attente, liées entre elles par leurs références", () => {
    const queue: VtesOperation[] = [
      ops.venueCreate(clock, "v1", { name: "Club", city: "Lyon" }),
      ops.tournamentCreate(clock, "t1", { name: "Locaux", startDate: "2026-10-24", venue: "ref:v1" }),
      ops.playerCreate(clock, "p1", { name: "Marc" }),
      ops.gameCreate(clock, "g1", {
        playedAt: "2026-10-24T20:00:00+02:00",
        venue: "ref:v1",
        tournament: "ref:t1",
        roundNumber: 1,
        roundType: "preliminary",
        playerCount: 4,
        participations: [
          { player: "me", seat: 2, victoryPoints: 2.5, gameWin: true },
          { player: "ref:p1", seat: 1 },
        ],
      }),
    ];
    const result = project(snapshot(), queue);

    expect(result.venues).toMatchObject([{ key: "ref:v1", id: null, clientRef: "v1", name: "Club", city: "Lyon", pending: true }]);
    expect(result.players.map((p) => p.key).sort()).toEqual(["id:1", "ref:p1"]);
    expect(result.tournaments).toMatchObject([
      { key: "ref:t1", venueKey: "ref:v1", deckPolicy: "mono", pending: true },
    ]);
    const [created] = result.games;
    expect(created).toMatchObject({
      key: "ref:g1",
      venueKey: "ref:v1",
      tournamentKey: "ref:t1",
      tournamentName: "Locaux",
      roundNumber: 1,
      roundType: "preliminary",
      me: { seat: 2, victoryPoints: 2.5, gameWin: true },
      pending: true,
    });
    // La table complète est connue d'emblée, ma ligne reconnue.
    expect(created.table).toMatchObject([
      { playerKey: "id:1", isMe: true, seat: 2 },
      { playerKey: "ref:p1", isMe: false, seat: 1 },
    ]);
  });

  it("le bilan d'un tournoi saisi hors ligne est recalculé et marqué provisoire", () => {
    const queue: VtesOperation[] = [
      ops.tournamentCreate(clock, "t1", { name: "Locaux", startDate: "2026-10-24" }),
      ops.gameCreate(clock, "g1", {
        tournament: "ref:t1",
        roundType: "preliminary",
        roundNumber: 1,
        playerCount: 4,
        participations: [{ player: "me", victoryPoints: 3, gameWin: true }],
      }),
      ops.gameCreate(clock, "g2", {
        tournament: "ref:t1",
        roundType: "preliminary",
        roundNumber: 2,
        playerCount: 4,
        participations: [{ player: "me", victoryPoints: 1 }],
      }),
      ops.gameCreate(clock, "g3", {
        tournament: "ref:t1",
        roundType: "final",
        playerCount: 5,
        participations: [{ player: "me", victoryPoints: 2.5, gameWin: true }],
      }),
    ];
    const [t] = project(snapshot(), queue).tournaments;
    expect(t.summary).toEqual({
      preliminaryGameWins: 1,
      preliminaryVictoryPoints: 4,
      roundsPlayed: 2,
      finalVictoryPoints: 2.5,
      finalGameWin: true,
    });
    expect(t.summaryProvisional).toBe(true);
  });

  it("le bilan du serveur est gardé tel quel tant qu'aucune partie du tournoi n'a bougé", () => {
    const result = project(snapshot({ tournaments: [tournament(2)] }), [
      ops.playerCreate(clock, "p1", { name: "Marc" }),
    ]);
    expect(result.tournaments[0]).toMatchObject({ key: "id:2", summaryProvisional: false });
    expect(result.tournaments[0].summary.preliminaryGameWins).toBe(1);
    expect(result.tournaments[0].admissibleFinalDecks).toEqual(["id:4"]);
  });

  it("une partie en file dans un tournoi du miroir recalcule son bilan, provisoire", () => {
    const snap = snapshot({
      tournaments: [tournament(2)],
      games: [
        game(7, {
          tournamentId: 2,
          roundType: "preliminary",
          roundNumber: 1,
          me: { deckId: null, seat: null, victoryPoints: 2, gameWin: true },
        }),
      ],
    });
    const queue = [
      ops.gameCreate(clock, "g2", {
        tournament: { id: 2 },
        roundType: "preliminary",
        roundNumber: 2,
        playerCount: 4,
        participations: [{ player: "me", victoryPoints: 1 }],
      }),
    ];
    const [t] = project(snap, queue).tournaments;
    expect(t.summary).toMatchObject({ preliminaryGameWins: 1, preliminaryVictoryPoints: 3, roundsPlayed: 2 });
    expect(t.summaryProvisional).toBe(true);
  });

  it("une partie tranchée mais pas encore reprise recalcule le bilan sans le dire provisoire", () => {
    const snap = snapshot({
      tournaments: [tournament(2, { summary: { preliminaryGameWins: 0, preliminaryVictoryPoints: 0, roundsPlayed: 0, finalVictoryPoints: null, finalGameWin: null } })],
      refs: [{ ref: "g1", id: 9, boundAt: "t", kind: "game" }],
    });
    const settled = [
      ops.gameCreate(clock, "g1", {
        tournament: { id: 2 },
        roundType: "preliminary",
        roundNumber: 1,
        playerCount: 4,
        participations: [{ player: "me", victoryPoints: 2.5, gameWin: true }],
      }),
    ];
    const result = project(snap, [], settled);
    expect(result.tournaments[0].summary).toMatchObject({ preliminaryGameWins: 1, roundsPlayed: 1 });
    expect(result.tournaments[0].summaryProvisional).toBe(false);
    // L'identifiant serveur est connu par la correspondance.
    expect(result.games[0]).toMatchObject({ key: "ref:g1", id: 9, pending: false });
  });

  it("une partie qui change de tournoi recalcule les deux bilans", () => {
    const snap = snapshot({
      tournaments: [tournament(2), tournament(3, { name: "Autre" })],
      games: [
        game(7, {
          tournamentId: 2,
          roundType: "preliminary",
          roundNumber: 1,
          me: { deckId: null, seat: null, victoryPoints: 2, gameWin: true },
        }),
      ],
    });
    const result = project(snap, [
      ops.gameUpdate(clock, "id:7", { fields: { tournament: "id:3" } }),
    ]);
    const byId = new Map(result.tournaments.map((t) => [t.id, t]));
    expect(byId.get(2)!.summary.roundsPlayed).toBe(0);
    expect(byId.get(3)!.summary.roundsPlayed).toBe(1);
    expect(byId.get(2)!.summaryProvisional && byId.get(3)!.summaryProvisional).toBe(true);
    expect(result.games[0]).toMatchObject({ tournamentKey: "id:3", tournamentName: "Autre" });
  });
});

describe("upsert par nom : deux références, un seul joueur", () => {
  it("une création au nom d'un joueur du miroir ne fait pas de doublon", () => {
    const snap = snapshot({ players: [ME, player(5, "Éloïse")] });
    const queue = [
      ops.playerCreate(clock, "p1", { name: "eloise" }),
      ops.gameCreate(clock, "g1", {
        playerCount: 4,
        participations: [{ player: "me" }, { player: "ref:p1" }],
      }),
    ];
    const result = project(snap, queue);
    expect(result.players.map((p) => p.key).sort()).toEqual(["id:1", "id:5"]);
    // La partie désigne bien le joueur existant par la référence liée.
    expect(result.games[0].table!.map((line) => line.playerKey)).toEqual(["id:1", "id:5"]);
    // Et la référence se retrouve par findByKey.
    expect(findByKey(result.players, "ref:p1")?.id).toBe(5);
  });

  it("deux créations au même nom dans la file ne donnent qu'un joueur", () => {
    const queue = [
      ops.playerCreate(clock, "pa", { name: "Marc" }),
      ops.playerCreate(clock, "pb", { name: "MARC " }),
      ops.gameCreate(clock, "g1", {
        playerCount: 4,
        participations: [{ player: "me" }, { player: "ref:pb" }],
      }),
    ];
    const result = project(snapshot(), queue);
    const marcs = result.players.filter((p) => !p.isMe);
    expect(marcs).toHaveLength(1);
    expect(marcs[0].key).toBe("ref:pa");
    expect(marcs[0].aliases).toContain("ref:pb");
    expect(result.games[0].table![1].playerKey).toBe("ref:pa");
  });

  it("deux références liées au même identifiant désignent la même ressource, clé canonique stable", () => {
    const snap = snapshot({
      players: [ME, player(5, "Marc")],
      refs: [
        { ref: "pb", id: 5, boundAt: "2026-10-24T10:00:02Z", kind: "player" },
        { ref: "pa", id: 5, boundAt: "2026-10-24T10:00:01Z", kind: "player" },
      ],
    });
    const { players } = project(snap, []);
    const marc = players.find((p) => p.id === 5)!;
    expect(marc.key).toBe("ref:pa"); // la plus ancienne liée
    expect(marc.aliases.sort()).toEqual(["id:5", "ref:pb"]);
    for (const key of ["id:5", "ref:pa", "ref:pb"] as const) {
      expect(findByKey(players, key)).toBe(marc);
    }
  });

  it("une création au nom du « Moi » est un refus du serveur : rien n'est projeté", () => {
    const result = project(snapshot(), [ops.playerCreate(clock, "p1", { name: "moi" })]);
    expect(result.players.map((p) => p.key)).toEqual(["id:1"]);
  });

  it("un lieu connu garde sa ville : la création au même nom n'ajoute rien", () => {
    const snap = snapshot({ venues: [{ ...venue(3, "Club"), city: "Lyon" }] });
    const result = project(snap, [ops.venueCreate(clock, "v1", { name: "club", city: "Paris" })]);
    expect(result.venues).toHaveLength(1);
    expect(result.venues[0]).toMatchObject({ key: "id:3", city: "Lyon" });
    expect(findByKey(result.venues, "ref:v1")).toBe(result.venues[0]);
  });
});

describe("genres : un identifiant n'est pas une clé de n'importe quel genre", () => {
  it("un joueur 12 et un deck 12 coexistent, chacun avec sa correspondance", () => {
    const snap = snapshot({
      players: [ME, player(12, "Marc")],
      decks: [
        {
          id: 12,
          name: "Banu",
          foldedName: "banu",
          discriminator: "0001",
          createdOn: null,
          status: "draft",
          archetype: null,
          notes: null,
          proxyAllowed: false,
          archivedAt: null,
        },
      ],
      refs: [{ ref: "d1", id: 12, boundAt: "t" }], // genre absent = deck
    });
    const result = project(snap, []);
    expect(result.decks[0].key).toBe("ref:d1");
    expect(result.players.find((p) => p.id === 12)!.key).toBe("id:12");
  });

  it("une table désigne les decks par leurs clés de deck", () => {
    const result = project(snapshot(), [
      ops.deckCreate(clock, "d1", { name: "Banu" }),
      ops.gameCreate(clock, "g1", {
        playerCount: 4,
        participations: [{ player: "me", deck: "ref:d1" }],
      }),
    ]);
    expect(result.games[0].me.deckKey).toBe("ref:d1");
    expect(result.games[0].table![0].deckKey).toBe("ref:d1");
  });
});

describe("parties du miroir", () => {
  const rows = (table: GameRow["table"]) =>
    snapshot({
      players: [ME, player(5, "Marc")],
      games: [game(7, { table, me: { deckId: null, seat: 2, victoryPoints: 2, gameWin: false } })],
    });

  it("lisent la table connue et la laissent inconnue (null) sinon", () => {
    const known = project(
      rows([
        { playerId: 1, isMe: true, deckId: null, seat: 2, victoryPoints: 2, gameWin: false, notes: null },
        { playerId: 5, isMe: false, deckId: null, seat: 1, victoryPoints: null, gameWin: null, notes: null },
      ]),
      [],
    ).games[0];
    expect(known.table!.map((line) => line.playerKey)).toEqual(["id:1", "id:5"]);
    expect(project(rows(null), []).games[0].table).toBeNull();
  });

  it("une correction de table remplace la table et ma ligne ; sans table, la table inconnue le reste", () => {
    const withTable = project(rows(null), [
      ops.gameUpdate(clock, "id:7", {
        table: [
          { player: "me", victoryPoints: 3, gameWin: true, seat: 1 },
          { player: "id:5", seat: 2 },
        ],
      }),
    ]).games[0];
    expect(withTable.table).toHaveLength(2);
    expect(withTable.me).toMatchObject({ victoryPoints: 3, gameWin: true, seat: 1 });
    expect(withTable.pending).toBe(true);

    const fieldsOnly = project(rows(null), [
      ops.gameUpdate(clock, "id:7", { fields: { notes: "x", playerCount: 5 } }),
    ]).games[0];
    expect(fieldsOnly.table).toBeNull();
    expect(fieldsOnly).toMatchObject({ notes: "x", playerCount: 5, me: { seat: 2 } });
  });

  it("la suppression retire la partie et recalcule le tournoi", () => {
    const snap = snapshot({
      tournaments: [tournament(2)],
      games: [game(7, { tournamentId: 2, roundType: "preliminary", roundNumber: 1, me: { deckId: null, seat: null, victoryPoints: 2, gameWin: true } })],
    });
    const result = project(snap, [ops.gameDelete(clock, "id:7")]);
    expect(result.games).toEqual([]);
    expect(result.tournaments[0].summary.roundsPlayed).toBe(0);
    expect(result.tournaments[0].summaryProvisional).toBe(true);
  });

  it("une partie déjà dans le miroir sous sa référence n'est pas recréée par l'opération tranchée", () => {
    const snap = snapshot({
      games: [game(7, { playedAt: "2026-10-24T18:00:00Z" })],
      refs: [{ ref: "g1", id: 7, boundAt: "t", kind: "game" }],
    });
    const settled = [ops.gameCreate(clock, "g1", { playedAt: "2026-01-01T00:00:00+01:00", playerCount: 4, participations: [{ player: "me" }] })];
    const result = project(snap, [], settled);
    expect(result.games).toHaveLength(1);
    expect(result.games[0]).toMatchObject({ key: "ref:g1", id: 7, playedAt: "2026-10-24T18:00:00Z" });
  });
});

describe("modifications et suppressions de joueurs, lieux, tournois", () => {
  it("renomment, retirent, et passent un tournoi en mono sans règle de finale", () => {
    const snap = snapshot({
      players: [ME, player(5, "Marc")],
      venues: [venue(3, "Club")],
      tournaments: [tournament(2)],
    });
    const queue = [
      ops.playerUpdate(clock, "id:5", { name: "Marco" }),
      ops.venueUpdate(clock, "id:3", { city: "Lyon" }),
      ops.tournamentUpdate(clock, "id:2", { deckPolicy: "mono", myRanking: 3 }),
    ];
    const result = project(snap, queue);
    expect(result.players.find((p) => p.id === 5)).toMatchObject({ name: "Marco", pending: true });
    expect(result.venues[0]).toMatchObject({ city: "Lyon", pending: true });
    expect(result.tournaments[0]).toMatchObject({ deckPolicy: "mono", finalDeckRule: null, myRanking: 3, pending: true });

    const after = project(snap, [
      ...queue,
      ops.playerDelete(clock, "id:5"),
      ops.venueDelete(clock, "id:3"),
      ops.tournamentDelete(clock, "id:2"),
    ]);
    expect(after.players.map((p) => p.id)).toEqual([1]);
    expect(after.venues).toEqual([]);
    expect(after.tournaments).toEqual([]);
  });

  it("une opération sur une ressource inconnue est sans effet", () => {
    const result = project(snapshot(), [
      ops.playerUpdate(clock, "id:99", { name: "x" }),
      ops.gameDelete(clock, "ref:nope"),
    ]);
    expect(sorted(result.players).map((p) => p.key)).toEqual(["id:1"]);
  });
});

describe("GW résolu comme le serveur (resolved_game_win)", () => {
  const { cases } = JSON.parse(
    readFileSync(resolve(__dirname, "../../../../backend/tests/fixtures/certain_game_win_cases.json"), "utf-8"),
  ) as { cases: Array<{ player_count: number; vp: number | null; expected: true | null }> };

  it.each(cases)("$player_count joueurs, $vp VP, GW omis -> $expected", ({ player_count, vp, expected }) => {
    const queue: VtesOperation[] = [
      ops.gameCreate(clock, "gw", {
        playerCount: player_count,
        participations: [{ player: "me", ...(vp === null ? {} : { victoryPoints: vp }) }],
      }),
    ];
    const [created] = project(snapshot(), queue).games;
    expect(created.me.gameWin).toBe(expected);
    expect(created.table?.[0].gameWin).toBe(expected);
  });

  it("un GW déclaré, faux compris, l'emporte sur le GW certain", () => {
    const [created] = project(snapshot(), [
      ops.gameCreate(clock, "gw", {
        playerCount: 4,
        participations: [{ player: "me", victoryPoints: 3, gameWin: false }],
      }),
    ]).games;
    expect(created.me.gameWin).toBe(false);
  });

  it("trois préliminaires à 1, 2 et 3 VP à quatre joueurs, GW omis : un GW au bilan", () => {
    const queue: VtesOperation[] = [
      ops.tournamentCreate(clock, "t1", { name: "T", startDate: "2026-10-24" }),
      ...[1, 2, 3].map((vp) =>
        ops.gameCreate(clock, `r${vp}`, {
          tournament: "ref:t1",
          roundType: "preliminary",
          roundNumber: vp,
          playerCount: 4,
          participations: [{ player: "me", victoryPoints: vp }],
        }),
      ),
    ];
    expect(project(snapshot(), queue).tournaments[0].summary).toMatchObject({
      preliminaryGameWins: 1,
      preliminaryVictoryPoints: 6,
      roundsPlayed: 3,
    });
  });

  it("une correction de table sans GW résout avec le nombre de joueurs de la partie", () => {
    const snap = snapshot({ games: [game(7, { playerCount: 5 })] });
    const [updated] = project(snap, [
      ops.gameUpdate(clock, "id:7", { table: [{ player: "me", victoryPoints: 3 }] }),
    ]).games;
    expect(updated.me.gameWin).toBe(true); // 3 > 5/2
    const [fewer] = project(snap, [
      ops.gameUpdate(clock, "id:7", { fields: { playerCount: 6 }, table: [{ player: "me", victoryPoints: 3 }] }),
    ]).games;
    expect(fewer.me.gameWin).toBeNull(); // 3 n'est pas > 6/2
  });
});

describe("nom du tournoi d'une partie modifiée", () => {
  const snap = () =>
    snapshot({
      tournaments: [tournament(2, { name: "Nationaux" }), tournament(3, { name: "Régionaux" })],
      games: [game(7, { tournamentId: 2, tournamentName: "Nationaux", roundType: "preliminary", roundNumber: 1 })],
    });

  it("tournament: null efface le nom périmé", () => {
    const [updated] = project(snap(), [ops.gameUpdate(clock, "id:7", { fields: { tournament: null } })]).games;
    expect(updated).toMatchObject({ tournamentKey: null, tournamentName: null });
  });

  it("un autre tournoi donne son nom", () => {
    const [updated] = project(snap(), [ops.gameUpdate(clock, "id:7", { fields: { tournament: "id:3" } })]).games;
    expect(updated).toMatchObject({ tournamentKey: "id:3", tournamentName: "Régionaux" });
  });

  it("un tournoi introuvable localement garde le nom rendu par le serveur", () => {
    const only = snapshot({ games: [game(7, { tournamentId: 9, tournamentName: "Ailleurs" })] });
    expect(project(only, []).games[0]).toMatchObject({ tournamentKey: "id:9", tournamentName: "Ailleurs" });
  });
});

describe("garde du « Moi » à l'upsert par nom", () => {
  it("player.create au nom du Moi n'ajoute aucun alias ni doublon", () => {
    const result = project(snapshot(), [ops.playerCreate(clock, "pm", { name: "moi" })]);
    expect(result.players).toHaveLength(1);
    expect(result.players[0]).toMatchObject({ key: "id:1", isMe: true, aliases: [] });
    // Une partie qui cite cette référence ne retombe pas sur le Moi.
    const withGame = project(snapshot(), [
      ops.playerCreate(clock, "pm", { name: "moi" }),
      ops.gameCreate(clock, "g", { playerCount: 4, participations: [{ player: "me" }, { player: "ref:pm" }] }),
    ]);
    expect(withGame.games[0].table?.[1]).toMatchObject({ playerKey: "ref:pm", isMe: false });
  });

  it("un joueur ordinaire du même nom reçoit bien l'alias", () => {
    const result = project(snapshot({ players: [ME, player(5, "Marc")] }), [
      ops.playerCreate(clock, "pm", { name: "MARC" }),
    ]);
    expect(result.players.find((p) => p.key === "id:5")?.aliases).toContain("ref:pm");
  });
});
