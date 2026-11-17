import { describe, expect, it } from "vitest";
import type { DeckCardFacts } from "../../../../../src/features/decks/deckTablesModel";
import {
  VDB_LIBRARY_TYPE_ORDER,
  exportVdbText,
  reprintedCardIds,
} from "../../../../../src/features/decks/export/exportVdbText";
import { buildCardIndex } from "../../../../../src/features/decks/import/cardIndex";
import { matchDecklist } from "../../../../../src/features/decks/import/matchDecklist";
import { parseDecklist } from "../../../../../src/features/decks/import/parseDecklist";
import type { LocalDeckCard } from "../../../../../src/offline/vtes";
import { crypt, library, mirrorRows, type CardSearchItem } from "../../../offline/fixtures/syntheticCatalog";

// Lot 9, étape E : l'aller-retour export puis import sur une liste qui couvre la crypte
// (advanced, groupe « Any », vampire réimprimé), **les treize types de bibliothèque** de VDB et
// leurs combinaisons. Les cinq réponses d'API réelles ne portent pas tous les types, et leur
// aller-retour se fait sans détails de carte (tout part en « Unknown »), donc il ne prouve rien
// sur l'ordre ni sur les en-têtes de type : celui-ci les exerce, avec les faits de carte.

interface Entry {
  item: CardSearchItem;
  quantity: number;
}

const vampire = (id: number, name: string, group: string, extra: Partial<Parameters<typeof crypt>[0]> = {}): Entry => ({
  item: crypt({ id, name, group, capacity: 6, clan: "Brujah", disciplines: ["CEL", "pot", "pre"], ...extra }),
  quantity: 2,
});

const card = (id: number, name: string, types: string[], quantity = 1, text: string | null = null): Entry => ({
  item: library({ id, name, types, text }),
  quantity,
});

/** Un type, ou une combinaison, par ligne : chacun des treize types de `VDB_LIBRARY_TYPE_ORDER`. */
const TYPE_CARDS: Entry[] = [
  card(100, "Villein", ["Master"], 3, "Trifle. Put this card on a vampire you control."),
  card(101, "The Anarch Free Press", ["Master"], 1),
  card(102, "Sacré-Cœur Cathedral, France", ["Master"], 1),
  card(110, "Conviction Card", ["Conviction"], 1),
  card(120, "Power Card", ["Power"], 2),
  card(130, "Bum's Rush", ["Action"], 4),
  card(140, "Kine Resources Contested", ["Political Action"], 2),
  card(150, "Carlton Van Wyk", ["Ally"], 1),
  card(160, ".44 Magnum", ["Equipment"], 5),
  card(170, "Hunting Lodge", ["Retainer"], 1),
  card(180, "Swallowed by the Night", ["Action Modifier"], 3),
  card(190, "Delaying Tactics", ["Reaction"], 4),
  card(200, "Taste of Vitae", ["Combat"], 6),
  card(210, "Reflex Card", ["Reflex"], 1),
  card(220, "Unmasking, The", ["Event"], 1),
  // Combinaisons : chacune forme son groupe, au rang de son premier type.
  card(230, "Earth Control", ["Reaction", "Action Modifier"], 2),
  card(231, "Wake with Evening's Freshness", ["Reaction", "Combat"], 1),
  card(232, "Sudden Reversal", ["Combat", "Reaction"], 1),
  card(233, "Deflection", ["Action", "Reaction"], 2),
  card(234, "Rego Motus", ["Action", "Political Action"], 1),
];

const CRYPT_CARDS: Entry[] = [
  vampire(1, "Theo Bell", "G2"),
  vampire(2, "Theo Bell", "G6"),
  vampire(3, "Count Germaine", "G4"),
  vampire(4, "Count Germaine", "G4", { advanced: true }),
  vampire(5, "Anarch Convert", "Any", { clan: "Caitiff", capacity: 1, disciplines: [] }),
  vampire(6, "Saku Pihlajamäki", "G6", { title: "Baron" }),
  vampire(7, "Aline Gädeke", "G6"),
  { ...vampire(8, "Anna \"Dictatrix11\" Suljic", "G4", { clan: "Martyr", sect: "Imbued" }), quantity: 1 },
];

const ENTRIES = [...CRYPT_CARDS, ...TYPE_CARDS];

