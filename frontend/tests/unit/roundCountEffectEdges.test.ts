import { describe, expect, it } from "vitest";
import {
  canAddRound,
  highestRound,
  nextRoundOf,
  roundCountEffect,
  type TournamentRounds,
} from "../../src/features/games/tournamentModel";
import type { LocalGame, LocalTournament } from "../../src/offline/vtes";

const tournament = (roundCount: number | null) => ({ key: "id:1", roundCount }) as LocalTournament;
const game = (n: number | null, playedAt: string, type: "preliminary" | "final" = "preliminary") =>
  ({ roundNumber: n, roundType: type, playedAt, me: { deckKey: null, victoryPoints: null, gameWin: null } }) as unknown as LocalGame;

describe("roundCountEffect : cas limites (QA, correctif D2)", () => {
  it("une seule ronde saisie : 1 -> inconnu ne convertit rien, et 0 n'est pas une valeur du serveur", () => {
    const one: TournamentRounds = { preliminaries: [game(1, "2026-10-24T10:00:00Z")], final: null };
    expect(roundCountEffect(null, one)).toEqual({ kind: "none" });
    // Le champ ne produit jamais 0 (min = 1, schéma serveur ge=1) ; si 0 arrivait, ce serait N - 1 = 0 : conversion.
    expect(roundCountEffect(0, one)).toMatchObject({ kind: "convert", round: 1 });
  });

  it("aucune ronde saisie : aucun effet, quelle que soit la valeur", () => {
    const empty: TournamentRounds = { preliminaries: [], final: null };
    for (const count of [null, 1, 5]) expect(roundCountEffect(count, empty)).toEqual({ kind: "none" });
  });

  it("deux parties sur la plus haute ronde : la plus récente devient la finale, l'autre reste (limite signalée)", () => {
    const older = game(3, "2026-10-24T10:00:00Z");
    const newer = game(3, "2026-10-24T12:00:00Z");
    const rounds: TournamentRounds = { preliminaries: [game(1, "2026-10-24T08:00:00Z"), older, newer], final: null };
    const effect = roundCountEffect(2, rounds);
    expect(effect).toMatchObject({ kind: "convert", round: 3 });
    if (effect.kind === "convert") expect(effect.game).toBe(newer);
  });

  it("après conversion puis hausse : la finale existe, aucune ronde n'est reproposée", () => {
    const after: TournamentRounds = {
      preliminaries: [game(1, "2026-10-24T08:00:00Z"), game(2, "2026-10-24T09:00:00Z")],
      final: game(null, "2026-10-24T10:00:00Z", "final"),
    };
    expect(highestRound(after)).toBe(2);
    expect(roundCountEffect(3, after)).toEqual({ kind: "none" });
    expect(nextRoundOf(tournament(3), after)).toBeNull();
    expect(canAddRound(tournament(3), after)).toBeNull();
    expect(canAddRound(tournament(2), after)).toBeNull();
  });

  it("une préliminaire sans numéro compte pour 0 et ne déclenche rien", () => {
    const rounds: TournamentRounds = { preliminaries: [game(null, "2026-10-24T08:00:00Z")], final: null };
    expect(highestRound(rounds)).toBe(0);
    expect(roundCountEffect(1, rounds)).toEqual({ kind: "none" });
  });
});
