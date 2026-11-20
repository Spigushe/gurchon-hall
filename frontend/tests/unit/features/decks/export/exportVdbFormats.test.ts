import { describe, expect, it } from "vitest";
import type { DeckCardFacts } from "../../../../../src/features/decks/deckTablesModel";
import { exportAs, EXPORT_FORMATS, exportFormatInfo, isExportFormat } from "../../../../../src/features/decks/export/exportFormats";
import { exportVdbJol } from "../../../../../src/features/decks/export/exportVdbJol";
import { exportVdbLackey, lackeyName } from "../../../../../src/features/decks/export/exportVdbLackey";
import { exportVdbText } from "../../../../../src/features/decks/export/exportVdbText";
import { exportVdbTwd, twdEventHeader } from "../../../../../src/features/decks/export/exportVdbTwd";
import type { LocalDeckCard } from "../../../../../src/offline/vtes";
import { crypt, library, mirrorRows, type CardSearchItem } from "../../../offline/fixtures/syntheticCatalog";
import { readFixture } from "../import/vdbFixtures";

// Lot 13, D1 (P9, A11) : exports TWD, JOL et LACKEY, comparés à l'octet près aux exports réels de
// `tests/fixtures/vdb/`. Le deck de chaque fixture est reconstitué depuis son export `TEXT`, qui
// porte la capacité, les disciplines, le titre, le clan, le groupe et le type de chaque carte.

const normalized = (text: string) => text.replace(/\r\n/g, "\n");
const fixture = (path: string) => normalized(readFixture(path));

interface Entry {
  item: CardSearchItem;
  quantity: number;
}

const TRIFLE_TEXT = "Trifle. Put this card on a vampire you control.";
/** Les masters à mot-clé « trifle » des deux decks de référence (l'export `TEXT` ne les nomme pas). */
const TRIFLES = new Set(["Villein", "Vessel"]);

const CRYPT_LINE = /^(\d+)x (.+?) +(\d+) ((?:[A-Za-z]{3} ?)*) *(?:([a-z]+(?: [a-z]+)?) +)?([A-Z][^:]*):(\w+)$/;

function entriesFromText(path: string): Entry[] {
  const lines = fixture(path).split("\n");
  const entries: Entry[] = [];
  let id = 1;
  let section: "crypt" | "library" | null = null;
  let types: string[] = [];
  for (const line of lines) {
    if (line.startsWith("Crypt (")) section = "crypt";
    else if (line.startsWith("Library (")) section = "library";
    else if (section === "crypt") {
      const match = CRYPT_LINE.exec(line);
      if (!match) continue;
      const [, quantity, rawName, capacity, disciplines, title, clan, group] = match;
      const advanced = rawName.endsWith(" (ADV)");
      entries.push({
        item: crypt({
          id: id++,
          name: advanced ? rawName.slice(0, -6) : rawName,
          advanced,
          capacity: Number(capacity),
          disciplines: disciplines.trim() === "" ? [] : disciplines.trim().split(" "),
          title: title ?? null,
          clan,
          group: group === "ANY" ? "Any" : `G${group}`,
        }),
        quantity: Number(quantity),
      });
    } else if (section === "library") {
      const heading = /^([A-Za-z /]+) \(\d+(?:; \d+ trifle)?\)$/.exec(line);
      const card = /^(\d+)x (.+)$/.exec(line);
      if (heading) types = heading[1].split("/");
      else if (card) {
        const name = card[2].replace(/^(.+), The$/, "The $1");
        entries.push({
          item: library({ id: id++, name, types, text: TRIFLES.has(name) ? TRIFLE_TEXT : null }),
          quantity: Number(card[1]),
        });
      }
    }
  }
  return entries;
}

function deckOf(entries: Entry[]): { lines: LocalDeckCard[]; facts: Map<number, DeckCardFacts> } {
  const { cards, details } = mirrorRows(entries.map((entry) => entry.item));
  const facts = new Map(cards.map((card, index) => [card.id, { card, details: details[index] }]));
  const lines = entries.map(({ item, quantity }) => ({
    cardId: item.id,
    languageCode: "EN",
    cardSetId: 1,
    quantity,
    proxyQuantity: quantity,
    cardName: null,
    pending: false,
  }));
  return { lines, facts };
}

const DECKS = [
  { id: "ref", name: "Guns and shit (mostly guns)", text: "vdb/ref-text.txt" },
  { id: "difficile", name: "Brujah Trophy Hunter (29-08-2009)", text: "vdb/difficile-text.txt" },
] as const;

