import { describe, expect, it } from "vitest";
import {
  averageVp,
  bilanSummary,
  deckAxis,
  DEFAULT_BILAN_FILTERS,
  filterFacts,
  filtersChanged,
  formatAverage,
  gameFact,
  gameWinsLine,
  groupMeta,
  mainClan,
  monthAxis,
  monthLabel,
  nextSort,
  opponentAxis,
  periodRange,
  pointsLine,
  positionAxis,
  sortGroups,
  statsOf,
  toggleRoundType,
  tournamentsLine,
  venueAxis,
  versionGroups,
  versionLabel,
  withBound,
  type GameFact,
  type GameFactContext,
} from "../../../../src/features/analysis/bilanModel";
import type { DeckKey, LocalGame, LocalTableLine, ResourceKey } from "../../../../src/offline/vtes";

const BANU = "id:1" as DeckKey;
const TOREADOR = "id:2" as DeckKey;
const MARC = "id:20" as ResourceKey;
const LEA = "id:21" as ResourceKey;
const BAR = "id:30" as ResourceKey;
const DONJON = "id:31" as ResourceKey;
const CLANS: Record<number, string> = { 1: "Ministry", 2: "Brujah", 3: "Tremere", 4: "Gangrel" };

const context: GameFactContext = {
  clanName: (id) => (id === null ? null : (CLANS[id] ?? null)),
  lentDeck: (key) => ({ clanName: key === BANU ? "Banu Haqim" : "Toreador", archetype: "vote" }),
};

function line(changes: Partial<LocalTableLine>): LocalTableLine {
  return {
    playerKey: null,
    isMe: false,
    deckKey: null,
    seat: null,
    victoryPoints: null,
    gameWin: null,
    opponentDeckName: null,
    opponentDeckArchetype: null,
    opponentClanId: null,
    notes: null,
    deckVersionId: null,
    deckVersionNumber: null,
    ...changes,
  };
}

let nextId = 1;
function game(changes: Partial<LocalGame> & { me?: Partial<LocalGame["me"]> } = {}): LocalGame {
  const id = nextId++;
  const me = {
    deckKey: BANU,
    seat: null,
    victoryPoints: 2,
    gameWin: false,
    deckVersionId: 10,
    deckVersionNumber: 1,
    ...changes.me,
  };
  return {
    key: `id:${id}` as ResourceKey,
    id,
    clientRef: null,
    aliases: [],
    pending: false,
    playedAt: "2026-10-15T19:30:00",
    venueKey: null,
    tournamentKey: null,
    tournamentName: null,
    roundNumber: null,
    roundType: "casual",
    playerCount: 5,
    notes: null,
    table: [line({ playerKey: "id:1" as ResourceKey, isMe: true, seat: me.seat, deckKey: me.deckKey })],
    ...changes,
    me,
  };
}

const facts = (games: LocalGame[]) => games.map((item) => gameFact(item, context));
const NOW = new Date(2026, 10, 12, 12, 0);

describe("gameFact", () => {
  it("réduit une partie à ses champs, VP absents comptés 0, GW nul compté non", () => {
    const fact = gameFact(game({ me: { victoryPoints: null, gameWin: null } }), context);
    expect(fact.victoryPoints).toBe(0);
    expect(fact.gameWin).toBe(false);
    expect(fact.day).toBe("2026-10-15");
    expect(fact.month).toBe("2026-10");
    expect(fact.seated).toBe(false);
    expect(fact.positions.prey).toBe("none");
  });

  it("lit le deck de l'adversaire à chaque position, prêt compris ; siège vide « inconnu »", () => {
    const fact = gameFact(
      game({
        me: { seat: 1 },
        playerCount: 5,
        table: [
          line({ isMe: true, playerKey: "id:1" as ResourceKey, seat: 1 }),
          line({ playerKey: MARC, seat: 2, opponentClanId: 1, opponentDeckArchetype: "bleed" }),
          line({ seat: 5, deckKey: TOREADOR }),
          line({ playerKey: LEA, seat: 3 }),
        ],
      }),
      context,
    );
    expect(fact.seated).toBe(true);
    expect(fact.positions.prey).toEqual({ clanName: "Ministry", archetype: "bleed" });
    expect(fact.positions.predator).toEqual({ clanName: "Toreador", archetype: "vote" });
    expect(fact.positions.grandPrey).toEqual({ clanName: null, archetype: null });
    expect(fact.positions.grandPredator).toBeNull();
    expect(fact.opponents).toEqual([MARC, LEA]);
  });

  it("à trois joueurs, pas de grande position ; table inconnue : positions inconnues", () => {
    const small = gameFact(game({ me: { seat: 1 }, playerCount: 3 }), context);
    expect(small.positions.grandPrey).toBe("none");
    const unknown = gameFact(game({ me: { seat: 1 }, table: null }), context);
    expect(unknown.positions.prey).toBeNull();
    expect(unknown.opponents).toEqual([]);
  });
});

