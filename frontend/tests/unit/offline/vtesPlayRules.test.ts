import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  certainGameWin,
  nextRoundNumber,
  tournamentSummary,
} from "../../../src/offline/vtes/playRules";

// Table de cas partagée avec le test Python de `certain_game_win` : une
// évolution du seuil se fait dans ce fichier JSON et dans les deux implémentations.
const FIXTURE = resolve(
  __dirname,
  "../../../../backend/tests/fixtures/certain_game_win_cases.json",
);
const { cases } = JSON.parse(readFileSync(FIXTURE, "utf-8")) as {
  cases: Array<{ player_count: number; vp: number | null; expected: true | null }>;
};

describe("certainGameWin (A4, A14)", () => {
  it("lit une table de cas non vide", () => {
    expect(cases.length).toBeGreaterThan(10);
  });

  it.each(cases)("$player_count joueurs, $vp VP -> $expected", ({ player_count, vp, expected }) => {
    const result = certainGameWin(player_count, vp);
    if (expected === null) expect(result).toBeNull(); // null, jamais undefined ni false
    else expect(result).toBe(true);
  });

  it("accepte des VP absents (champ non rempli)", () => {
    expect(certainGameWin(4, undefined)).toBeNull();
  });
});

describe("tournamentSummary (bilan provisoire, A12 et A14)", () => {
  const round = (victoryPoints: number | null, gameWin: boolean | null, deckId: number | null = 1) => ({
    deckId,
    victoryPoints,
    gameWin,
  });

  it("compte les GW, additionne les VP et les rondes jouées des préliminaires", () => {
    const tally = tournamentSummary([round(3, true), round(1.5, false), round(2, null)], null);
    expect(tally).toEqual({
      preliminaryGameWins: 1,
      preliminaryVictoryPoints: 6.5,
      roundsPlayed: 3,
      finalVictoryPoints: null,
      finalGameWin: null,
    });
  });

  it("compte pour 0 des VP non saisis", () => {
    expect(tournamentSummary([round(null, null)], null).preliminaryVictoryPoints).toBe(0);
  });

  it("rend la finale à part, GW nul compté comme faux, VP absents comme 0", () => {
    expect(tournamentSummary([round(2, true)], round(null, null))).toMatchObject({
      finalVictoryPoints: 0,
      finalGameWin: false,
    });
    expect(tournamentSummary([], round(2.5, true))).toMatchObject({
      preliminaryGameWins: 0,
      roundsPlayed: 0,
      finalVictoryPoints: 2.5,
      finalGameWin: true,
    });
  });
});

describe("nextRoundNumber", () => {
  it("propose 1 sans ronde", () => {
    expect(nextRoundNumber([])).toBe(1);
    expect(nextRoundNumber([null, undefined])).toBe(1);
  });

  it("propose max + 1, et non le nombre de rondes jouées", () => {
    expect(nextRoundNumber([1, 2, 3])).toBe(4);
    expect(nextRoundNumber([1, 3])).toBe(4); // la ronde 2 manque : 3 + 1, pas 2 + 1
    expect(nextRoundNumber([3, 1, null])).toBe(4);
  });
});