describe.each(DECKS)("exports de $id comparés aux fixtures VDB", ({ id, name, text }) => {
  const { lines, facts } = deckOf(entriesFromText(text));

  it("TEXT : la reconstitution est fidèle (garde-fou des trois autres)", () => {
    // Les descriptions de VDB ne sont pas reprises : on compare de la crypte à la fin.
    const from = (value: string) => value.slice(value.indexOf("Crypt ("));
    expect(from(exportVdbText({ name, lines, facts }))).toBe(from(fixture(text)));
  });

  it("TWD : reproduit l'export réel, aux deux écarts voulus près (crypte par capacité, pas de [Format])", () => {
    // Écarts volontaires à VDB (décisions du 2026-11-20) : la fixture range la crypte par quantité puis
    // nom et écrit `[Format]` ; l'attendu en dérive, crypte reprise dans l'ordre du `TEXT` (capacité).
    const real = fixture(`vdb/${id}-twd.txt`).split("\n");
    const start = real.findIndex((line) => line.startsWith("Crypt ("));
    const end = real.indexOf("", start);
    const textLines = fixture(text).split("\n");
    const textStart = textLines.findIndex((line) => line.startsWith("Crypt ("));
    const cryptByCapacity = textLines.slice(textStart + 2, textStart + 2 + (end - start - 2));
    const expected = [...real.slice(0, start + 2), ...cryptByCapacity, ...real.slice(end)]
      .filter((line) => line !== "[Format]")
      .join("\n");
    expect(exportVdbTwd({ name, lines, facts })).toBe(expected);
  });

  it("JOL : reproduit l'export réel", () => {
    expect(exportVdbJol({ name, lines, facts })).toBe(fixture(`vdb/${id}-jol.txt`));
  });

  it("LACKEY : reproduit l'export réel", () => {
    expect(exportVdbLackey({ name, lines, facts })).toBe(fixture(`vdb/${id}-lackey.txt`));
  });
});

describe("en-tête du TWD", () => {
  const { lines, facts } = deckOf(entriesFromText("vdb/ref-text.txt"));

  it("garde les crochets sans événement", () => {
    expect(twdEventHeader(null)).toEqual([
      "[Event Name]",
      "[Location]",
      "[Date]",
      "[Players]",
      "[Winner]",
      "[Event Link]",
    ]);
    expect(twdEventHeader(undefined)).toEqual(twdEventHeader(null));
  });

  it("remplit nom, lieu, date et joueurs, le reste garde son gabarit, sans ligne [Format]", () => {
    const text = exportVdbTwd({
      name: "Guns v2",
      lines,
      facts,
      event: { name: "R&D Paris", location: "Chez Marc, Paris", date: "2026-01-25", players: 13 },
    });
    expect(text.split("\n").slice(0, 10)).toEqual([
      "R&D Paris",
      "Chez Marc, Paris",
      "2026-01-25",
      "13",
      "[Winner]",
      "[Event Link]",
      "",
      "-- [Scores]",
      "",
      "Deck Name: Guns v2",
    ]);
  });

  it("garde le gabarit d'un champ non saisi ou blanc", () => {
    expect(twdEventHeader({ name: "Tournoi", location: null, date: "2026-01-25", players: null })).toEqual([
      "Tournoi",
      "[Location]",
      "2026-01-25",
      "[Players]",
      "[Winner]",
      "[Event Link]",
    ]);
    expect(twdEventHeader({ name: "  ", location: "", date: "2026-01-25", players: 0 })[0]).toBe("[Event Name]");
  });
});

describe("cas limites des formats", () => {
  it("LACKEY seul passe en ASCII ; ni JOL ni LACKEY n'écrivent (G6)", () => {
    const { lines, facts } = deckOf([
      { item: crypt({ id: 1, name: "Theo Bell", group: "G6", clan: "Brujah", capacity: 7 }), quantity: 2 },
      { item: library({ id: 2, name: "Sacré-Cœur Cathedral, France", types: ["Master"] }), quantity: 1 },
      { item: library({ id: 3, name: "Rock/Paper", types: ["Action"] }), quantity: 12 },
    ]);
    const input = { name: "x", lines, facts, reprinted: new Set([1]) };
    expect(exportVdbLackey(input)).toBe(
      ["12      RockPaper", "1       Sacre-Coeur Cathedral, France", "Crypt:", "2       Theo Bell", ""].join("\n"),
    );
    expect(exportVdbJol(input)).toBe("2xTheo Bell\n12xRock/Paper\n1xSacré-Cœur Cathedral, France\n");
    expect(exportVdbText(input)).toContain("(G6)");
    expect(exportVdbTwd(input)).toContain("(G6)");
  });

  it("une liste vide donne des textes valides", () => {
    const input = { name: "Vide", lines: [], facts: new Map() };
    expect(exportVdbJol(input)).toBe("");
    expect(exportVdbLackey(input)).toBe("Crypt:\n");
    expect(exportVdbTwd(input)).toContain("Crypt (0 cards, min=0 max=0 avg=0)");
  });

  it("lackeyName transcrit les lettres étendues", () => {
    expect(lackeyName("Łódź Ørsted Œuvre Æon Straße")).toBe("Lodz Orsted Oeuvre Aeon Strasse");
    expect(lackeyName("Ni/Non")).toBe("NiNon");
    expect(lackeyName("日本")).toBe("");
  });

  it("exportAs et le registre des formats", () => {
    const input = { name: "Vide", lines: [], facts: new Map() };
    expect(EXPORT_FORMATS.map((format) => format.id)).toEqual(["text", "twd", "jol", "lackey"]);
    expect(exportAs("text", input)).toBe(exportVdbText(input));
    expect(exportAs("jol", input)).toBe(exportVdbJol(input));
    expect(exportFormatInfo("lackey").fileSuffix).toBe("LACKEY");
    expect(exportFormatInfo("text").fileSuffix).toBeNull();
    expect(isExportFormat("twd")).toBe(true);
    expect(isExportFormat("xlsx")).toBe(false);
  });
});
