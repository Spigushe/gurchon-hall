import { describe, expect, it } from "vitest";
import { noChanges, versionChanges, versionLines } from "../../../../src/features/decks/deckVersionModel";
import { frozenAtLabel, roundsPlayedLabel } from "../../../../src/features/games/tournamentDecksModel";
import type { LocalGame } from "../../../../src/offline/vtes";

const NAMES: Record<number, string> = { 1: "Blur", 2: "Parity Shift", 3: "Consanguineous Boon", 4: "Jamal", 5: "Fatima" };
const nameOf = (id: number) => NAMES[id];

describe("versionLines", () => {
  it("rend carte × quantité en lignes de deck, sans proxy ni attente", () => {
    expect(versionLines([{ cardId: 1, quantity: 4 }])).toEqual([
      { cardId: 1, languageCode: "", cardSetId: 0, quantity: 4, proxyQuantity: 0, cardName: null, pending: false },
    ]);
  });
});

describe("versionChanges", () => {
  it("entrées, sorties et quantités modifiées, par nom", () => {
    const v1 = [
      { cardId: 1, quantity: 4 },
      { cardId: 2, quantity: 5 },
      { cardId: 4, quantity: 2 },
    ];
    const v2 = [
      { cardId: 1, quantity: 4 },
      { cardId: 2, quantity: 3 },
      { cardId: 3, quantity: 2 },
      { cardId: 5, quantity: 2 },
    ];
    const changes = versionChanges(v1, v2, nameOf);
    expect(changes.entries.map((change) => [change.name, change.to])).toEqual([
      ["Consanguineous Boon", 2],
      ["Fatima", 2],
    ]);
    expect(changes.exits.map((change) => [change.name, change.from])).toEqual([["Jamal", 2]]);
    expect(changes.changed.map((change) => [change.name, change.from, change.to])).toEqual([["Parity Shift", 5, 3]]);
    expect(noChanges(changes)).toBe(false);
    expect(noChanges(versionChanges(v1, v1, nameOf))).toBe(true);
  });
});

describe("decks joués d'un tournoi", () => {
  const round = (roundType: LocalGame["roundType"], roundNumber: number | null) =>
    ({ roundType, roundNumber }) as LocalGame;

  it("« rondes 2 et 3, finale », « ronde 1 », « finale »", () => {
    expect(roundsPlayedLabel([round("preliminary", 3), round("final", null), round("preliminary", 2)])).toBe(
      "rondes 2 et 3, finale",
    );
    expect(roundsPlayedLabel([round("preliminary", 1), round("preliminary", 2), round("preliminary", 3)])).toBe(
      "rondes 1, 2 et 3",
    );
    expect(roundsPlayedLabel([round("preliminary", 1)])).toBe("ronde 1");
    expect(roundsPlayedLabel([round("final", null)])).toBe("finale");
  });

  it("« figée à la ronde 2 », « figée à la finale », rien pour une partie absente", () => {
    expect(frozenAtLabel(round("preliminary", 2))).toBe("figée à la ronde 2");
    expect(frozenAtLabel(round("final", null))).toBe("figée à la finale");
    expect(frozenAtLabel(undefined)).toBeNull();
  });
});
