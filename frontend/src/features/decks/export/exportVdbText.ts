import { foldText } from "../../../offline/core/foldText";
import type { CardRow, LocalDeckCard } from "../../../offline/vtes";
import { isTrifle, mergeDeckLines, type DeckCardFacts, type DeckTableRow } from "../deckTablesModel";
import { libraryTypeGroup } from "../libraryTypeOrder";

/**
 * Export d'un deck au format `TEXT` de VDB (Lot 9, A5, P9), en fonctions pures.
 * La mise en page suit celle de VDB, relevée sur les exports réels de
 * `tests/fixtures/vdb/` (`ref-text.txt`, `difficile-text.txt`) : un texte
 * exporté ici et un texte exporté par VDB se ressemblent ligne à ligne, et VDB
 * comme notre import le relisent.
 *
 * - en-tête `Deck Name:`, puis `Description:` si le deck a des notes, puis
 *   deux lignes vides ;
 * - `Crypt (12 cards, min=18 max=30 avg=6.17)` souligné de `=`, une ligne par
 *   vampire en colonnes : quantité, nom (`(ADV)`, `(G6)` pour la version
 *   récente d'un vampire réimprimé), capacité, disciplines (supérieures en
 *   capitales d'abord), titre, `Clan:groupe` ;
 * - `Library (80 cards)` souligné de `=`, puis un titre par type
 *   (`Master (18; 7 trifle)`) souligné de `-` sur un caractère de plus, comme
 *   VDB, et des lignes `3x Nom`.
 *
 * Écart assumé : une carte absente du miroir local (catalogue pas encore lu)
 * s'exporte sous son nom en bibliothèque, dans un groupe « Unknown ».
 */

const UNKNOWN_GROUP = "Unknown";

export interface VdbExportInput {
  name: string;
  /** Notes du deck, exportées en description. */
  description?: string | null;
  lines: readonly LocalDeckCard[];
  facts: ReadonlyMap<number, DeckCardFacts>;
  /** Cartes de crypte marquées `(G<n>)` : version récente d'un vampire réimprimé (`reprintedCardIds`). */
  reprinted?: ReadonlySet<number>;
}

/**
 * Cartes de crypte à marquer `(G<n>)` : la version non *advanced* d'un nom qui
 * en a une autre, plus ancienne (plus petit identifiant VEKN). La version
 * d'origine n'a aucune marque, comme chez VDB (P4). `versions` : toutes les
 * cartes du catalogue qui portent le nom d'une carte du deck.
 */
export function reprintedCardIds(cards: readonly CardRow[], versions: readonly CardRow[]): Set<number> {
  const oldest = new Map<string, number>();
  for (const card of versions) {
    if (card.category !== "crypt" || card.advanced) continue;
    const current = oldest.get(card.foldedName);
    if (current === undefined || card.veknId < current) oldest.set(card.foldedName, card.veknId);
  }
  const marked = new Set<number>();
  for (const card of cards) {
    if (card.category !== "crypt" || card.advanced) continue;
    const first = oldest.get(card.foldedName);
    if (first !== undefined && first < card.veknId) marked.add(card.id);
  }
  return marked;
}

/** « The Anarch Free Press » → « Anarch Free Press, The », écriture des noms chez VDB. */
export function vdbName(name: string): string {
  const match = /^The (.+)$/.exec(name);
  return match ? `${match[1]}, The` : name;
}

export function cryptName(row: DeckTableRow, reprinted: ReadonlySet<number>): string {
  const card = row.facts?.card;
  const base = vdbName(row.name);
  if (card?.advanced) return `${base} (ADV)`;
  if (card && reprinted.has(card.id) && card.groupCode) return `${base} (${card.groupCode})`;
  return base;
}

/** « CEL POT PRE for pro » : supérieures en capitales, puis inférieures, chacune par code. */
export function disciplinesText(row: DeckTableRow): string {
  const disciplines = row.facts?.details?.disciplines ?? [];
  const codes = (superior: boolean) =>
    disciplines
      .filter((discipline) => discipline.superior === superior)
      .map((discipline) => discipline.code)
      .sort();
  return [...codes(true).map((code) => code.toUpperCase()), ...codes(false).map((code) => code.toLowerCase())].join(" ");
}

function clanGroupText(row: DeckTableRow): string {
  const card = row.facts?.card;
  const group = card?.groupCode ?? "";
  const groupText = group === "Any" ? "ANY" : group.replace(/^G/, "");
  return `${card?.clanName ?? ""}:${groupText}`;
}

/** Arrondi à deux décimales, sans zéros de traîne (« 6.17 », « 6 »). */
const twoDecimals = (value: number) => String(Math.round(value * 100) / 100);

/** Les capacités des exemplaires, une par carte (quantités dépliées). */
function capacities(rows: readonly DeckTableRow[]): number[] {
  return rows.flatMap((row) => Array<number>(row.quantity).fill(row.facts?.card.capacity ?? 0));
}

/** `Crypt (12 cards, min=18 max=30 avg=6.17)` : quatre plus faibles, quatre plus fortes, moyenne. */
export function cryptHeader(rows: readonly DeckTableRow[]): string {
  const values = capacities(rows).sort((a, b) => a - b);
  const total = values.length;
  const sum = (list: number[]) => list.reduce((acc, value) => acc + value, 0);
  const min = sum(values.slice(0, 4));
  const max = sum(values.slice(-4));
  const avg = total === 0 ? 0 : sum(values) / total;
  return `Crypt (${total} cards, min=${min} max=${max} avg=${twoDecimals(avg)})`;
}

const widest = (values: readonly string[]) => values.reduce((max, value) => Math.max(max, value.length), 0);

