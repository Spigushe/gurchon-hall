import { describe, expect, it } from "vitest";
import {
  decklistOf,
  decksOfGame,
  freezeBody,
  freezeOutcome,
  freezeScope,
  freezeSentence,
  playedVersionsOf,
  roundsPhrase,
  sameDecklist,
  untouchedSentence,
  versionNote,
} from "../../../../src/features/games/freezeModel";
import type {
  DeckKey,
  LocalGame,
  LocalTableLine,
  LocalTournament,
  ResourceKey,
} from "../../../../src/offline/vtes";

const BANU = "id:1" as DeckKey;
const TOREADOR = "id:2" as DeckKey;

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

function game(id: number, changes: Partial<LocalGame> = {}): LocalGame {
  const deckKey = changes.me?.deckKey ?? BANU;
  return {
    key: `id:${id}` as ResourceKey,
    id,
    clientRef: null,
    aliases: [`id:${id}` as ResourceKey],
    pending: false,
    playedAt: "2026-11-05T19:30:00Z",
    venueKey: null,
    tournamentKey: null,
    tournamentName: null,
    roundNumber: null,
    roundType: "casual",
    playerCount: 5,
    notes: null,
    me: { deckKey, seat: 2, victoryPoints: 2, gameWin: false, deckVersionId: 10, deckVersionNumber: 2 },
    table: [line({ playerKey: "id:1" as ResourceKey, isMe: true, deckKey, deckVersionId: 10, deckVersionNumber: 2, seat: 2 })],
    ...changes,
  };
}

function tournament(changes: Partial<LocalTournament> = {}): LocalTournament {
  return {
    key: "id:1" as ResourceKey,
    id: 1,
    clientRef: null,
    aliases: ["id:1" as ResourceKey],
    pending: false,
    name: "Open de Lyon",
    startDate: "2026-10-24",
    endDate: null,
    venueKey: null,
    deckPolicy: "multi",
    format: "constructed",
    eventTier: "standard",
    finalDeckRule: "free_choice",
    roundCount: 3,
    playerCount: null,
    myRanking: null,
    notes: null,
    summary: {
      preliminaryGameWins: 0,
      preliminaryVictoryPoints: 0,
      roundsPlayed: 0,
      finalVictoryPoints: null,
      finalGameWin: null,
    },
    summaryProvisional: false,
    admissibleFinalDecks: null,
    deckVersions: [],
    ...changes,
  };
}

/** Une partie du tournoi 1, à la ronde donnée (`final` pour la finale). */
function round(id: number, which: number | "final", deckKey: DeckKey = BANU): LocalGame {
  return game(id, {
    tournamentKey: "id:1" as ResourceKey,
    tournamentName: "Open de Lyon",
    roundType: which === "final" ? "final" : "preliminary",
    roundNumber: which === "final" ? null : which,
    me: { deckKey, seat: 1, victoryPoints: 1, gameWin: false, deckVersionId: 10, deckVersionNumber: 2 },
    table: [line({ isMe: true, playerKey: "id:1" as ResourceKey, deckKey, deckVersionId: 10, deckVersionNumber: 2 })],
  });
}

describe("comparaison de deux listes (P2)", () => {
  it("additionne les impressions et ignore langue, extension et proxies", () => {
    // Deux lignes de la même carte (deux impressions) valent une seule entrée carte × quantité.
    const current = decklistOf([
      { cardId: 7, quantity: 2 },
      { cardId: 7, quantity: 1 },
      { cardId: 8, quantity: 4 },
    ]);
    expect(sameDecklist(current, decklistOf([{ cardId: 7, quantity: 3 }, { cardId: 8, quantity: 4 }]))).toBe(true);
    expect(sameDecklist(current, decklistOf([{ cardId: 7, quantity: 3 }]))).toBe(false);
    expect(sameDecklist(current, decklistOf([{ cardId: 7, quantity: 3 }, { cardId: 8, quantity: 5 }]))).toBe(false);
  });
});

describe("freezeOutcome", () => {
  const v1 = { number: 1, cards: [{ cardId: 7, quantity: 3 }] };
  const v2 = { number: 2, cards: [{ cardId: 7, quantity: 4 }] };
  const v3 = { number: 3, cards: [{ cardId: 7, quantity: 5 }] };

  it("même liste que la version jouée : rien ne change", () => {
    expect(freezeOutcome([{ cardId: 7, quantity: 4 }], v2, [v1, v2])).toEqual({ kind: "same", number: 2 });
  });

  it("liste d'une version plus récente : le serveur la réutilise", () => {
    expect(freezeOutcome([{ cardId: 7, quantity: 5 }], v2, [v1, v2, v3])).toEqual({ kind: "reuse", number: 3 });
  });

  it("liste nouvelle : la version qui suit la dernière", () => {
    expect(freezeOutcome([{ cardId: 7, quantity: 6 }], v2, [v1, v2, v3])).toEqual({ kind: "new", number: 4 });
    // Une liste revenue à la v1 ne la reprend pas : seule la dernière version est réutilisée.
    expect(freezeOutcome([{ cardId: 7, quantity: 3 }], v2, [v1, v2])).toEqual({ kind: "new", number: 3 });
  });

  it("rien à comparer sans liste actuelle ou sans version lue", () => {
    expect(freezeOutcome(null, v2, [v2])).toEqual({ kind: "unknown" });
    expect(freezeOutcome([{ cardId: 7, quantity: 4 }], null, [])).toEqual({ kind: "unknown" });
  });

  it("le dit en une phrase, au singulier ou au pluriel", () => {
    expect(freezeSentence({ kind: "new", number: 3 }, 2, false)).toBe(
      "La liste actuelle diffère de la v2 : elle deviendra la v3.",
    );
    expect(freezeSentence({ kind: "same", number: 2 }, 2, true)).toBe(
      "La liste actuelle est celle de la v2 : les parties ne changent pas.",
    );
    expect(freezeSentence({ kind: "reuse", number: 3 }, 2, false)).toBe(
      "La liste actuelle est celle de la v3 : la partie passera de la v2 à la v3.",
    );
    expect(freezeSentence({ kind: "unknown" }, 2, false)).toContain("le serveur dira");
  });
});

