import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { cardLegality, isCardLegal, todayUtc } from "../../../src/offline/vtes/cardLegality";

/**
 * Lot Chercher, A5 et C1b : jumelle TypeScript de `card_legality`, sur la table
 * de cas commune avec pytest (`backend/tests/fixtures/card_legality_cases.json`).
 */

interface LegalityCase {
  description: string;
  banned_on: string | null;
  legal_from: string | null;
  on: string;
  expected: { banned: boolean; not_yet_legal: boolean };
}

const table = JSON.parse(
  readFileSync(resolve(__dirname, "../../../../backend/tests/fixtures/card_legality_cases.json"), "utf-8"),
) as { cases: LegalityCase[] };

describe("cardLegality, table commune avec le serveur", () => {
  it.each(table.cases.map((c) => [c.description, c] as const))("%s", (_, c) => {
    expect(cardLegality(c.banned_on, c.legal_from, c.on)).toEqual({
      banned: c.expected.banned,
      notYetLegal: c.expected.not_yet_legal,
    });
  });

  it("contient au moins un cas par combinaison de résultats", () => {
    const seen = new Set(table.cases.map((c) => `${c.expected.banned}/${c.expected.not_yet_legal}`));
    expect([...seen].sort()).toEqual(["false/false", "false/true", "true/false", "true/true"]);
  });

  it("Playing for Keeps est bannie et pas encore légale entre ses deux dates", () => {
    const legality = cardLegality("1995-11-01", "1996-01-14", "1995-12-25");
    expect(legality).toEqual({ banned: true, notYetLegal: true });
    expect(isCardLegal(legality)).toBe(false);
    expect(isCardLegal(cardLegality(null, "1996-01-14", "1996-01-14"))).toBe(true);
  });
});

describe("todayUtc", () => {
  it("rend la date UTC, pas la date locale, autour de minuit", () => {
    // 23 h 30 à Paris le 31 décembre = 22 h 30 UTC, encore le 31.
    expect(todayUtc(new Date("2026-12-31T23:30:00+01:00"))).toBe("2026-12-31");
    // 0 h 30 à Paris le 1er janvier = 23 h 30 UTC le 31 décembre.
    expect(todayUtc(new Date("2027-01-01T00:30:00+01:00"))).toBe("2026-12-31");
    // 1 h 30 à Paris le 1er janvier = 0 h 30 UTC le 1er.
    expect(todayUtc(new Date("2027-01-01T01:30:00+01:00"))).toBe("2027-01-01");
  });

  it("une carte légale à partir du lendemain UTC ne l'est pas encore à 23 h 59 UTC", () => {
    const on = todayUtc(new Date("2026-11-05T23:59:59Z"));
    expect(cardLegality(null, "2026-11-06", on).notYetLegal).toBe(true);
    expect(cardLegality(null, "2026-11-06", todayUtc(new Date("2026-11-06T00:00:00Z"))).notYetLegal).toBe(false);
  });
});
