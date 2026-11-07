import { describe, expect, it } from "vitest";
import { illegalReason, legalityTag } from "../../../../src/features/decks/legalityTagModel";
import type { DeckLegality } from "../../../../src/features/decks/useDeckLegality";

const card = (id: number) => ({ id, name: `Carte ${id}`, category: "library" as const, group_code: null, advanced: false });

const LEGAL: DeckLegality = {
  deck_id: 1,
  evaluated_on: "2026-11-06",
  crypt_count: 12,
  library_count: 80,
  crypt_minimum: 12,
  library_minimum: 60,
  library_maximum: 90,
  crypt_groups: ["G5", "G6"],
  banned_cards: [],
  not_yet_legal_cards: [],
  is_legal: true,
  issues: [],
};

describe("illegalReason : premier motif, dans l'ordre des règles", () => {
  it.each<[string, Partial<DeckLegality>, string | null]>([
    ["crypte trop courte", { crypt_count: 8 }, "crypte 8/12"],
    ["bibliothèque trop courte", { library_count: 56 }, "bibliothèque 56/60"],
    ["bibliothèque trop longue", { library_count: 95 }, "bibliothèque 95/90"],
    ["trois groupes", { crypt_groups: ["G2", "G3", "G4"] }, "groupes G2, G3, G4"],
    ["une carte bannie", { banned_cards: [card(1)] }, "1 carte bannie"],
    ["deux cartes bannies", { banned_cards: [card(1), card(2)] }, "2 cartes bannies"],
    ["pas encore légale", { not_yet_legal_cards: [card(3)] }, "1 carte pas encore légale"],
    ["deux groupes non adjacents", { crypt_groups: ["G2", "G4"] }, "groupes G2, G4"],
    ["crypte courte avant tout le reste", { crypt_count: 8, banned_cards: [card(1)] }, "crypte 8/12"],
  ])("%s", (_label, patch, expected) => {
    expect(illegalReason({ ...LEGAL, ...patch, is_legal: false } as DeckLegality)).toBe(expected);
  });
});

describe("legalityTag", () => {
  const ready = (legality: DeckLegality) => ({ kind: "ready" as const, legality });

  it("deck pas encore synchronisé, hors ligne, en calcul, en erreur", () => {
    expect(legalityTag({ id: null }, true, null)).toEqual({ kind: "unknown", label: "Verdict en attente" });
    expect(legalityTag({ id: 1 }, false, null)).toEqual({ kind: "unknown", label: "Légalité hors ligne" });
    expect(legalityTag({ id: 1 }, true, null)).toEqual({ kind: "unknown", label: "Légalité…" });
    expect(legalityTag({ id: 1 }, true, { kind: "error", message: "x" })).toEqual({
      kind: "unknown",
      label: "Légalité indisponible",
    });
  });

  it("légal, illégal avec motif, illégal sans motif reconnu", () => {
    expect(legalityTag({ id: 1 }, true, ready(LEGAL))).toEqual({ kind: "legal", label: "Légal" });
    expect(legalityTag({ id: 1 }, true, ready({ ...LEGAL, is_legal: false, crypt_count: 8 }))).toEqual({
      kind: "illegal",
      label: "Illégal · crypte 8/12",
    });
    expect(legalityTag({ id: 1 }, true, ready({ ...LEGAL, is_legal: false, crypt_groups: [] }))).toEqual({
      kind: "illegal",
      label: "Illégal",
    });
  });
});