function pipeline(entries: Entry[]) {
  const { cards, details } = mirrorRows(entries.map((entry) => entry.item));
  const facts = new Map<number, DeckCardFacts>(cards.map((row, index) => [row.id, { card: row, details: details[index] }]));
  const lines: LocalDeckCard[] = entries.map(({ item, quantity }) => ({
    cardId: item.id,
    languageCode: "EN",
    cardSetId: 1,
    quantity,
    proxyQuantity: quantity,
    cardName: null,
    pending: false,
  }));
  const reprinted = reprintedCardIds(cards, cards);
  const text = exportVdbText({ name: "Tous les types", description: "Un essai.", lines, facts, reprinted });
  const index = buildCardIndex(cards);
  const parsed = parseDecklist(text);
  const match = matchDecklist(parsed.lines, index);
  return { text, parsed, match, cards, reprinted };
}

describe("aller-retour sur une liste qui couvre la crypte et tous les types de bibliothèque", () => {
  const { text, parsed, match, reprinted } = pipeline(ENTRIES);

  it("retrouve exactement la liste, sans ligne illisible, non reconnue ni version supposée", () => {
    expect(parsed.unreadable).toEqual([]);
    expect(match.unmatched).toEqual([]);
    expect(match.resolved.filter((line) => line.by === "assumed")).toEqual([]);
    const expected = ENTRIES.map(({ item, quantity }) => [item.id, quantity]).sort(([a], [b]) => a - b);
    const found = match.cards.map(({ card: matched, quantity }) => [matched.id, quantity]).sort(([a], [b]) => a - b);
    expect(found).toEqual(expected);
  });

  it("retrouve la version d'origine, la récente (G6), l'advanced et le groupe « Any » du vampire réimprimé", () => {
    expect([...reprinted]).toEqual([2]);
    expect(text).toContain("2x Theo Bell  ");
    expect(text).toContain("2x Theo Bell (G6)");
    expect(text).toContain("(ADV)");
    expect(text).toMatch(/Anarch Convert\s+1\s+Caitiff:ANY/);
    const byId = new Map(match.cards.map(({ card: matched }) => [matched.id, matched]));
    expect(byId.get(1)?.groupCode).toBe("G2");
    expect(byId.get(2)?.groupCode).toBe("G6");
    expect(byId.get(3)?.advanced).toBe(false);
    expect(byId.get(4)?.advanced).toBe(true);
    expect(byId.get(5)?.groupCode).toBe("Any");
  });

  it("écrit un en-tête par type, dans l'ordre de VDB, puis chaque combinaison au rang de son premier type", () => {
    const titles = text
      .split("\n")
      .map((line) => /^([A-Z][A-Za-z /]+) \(\d+(?:; \d+ trifle)?\)$/.exec(line)?.[1])
      .filter((title): title is string => title !== undefined && title !== "Library" && title !== "Crypt");
    expect(titles).toEqual([
      "Master",
      "Conviction",
      "Power",
      "Action",
      "Action/Political Action",
      "Action/Reaction",
      "Political Action",
      "Ally",
      "Equipment",
      "Retainer",
      "Action Modifier",
      "Action Modifier/Reaction",
      "Reaction",
      "Reaction/Combat",
      "Combat",
      "Reflex",
      "Event",
    ]);
    // Les treize types de VDB figurent tous en simple.
    for (const type of VDB_LIBRARY_TYPE_ORDER) expect(titles).toContain(type);
  });

  it("compte les trifles dans l'en-tête de Master et le total de bibliothèque", () => {
    expect(text).toContain("Master (5; 3 trifle)");
    const library = ENTRIES.filter((entry) => entry.item.category === "library").reduce((sum, entry) => sum + entry.quantity, 0);
    expect(text).toContain(`Library (${library} cards)`);
    expect(text).toContain("Crypt (15 cards,");
  });

  it("écrit « The X » comme « X, The » et garde la lettre spéciale, et les deux se réapparient", () => {
    expect(text).toContain("1x Anarch Free Press, The");
    expect(text).toContain("1x Sacré-Cœur Cathedral, France");
    expect(match.cards.map(({ card: matched }) => matched.name)).toEqual(
      expect.arrayContaining(["The Anarch Free Press", "Sacré-Cœur Cathedral, France", "Unmasking, The"]),
    );
  });

  it("un second tour (export de la liste retrouvée) donne le même texte", () => {
    const again = pipeline(
      match.cards.map(({ card: matched, quantity }) => ({
        item: ENTRIES.find((entry) => entry.item.id === matched.id)?.item as CardSearchItem,
        quantity,
      })),
    );
    expect(again.text).toBe(text);
  });
});