describe("portée du regel (P3)", () => {
  const tournaments = [tournament()];

  it("en amicale, la partie seule", () => {
    const casual = game(1);
    expect(freezeScope(casual, [casual, game(2)], tournaments)).toEqual({ affected: [casual], untouched: [] });
  });

  it("en tournoi, toutes les parties qui jouent un deck de la table, et les autres à part", () => {
    const r1 = round(1, 1, TOREADOR);
    const r2 = round(2, 2);
    const r3 = round(3, 3);
    const final = round(4, "final");
    const elsewhere = game(5);
    const scope = freezeScope(r2, [r1, r2, r3, final, elsewhere], tournaments);
    expect(scope.affected.map((item) => item.id)).toEqual([2, 3, 4]);
    expect(scope.untouched.map((item) => item.id)).toEqual([1]);
  });

  it("un deck prêté à un adversaire entre dans la portée", () => {
    const lent = round(2, 2);
    lent.table = [...(lent.table ?? []), line({ playerKey: "id:9" as ResourceKey, deckKey: TOREADOR, seat: 3 })];
    const r1 = round(1, 1, TOREADOR);
    expect(decksOfGame(lent)).toEqual([BANU, TOREADOR]);
    expect(freezeScope(lent, [r1, lent], tournaments).affected.map((item) => item.id)).toEqual([2, 1]);
  });
});

describe("textes de la confirmation (1b-51, d29)", () => {
  it("rondes en toutes lettres", () => {
    expect(roundsPhrase([round(1, 2)])).toBe("ronde 2");
    expect(roundsPhrase([round(1, 3), round(2, 2), round(3, "final")])).toBe("rondes 2 et 3, finale");
    expect(roundsPhrase([round(1, 1), round(2, 2), round(3, 3)])).toBe("rondes 1, 2 et 3");
    expect(roundsPhrase([round(1, "final")])).toBe("finale");
  });

  it("en tournoi : nombre de parties, tournoi, deck et rondes", () => {
    const r2 = round(2, 2);
    const scope = { affected: [r2, round(3, 3), round(4, "final")], untouched: [round(1, 1, TOREADOR)] };
    expect(freezeBody(r2, scope, ["Banu Princes"])).toBe(
      "Les 3 parties du tournoi « Open de Lyon » jouées avec Banu Princes (rondes 2 et 3, finale) seront rattachées à sa liste actuelle.",
    );
    expect(untouchedSentence(scope, (key) => (key === TOREADOR ? "Toreador Mass Vote" : "Banu Princes"))).toBe(
      "La ronde 1, jouée avec Toreador Mass Vote, ne change pas.",
    );
  });

  it("en amicale : la phrase de d29", () => {
    const casual = game(1);
    expect(freezeBody(casual, { affected: [casual], untouched: [] }, ["Banu Princes"])).toBe(
      "La partie sera rattachée à la liste actuelle de Banu Princes. Utile si vous avez saisi la partie après avoir modifié le deck.",
    );
    expect(untouchedSentence({ affected: [casual], untouched: [] }, () => null)).toBeNull();
  });
});

describe("version jouée d'une partie", () => {
  it("prend la version de ma ligne, puis celle d'un deck prêté", () => {
    const lent = round(2, 2);
    lent.table = [
      ...(lent.table ?? []),
      line({ playerKey: "id:9" as ResourceKey, deckKey: TOREADOR, deckVersionId: 20, deckVersionNumber: 1 }),
    ];
    const versions = playedVersionsOf(lent);
    expect(versions.get(BANU)).toEqual({ id: 10, number: 2 });
    expect(versions.get(TOREADOR)).toEqual({ id: 20, number: 1 });
  });

  it("dit où la liste du tournoi a été figée", () => {
    const r1 = round(1, 1);
    const r2 = round(2, 2);
    const frozen = tournament({
      deckVersions: [{ deckKey: BANU, deckId: 1, deckVersionId: 10, deckVersionNumber: 2, frozenByGameKey: r2.key }],
    });
    expect(versionNote(r2, [frozen], [r1, r2])).toEqual({
      text: "liste du tournoi, figée à cette ronde",
      pending: false,
    });
    expect(versionNote(r1, [frozen], [r1, r2])).toEqual({
      text: "liste du tournoi, figée à la ronde 2",
      pending: false,
    });
  });

  it("une partie en file attend la synchronisation ; une amicale figée n'a pas de note", () => {
    const pending = game(1, {
      pending: true,
      me: { deckKey: BANU, seat: 2, victoryPoints: 2, gameWin: false, deckVersionId: null, deckVersionNumber: null },
    });
    expect(versionNote(pending, [], [])).toEqual({ text: "liste figée à la synchronisation", pending: true });
    expect(versionNote(game(2), [], [])).toBeNull();
  });
});
