import { CATEGORY_LABELS } from "../../labels";
import type { CardRow, LocalStockEntry } from "../../offline/vtes";

/**
 * Tri de la collection, partagé par le tableau bureau et la liste mobile (Lot 5c,
 * étape 3) : une seule fonction de comparaison, donc le même ordre aux deux
 * largeurs. Pure — aucune lecture, aucun hook — pour se tester sans rendu.
 *
 * Les colonnes absentes du miroir (type de bibliothèque, disciplines, coût) sont
 * hors périmètre : « type » retombe sur la catégorie Crypte/Bibliothèque déjà
 * connue, « cap. / coût » ne trie que la capacité des cartes de crypte.
 */

export type StockSortColumn =
  | "name"
  | "type"
  | "clan"
  | "capacity"
  | "language"
  | "quantity"
  | "decks"
  | "notes";
export type StockSortDir = "asc" | "desc";

export const STOCK_SORT_COLUMNS: Array<{ key: StockSortColumn; label: string }> = [
  { key: "name", label: "Nom" },
  { key: "type", label: "Type" },
  { key: "clan", label: "Clan / discipline" },
  { key: "capacity", label: "Cap. / coût" },
  { key: "language", label: "Langue" },
  { key: "quantity", label: "Ex." },
  { key: "decks", label: "Decks" },
  { key: "notes", label: "Notes" },
];

export const DEFAULT_STOCK_SORT: { column: StockSortColumn; dir: StockSortDir } = {
  column: "name",
  dir: "asc",
};

/** Ce que le tri lit en dehors de l'entrée elle-même ; absent tant que le miroir se charge. */
export interface StockSortLookups {
  cards?: ReadonlyMap<number, Pick<CardRow, "clanName" | "capacity">>;
  deckCounts?: ReadonlyMap<number, number>;
}

/** Comparaison par unités de code, comme le reste de l'app (`offline/vtes/reads.ts`). */
const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Clé de tri d'une ligne pour un critère. Valeurs absentes : texte vide pour
 * le nom, le clan et les notes ; `-1` pour la capacité d'une carte sans
 * capacité (bibliothèque ou inconnue) ; 0 deck quand le compte est inconnu.
 */
export function stockSortValue(
  entry: LocalStockEntry,
  column: StockSortColumn,
  lookups: StockSortLookups = {},
): string | number {
  const card = lookups.cards?.get(entry.cardId);
  switch (column) {
    case "name":
      return entry.cardName ?? "";
    case "type":
      return entry.category ? CATEGORY_LABELS[entry.category] : "";
    case "clan":
      return card?.clanName ?? "";
    case "capacity":
      return entry.category === "crypt" ? (card?.capacity ?? -1) : -1;
    case "language":
      return entry.languageCode;
    case "quantity":
      return entry.quantityOwned;
    case "decks":
      return lookups.deckCounts?.get(entry.cardId) ?? 0;
    case "notes":
      return entry.notes ?? "";
  }
}

export function compareStockEntries(
  a: LocalStockEntry,
  b: LocalStockEntry,
  column: StockSortColumn,
  dir: StockSortDir,
  lookups: StockSortLookups = {},
): number {
  const va = stockSortValue(a, column, lookups);
  const vb = stockSortValue(b, column, lookups);
  const cmp =
    typeof va === "number" && typeof vb === "number" ? va - vb : compareText(String(va), String(vb));
  return (dir === "asc" ? 1 : -1) * cmp;
}

/** Copie triée ; le tri est stable, les égalités gardent l'ordre de la lecture locale. */
export function sortStockEntries(
  entries: readonly LocalStockEntry[],
  column: StockSortColumn,
  dir: StockSortDir,
  lookups: StockSortLookups = {},
): LocalStockEntry[] {
  return [...entries].sort((a, b) => compareStockEntries(a, b, column, dir, lookups));
}
