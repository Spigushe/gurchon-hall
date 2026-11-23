import { describe, expect, it } from "vitest";
import {
  buildPreview,
  deckTitle,
  finalLabel,
  headerFacts,
  myPositions,
  myScore,
  normalizeInstant,
  orderedGames,
  preliminaryLabel,
  rankingLabel,
  roundTitle,
  sameSnapshot,
  seatDeck,
  seatName,
  tournamentDates,
  type PreviewInput,
  type ReportSnapshot,
} from "../../../../src/features/report/reportModel";
import { parsePublicReportHash, isPublicReportHash } from "../../../../src/features/report/publicReportRoute";
import type {
  DeckKey,
  LocalDeck,
  LocalDeckCard,
  LocalGame,
  LocalPlayer,
  LocalTableLine,
  LocalTournament,
  ResourceKey,
} from "../../../../src/offline/vtes";

function tournament(overrides: Partial<LocalTournament> = {}): LocalTournament {
  return {
    key: "id:1",
    id: 1,
    clientRef: null,
    aliases: [],
    pending: false,
    name: "Coupe de Lutèce",
    startDate: "2026-11-14",
    endDate: null,
    venueKey: null,
    deckPolicy: "mono",
    format: "constructed",
    eventTier: "standard",
    finalDeckRule: null,
    roundCount: 3,
    playerCount: 22,
    myRanking: 3,
    notes: "Premier tournoi.",
    summary: {
      preliminaryGameWins: 2,
      preliminaryVictoryPoints: 6.5,
      roundsPlayed: 3,
      finalVictoryPoints: 1,
      finalGameWin: false,
    },
    summaryProvisional: false,
    admissibleFinalDecks: null,
    deckVersions: [],
    report: null,
    reportRequest: null,
    ...overrides,
  };
}

function line(overrides: Partial<LocalTableLine> = {}): LocalTableLine {
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
    ...overrides,
  };
}

function game(number: number | null, table: LocalTableLine[] | null, overrides: Partial<LocalGame> = {}): LocalGame {
  return {
    key: `id:${10 + (number ?? 9)}` as ResourceKey,
    id: 10 + (number ?? 9),
    clientRef: null,
    aliases: [],
    pending: false,
    playedAt: "2026-11-14T14:00:00+01:00",
    venueKey: null,
    tournamentKey: "id:1",
    tournamentName: "Coupe de Lutèce",
    roundNumber: number,
    roundType: number === null ? "final" : "preliminary",
    playerCount: 5,
    me: { deckKey: "id:7" as DeckKey, seat: 2, victoryPoints: 3, gameWin: true, deckVersionId: null, deckVersionNumber: null },
    notes: null,
    table,
    ...overrides,
  };
}

const deck: LocalDeck = {
  key: "id:7" as DeckKey,
  id: 7,
  clientRef: null,
  name: "Guns",
  discriminator: "0001",
  createdOn: null,
  status: "active",
  archetype: "rush",
  notes: null,
  proxyAllowed: true,
  archivedAt: null,
  vdbDeckId: null,
  pending: false,
};

const marc: LocalPlayer = {
  key: "id:3" as ResourceKey,
  id: 3,
  clientRef: null,
  aliases: [],
  pending: false,
  name: "Marc",
  isMe: false,
  gameCount: 1,
};

const currentList: LocalDeckCard[] = [
  { cardId: 5, languageCode: "EN", cardSetId: 1, quantity: 2, proxyQuantity: 0, cardName: null, pending: false },
  { cardId: 5, languageCode: "FR", cardSetId: 1, quantity: 1, proxyQuantity: 0, cardName: null, pending: false },
  { cardId: 2, languageCode: "EN", cardSetId: 1, quantity: 4, proxyQuantity: 4, cardName: null, pending: false },
];

function input(overrides: Partial<PreviewInput> = {}): PreviewInput {
  return {
    tournament: tournament(),
    venue: null,
    games: [],
    players: [marc],
    decks: [deck],
    deckVersions: [],
    deckCards: new Map([[deck.key, currentList]]),
    clans: [{ id: 4, name: "Ventrue" }],
    includeOpponentNotes: false,
    ...overrides,
  };
}

