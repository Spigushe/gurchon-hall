import { describe, expect, it } from "vitest";
import { CORE_STORES_V1, CORE_STORES_V2, OfflineCoreDb } from "../../../src/offline/core/db";
import {
  VtesOfflineDb,
  VTES_STORES_V1,
  VTES_STORES_V2,
  VTES_STORES_V3,
  VTES_STORES_V4,
  VTES_STORES_V5,
  type DeckRow,
  type GameRow,
  type PlayerRow,
  type TournamentRow,
} from "../../../src/offline/vtes/db";
import * as ops from "../../../src/offline/vtes/operations";
import { project, type Snapshot } from "../../../src/offline/vtes/overlay";
import { readCatalogState, readClans, readDeckVersion, readDeckVersions } from "../../../src/offline/vtes/reads";
import { cardDetailRowOf, cardRowOf, refreshDeckVersions } from "../../../src/offline/vtes/refresh";
import type { VtesOperation } from "../../../src/offline/vtes/types";
import { participationsOf, buildParticipations, type GameDraft } from "../../../src/features/games/gameFormModel";
import { createFakeServer, type FakeDeckVersion } from "./fakeServer";
import { crypt, library } from "./fixtures/syntheticCatalog";
import { freshDbName } from "./helpers";

/**
 * Lot 8, étape C1 : la couche hors ligne des versions jouées et du deck
 * adverse. Le serveur seul fige une liste ; ces tests vérifient que le client
 * la reprend telle quelle, qu'il n'en invente jamais, et qu'il garde la forme
 * des opérations d'avant le lot.
 */

