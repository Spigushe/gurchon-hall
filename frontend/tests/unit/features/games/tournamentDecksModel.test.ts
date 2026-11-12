import { describe, expect, it } from "vitest";
import { legalityDayLabel, versionLegalityTag } from "../../../../src/features/games/tournamentDecksModel";
import type { DeckVersionLegality } from "../../../../src/features/games/useVersionLegality";

/** Pastille de légalité d'une version à la date du tournoi (Lot 8, B3, P11). */

const NOW = new Date(2026, 10, 12);

type Summary = DeckVersionLegality["banned_cards"][number];

function legality(fields: Partial<DeckVersionLegality> = {}): DeckVersionLegality {
  return {
    deck_id: 1,
    deck_version_id: 10,
    number: 2,
    evaluated_on: "2026-10-24",
    crypt_count: 12,
    library_count: 60,
    crypt_minimum: 12,
    library_minimum: 60,
    library_maximum: 90,
    crypt_groups: ["G2"],
    banned_cards: [],
    not_yet_legal_cards: [],
    is_legal: true,
    issues: [],
    ...fields,
  };
}

describe("legalityDayLabel", () => {
  it("« 24 octobre » dans l'année en cours, l'année en plus sinon", () => {
    expect(legalityDayLabel("2026-10-24", NOW)).toBe("24 octobre");
    expect(legalityDayLabel("2025-03-01", NOW)).toBe("1 mars 2025");
  });

  it("rend telle quelle une valeur qui n'est pas une date locale", () => {
    expect(legalityDayLabel("bientôt", NOW)).toBe("bientôt");
  });
});

describe("versionLegalityTag", () => {
  it("hors ligne, sans attendre de verdict", () => {
    expect(versionLegalityTag("2026-10-24", false, null, NOW)).toEqual({
      kind: "unknown",
      label: "Légalité hors ligne",
      detail: null,
    });
  });

  it("en cours de lecture, puis en erreur", () => {
    expect(versionLegalityTag("2026-10-24", true, null, NOW).label).toBe("Légalité…");
    expect(versionLegalityTag("2026-10-24", true, { kind: "error", message: "réponse 404" }, NOW)).toEqual({
      kind: "unknown",
      label: "Légalité indisponible",
      detail: null,
    });
  });

  it("légale : « Légal le 24 octobre », sans infobulle", () => {
    expect(versionLegalityTag("2026-10-24", true, { kind: "ready", legality: legality() }, NOW)).toEqual({
      kind: "legal",
      label: "Légal le 24 octobre",
      detail: null,
    });
  });

  it("illégale : le premier motif dans la pastille, tous les motifs dans l'infobulle", () => {
    const issues = ["Carte(s) bannie(s) : Sort banni.", "Carte(s) pas encore légale(s) : Sort récent."];
    const outcome = {
      kind: "ready" as const,
      legality: legality({
        is_legal: false,
        banned_cards: [{ id: 5 } as Summary],
        not_yet_legal_cards: [{ id: 6 } as Summary],
        issues,
      }),
    };
    expect(versionLegalityTag("2026-10-24", true, outcome, NOW)).toEqual({
      kind: "illegal",
      label: "Illégal le 24 octobre · 1 carte bannie",
      detail: issues.join(" "),
    });
  });

  it("illégale sans motif reconnu : la date seule, avec l'année d'un autre millésime", () => {
    const outcome = { kind: "ready" as const, legality: legality({ is_legal: false }) };
    expect(versionLegalityTag("2025-10-24", true, outcome, NOW)).toEqual({
      kind: "illegal",
      label: "Illégal le 24 octobre 2025",
      detail: null,
    });
  });
});