const table = [
  line({ playerKey: marc.key, seat: 1, notes: "Joue vite." }),
  line({ seat: 4, opponentDeckName: "Nos", opponentDeckArchetype: "bleed", opponentClanId: 4 }),
  line({ isMe: true, deckKey: deck.key, seat: 2, victoryPoints: 3, gameWin: true, notes: "Belle partie." }),
];

describe("aperçu du compte-rendu depuis le miroir", () => {
  it("reprend le tournoi, le bilan et la table dans l'ordre des sièges", () => {
    const snapshot = buildPreview(input({ games: [game(1, table, { notes: "Récit." })] }));
    expect(snapshot.format_version).toBe(1);
    expect(snapshot.tournament).toMatchObject({ name: "Coupe de Lutèce", my_ranking: 3, notes: "Premier tournoi." });
    expect(snapshot.summary.preliminary_victory_points).toBe(6.5);
    const seats = snapshot.rounds[0].seats;
    expect(seats.map((seat) => seat.seat)).toEqual([1, 2, 4]);
    expect(seats[0]).toMatchObject({ player_name: "Marc", is_me: false, notes: null });
    expect(seats[1]).toMatchObject({ is_me: true, deck_id: 7, deck_name: "Guns", victory_points: 3, game_win: true, notes: "Belle partie." });
    expect(seats[2]).toMatchObject({ player_name: null, clan_name: "Ventrue", deck_archetype: "bleed", deck_name: "Nos" });
    expect(snapshot.rounds[0].notes).toBe("Récit.");
    expect(snapshot.rounds[0].played_at).toBe("2026-11-14T13:00:00Z");
  });

  it("n'inclut les notes sur les adversaires que si l'option est cochée (P4)", () => {
    const snapshot = buildPreview(input({ games: [game(1, table)], includeOpponentNotes: true }));
    expect(snapshot.rounds[0].seats[0].notes).toBe("Joue vite.");
  });

  it("prend la version figée du tournoi, sinon la liste courante sommée par carte", () => {
    const pending = buildPreview(input({ games: [game(1, table)] }));
    expect(pending.decks).toEqual([
      { deck_id: 7, name: "Guns", archetype: "rush", version_number: null, cards: [{ card_id: 2, quantity: 4 }, { card_id: 5, quantity: 3 }] },
    ]);
    const frozen = buildPreview(
      input({
        games: [game(1, table)],
        tournament: tournament({
          deckVersions: [{ deckKey: deck.key, deckId: 7, deckVersionId: 40, deckVersionNumber: 2, frozenByGameKey: "id:11" as ResourceKey }],
        }),
        deckVersions: [
          { id: 40, deckId: 7, number: 2, createdAt: "2026-11-14T12:00:00Z", cryptCount: 0, libraryCount: 4, cards: [{ cardId: 2, quantity: 4 }] },
        ],
      }),
    );
    expect(frozen.decks[0]).toMatchObject({ version_number: 2, cards: [{ card_id: 2, quantity: 4 }] });
  });

  it("range les rondes dans l'ordre, la finale en dernier, et garde ma ligne sans table", () => {
    const games = [game(null, null), game(2, null), game(1, null)];
    const snapshot = buildPreview(input({ games }));
    expect(snapshot.rounds.map((round) => roundTitle(round))).toEqual(["Ronde 1", "Ronde 2", "Finale"]);
    expect(snapshot.rounds[0].seats).toHaveLength(1);
    expect(snapshot.rounds[0].seats[0]).toMatchObject({ is_me: true, deck_name: "Guns", victory_points: 3 });
    expect(orderedGames(games).map((item) => item.roundNumber)).toEqual([1, 2, null]);
  });
});

describe("comparaison de deux instantanés", () => {
  const base = buildPreview(input({ games: [game(1, table)] }));

  it("ignore l'ordre des clés et la forme de l'instant", () => {
    const reordered = JSON.parse(JSON.stringify(base)) as ReportSnapshot;
    reordered.rounds[0].played_at = "2026-11-14T13:00:00.000Z";
    expect(sameSnapshot(base, reordered)).toBe(true);
  });

  it("voit une note changée", () => {
    const changed = { ...base, tournament: { ...base.tournament, notes: "Autre." } };
    expect(sameSnapshot(base, changed)).toBe(false);
  });

  it("normalise un instant en UTC sans millisecondes", () => {
    expect(normalizeInstant("2026-11-14T14:00:00+01:00")).toBe("2026-11-14T13:00:00Z");
    expect(normalizeInstant("pas une date")).toBe("pas une date");
  });
});