describe("filtres", () => {
  const all = facts([
    game({ playedAt: "2025-06-01T20:00:00", roundType: "casual" }),
    game({ playedAt: "2026-02-01T20:00:00", roundType: "preliminary", me: { deckKey: TOREADOR } }),
    game({ playedAt: "2026-11-01T20:00:00", roundType: "final" }),
  ]);

  it("période : 12 derniers mois par défaut, cette année, tout, bornes à la main", () => {
    expect(periodRange(DEFAULT_BILAN_FILTERS, NOW)).toEqual({ from: "2025-11-13", to: null });
    expect(filterFacts(all, DEFAULT_BILAN_FILTERS, NOW)).toHaveLength(2);
    expect(filterFacts(all, { ...DEFAULT_BILAN_FILTERS, period: "year" }, NOW)).toHaveLength(2);
    expect(filterFacts(all, { ...DEFAULT_BILAN_FILTERS, period: "all" }, NOW)).toHaveLength(3);
    const custom = withBound(DEFAULT_BILAN_FILTERS, "to", "2026-06-30", NOW);
    expect(custom).toMatchObject({ period: "custom", from: "2025-11-13", to: "2026-06-30" });
    expect(filterFacts(all, custom, NOW)).toHaveLength(1);
  });

  it("types multiples (aucun : tous) et un seul deck", () => {
    const types = toggleRoundType(toggleRoundType({ ...DEFAULT_BILAN_FILTERS, period: "all" }, "final"), "casual");
    expect(types.roundTypes).toEqual(["casual", "final"]);
    expect(filterFacts(all, types, NOW)).toHaveLength(2);
    expect(toggleRoundType(types, "final").roundTypes).toEqual(["casual"]);
    expect(filterFacts(all, { ...DEFAULT_BILAN_FILTERS, period: "all", deckKey: TOREADOR }, NOW)).toHaveLength(1);
    expect(filtersChanged(DEFAULT_BILAN_FILTERS)).toBe(false);
    expect(filtersChanged(types)).toBe(true);
  });
});

