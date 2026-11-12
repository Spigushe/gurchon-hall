import { describe, expect, it } from "vitest";
import {
  buildParticipations,
  formErrors,
  isEmptyUnnamed,
  opponentDeckSummary,
  recentClanIds,
  type GameDraft,
  type OpponentDraft,
} from "../../../../src/features/games/gameFormModel";
import type { DeckKey, LocalGame, ResourceKey } from "../../../../src/offline/vtes";

const CLANS = [
  { id: 3, name: "Brujah" },
  { id: 5, name: "Tremere" },
];

function opponent(changes: Partial<OpponentDraft> = {}): OpponentDraft {
  return { playerKey: "id:2" as ResourceKey, name: "Mikael", seat: null, deckKey: null, notes: null, ...changes };
}

function draft(opponents: OpponentDraft[]): GameDraft {
  return {
    playedAt: "2026-11-12T20:00",
    venueKey: null,
    tournamentKey: null,
    roundType: "casual",
    roundNumber: null,
    playerCount: 5,
    deckKey: null,
    seat: 2,
    vp: 0,
    gameWin: false,
    opponents,
    notes: "",
    meNotes: null,
  };
}

describe("ligne sans nom (P6, précision 2 de B1)", () => {
  const unnamed = (changes: Partial<OpponentDraft> = {}) =>
    opponent({ playerKey: null, name: "Joueur non nommé", ...changes });

  it("doit porter un siège, un deck prêté ou un deck adverse ; des notes seules ne suffisent pas", () => {
    expect(isEmptyUnnamed(unnamed())).toBe(true);
    expect(isEmptyUnnamed(unnamed({ notes: "Grand gaillard" }))).toBe(true);
    expect(isEmptyUnnamed(unnamed({ opponentDeckName: "   " }))).toBe(true);
    expect(isEmptyUnnamed(unnamed({ seat: 3 }))).toBe(false);
    expect(isEmptyUnnamed(unnamed({ deckKey: "id:1" as DeckKey }))).toBe(false);
    expect(isEmptyUnnamed(unnamed({ opponentClanId: 5 }))).toBe(false);
    expect(isEmptyUnnamed(unnamed({ opponentDeckArchetype: "wall" }))).toBe(false);
    // Une ligne nommée n'est jamais « vide » à ce titre.
    expect(isEmptyUnnamed(opponent())).toBe(false);
  });

  it("bloque l'envoi avec l'alerte du handoff", () => {
    expect(formErrors(draft([unnamed()]))).toEqual([
      { id: "unnamed", message: "Une ligne sans nom doit porter un siège ou un deck pour être enregistrée." },
    ]);
    expect(formErrors(draft([unnamed({ seat: 3 })]))).toEqual([]);
  });

  it("part sans joueur", () => {
    const [, line] = buildParticipations(draft([unnamed({ seat: 3, opponentClanId: 5 })]));
    expect(line).toEqual({ player: null, seat: 3, opponentClanId: 5 });
  });
});

describe("deck adverse (P5)", () => {
  it("part rogné, champ par champ, seulement s'il est saisi", () => {
    const [, line] = buildParticipations(
      draft([opponent({ opponentClanId: 5, opponentDeckArchetype: "wall", opponentDeckName: "  Tremere wall  " })]),
    );
    expect(line).toEqual({
      player: "id:2",
      opponentClanId: 5,
      opponentDeckArchetype: "wall",
      opponentDeckName: "Tremere wall",
    });
    const [, empty] = buildParticipations(draft([opponent({ opponentDeckName: "" })]));
    expect(empty).toEqual({ player: "id:2" });
  });

  it("ne part jamais avec un deck prêté, déjà connu", () => {
    const [, line] = buildParticipations(
      draft([opponent({ deckKey: "id:1" as DeckKey, opponentClanId: 5, opponentDeckArchetype: "rush" })]),
    );
    expect(line).toEqual({ player: "id:2", deck: "id:1" });
  });

  it("se résume replié : clan, archétype, nom, ou « Facultatif »", () => {
    expect(opponentDeckSummary(opponent(), CLANS)).toEqual({ clan: null, text: "Facultatif" });
    expect(opponentDeckSummary(opponent({ opponentClanId: 3, opponentDeckArchetype: "rush" }), CLANS)).toEqual({
      clan: "Brujah",
      text: "Brujah · Rush",
    });
    expect(opponentDeckSummary(opponent({ opponentClanId: 99, opponentDeckName: "Mystère" }), CLANS)).toEqual({
      clan: "Clan inconnu",
      text: "Clan inconnu · Mystère",
    });
  });
});

describe("clans récents (1b-49)", () => {
  it("les trois derniers clans saisis, sans doublon, de la partie la plus récente à la plus ancienne", () => {
    const withClans = (...ids: Array<number | null>) =>
      ({ table: ids.map((id) => ({ opponentClanId: id })) }) as unknown as LocalGame;
    const games = [withClans(5, null), withClans(3, 5), withClans(7), withClans(9)];
    expect(recentClanIds(games)).toEqual([5, 3, 7]);
    expect(recentClanIds([{ table: null } as unknown as LocalGame])).toEqual([]);
  });
});
