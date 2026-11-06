import { describe, expect, it } from "vitest";
import {
  clanGlyph,
  costGlyph,
  disciplineGlyph,
  disciplineLabel,
  isSingleLevel,
  textIcon,
  typeGlyph,
} from "../../../../src/features/search/glyphs";
import { costLabel, legalityText } from "../../../../src/features/search/searchFormat";
import { buildSearchOptions } from "../../../../src/features/search/searchOptions";
import { buildSearchCatalog, NON_TITLED, NOT_REQUIRED, REFLEX_TYPE, REQUIRES_TITLED } from "../../../../src/offline/vtes";
import { SEARCH_CATALOG } from "../../offline/fixtures/searchCases";
import { mirrorRows } from "../../offline/fixtures/syntheticCatalog";

const NAMES: Record<string, string> = { pot: "Potence", tem: "Temporis" };
const name = (code: string) => NAMES[code] ?? code;

describe("table des glyphes krcg", () => {
  it("minuscule pour l'inférieure, majuscule pour la supérieure, sauf Temporis et Obtenebration", () => {
    expect(disciplineGlyph("pot")).toEqual({ font: "ankha", char: "p" });
    expect(disciplineGlyph("POT", true)).toEqual({ font: "ankha", char: "P" });
    expect(disciplineGlyph("tem", true)?.char).toBe("!");
    expect(disciplineGlyph("obt", true)?.char).toBe("£");
    // Absents de la table du handoff, relus sur la police (D1c).
    expect(disciplineGlyph("obl")?.char).toBe("ø");
    expect(disciplineGlyph("str", true)?.char).toBe("á");
    expect(disciplineGlyph("mal")?.char).toBe("â");
    expect(disciplineGlyph("inconnue")).toBeNull();
  });

  it("types, coûts et clans", () => {
    expect(typeGlyph("Action Modifier")?.char).toBe("1");
    expect(typeGlyph("Master")).toBeNull();
    expect(costGlyph("blood", "2")?.char).toBe(";");
    expect(costGlyph("pool", "x")?.char).toBe("_");
    expect(costGlyph("pool", "4")?.char).toBe("\\");
    expect(costGlyph("conviction", "1")).toBeNull();
    expect(costGlyph("blood", null)).toBeNull();
    expect(costGlyph("blood", "9")).toBeNull();
    expect(clanGlyph("Ventrue")).toEqual({ font: "clans", char: "v" });
    expect(clanGlyph("Hecata")).toBeNull();
    expect(clanGlyph(null)).toBeNull();
  });

  it("nomme chaque icône pour un lecteur d'écran", () => {
    expect(disciplineLabel("Potence", true, "pot")).toBe("Potence supérieure");
    expect(disciplineLabel("Potence", false)).toBe("Potence inférieure");
    expect(disciplineLabel("Defense", false, "def")).toBe("Defense");
    expect(isSingleLevel("fli")).toBe(true);
    expect(isSingleLevel("dom")).toBe(false);
  });

  it("lit les jetons du texte de carte", () => {
    expect(textIcon("POT", name)).toEqual({ glyph: { font: "ankha", char: "P" }, label: "Potence supérieure" });
    expect(textIcon("tem", name)?.label).toBe("Temporis inférieure");
    expect(textIcon("MERGED", name)?.glyph.char).toBe("µ");
    expect(textIcon("FLIGHT", name)?.label).toBe("Flight");
    expect(textIcon("2 CONVICTION", name)?.label).toBe("2 conviction");
    expect(textIcon("ACTION MODIFIER", name)).toEqual({ glyph: { font: "ankha", char: "1" }, label: "Action Modifier" });
    expect(textIcon("D", name)).toBeNull();
  });
});

describe("libellés de la fiche", () => {
  const rows = mirrorRows(SEARCH_CATALOG);
  const catalog = buildSearchCatalog(rows.cards, rows.details);
  const byName = (cardName: string) => catalog.cards.find((item) => item.card.name === cardName)!;

  it("légalité du jour, « inconnue » sans détails", () => {
    expect(legalityText(byName("Banned Master"), "2026-11-05")).toEqual({ label: "Bannie", kind: "banned" });
    expect(legalityText(byName("Future Master"), "2026-11-05")).toEqual({ label: "Légale le 01/01/2027", kind: "soon" });
    expect(legalityText(byName("Plain Master"), "2026-11-05").kind).toBe("legal");
    expect(legalityText({ ...byName("Plain Master"), details: null }, "2026-11-05").kind).toBe("unknown");
  });

  it("coût en clair", () => {
    expect(costLabel("blood", "2")).toBe("2 sang");
    expect(costLabel("conviction", "1")).toBe("1 conviction");
    expect(costLabel(null, null)).toBe("aucun");
  });
});

describe("valeurs proposées par les filtres", () => {
  const { cards, details } = mirrorRows(SEARCH_CATALOG);
  const options = buildSearchOptions(buildSearchCatalog(cards, details));

  it("lit disciplines, vertus, clans, types et titres dans le catalogue", () => {
    expect(options.cryptDisciplines.map((option) => option.code)).toContain("tha");
    expect(options.cryptDisciplines.map((option) => option.code)).not.toContain("def");
    expect(options.virtues.map((option) => option.code)).toEqual(["def", "ven"]);
    expect(options.libraryDisciplines.map((option) => option.code)).toContain("vic");
    expect(options.cryptClans).toContain("Tremere");
    expect(options.libraryClans[0]).toBe(NOT_REQUIRED);
    expect(options.types).toContain(REFLEX_TYPE);
    expect(options.sects.slice(0, 2)).toEqual(["Camarilla", "Sabbat"]);
    expect(options.groups).not.toContain("Any");
    expect(options.cryptTitles.at(-1)).toBe(NON_TITLED);
    expect(options.cryptTitles.indexOf("Prince")).toBeLessThan(options.cryptTitles.indexOf("Cardinal"));
    expect(options.libraryTitles[0]).toBe(REQUIRES_TITLED);
    expect(options.disciplineName("dom")).toBe("Dominate");
    expect(options.disciplineName("zzz")).toBe("zzz");
  });

  it("sans catalogue, des listes vides plutôt qu'une erreur", () => {
    const empty = buildSearchOptions(undefined);
    expect(empty.cryptDisciplines).toEqual([]);
    expect(empty.types).toEqual([]);
    expect(empty.libraryClans).toEqual([NOT_REQUIRED]);
  });
});