let counter = 0;
const clock: ops.OperationClock = {
  newId: () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`,
  now: () => "2026-11-12T20:00:00.000+01:00",
};

const ME: PlayerRow = { id: 1, name: "Moi", foldedName: "moi", isMe: true, gameCount: 0 };
const MARC: PlayerRow = { id: 5, name: "Marc", foldedName: "marc", isMe: false, gameCount: 0 };

const deckRow = (id: number, name: string): DeckRow => ({
  id,
  name,
  foldedName: name.toLowerCase(),
  discriminator: "0001",
  createdOn: null,
  status: "active",
  archetype: null,
  notes: null,
  proxyAllowed: false,
  archivedAt: null,
});

const tournament = (id: number, overrides: Partial<TournamentRow> = {}): TournamentRow => ({
  id,
  name: "Nationaux",
  startDate: "2026-11-07",
  endDate: null,
  venueId: null,
  deckPolicy: "mono",
  format: "constructed",
  eventTier: "standard",
  finalDeckRule: null,
  roundCount: 3,
  playerCount: null,
  myRanking: null,
  summary: {
    preliminaryGameWins: 0,
    preliminaryVictoryPoints: 2,
    roundsPlayed: 1,
    finalVictoryPoints: null,
    finalGameWin: null,
  },
  admissibleFinalDecks: null,
  deckVersions: [],
  notes: null,
  updatedAt: "2026-11-07T10:00:00Z",
  ...overrides,
});

/** Une partie du miroir où je joue le deck 4 en version 12 (« v2 »), face à Marc. */
const game = (id: number, overrides: Partial<GameRow> = {}): GameRow => ({
  id,
  playedAt: "2026-11-07T18:00:00Z",
  venueId: null,
  tournamentId: null,
  tournamentName: null,
  roundNumber: null,
  roundType: "casual",
  playerCount: 4,
  me: { deckId: 4, deckVersionId: 12, deckVersionNumber: 2, seat: 1, victoryPoints: 2, gameWin: false },
  notes: null,
  updatedAt: "2026-11-07T18:00:00Z",
  table: [
    {
      playerId: 1,
      isMe: true,
      deckId: 4,
      deckVersionId: 12,
      deckVersionNumber: 2,
      seat: 1,
      victoryPoints: 2,
      gameWin: false,
      opponentDeckName: null,
      opponentDeckArchetype: null,
      opponentClanId: null,
      notes: null,
    },
    {
      playerId: 5,
      isMe: false,
      deckId: null,
      deckVersionId: null,
      deckVersionNumber: null,
      seat: 2,
      victoryPoints: null,
      gameWin: null,
      opponentDeckName: "Ministry stealth bleed",
      opponentDeckArchetype: "bleed",
      opponentClanId: 9,
      notes: null,
    },
  ],
  ...overrides,
});

function snapshot(partial: Partial<Snapshot> = {}): Snapshot {
  return {
    stock: [],
    decks: [deckRow(4, "Banu"), deckRow(6, "Tremere")],
    deckCards: [],
    cards: [],
    refs: [],
    players: [ME, MARC],
    ...partial,
  };
}

describe("constructeurs d'opérations (A5)", () => {
  it("une ligne d'adversaire non nommé omet `player` et porte le deck adverse", () => {
    const op = ops.gameCreate(clock, "g1", {
      playedAt: "2026-11-12T20:00:00+01:00",
      playerCount: 5,
      participations: [
        { player: "me", deck: "id:4", seat: 1 },
        { seat: 2, opponentClanId: 9, opponentDeckArchetype: "bleed", opponentDeckName: "Ministry" },
        { player: null, seat: 3 },
      ],
    });
    const [, unnamed, bare] = op.data.participations;
    expect(unnamed).toEqual({
      seat: 2,
      opponent_deck_name: "Ministry",
      opponent_deck_archetype: "bleed",
      opponent_clan_id: 9,
    });
    expect(bare).toEqual({ seat: 3 });
    expect(op.data.participations[0]).not.toHaveProperty("opponent_deck_name");
  });

  it("le regel n'écrit `refreeze_decklists` que s'il est vrai, dans `data`", () => {
    expect(ops.gameUpdate(clock, "id:7", { refreezeDecklists: true })).toMatchObject({
      data: { refreeze_decklists: true },
    });
    expect(ops.gameUpdate(clock, "id:7", { refreezeDecklists: true }).data).toEqual({ refreeze_decklists: true });
    // `false` et l'absence gardent la forme d'une opération d'avant le lot.
    expect(ops.gameUpdate(clock, "id:7", { refreezeDecklists: false })).not.toHaveProperty("data");
    expect(ops.gameUpdate(clock, "id:7", { fields: { notes: "x" }, refreezeDecklists: false }).data).toEqual({
      notes: "x",
    });
    const withTable = ops.gameUpdate(clock, "id:7", {
      table: [{ player: "me" }],
      refreezeDecklists: true,
    });
    expect(withTable).toMatchObject({ data: { refreeze_decklists: true }, table: { participations: [{ player: { me: true } }] } });
  });

  it("l'archétype d'un deck part tel quel, un des six codes", () => {
    expect(ops.deckCreate(clock, "d1", { name: "Banu", archetype: "vote" }).data).toEqual({
      name: "Banu",
      archetype: "vote",
    });
    expect(ops.deckUpdate(clock, "id:4", { archetype: null }).data).toEqual({ archetype: null });
  });
});

describe("miroir des parties : versions et deck adverse (A4, A6)", () => {
  it("lit la version figée et le deck adverse, et la ligne sans joueur", () => {
    const unnamed = {
      ...game(7).table![1],
      playerId: null,
      seat: 3,
      opponentDeckName: null,
      opponentDeckArchetype: null,
      opponentClanId: 2,
    };
    const result = project(snapshot({ games: [game(7, { table: [...game(7).table!, unnamed] })] }), []);
    const [local] = result.games;
    expect(local.me).toMatchObject({ deckKey: "id:4", deckVersionId: 12, deckVersionNumber: 2 });
    expect(local.table![1]).toMatchObject({
      playerKey: "id:5",
      opponentDeckName: "Ministry stealth bleed",
      opponentDeckArchetype: "bleed",
      opponentClanId: 9,
      deckVersionId: null,
    });
    expect(local.table![2]).toMatchObject({ playerKey: null, isMe: false, seat: 3, opponentClanId: 2 });
  });

  it("une ligne écrite avant la version 7 de la base se lit sans version ni deck adverse", () => {
    const old = game(7);
    const legacy: GameRow = {
      ...old,
      me: { deckId: 4, seat: 1, victoryPoints: 2, gameWin: false },
      table: old.table!.map(({ playerId, isMe, deckId, seat, victoryPoints, gameWin, notes }) => ({
        playerId,
        isMe,
        deckId,
        seat,
        victoryPoints,
        gameWin,
        notes,
      })),
    };
    const local = project(snapshot({ games: [legacy] }), []).games[0];
    expect(local.me).toMatchObject({ deckVersionId: null, deckVersionNumber: null });
    expect(local.table![1]).toMatchObject({ opponentDeckName: null, opponentDeckArchetype: null, opponentClanId: null });
  });

  it("la version d'un deck dans un tournoi désigne la partie qui l'a figée par sa clé", () => {
    const result = project(
      snapshot({
        tournaments: [
          tournament(3, {
            deckVersions: [{ deckId: 4, deckVersionId: 12, deckVersionNumber: 2, frozenByGameId: 7 }],
          }),
        ],
        games: [game(7, { tournamentId: 3, roundType: "preliminary", roundNumber: 1 })],
      }),
      [],
    );
    expect(result.tournaments[0].deckVersions).toEqual([
      { deckKey: "id:4", deckId: 4, deckVersionId: 12, deckVersionNumber: 2, frozenByGameKey: "id:7" },
    ]);
  });

  it("un tournoi relu avant la version 7 n'a aucune version", () => {
    const { deckVersions: _omitted, ...legacy } = tournament(3);
    void _omitted;
    expect(project(snapshot({ tournaments: [legacy] }), []).tournaments[0].deckVersions).toEqual([]);
  });
});

describe("surcouche : version d'une écriture en file (règles de B1)", () => {
  const inTournament = () =>
    snapshot({
      tournaments: [
        tournament(3, {
          deckVersions: [{ deckId: 4, deckVersionId: 12, deckVersionNumber: 2, frozenByGameId: 7 }],
        }),
      ],
      games: [
        game(7, { tournamentId: 3, roundType: "preliminary", roundNumber: 1 }),
        game(8, { tournamentId: 3, roundType: "preliminary", roundNumber: 2 }),
      ],
    });

  it("une partie créée hors ligne en amicale attend la synchronisation pour sa liste", () => {
    const queue: VtesOperation[] = [
      ops.gameCreate(clock, "g1", {
        playerCount: 4,
        participations: [{ player: "me", deck: "id:4" }, { player: "id:5" }],
      }),
    ];
    const created = project(snapshot(), queue).games.find((item) => item.key === "ref:g1")!;
    expect(created.me).toMatchObject({ deckKey: "id:4", deckVersionId: null, deckVersionNumber: null });
    expect(created.pending).toBe(true);
  });

  it("une ronde créée hors ligne prend la version du tournoi pour ce deck, pas pour un autre", () => {
    const queue: VtesOperation[] = [
      ops.gameCreate(clock, "g2", {
        tournament: "id:3",
        roundType: "preliminary",
        roundNumber: 3,
        playerCount: 4,
        participations: [{ player: "me", deck: "id:4" }, { player: "id:5", deck: "id:6" }],
      }),
    ];
    const created = project(inTournament(), queue).games.find((item) => item.key === "ref:g2")!;
    expect(created.me).toMatchObject({ deckVersionId: 12, deckVersionNumber: 2 });
    expect(created.table![1]).toMatchObject({ deckKey: "id:6", deckVersionId: null });
  });

  it("un remplacement de table garde la version du deck que la partie jouait déjà", () => {
    const queue: VtesOperation[] = [
      ops.gameUpdate(clock, "id:7", {
        table: [
          { player: "me", deck: "id:4", victoryPoints: 3 },
          { seat: 3, opponentDeckArchetype: "wall" },
        ],
      }),
    ];
    const updated = project(snapshot({ games: [game(7)] }), queue).games[0];
    expect(updated.me).toMatchObject({ victoryPoints: 3, deckVersionId: 12, deckVersionNumber: 2 });
    expect(updated.table![1]).toMatchObject({ playerKey: null, opponentDeckArchetype: "wall" });
  });

  it("un remplacement de table avec un autre deck attend la synchronisation pour lui", () => {
    const queue: VtesOperation[] = [
      ops.gameUpdate(clock, "id:7", { table: [{ player: "me", deck: "id:6" }] }),
    ];
    expect(project(snapshot({ games: [game(7)] }), queue).games[0].me).toMatchObject({
      deckKey: "id:6",
      deckVersionId: null,
    });
  });

  it("une modification qui ne touche ni la table ni le tournoi garde la version", () => {
    const queue: VtesOperation[] = [ops.gameUpdate(clock, "id:7", { fields: { notes: "VP corrigés" } })];
    expect(project(snapshot({ games: [game(7)] }), queue).games[0].me.deckVersionId).toBe(12);
  });

  it("une partie déplacée vers une amicale garde sa version ; vers un tournoi, prend la sienne", () => {
    const toCasual = project(inTournament(), [
      ops.gameUpdate(clock, "id:8", { fields: { tournament: null, roundType: "casual", roundNumber: null } }),
    ]).games.find((item) => item.key === "id:8")!;
    expect(toCasual.me.deckVersionId).toBe(12);

    const other = snapshot({
      tournaments: [
        tournament(3, {
          deckVersions: [{ deckId: 4, deckVersionId: 15, deckVersionNumber: 3, frozenByGameId: 9 }],
        }),
      ],
      games: [game(7), game(9, { tournamentId: 3, roundType: "preliminary", roundNumber: 1 })],
    });
    const moved = project(other, [
      ops.gameUpdate(clock, "id:7", { fields: { tournament: "id:3", roundType: "preliminary", roundNumber: 2 } }),
    ]).games.find((item) => item.key === "id:7")!;
    expect(moved.me).toMatchObject({ deckVersionId: 15, deckVersionNumber: 3 });
    expect(moved.table![0]).toMatchObject({ deckVersionId: 15 });
  });

  it("un regel en amicale efface la version de cette partie seulement", () => {
    const result = project(snapshot({ games: [game(7), game(8)] }), [
      ops.gameUpdate(clock, "id:7", { refreezeDecklists: true }),
    ]);
    const byKey = (key: string) => result.games.find((item) => item.key === key)!;
    expect(byKey("id:7").me.deckVersionId).toBeNull();
    expect(byKey("id:7").table![0].deckVersionId).toBeNull();
    expect(byKey("id:8").me.deckVersionId).toBe(12);
  });

  it("un regel en tournoi efface la version du deck sur toutes ses rondes et la ligne du tournoi", () => {
    const base = inTournament();
    base.tournaments = [
      tournament(3, {
        deckVersions: [
          { deckId: 4, deckVersionId: 12, deckVersionNumber: 2, frozenByGameId: 7 },
          { deckId: 6, deckVersionId: 20, deckVersionNumber: 1, frozenByGameId: 8 },
        ],
      }),
    ];
    const result = project(base, [ops.gameUpdate(clock, "id:8", { refreezeDecklists: true })]);
    for (const local of result.games) {
      expect(local.me.deckVersionId).toBeNull();
      expect(local.table![0].deckVersionId).toBeNull();
    }
    expect(result.tournaments[0].deckVersions.map((item) => item.deckKey)).toEqual(["id:6"]);
  });

  it("une ronde ajoutée après un regel en file attend aussi la synchronisation", () => {
    const result = project(inTournament(), [
      ops.gameUpdate(clock, "id:7", { refreezeDecklists: true }),
      ops.gameCreate(clock, "g3", {
        tournament: "id:3",
        roundType: "preliminary",
        roundNumber: 3,
        playerCount: 4,
        participations: [{ player: "me", deck: "id:4" }],
      }),
    ]);
    expect(result.games.find((item) => item.key === "ref:g3")!.me.deckVersionId).toBeNull();
  });
});

describe("formulaire de partie : la table relue repart telle quelle", () => {
  it("participationsOf garde la ligne sans joueur et le deck adverse, comme buildParticipations", () => {
    const unnamed = { ...game(7).table![1], playerId: null, seat: 3 };
    const local = project(snapshot({ games: [game(7, { table: [...game(7).table!, unnamed] })] }), []).games[0];
    const lines = participationsOf(local)!;
    expect(lines[1]).toEqual({
      player: "id:5",
      seat: 2,
      opponentDeckName: "Ministry stealth bleed",
      opponentDeckArchetype: "bleed",
      opponentClanId: 9,
    });
    expect(lines[2]).toMatchObject({ player: null, seat: 3, opponentClanId: 9 });

    const draft: GameDraft = {
      playedAt: "2026-11-07T19:00",
      venueKey: null,
      tournamentKey: null,
      roundType: "casual",
      roundNumber: null,
      playerCount: 4,
      deckKey: "id:4",
      seat: 1,
      vp: 2,
      gameWin: false,
      opponents: local.table!
        .filter((line) => !line.isMe)
        .map((line) => ({
          playerKey: line.playerKey,
          name: "x",
          seat: line.seat,
          deckKey: line.deckKey,
          notes: line.notes,
          opponentDeckName: line.opponentDeckName,
          opponentDeckArchetype: line.opponentDeckArchetype,
          opponentClanId: line.opponentClanId,
        })),
      notes: "",
      meNotes: null,
    };
    expect(buildParticipations(draft)).toEqual(lines);
  });
});

/** Base au schéma du lot Chercher (versions 1 à 6) : l'« ancien code » d'avant le Lot 8. */
class ChercherDb extends OfflineCoreDb {
  constructor(name: string) {
    super(name);
    this.version(1).stores({ ...CORE_STORES_V1, ...VTES_STORES_V1 });
    this.version(2).stores({ ...CORE_STORES_V2 });
    this.version(3).stores({ ...VTES_STORES_V2 });
    this.version(4).stores({ ...VTES_STORES_V3 });
    this.version(5).stores({ ...VTES_STORES_V4 });
    this.version(6).stores({ ...VTES_STORES_V5 });
  }
}

describe("version 7 du schéma (Lot 8 : versions de deck)", () => {
  it("ajoute `deckVersions`, vide `cardDetails` pour le relire avec les clans, garde le reste", async () => {
    const name = freshDbName("v7");
    const theo = crypt({ id: 2, name: "Theo Bell", clan: "Brujah" });
    const before = new ChercherDb(name);
    await before.table("cards").bulkPut([theo].map(cardRowOf));
    const { clanId: _clanId, ...oldDetail } = cardDetailRowOf(theo);
    void _clanId;
    await before.table("cardDetails").put(oldDetail);
    await before.table("games").put(game(7));
    await before.table("outbox").put({
      operationId: "op-1",
      rank: 1,
      type: "game.update",
      state: "pending",
      operation: ops.gameUpdate(clock, "id:7", { fields: { notes: "x" } }),
      recordedAt: "t",
      attempts: 0,
    });
    before.close();

    const after = new VtesOfflineDb(name);
    try {
      await after.open();
      expect(after.verno).toBe(7);
      expect(await after.deckVersions.count()).toBe(0);
      expect(await after.cards.count()).toBe(1);
      expect(await after.cardDetails.count()).toBe(0);
      expect(await readCatalogState(after)).toMatchObject({ cards: 1, details: 0, complete: false });
      expect(await after.games.count()).toBe(1);
      expect(await after.outbox.count()).toBe(1);
    } finally {
      after.close();
    }
  });
});

describe("miroir des versions (`refreshDeckVersions`)", () => {
  const version = (id: number, deckId: number, number: number): FakeDeckVersion => ({
    id,
    deck_id: deckId,
    number,
    created_at: "2026-11-07T18:00:00Z",
    crypt_count: 12,
    library_count: 60,
    cards: [{ card_id: 2, quantity: 3 }],
  });

  function serverWithDecks() {
    const server = createFakeServer();
    for (const id of [4, 6, 8]) {
      server.state.decks.push({
        id,
        name: `Deck ${id}`,
        discriminator: "0001",
        client_ref: null,
        proxy_allowed: false,
        archived_at: null,
      });
    }
    server.state.deckVersions.push(version(11, 4, 1), version(12, 4, 2), version(20, 6, 1), version(30, 8, 1));
    return server;
  }

  it("ne lit que les decks que les parties et les tournois désignent", async () => {
    const server = serverWithDecks();
    const db = new VtesOfflineDb(freshDbName("versions"));
    await db.games.put(game(7));
    await db.tournaments.put(
      tournament(3, { deckVersions: [{ deckId: 6, deckVersionId: 20, deckVersionNumber: 1, frozenByGameId: 9 }] }),
    );

    expect(await refreshDeckVersions(server.client, db)).toBe(3);

    const read = server.state.requests.filter((request) => request.path.endsWith("/versions")).map((r) => r.path);
    expect(read.sort()).toEqual(["/decks/4/versions", "/decks/6/versions"]);
    expect((await readDeckVersions(db, "id:4")).map((row) => row.number)).toEqual([1, 2]);
    expect(await readDeckVersion(db, 12)).toMatchObject({
      deckId: 4,
      number: 2,
      cryptCount: 12,
      libraryCount: 60,
      cards: [{ cardId: 2, quantity: 3 }],
    });
    db.close();
  });

  it("ne relit pas un deck dont toutes les versions désignées sont connues, et oublie un deck qui n'est plus joué", async () => {
    const server = serverWithDecks();
    const db = new VtesOfflineDb(freshDbName("versions-cache"));
    await db.games.put(game(7));
    await db.deckVersions.bulkPut([
      { id: 12, deckId: 4, number: 2, createdAt: "t", cryptCount: 1, libraryCount: 1, cards: [] },
      { id: 30, deckId: 8, number: 1, createdAt: "t", cryptCount: 1, libraryCount: 1, cards: [] },
    ]);

    expect(await refreshDeckVersions(server.client, db)).toBe(1);

    expect(server.state.requests.some((request) => request.path.endsWith("/versions"))).toBe(false);
    expect((await db.deckVersions.toArray()).map((row) => row.id)).toEqual([12]);
    db.close();
  });

  it("un deck introuvable est omis ; une ligne de deck créé hors ligne se lit par sa référence", async () => {
    const server = serverWithDecks();
    const db = new VtesOfflineDb(freshDbName("versions-404"));
    await db.games.put(game(7, { me: { ...game(7).me, deckId: 99, deckVersionId: 77 }, table: null }));
    await db.games.put(game(8, { me: { ...game(8).me, deckId: 6, deckVersionId: 20 }, table: null }));

    expect(await refreshDeckVersions(server.client, db)).toBe(1);
    await db.refs.put({ ref: "deck-hors-ligne", id: 6, boundAt: "t" });
    expect((await readDeckVersions(db, "ref:deck-hors-ligne")).map((row) => row.id)).toEqual([20]);
    expect(await readDeckVersions(db, "ref:inconnu")).toEqual([]);
    db.close();
  });
});

describe("clans du catalogue (`readClans`)", () => {
  it("se déduisent des cartes de crypte, une fois chacun, triés par nom", async () => {
    const db = new VtesOfflineDb(freshDbName("clans"));
    const cards = [
      crypt({ id: 1, name: "A", clan: "Tremere" }),
      crypt({ id: 2, name: "B", clan: "Brujah" }),
      crypt({ id: 3, name: "C", clan: "Tremere" }),
      library({ id: 4, name: "D" }),
    ];
    await db.cards.bulkPut(cards.map(cardRowOf));
    await db.cardDetails.bulkPut(cards.map(cardDetailRowOf));

    const clans = await readClans(db);
    expect(clans.map((clan) => clan.name)).toEqual(["Brujah", "Tremere"]);
    expect(clans.find((clan) => clan.name === "Tremere")!.id).toBe(cards[0].clan!.id);
    db.close();
  });
});
