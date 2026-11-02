import { describe, expect, it } from "vitest";
import {
  bestRoundOf,
  canAddRound,
  draftOf,
  highestRound,
  nextRoundOf,
  rankingProblem,
  roundCountEffect,
  tournamentInProgress,
  withPolicy,
  withTier,
  type TournamentRounds,
} from "../../src/features/games/tournamentModel";
import { duplicateName } from "../../src/features/games/notebookModel";
import type { LocalGame, LocalTournament } from "../../src/offline/vtes";

const t = (o: Partial<LocalTournament> = {}) =>
  ({ key: "id:1", startDate: "2026-10-25", myRanking: null, roundCount: 3, ...o }) as LocalTournament;
const g = (n: number | null, deck: string, vp: number | null, gw: boolean | null) =>
  ({
    roundNumber: n,
    roundType: n === null ? "final" : "preliminary",
    me: { deckKey: deck, victoryPoints: vp, gameWin: gw },
  }) as unknown as LocalGame;

describe("cas limites des règles de tournoi (QA D2)", () => {
  it("rankingProblem : bornes exactes et ordre des contrôles", () => {
    const none = { played: false, gameWin: null };
    expect(rankingProblem(4, 4, none)).toBeNull();
    expect(rankingProblem(5, 4, none)).toBe("Au plus 4e sur 4 joueurs.");
    expect(rankingProblem(1.5, 27, none)).toBe("La place va de 1 au nombre de joueurs.");
    expect(rankingProblem(-1, 27, none)).toBe("La place va de 1 au nombre de joueurs.");
    // Finale jouée sans GW : 1 reste permis, 5 aussi, 6 non.
    expect(rankingProblem(1, 27, { played: true, gameWin: false })).toBeNull();
    expect(rankingProblem(5, 27, { played: true, gameWin: null })).toBeNull();
    expect(rankingProblem(6, 27, { played: true, gameWin: null })).toBe("Finaliste : votre place va de 1 à 5.");
    // Nombre de joueurs inconnu : seule la règle de finale s'applique.
    expect(rankingProblem(6, null, { played: true, gameWin: false })).toBe("Finaliste : votre place va de 1 à 5.");
    expect(rankingProblem(40, null, { played: false, gameWin: null })).toBeNull();
  });

  it("withTier / withPolicy : le multi-deck est refusé aux trois championnats, accepté en standard", () => {
    const base = { ...draftOf(undefined, "2026-10-25"), deckPolicy: "multi" as const, finalDeckRule: "free_choice" as const };
    for (const tier of ["national_championship", "grand_prix", "continental_championship"] as const) {
      const d = withTier(base, tier);
      expect(d).toMatchObject({ deckPolicy: "mono", finalDeckRule: null, eventTier: tier });
      expect(withPolicy(d, "multi")).toBe(d);
    }
    expect(withTier(base, "standard")).toMatchObject({ deckPolicy: "multi", finalDeckRule: "free_choice" });
    expect(withPolicy(base, "mono")).toMatchObject({ deckPolicy: "mono", finalDeckRule: null });
  });

  it("bestRoundOf : GW avant VP, égalité parfaite -> la première ronde, decks hors liste exclus", () => {
    const rounds = [g(1, "id:1", 4, false), g(2, "id:2", 2, true), g(3, "id:3", 2, true)];
    expect(bestRoundOf(rounds, null)?.roundNumber).toBe(2);
    expect(bestRoundOf(rounds, ["id:1"])?.roundNumber).toBe(1);
    expect(bestRoundOf(rounds, ["id:9"])).toBeNull();
    expect(bestRoundOf([g(1, "id:1", null, null), g(2, "id:1", 0.5, null)], null)?.roundNumber).toBe(2);
  });

  it("tournamentInProgress : le plus récent de la liste l'emporte, un classé est ignoré, minuit local", () => {
    const now = new Date(2026, 9, 25, 0, 5);
    const list = [t({ key: "a", startDate: "2026-10-25", myRanking: 2 }), t({ key: "b", startDate: "2026-10-24" })];
    expect(tournamentInProgress(list, now)?.key).toBe("b");
    expect(tournamentInProgress([t({ startDate: "2026-10-23" })], new Date(2026, 9, 25, 23, 59))).toBeNull();
    expect(tournamentInProgress([t({ startDate: "pas-une-date" })], now)).toBeNull();
  });

  it("après la finale, aucune ronde de plus n'est proposée, que round_count soit inconnu ou connu", () => {
    const withFinal: TournamentRounds = { preliminaries: [g(1, "id:1", 3, false)], final: g(null, "id:1", 2, false) };
    for (const roundCount of [null, 1, 4]) {
      const tournament = t({ roundCount });
      expect(nextRoundOf(tournament, withFinal)).toBeNull();
      expect(canAddRound(tournament, withFinal)).toBeNull();
    }
  });

  it("rankingProblem : pas d'ordinal à un seul joueur", () => {
    const none = { played: false, gameWin: null };
    expect(rankingProblem(2, 1, none)).toBe("Avec un seul joueur, la place ne peut être que la première.");
    expect(rankingProblem(4, 3, none)).toBe("Au plus 3e sur 3 joueurs.");
    expect(rankingProblem(1, 1, none)).toBeNull();
  });

  it("roundCountEffect : pas d'effet jusqu'à la plus haute ronde, conversion à N − 1, refus au-delà ou avec une finale", () => {
    const three: TournamentRounds = {
      preliminaries: [g(1, "id:1", 1, false), g(2, "id:1", 2, false), g(3, "id:1", 3, true)],
      final: null,
    };
    expect(highestRound(three)).toBe(3);
    expect(highestRound({ preliminaries: [], final: null })).toBe(0);
    expect(roundCountEffect(null, three)).toEqual({ kind: "none" });
    expect(roundCountEffect(3, three)).toEqual({ kind: "none" });
    expect(roundCountEffect(5, three)).toEqual({ kind: "none" });
    expect(roundCountEffect(2, three)).toMatchObject({ kind: "convert", round: 3, game: { roundNumber: 3 } });
    const refusal = {
      kind: "refuse",
      message: "La ronde 3 est déjà saisie : le tournoi ne peut pas compter moins de 3 ronde(s).",
    };
    expect(roundCountEffect(1, three)).toEqual(refusal);
    const withFinal = { ...three, final: g(null, "id:1", 2, false) };
    expect(roundCountEffect(2, withFinal)).toEqual(refusal);
    expect(roundCountEffect(3, withFinal)).toEqual({ kind: "none" });
  });

  it("duplicateName : replié comme fold_text, soi-même exclu, espaces de bord ignorés", () => {
    const others = [{ key: "p:1", name: "Élodie " }, { key: "p:2", name: "Moi" }];
    expect(duplicateName("  elodie", others, "p:9")).toBe(true);
    expect(duplicateName("ÉLODIE", others, "p:1")).toBe(false);
    expect(duplicateName("Zoé", others, "p:9")).toBe(false);
  });
});