describe("mise en forme de la trame", () => {
  it("écrit les dates d'un jour ou d'une période", () => {
    expect(tournamentDates("2026-11-14", null)).toBe("Samedi 14 novembre 2026");
    expect(tournamentDates("2026-12-05", "2026-12-06")).toBe("Du 5 au 6 décembre 2026");
    expect(tournamentDates("2026-11-30", "2026-12-01")).toBe("Du 30 novembre au 1er décembre 2026");
    expect(tournamentDates("2026-12-31", "2027-01-01")).toBe("Du 31 décembre 2026 au 1er janvier 2027");
  });

  it("écrit le classement, le bilan et la finale sans pourcentage", () => {
    expect(rankingLabel(3, 22)).toBe("3e sur 22");
    expect(rankingLabel(1, null)).toBe("1er");
    expect(rankingLabel(null, 22)).toBeNull();
    const snapshot = buildPreview(input());
    expect(preliminaryLabel(snapshot.summary)).toBe("2 GW · 6,5 VP en 3 rondes");
    // « pas de GW » ne s'écrit nulle part (handoff `COMPTE-RENDU.md`).
    expect(finalLabel(snapshot.summary)).toBe("1 VP");
    expect(finalLabel({ ...snapshot.summary, final_victory_points: 3, final_game_win: true })).toBe("3 VP · GW");
    expect(finalLabel({ ...snapshot.summary, final_victory_points: null, final_game_win: null })).toBeNull();
  });

  it("omet les faits inconnus de l'en-tête, sans tiret", () => {
    const snapshot = buildPreview(input({ tournament: tournament({ playerCount: null, roundCount: null }) }));
    expect(headerFacts(snapshot.tournament)).toEqual(["Tournoi standard", "construit", "mono-deck"]);
    const withVenue = buildPreview(input({ venue: { key: "id:2" as ResourceKey, id: 2, clientRef: null, aliases: [], pending: false, name: "Le Dé Pipé", city: "Paris", notes: "Code", gameCount: 0, tournamentCount: 1 } }));
    expect(headerFacts(withVenue.tournament)[0]).toBe("Le Dé Pipé, Paris");
  });

  it("nomme les lignes, leurs decks et mes positions de départ", () => {
    const round = buildPreview(input({ games: [game(1, table)] })).rounds[0];
    expect(seatName(round.seats[1], "auteur")).toBe("Moi (@auteur)");
    expect(seatName(round.seats[2], null)).toBe("Joueur non nommé");
    expect(seatDeck(round.seats[2])).toBe("Ventrue · Bleed · Nos");
    expect(myScore(round)).toBe("3 VP · GW");
    // Siège 2 sur 5 : proie au siège 3 (non saisi), prédateur au siège 1 (Marc).
    expect(myPositions(round)).toEqual({ prey: "siège 3", predator: "Marc" });
    expect(deckTitle({ name: "Guns", archetype: "rush" })).toBe("Guns (Rush)");
  });
});

describe("hash d'une page publique de compte-rendu", () => {
  it("reconnaît un jeton, refuse une forme invalide et ignore toute requête", () => {
    expect(parsePublicReportHash("#/compte-rendu/aB3x_9pQ")).toEqual({ kind: "report", token: "aB3x_9pQ" });
    expect(parsePublicReportHash("#/compte-rendu/aB3x_9pQ?v=1")).toEqual({ kind: "report", token: "aB3x_9pQ" });
    expect(parsePublicReportHash("#/compte-rendu/court")).toEqual({ kind: "invalid" });
    expect(parsePublicReportHash("#/liste/aB3x_9pQ")).toEqual({ kind: "none" });
    expect(isPublicReportHash("#/tournois/id:1/compte-rendu")).toBe(false);
  });
});
