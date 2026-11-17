import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildCardIndex, type ImportCard } from "../../../../../src/features/decks/import/cardIndex";
import type { ParsedLine } from "../../../../../src/features/decks/import/parseDecklist";

// Lecture des fixtures du Lot 9 : table de cas commune et exports réels de VDB.

const FIXTURES = resolve(__dirname, "../../../../fixtures");

export const readFixture = (path: string): string => readFileSync(resolve(FIXTURES, path), "utf-8");
export const readJson = <T>(path: string): T => JSON.parse(readFixture(path)) as T;

export interface FixtureCard {
  vekn_id: number;
  name: string;
  category: "crypt" | "library";
  group: string | null;
  advanced: boolean;
}

/** Une carte de fixture au format du miroir : l'identifiant du catalogue vaut l'identifiant VEKN. */
export const toImportCard = (card: FixtureCard): ImportCard => ({
  id: card.vekn_id,
  veknId: card.vekn_id,
  name: card.name,
  category: card.category,
  groupCode: card.group,
  advanced: card.advanced,
  latestCardSetId: 900 + (card.vekn_id % 7),
});

export const indexOf = (cards: readonly FixtureCard[]) => buildCardIndex(cards.map(toImportCard));

export interface CaseLine {
  line: number;
  quantity: number;
  vekn_id?: number;
  name?: string;
  advanced?: boolean;
  group?: string | null;
}

/** Une ligne de la table de cas, sous la forme de l'analyseur. */
export const toParsedLine = (line: CaseLine): ParsedLine =>
  line.vekn_id !== undefined
    ? { kind: "id", line: line.line, text: `${line.vekn_id}=${line.quantity}`, quantity: line.quantity, veknId: line.vekn_id, section: null }
    : {
        kind: "name",
        line: line.line,
        text: `${line.quantity}x ${line.name}`,
        quantity: line.quantity,
        name: line.name as string,
        advanced: line.advanced ?? false,
        group: line.group ?? null,
        section: null,
      };

export interface MatchCases {
  catalog: FixtureCard[];
  minify: Array<{ input: string; expected: string }>;
  cases: Array<{
    name: string;
    lines: CaseLine[];
    expected: {
      resolved: Array<{ line: number; vekn_id: number; by: string }>;
      cards: Array<{ vekn_id: number; quantity: number }>;
      unmatched: Array<{ line: number; reason: string }>;
    };
  }>;
}

export const MATCH_CASES = readJson<MatchCases>("vdb-import-cases.json");

/** Extrait du catalogue de développement qui couvre toutes les réponses d'API des fixtures. */
export const EXTRACT = readJson<{ catalog: FixtureCard[] }>("vdb/catalog-extract.json").catalog;

export interface ApiFixture {
  deckid: string;
  name: string;
  author: string | null;
  description: string | null;
  cards: Record<string, number>;
}

/** Une réponse réelle de l'API de VDB, au format de `VdbDeckRead` que rend le serveur. */
export function apiDeck(path: string) {
  const raw = readJson<ApiFixture>(path);
  return {
    vdb_deck_id: raw.deckid,
    name: raw.name,
    author: raw.author,
    description: raw.description,
    cards: Object.entries(raw.cards)
      .filter(([, quantity]) => quantity > 0)
      .map(([id, quantity]) => ({ vekn_id: Number(id), quantity }))
      .sort((a, b) => a.vekn_id - b.vekn_id),
  };
}