/** Capacité décroissante, puis nom tel qu'exporté. */
function compareCrypt(a: { row: DeckTableRow; name: string }, b: { row: DeckTableRow; name: string }): number {
  const capacityA = a.row.facts?.card.capacity ?? -1;
  const capacityB = b.row.facts?.card.capacity ?? -1;
  return capacityB - capacityA || compareFolded(a.name, b.name);
}

export const compareFolded = (a: string, b: string) => {
  const foldedA = foldText(a);
  const foldedB = foldText(b);
  return foldedA < foldedB ? -1 : foldedA > foldedB ? 1 : 0;
};

/**
 * Les lignes de crypte, en colonnes alignées comme chez VDB, par capacité
 * décroissante puis nom (le `TWD` aussi, par choix, cf. `exportVdbTwd.ts`).
 */
export function cryptLines(rows: readonly DeckTableRow[], reprinted: ReadonlySet<number>): string[] {
  const cells = rows
    .map((row) => ({
      row,
      name: cryptName(row, reprinted),
      quantity: `${row.quantity}x`,
      capacity: String(row.facts?.card.capacity ?? ""),
      disciplines: disciplinesText(row),
      title: (row.facts?.details?.title ?? "").toLowerCase(),
      clan: clanGroupText(row),
    }))
    .sort(compareCrypt);
  const width = {
    quantity: widest(cells.map((cell) => cell.quantity)),
    name: widest(cells.map((cell) => cell.name)) + 3,
    capacity: widest(cells.map((cell) => cell.capacity)),
    disciplines: widest(cells.map((cell) => cell.disciplines)) + 3,
    title: widest(cells.map((cell) => cell.title)) + 3,
  };
  return cells.map((cell) =>
    [
      `${cell.quantity.padEnd(width.quantity)} `,
      cell.name.padEnd(width.name),
      `${cell.capacity.padStart(width.capacity)} `,
      cell.disciplines.padEnd(width.disciplines),
      cell.title.padEnd(width.title),
      cell.clan,
    ].join(""),
  );
}

export interface ExportGroup {
  label: string;
  /** Rang dans l'ordre de VDB ; les libellés hors liste à égalité, départagés par libellé. */
  rank: number;
  rows: DeckTableRow[];
}

const UNKNOWN_RANK = Number.MAX_SAFE_INTEGER;

/**
 * Groupes de bibliothèque, dans l'ordre de VDB (`libraryTypeOrder.ts`), commun
 * à toutes les decklists : un par libellé (`Action Modifier/Reaction`), puis
 * « Unknown » pour les cartes sans détails.
 */
export function libraryGroups(rows: readonly DeckTableRow[]): ExportGroup[] {
  const groups = new Map<string, ExportGroup>();
  for (const row of rows) {
    const typeGroup = libraryTypeGroup(row.facts?.details?.types ?? []);
    const label = typeGroup?.label ?? UNKNOWN_GROUP;
    const group = groups.get(label) ?? { label, rank: typeGroup?.rank ?? UNKNOWN_RANK, rows: [] };
    group.rows.push(row);
    groups.set(label, group);
  }
  return [...groups.values()].sort((a, b) => a.rank - b.rank || compareFolded(a.label, b.label));
}

export const sumQuantity = (rows: readonly DeckTableRow[]) => rows.reduce((sum, row) => sum + row.quantity, 0);

/** `Master (18; 7 trifle)`, souligné de `-` sauf pour le `TWD`, puis les cartes par nom exporté. */
export function groupBlock(group: ExportGroup, underlined = true): string[] {
  const trifles = group.rows.reduce((sum, row) => sum + (isTrifle(row.facts?.details ?? null) ? row.quantity : 0), 0);
  const title = `${group.label} (${sumQuantity(group.rows)}${trifles > 0 ? `; ${trifles} trifle` : ""})`;
  const cards = group.rows
    .map((row) => ({ quantity: row.quantity, name: vdbName(row.name) }))
    .sort((a, b) => compareFolded(a.name, b.name))
    .map((card) => `${card.quantity}x ${card.name}`);
  return [title, ...(underlined ? ["-".repeat(title.length + 1)] : []), ...cards];
}

function headerLines(name: string, description: string | null | undefined): string[] {
  const lines = [`Deck Name: ${name}`];
  const text = description?.trim();
  if (text) lines.push(`Description: ${text}`);
  return [...lines, "", ""];
}

/** Les lignes fusionnées du deck, séparées en crypte et bibliothèque (commun aux quatre formats). */
export function splitDeck(input: VdbExportInput): { crypt: DeckTableRow[]; library: DeckTableRow[] } {
  const rows = mergeDeckLines(input.lines, input.facts);
  return {
    crypt: rows.filter((row) => row.facts?.card.category === "crypt"),
    library: rows.filter((row) => row.facts?.card.category !== "crypt"),
  };
}

/** Le texte complet, lignes séparées par `\n`, terminé par un saut de ligne. */
export function exportVdbText(input: VdbExportInput): string {
  const reprinted = input.reprinted ?? new Set<number>();
  const { crypt, library } = splitDeck(input);

  const cryptTitle = cryptHeader(crypt);
  const libraryTitle = `Library (${sumQuantity(library)} cards)`;
  const groups = libraryGroups(library).map((group) => groupBlock(group));
  const out = [
    ...headerLines(input.name, input.description),
    cryptTitle,
    "=".repeat(cryptTitle.length),
    ...cryptLines(crypt, reprinted),
    "",
    libraryTitle,
    "=".repeat(libraryTitle.length),
    ...groups.flatMap((block, index) => (index === 0 ? block : ["", ...block])),
  ];
  return `${out.join("\n")}\n`;
}
