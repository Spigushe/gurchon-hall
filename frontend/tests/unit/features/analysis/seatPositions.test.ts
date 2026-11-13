import { describe, expect, it } from "vitest";
import {
  isNearPosition,
  positionLabel,
  positionsOfSeat,
  preyPredatorHint,
  seatPositions,
  type SeatPositions,
} from "../../../../src/features/analysis/analysisModel";

/**
 * Table de cas des positions à la table (A7 du Lot 8, P7 et P8) : tables de
 * deux à six, siège absent ou hors table, siège d'en face à quatre et à six.
 * Côté client seulement, le serveur ne calcule aucune position (P9).
 */
const CASES: Array<{ seat: number | null; players: number; expected: SeatPositions }> = [
  // À deux, proie et prédateur sont le même adversaire ; pas de grande position.
  { seat: 1, players: 2, expected: { prey: 2, predator: 2, grandPrey: null, grandPredator: null } },
  { seat: 2, players: 2, expected: { prey: 1, predator: 1, grandPrey: null, grandPredator: null } },
  // À trois, n + 2 est mon prédateur : pas de grande position.
  { seat: 1, players: 3, expected: { prey: 2, predator: 3, grandPrey: null, grandPredator: null } },
  { seat: 3, players: 3, expected: { prey: 1, predator: 2, grandPrey: null, grandPredator: null } },
  // À quatre, le siège d'en face est grande proie et grand prédateur.
  { seat: 1, players: 4, expected: { prey: 2, predator: 4, grandPrey: 3, grandPredator: 3 } },
  { seat: 4, players: 4, expected: { prey: 1, predator: 3, grandPrey: 2, grandPredator: 2 } },
  // À cinq, les quatre adversaires ont chacun une position.
  { seat: 2, players: 5, expected: { prey: 3, predator: 1, grandPrey: 4, grandPredator: 5 } },
  { seat: 5, players: 5, expected: { prey: 1, predator: 4, grandPrey: 2, grandPredator: 3 } },
  // À six, le siège d'en face (n + 3) n'a aucune position.
  { seat: 1, players: 6, expected: { prey: 2, predator: 6, grandPrey: 3, grandPredator: 5 } },
  { seat: 6, players: 6, expected: { prey: 1, predator: 5, grandPrey: 2, grandPredator: 4 } },
  // Sans siège, ou hors de la table : aucune position.
  { seat: null, players: 5, expected: { prey: null, predator: null, grandPrey: null, grandPredator: null } },
  { seat: 6, players: 5, expected: { prey: null, predator: null, grandPrey: null, grandPredator: null } },
  { seat: 0, players: 5, expected: { prey: null, predator: null, grandPrey: null, grandPredator: null } },
];

describe("seatPositions (table de cas)", () => {
  it.each(CASES)("siège $seat à $players joueurs", ({ seat, players, expected }) => {
    expect(seatPositions(seat, players)).toEqual(expected);
  });
});

describe("positionsOfSeat", () => {
  it("nomme la position d'un siège par rapport au mien, dans l'ordre d'affichage", () => {
    expect(positionsOfSeat(2, 5, 3)).toEqual(["prey"]);
    expect(positionsOfSeat(2, 5, 1)).toEqual(["predator"]);
    expect(positionsOfSeat(2, 5, 4)).toEqual(["grandPrey"]);
    expect(positionsOfSeat(2, 5, 5)).toEqual(["grandPredator"]);
  });

  it("compte des deux côtés à deux et à quatre joueurs, rien pour le siège d'en face à six", () => {
    expect(positionsOfSeat(1, 2, 2)).toEqual(["prey", "predator"]);
    expect(positionsOfSeat(1, 4, 3)).toEqual(["grandPrey", "grandPredator"]);
    expect(positionsOfSeat(1, 6, 4)).toEqual([]);
  });

  it("ne dit rien sans mon siège, sans le sien, ou pour mon propre siège", () => {
    expect(positionsOfSeat(null, 5, 3)).toEqual([]);
    expect(positionsOfSeat(2, 5, null)).toEqual([]);
    expect(positionsOfSeat(2, 5, 2)).toEqual([]);
  });
});

describe("libellés et aide", () => {
  it("joint les positions et distingue les proches des éloignées", () => {
    expect(positionLabel(["prey"])).toBe("proie");
    expect(positionLabel(["grandPrey", "grandPredator"])).toBe("grande proie et grand prédateur");
    expect(positionLabel([])).toBeNull();
    expect(isNearPosition(["prey", "predator"])).toBe(true);
    expect(isNearPosition(["grandPredator"])).toBe(false);
  });

  it("donne l'aide de la saisie dès que mon siège est connu (1b-48)", () => {
    expect(preyPredatorHint(2, 5)).toBe("Votre proie : siège 3 · Votre prédateur : siège 1");
    expect(preyPredatorHint(1, 2)).toBe("Votre proie et votre prédateur : siège 2");
    expect(preyPredatorHint(null, 5)).toBeNull();
  });
});