describe("agrégats et axes", () => {
  const list = facts([
    game({ venueKey: BAR, me: { victoryPoints: 3, gameWin: true, deckVersionNumber: 1 }, playedAt: "2026-09-19T14:00:00" }),
    game({ venueKey: BAR, me: { victoryPoints: 1.5, deckVersionNumber: 2 }, playedAt: "2026-10-24T14:00:00" }),
    game({ venueKey: DONJON, me: { deckKey: TOREADOR, victoryPoints: 2, gameWin: true }, playedAt: "2026-10-03T21:00:00" }),
    game({ pending: true, me: { deckVersionNumber: null, deckVersionId: null, victoryPoints: 0 }, playedAt: "2026-11-07T21:00:00" }),
    game({ me: { deckKey: null, victoryPoints: 1 }, playedAt: "2026-11-08T21:00:00" }),
  ]);

  it("bilan : comptes, VP total et moyen, tournois, finales", () => {
    const stats = statsOf(list);
    expect(stats).toEqual({ games: 5, gameWins: 2, victoryPoints: 7.5 });
    expect(averageVp(stats)).toBe(1.5);
    expect(averageVp(statsOf([]))).toBeNull();
    const summary = bilanSummary(list);
    expect(summary.tournaments).toBe(0);
    expect(summary.finals).toBe(0);
  });

  it("axe Deck : alphabétique, « inconnu » en dernier, versions puis liste figée à la synchronisation", () => {
    const decks = deckAxis(list, (key) => (key === BANU ? "Banu Princes" : "Toreador Mass Vote"));
    expect(decks.map((group) => group.label)).toEqual(["Banu Princes", "Toreador Mass Vote", "inconnu"]);
    expect(decks[0].versions.map((version) => [version.key, version.stats.games, version.since])).toEqual([
      ["v1", 1, "2026-09-19"],
      ["v2", 1, "2026-10-24"],
      ["pending", 1, "2026-11-07"],
    ]);
    expect(versionLabel(decks[0].versions[2])).toBe("liste figée à la synchronisation");
    expect(versionLabel({ number: null, pending: false })).toBe("liste non figée");
  });

  it("axe Lieu (sans lieu : inconnu), axe Mois (le plus récent en haut)", () => {
    const venues = venueAxis(list, (key) => (key === BAR ? "Bar à Dés" : "Le Donjon"));
    expect(venues.map((group) => [group.label, group.stats.games])).toEqual([
      ["Bar à Dés", 2],
      ["Le Donjon", 1],
      ["inconnu", 2],
    ]);
    expect(monthAxis(list).map((group) => group.label)).toEqual(["Novembre 2026", "Octobre 2026", "Septembre 2026"]);
    expect(monthLabel("2026-01")).toBe("Janvier 2026");
  });

  it("axe Adversaires : une partie par adversaire nommé, les lignes sans nom ignorées", () => {
    const tables = facts([
      game({ table: [line({ playerKey: MARC }), line({ playerKey: LEA }), line({ seat: 3 })] }),
      game({ table: [line({ playerKey: MARC })] }),
      game({ table: [line({ seat: 2, opponentDeckArchetype: "rush" })] }),
    ]);
    const groups = opponentAxis(tables, (key) => (key === MARC ? "Marc" : "Léa"));
    expect(groups.map((group) => [group.label, group.stats.games])).toEqual([
      ["Léa", 1],
      ["Marc", 2],
    ]);
  });

  it("versionGroups par numéro croissant", () => {
    expect(versionGroups(list.slice(0, 2)).map((version) => version.number)).toEqual([1, 2]);
  });
});

describe("axe Position (P7, P8)", () => {
  const seated = (seat: number | null, playerCount: number, table: LocalTableLine[]) =>
    game({ me: { seat }, playerCount, table: [line({ isMe: true, playerKey: "id:1" as ResourceKey, seat }), ...table] });
  const list = facts([
    seated(1, 5, [line({ seat: 2, opponentDeckArchetype: "bleed", opponentClanId: 1 }), line({ seat: 3, opponentClanId: 4 })]),
    seated(3, 4, [line({ seat: 4, opponentDeckArchetype: "wall", opponentClanId: 3 }), line({ seat: 1, opponentDeckArchetype: "rush" })]),
    seated(1, 3, [line({ seat: 2, opponentDeckArchetype: "bleed", opponentClanId: 2 })]),
    seated(null, 5, []),
  ]);

  it("proie par archétype, les parties sans siège comptées à part", () => {
    const axis = positionAxis(list, "prey", "archetype");
    expect(axis.groups.map((group) => [group.label, group.stats.games])).toEqual([
      ["Bleed", 2],
      ["Wall", 1],
    ]);
    expect(axis.unseated).toBe(1);
    expect(axis.withoutPosition).toBe(0);
  });

  it("par clan, siège sans ligne ou ligne muette : « inconnu » en dernier", () => {
    const axis = positionAxis(list, "predator", "clan");
    expect(axis.groups.map((group) => group.label)).toEqual(["inconnu"]);
    expect(axis.groups[0].stats.games).toBe(3);
  });

  it("grande proie : le siège d'en face à quatre, aucune grande position à trois", () => {
    const axis = positionAxis(list, "grandPrey", "archetype");
    expect(axis.groups.map((group) => [group.label, group.stats.games])).toEqual([
      ["Rush", 1],
      ["inconnu", 1],
    ]);
    expect(axis.withoutPosition).toBe(1);
    expect(positionAxis(list, "grandPredator", "archetype").groups[0].label).toBe("Rush");
  });
});

