import { describe, expect, it } from "vitest";
import type { DeckCardFacts } from "../../../../../src/features/decks/deckTablesModel";
import {
  cryptHeader,
  exportVdbText,
  reprintedCardIds,
  vdbName,
} from "../../../../../src/features/decks/export/exportVdbText";
import { matchDecklist } from "../../../../../src/features/decks/import/matchDecklist";
import { parseDecklist } from "../../../../../src/features/decks/import/parseDecklist";
import { foldText } from "../../../../../src/offline/core/foldText";
import type { CardRow, LocalDeckCard } from "../../../../../src/offline/vtes";
import { crypt, library, mirrorRows, type CardSearchItem } from "../../../offline/fixtures/syntheticCatalog";
import { EXTRACT, apiDeck, indexOf, readFixture, type FixtureCard } from "../import/vdbFixtures";

// Lot 9, A5 : export au format `TEXT` de VDB, comparé aux exports réels de `tests/fixtures/vdb/`.

interface Entry {
  item: CardSearchItem;
  quantity: number;
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

const brujah = (id: number, name: string, capacity: number, disciplines: string[], title: string | null, group = "G6") => ({
  item: crypt({ id, name, capacity, disciplines, title, group, clan: "Brujah" }),
});

const lib = (id: number, name: string, types: string[], text: string | null = null) => ({
  item: library({ id, name, types, text }),
});

/** Le deck de référence (`ref-text.txt`), avec ses faits de carte. */
const REF: Entry[] = [
  { ...brujah(1, "Saku Pihlajamäki", 8, ["CEL", "POT", "PRE", "for", "pro"], "Baron"), quantity: 2 },
  { ...brujah(2, "Aline Gädeke", 7, ["POT", "PRE", "cel"], "Baron"), quantity: 2 },
  { ...brujah(3, "Valeriya Zinovieva", 7, ["POT", "cel", "pre", "pro"], "Baron"), quantity: 2 },
  { ...brujah(4, "Atiena", 6, ["CEL", "obf", "pot", "pre"], "Baron"), quantity: 2 },
  { ...brujah(5, "Leumeah", 6, ["PRE", "cel", "for", "pot"], "Baron"), quantity: 2 },
  { ...brujah(6, "Anita Wainwright", 3, ["cel", "pre"], null), quantity: 1 },
  { ...brujah(7, "Laura Goldman", 3, ["cel", "pre"], null, "G5"), quantity: 1 },
  { ...lib(10, "The Anarch Free Press", ["Master"]), quantity: 1 },
  { ...lib(11, "Carfax Abbey", ["Master"]), quantity: 1 },
  { ...lib(12, "Club Illusion", ["Master"]), quantity: 1 },
  { ...lib(13, "Direct Intervention", ["Master"]), quantity: 1 },
  { ...lib(14, "Dreams of the Sphinx", ["Master"]), quantity: 1 },
  { ...lib(15, "Fame", ["Master"]), quantity: 1 },
  { ...lib(16, "Garibaldi-Meucci Museum", ["Master"]), quantity: 1 },
  { ...lib(17, "New Carthage", ["Master"]), quantity: 1 },
  { ...lib(18, "Papillon", ["Master"]), quantity: 1 },
  { ...lib(19, "Powerbase: Los Angeles", ["Master"]), quantity: 1 },
  { ...lib(20, "Powerbase: Montreal", ["Master"]), quantity: 1 },
  { ...lib(21, "Villein", ["Master"], "Trifle. Put this card on a vampire you control."), quantity: 7 },
  { ...lib(30, "Line Brawl", ["Action"]), quantity: 5 },
  { ...lib(31, "Open War", ["Action"]), quantity: 1 },
  { ...lib(40, ".44 Magnum", ["Equipment"]), quantity: 7 },
  { ...lib(41, "Heart of Nizchetus", ["Equipment"]), quantity: 1 },
  { ...lib(50, "Organized Resistance", ["Reaction"]), quantity: 14 },
  { ...lib(51, "Bait and Switch", ["Reaction"]), quantity: 7 },
  { ...lib(60, "Taste of Vitae", ["Combat"]), quantity: 3 },
  { ...lib(61, "Bollix", ["Combat"]), quantity: 4 },
  { ...lib(62, "Concealed Weapon", ["Combat"]), quantity: 6 },
  { ...lib(63, "Diversion", ["Combat"]), quantity: 10 },
  { ...lib(64, "Hell-for-Leather", ["Combat"]), quantity: 4 },
];

const normalized = (text: string) => text.replace(/\r\n/g, "\n");

describe("exportVdbText : le format TEXT de VDB", () => {
  it("reproduit ref-text.txt ligne à ligne, ligne d'auteur exceptée", () => {
    const { lines, facts } = deckOf(REF);
    const text = exportVdbText({
      name: "Guns and shit (mostly guns)",
      description: "Date: 2026-01-25\nPlayers: 13\nEvent: R&D Paris\nLocation: Paris, France",
      lines,
      facts,
    });
    const expected = normalized(readFixture("vdb/ref-text.txt"))
      .split("\n")
      .filter((line) => !line.startsWith("Author:"))
      .join("\n");
    expect(text).toBe(expected);
  });

  it("reproduit la crypte de difficile-text.txt : advanced, titres, clan à deux mots, capacité à deux chiffres", () => {
    const entries: Entry[] = [
      { item: crypt({ id: 1, name: "Jann Berger", capacity: 10, group: "G4", clan: "Brujah", title: "Prince", disciplines: ["CEL", "POT", "PRE", "dem", "for"] }), quantity: 3 },
      { item: crypt({ id: 2, name: "Dmitra Ilyanova", capacity: 9, group: "G5", clan: "Brujah", title: "Justicar", disciplines: ["CEL", "FOR", "POT", "PRE", "obf"] }), quantity: 3 },
      { item: crypt({ id: 3, name: "Hektor", capacity: 9, group: "G4", clan: "Brujah antitribu", title: "Priscus", disciplines: ["CEL", "POT", "PRE", "QUI", "for"] }), quantity: 3 },
      { item: crypt({ id: 4, name: "Count Germaine", capacity: 8, group: "G4", clan: "Brujah", disciplines: ["CEL", "FOR", "POT", "PRE", "obf"] }), quantity: 2 },
      { item: crypt({ id: 5, name: "Count Germaine", advanced: true, capacity: 8, group: "G4", clan: "Brujah", disciplines: ["CEL", "FOR", "POT", "PRE", "obf"] }), quantity: 1 },
      { item: crypt({ id: 6, name: "Themistocles", capacity: 8, group: "G5", clan: "Brujah", disciplines: ["AUS", "CEL", "FOR", "POT", "pre"] }), quantity: 1 },
    ];
    const { lines, facts } = deckOf(entries);
    const text = exportVdbText({ name: "x", lines, facts });
    const fixture = normalized(readFixture("vdb/difficile-text.txt")).split("\n");
    const start = fixture.findIndex((line) => line.startsWith("Crypt ("));
    const expected = fixture.slice(start, start + 8);
    expect(text.split("\n").slice(3, 11)).toEqual(expected);
  });

  it("marque (G6) la version récente d'un vampire réimprimé, ANY pour un groupe neutre, une combinaison de types", () => {
    const { lines, facts } = deckOf([
      { item: crypt({ id: 1, name: "Theo Bell", capacity: 7, group: "G6", clan: "Brujah" }), quantity: 2 },
      { item: crypt({ id: 2, name: "Anarch Convert", capacity: 1, group: "Any", clan: "Caitiff" }), quantity: 1 },
      { ...lib(3, "Earth Control", ["Reaction", "Action Modifier"]), quantity: 2 },
      { ...lib(4, "Bum's Rush", ["Action"]), quantity: 3 },
      { ...lib(5, "Swallowed by the Night", ["Action Modifier"]), quantity: 1 },
      { ...lib(6, "Mystery Card", []), quantity: 1 },
    ]);
    const text = exportVdbText({ name: "Essai", description: "  ", lines, facts, reprinted: new Set([1]) });
    expect(text).toContain("2x Theo Bell (G6)");
    expect(text).toMatch(/1x Anarch Convert\s+1\s+Caitiff:ANY/);
    expect(text).not.toContain("Description:");
    const titles = text.split("\n").filter((line) => /^[A-Z][A-Za-z /]+ \(\d+\)$/.test(line));
    expect(titles).toEqual(["Action (3)", "Action Modifier (1)", "Action Modifier/Reaction (2)", "Unknown (1)"]);
  });

  it("calcule min, max et moyenne de la crypte sur les exemplaires", () => {
    const { lines, facts } = deckOf(REF.slice(0, 7));
    const rows = lines.map((line) => ({ ...line, facts: facts.get(line.cardId) ?? null }));
    expect(cryptHeader(rows as never)).toBe("Crypt (12 cards, min=18 max=30 avg=6.17)");
    expect(cryptHeader([])).toBe("Crypt (0 cards, min=0 max=0 avg=0)");
  });

  it("écrit « X, The » comme VDB", () => {
    expect(vdbName("The Sargon Fragment")).toBe("Sargon Fragment, The");
    expect(vdbName("Theo Bell")).toBe("Theo Bell");
  });
});

const fixtureRow = (card: FixtureCard): CardRow => ({
  id: card.vekn_id,
  veknId: card.vekn_id,
  name: card.name,
  foldedName: foldText(card.name),
  category: card.category,
  clanName: null,
  capacity: null,
  groupCode: card.group,
  advanced: card.advanced,
  imageUrl: null,
  cardSetIds: [1],
  latestCardSetId: 1,
});

describe("reprintedCardIds", () => {
  const rows = EXTRACT.map(fixtureRow);
  const byId = (id: number) => rows.find((row) => row.veknId === id) as CardRow;

  it("marque la version récente, jamais l'origine ni l'advanced", () => {
    const marked = reprintedCardIds([byId(201613), byId(201362), byId(201363), byId(200292)], rows);
    expect([...marked]).toEqual([201613]);
  });
});

describe("aller-retour : exporter puis réimporter retrouve la même liste", () => {
  const rows = EXTRACT.map(fixtureRow);
  const index = indexOf(EXTRACT);

  it.each(["vdb/ref-api.json", "vdb/maj-apres-api.json", "vdb/difficile-api.json", "vdb/precon-api.json", "vdb/twda-api.json"])(
    "%s",
    (path) => {
      const deck = apiDeck(path);
      const lines = deck.cards.map((card) => ({
        cardId: card.vekn_id,
        languageCode: "EN",
        cardSetId: 1,
        quantity: card.quantity,
        proxyQuantity: card.quantity,
        cardName: null,
        pending: false,
      }));
      const facts = new Map(
        rows.filter((row) => lines.some((line) => line.cardId === row.id)).map((row) => [row.id, { card: row, details: null }]),
      );
      const reprinted = reprintedCardIds([...facts.values()].map(({ card }) => card), rows);
      const text = exportVdbText({ name: deck.name, description: deck.description, lines, facts, reprinted });
      const parsed = parseDecklist(text);
      const match = matchDecklist(parsed.lines, index);
      expect(parsed.unreadable).toEqual([]);
      expect(match.unmatched).toEqual([]);
      expect(match.resolved.filter((line) => line.by === "assumed")).toEqual([]);
      expect(match.cards.map(({ card, quantity }) => ({ vekn_id: card.veknId, quantity }))).toEqual(deck.cards);
      expect(parsed.header.name).toBe(deck.name);
    },
  );
});
