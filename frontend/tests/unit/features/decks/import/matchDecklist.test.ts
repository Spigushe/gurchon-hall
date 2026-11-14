import { describe, expect, it } from "vitest";
import {
  buildCardIndex,
  cryptGroup,
  cryptGroupsLegal,
  minifyName,
} from "../../../../../src/features/decks/import/cardIndex";
import { matchDecklist, resolveReprintedVampires } from "../../../../../src/features/decks/import/matchDecklist";
import { indexOf, MATCH_CASES, toImportCard, toParsedLine } from "./vdbFixtures";

// Lot 9, P4 et A2 : table de cas commune de l'appariement (`vdb-import-cases.json`).

describe("minifyName, table de cas", () => {
  it.each(MATCH_CASES.minify)("$input → $expected", ({ input, expected }) => {
    expect(minifyName(input)).toBe(expected);
  });

  it("donne la même clé au nom du catalogue et à ses écritures de VDB", () => {
    for (const card of MATCH_CASES.catalog) expect(minifyName(card.name)).toMatch(/^[a-z0-9]+$/);
  });
});

describe("matchDecklist, table de cas", () => {
  const index = indexOf(MATCH_CASES.catalog);

  it.each(MATCH_CASES.cases)("$name", ({ lines, expected }) => {
    const result = matchDecklist(lines.map(toParsedLine), index);
    expect(result.resolved.map((line) => ({ line: line.line, vekn_id: line.card.veknId, by: line.by }))).toEqual(
      expected.resolved,
    );
    expect(result.cards.map((card) => ({ vekn_id: card.card.veknId, quantity: card.quantity }))).toEqual(
      expected.cards,
    );
    expect(result.unmatched.map((line) => ({ line: line.line, reason: line.reason }))).toEqual(expected.unmatched);
  });

  it("couvre les quatre façons de trouver une carte et les trois motifs de refus", () => {
    const by = new Set(MATCH_CASES.cases.flatMap((item) => item.expected.resolved.map((line) => line.by)));
    const reasons = new Set(MATCH_CASES.cases.flatMap((item) => item.expected.unmatched.map((line) => line.reason)));
    expect([...by].sort()).toEqual(["assumed", "deduced", "name", "vekn_id"]);
    expect([...reasons].sort()).toEqual(["no_such_version", "unknown_name", "unknown_vekn_id"]);
  });

  it("rend les autres versions d'un groupe déduit ou d'une version supposée", () => {
    const result = matchDecklist(
      MATCH_CASES.cases.find((item) => item.name === "version supposée : vampire réimprimé seul en crypte")!.lines.map(
        toParsedLine,
      ),
      index,
    );
    const theo = result.resolved.find((line) => line.by === "assumed")!;
    expect(theo.card.veknId).toBe(201362);
    expect(theo.alternatives.map((card) => card.veknId)).toEqual([201613]);
    expect(result.resolved.find((line) => line.by === "name")!.alternatives).toEqual([]);
  });

  it("garde le texte d'origine des lignes rendues et des lignes non reconnues", () => {
    const result = matchDecklist(
      [toParsedLine({ line: 4, quantity: 2, name: "Carte inventée" }), toParsedLine({ line: 5, quantity: 1, vekn_id: 101945 })],
      index,
    );
    expect(result.unmatched).toEqual([{ line: 4, text: "2x Carte inventée", reason: "unknown_name" }]);
    expect(result.resolved[0]).toMatchObject({ line: 5, text: "101945=1", quantity: 1 });
  });
});

describe("règle des groupes de crypte", () => {
  it.each([
    [[], true],
    [[3], true],
    [[2, 3], true],
    [[3, 2, 3], true],
    [[2, 4], false],
    [[1, 2, 3], false],
    [[6, 7], true],
  ] as const)("%j → %s", (groups, legal) => {
    expect(cryptGroupsLegal(groups)).toBe(legal);
  });

  it("tient « Any », une valeur absente ou inattendue pour neutres", () => {
    expect([cryptGroup("G4"), cryptGroup("Any"), cryptGroup(null), cryptGroup("G")]).toEqual([4, null, null, null]);
  });
});

describe("resolveReprintedVampires", () => {
  const cards = new Map(MATCH_CASES.catalog.map((card) => [card.vekn_id, toImportCard(card)]));
  const card = (veknId: number) => cards.get(veknId)!;

  it("déduit tous les noms qu'une crypte connue fixe", () => {
    // Anson (G1) : Gilbert Duane ne tient qu'en G1, Kalinda qu'en G2.
    const choices = resolveReprintedVampires(
      [card(200107)],
      new Map([
        ["gilbertduane", [card(200517), card(201617)]],
        ["kalinda", [card(200745), card(201596)]],
      ]),
    );
    expect(choices.get("gilbertduane")).toEqual({ card: card(200517), by: "deduced" });
    expect(choices.get("kalinda")).toEqual({ card: card(200745), by: "deduced" });
  });

  it("tranche nom par nom : l'un déduit, l'autre supposé", () => {
    // Cartes synthétiques : A en G2 ou G6, B en G5 ou G6. Seules (G6, G5) et
    // (G6, G6) sont légales : A est déduit, B reste ouvert, donc supposé.
    const synthetic = (veknId: number, groupCode: string) => ({
      ...toImportCard({ vekn_id: veknId, name: "x", category: "crypt", group: groupCode, advanced: false }),
    });
    const choices = resolveReprintedVampires(
      [],
      new Map([
        ["a", [synthetic(1, "G2"), synthetic(2, "G6")]],
        ["b", [synthetic(3, "G5"), synthetic(4, "G6")]],
      ]),
    );
    expect(choices.get("a")).toMatchObject({ card: { veknId: 2 }, by: "deduced" });
    expect(choices.get("b")).toMatchObject({ card: { veknId: 3 }, by: "assumed" });
  });

  it("suppose la version d'origine quand les combinaisons se contredisent", () => {
    const choices = resolveReprintedVampires([], new Map([["theobell", [card(201362), card(201613)]]]));
    expect(choices.get("theobell")).toEqual({ card: card(201362), by: "assumed" });
  });

  it("au-delà du plafond de combinaisons, suppose sans chercher", () => {
    const pair = [card(201362), card(201613)];
    const many = new Map(Array.from({ length: 13 }, (_, index) => [`nom${index}`, pair] as const));
    const choices = resolveReprintedVampires([card(201375)], many);
    expect([...choices.values()].every((choice) => choice.by === "assumed")).toBe(true);
  });

  it("un index vide ne trouve rien", () => {
    expect(matchDecklist([toParsedLine({ line: 1, quantity: 1, name: "Theo Bell" })], buildCardIndex([])).unmatched).toEqual([
      { line: 1, text: "1x Theo Bell", reason: "unknown_name" },
    ]);
  });
});
