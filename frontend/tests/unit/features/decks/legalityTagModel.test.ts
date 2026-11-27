import { describe, expect, it } from "vitest";
import { legalityTag } from "../../../../src/features/decks/legalityTagModel";
import type { DeckLegality } from "../../../../src/features/decks/useDeckLegality";

const card = (id: number): DeckLegality["banned_cards"][number] => ({
  id,
  vekn_id: 100000 + id,
  name: `Carte ${id}`,
  category: "library",
  clan: null,
  capacity: null,
  group_code: null,
  advanced: false,
  image_url: null,
});

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

  it("légal, illégal : jamais de motif dans l'étiquette", () => {
    expect(legalityTag({ id: 1 }, true, ready(LEGAL))).toEqual({ kind: "legal", label: "Légal" });
    expect(legalityTag({ id: 1 }, true, ready({ ...LEGAL, is_legal: false, crypt_count: 8 }))).toEqual({
      kind: "illegal",
      label: "Illégal",
    });
    expect(
      legalityTag({ id: 1 }, true, ready({ ...LEGAL, is_legal: false, banned_cards: [card(1)] })),
    ).toEqual({ kind: "illegal", label: "Illégal" });
  });
});