describe("tri du bureau", () => {
  const groups = deckAxis(
    facts([
      game({ me: { deckKey: BANU, victoryPoints: 1 } }),
      game({ me: { deckKey: TOREADOR, victoryPoints: 4 } }),
      game({ me: { deckKey: TOREADOR, victoryPoints: 2 } }),
      game({ me: { deckKey: null, victoryPoints: 5 } }),
    ]),
    (key) => (key === BANU ? "Banu" : "Toreador"),
  );

  it("premier clic dans le sens naturel, second clic inversé, « inconnu » toujours en dernier", () => {
    const first = nextSort(null, "games");
    expect(first).toEqual({ column: "games", descending: true });
    expect(sortGroups(groups, first).map((group) => group.label)).toEqual(["Toreador", "Banu", "inconnu"]);
    const second = nextSort(first, "games");
    expect(sortGroups(groups, second).map((group) => group.label)).toEqual(["Banu", "Toreador", "inconnu"]);
    expect(nextSort(null, "label")).toEqual({ column: "label", descending: false });
    expect(sortGroups(groups, { column: "average", descending: true }).at(-1)?.label).toBe("inconnu");
    expect(sortGroups(groups, null).map((group) => group.label)).toEqual(["Banu", "Toreador", "inconnu"]);
  });
});

describe("clan principal (P5)", () => {
  const clans: Record<number, string | null> = { 1: "Ventrue", 2: "Banu Haqim", 3: "Banu Haqim", 4: null };
  it("le clan qui compte le plus d'exemplaires, égalité par le nom, rien sans clan", () => {
    expect(mainClan([{ cardId: 1, quantity: 3 }, { cardId: 2, quantity: 2 }, { cardId: 3, quantity: 2 }], (id) => clans[id])).toBe(
      "Banu Haqim",
    );
    expect(mainClan([{ cardId: 1, quantity: 2 }, { cardId: 2, quantity: 2 }], (id) => clans[id])).toBe("Banu Haqim");
    expect(mainClan([{ cardId: 4, quantity: 12 }], (id) => clans[id])).toBeNull();
  });
});

describe("libellés : jamais de pourcentage (P8)", () => {
  const stats = { games: 14, gameWins: 6, victoryPoints: 26.5 };
  it("écrit les comptes et le VP moyen à la virgule", () => {
    expect(gameWinsLine(stats)).toBe("6 GW sur 14 parties");
    expect(groupMeta({ games: 1, gameWins: 0, victoryPoints: 2 })).toBe("0 GW sur 1 partie · 2 VP");
    expect(pointsLine(stats)).toBe("26,5 VP, 1,9 VP par partie");
    expect(formatAverage(null)).toBe("—");
    expect(tournamentsLine({ ...stats, tournaments: 2, finals: 1 })).toBe("2 tournois joués · 1 finale atteinte");
    expect(tournamentsLine({ ...stats, tournaments: 1, finals: 0 })).toBe("1 tournoi joué · 0 finale atteinte");
  });

  it("aucune sortie du modèle ne contient « % »", () => {
    const sample: GameFact[] = facts([game({ me: { gameWin: true } }), game()]);
    const outputs = [
      JSON.stringify(deckAxis(sample, () => "Banu")),
      JSON.stringify(bilanSummary(sample)),
      gameWinsLine(statsOf(sample)),
      pointsLine(statsOf(sample)),
    ];
    for (const output of outputs) expect(output).not.toContain("%");
  });
});
