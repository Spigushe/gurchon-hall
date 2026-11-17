import type { CardDetailRow, CardRow, LocalDeckCard } from "../../offline/vtes";

/**
 * Tableaux crypte / bibliothèque d'un deck (lot Affichage des decks, handoff
 * `docs/design-handoff/DECKS.md`, plan `docs/lot-affichage-decks-plan.md`,
 * A2) : tout ce que `DeckTables` affiche, calculé ici sans React pour être
 * testé sur une table de cas et garder la complexité hors des composants.
 *
 * Une ligne de deck a pour clé carte × langue × extension (Lot 4) ; les
 * tableaux montrent une ligne par **carte**, qui garde ses lignes d'origine
 * (`lines`) pour le détail (P2).
 */

/** Ce que le miroir local sait d'une carte : `cards`, et `cardDetails` depuis le lot Chercher. */
export interface DeckCardFacts {
  card: CardRow;
  /** `null` quand le miroir est incomplet (serveur d'avant le lot Chercher). */
  details: CardDetailRow | null;
}

/** Une carte du deck, toutes ses lignes (langue × extension) réunies. */
export interface DeckTableRow {
  cardId: number;
  name: string;
  /** `foldedName` du catalogue, ou le nom brut d'une carte hors catalogue : clé de tri. */
  sortName: string;
  quantity: number;
  proxyQuantity: number;
  /** Une de ses lignes attend la synchronisation. */
  pending: boolean;
  /** Lignes d'origine, dans l'ordre reçu ; plus d'une = carte fusionnée. */
  lines: LocalDeckCard[];
  /** `null` pour une carte absente du miroir (catalogue pas encore chargé). */
  facts: DeckCardFacts | null;
}

export interface CryptSection {
  rows: DeckTableRow[];
  total: number;
  proxies: number;
  /** « G5–6 », « G2 · G4 », « G3 » ; `null` sans groupe numéroté. */
  groupsLabel: string | null;
  /** Capacité moyenne pondérée par les quantités, `null` sans capacité connue. */
  averageCapacity: number | null;
  /** Colonnes de disciplines alignées d'une ligne à l'autre (`cryptDisciplineColumns`). */
  disciplineColumns: string[];
}

export type LibraryGroupKind = "types" | "pending-details" | "outside-catalog";

export interface LibraryGroup {
  key: string;
  kind: LibraryGroupKind;
  /** Types du groupe dans l'ordre de `LIBRARY_TYPE_ORDER` (vide hors `types`). */
  types: string[];
  /** « Action Modifier / Reaction » ; libellé d'état pour les deux autres genres. */
  label: string;
  rows: DeckTableRow[];
  total: number;
  /** Masters « trifle » du groupe, en exemplaires (A3). */
  trifles: number;
}

export interface CostTotal {
  amount: number;
  /** Un coût X au moins : il ne s'additionne pas, l'affichage ajoute « + X ». */
  hasX: boolean;
}

export interface LibrarySection {
  groups: LibraryGroup[];
  total: number;
  proxies: number;
  blood: CostTotal;
  pool: CostTotal;
}

export interface DeckTables {
  crypt: CryptSection;
  library: LibrarySection;
}

/**
 * Ordre des groupes de bibliothèque : celui du handoff, puis les types que le
 * handoff oublie (cartes d'imbued), P6.
 */
export const LIBRARY_TYPE_ORDER: readonly string[] = [
  "Master",
  "Action",
  "Action Modifier",
  "Political Action",
  "Ally",
  "Equipment",
  "Retainer",
  "Combat",
  "Reaction",
  "Event",
  "Reflex",
  "Power",
  "Conviction",
];

export const PENDING_DETAILS_LABEL = "Bibliothèque · détails à venir";
export const OUTSIDE_CATALOG_LABEL = "Hors catalogue local";

const typeRank = (type: string) => {
  const rank = LIBRARY_TYPE_ORDER.indexOf(type);
  return rank === -1 ? LIBRARY_TYPE_ORDER.length : rank;
};

const orderTypes = (types: readonly string[]) =>
  [...types].sort((a, b) => typeRank(a) - typeRank(b) || a.localeCompare(b));

const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

const TRIFLE = /\btrifle\b/;

/** A3 : un master dont le texte porte le mot-clé « trifle ». */
export function isTrifle(details: CardDetailRow | null): boolean {
  return details !== null && details.types.includes("Master") && TRIFLE.test(details.foldedText);
}

/** Réunit les lignes d'une même carte, dans l'ordre de première apparition. */
export function mergeDeckLines(
  lines: readonly LocalDeckCard[],
  facts: ReadonlyMap<number, DeckCardFacts>,
): DeckTableRow[] {
  const rows = new Map<number, DeckTableRow>();
  for (const line of lines) {
    const existing = rows.get(line.cardId);
    if (existing) {
      existing.quantity += line.quantity;
      existing.proxyQuantity += line.proxyQuantity;
      existing.pending ||= line.pending;
      existing.lines.push(line);
      continue;
    }
    const known = facts.get(line.cardId) ?? null;
    const name = known?.card.name ?? line.cardName ?? `Carte n° ${line.cardId}`;
    rows.set(line.cardId, {
      cardId: line.cardId,
      name,
      sortName: known?.card.foldedName ?? name.toLowerCase(),
      quantity: line.quantity,
      proxyQuantity: line.proxyQuantity,
      pending: line.pending,
      lines: [line],
      facts: known,
    });
  }
  return [...rows.values()];
}

const sumQuantity = (rows: readonly DeckTableRow[]) => rows.reduce((sum, row) => sum + row.quantity, 0);
const sumProxies = (rows: readonly DeckTableRow[]) => rows.reduce((sum, row) => sum + row.proxyQuantity, 0);

/** Groupes numérotés présents, « Any » neutre : « G5–6 » s'ils se suivent, « G2 · G4 » sinon. */
export function cryptGroupsLabel(rows: readonly DeckTableRow[]): string | null {
  const groups = new Set<number>();
  for (const row of rows) {
    const code = row.facts?.card.groupCode;
    if (code && /^G\d+$/.test(code)) groups.add(Number(code.slice(1)));
  }
  if (groups.size === 0) return null;
  const sorted = [...groups].sort((a, b) => a - b);
  const contiguous = sorted.every((group, index) => index === 0 || group === sorted[index - 1] + 1);
  if (sorted.length === 1) return `G${sorted[0]}`;
  return contiguous ? `G${sorted[0]}–${sorted[sorted.length - 1]}` : sorted.map((group) => `G${group}`).join(" · ");
}

function averageCapacity(rows: readonly DeckTableRow[]): number | null {
  let weighted = 0;
  let count = 0;
  for (const row of rows) {
    const capacity = row.facts?.card.capacity;
    if (capacity === null || capacity === undefined) continue;
    weighted += capacity * row.quantity;
    count += row.quantity;
  }
  return count === 0 ? null : Math.round((weighted / count) * 10) / 10;
}

/** Capacité décroissante, capacité inconnue en dernier, puis nom replié. */
function compareCrypt(a: DeckTableRow, b: DeckTableRow): number {
  const capacityA = a.facts?.card.capacity ?? -1;
  const capacityB = b.facts?.card.capacity ?? -1;
  return capacityB - capacityA || compareText(a.sortName, b.sortName);
}

function buildCrypt(rows: DeckTableRow[]): CryptSection {
  const sorted = [...rows].sort(compareCrypt);
  return {
    rows: sorted,
    total: sumQuantity(sorted),
    proxies: sumProxies(sorted),
    groupsLabel: cryptGroupsLabel(sorted),
    averageCapacity: averageCapacity(sorted),
    disciplineColumns: cryptDisciplineColumns(sorted),
  };
}

/** Clé et genre du groupe d'une carte de bibliothèque. */
function libraryGroupOf(row: DeckTableRow): { key: string; kind: LibraryGroupKind; types: string[] } {
  if (row.facts === null) return { key: "outside-catalog", kind: "outside-catalog", types: [] };
  const types = row.facts.details?.types ?? [];
  if (types.length === 0) return { key: "pending-details", kind: "pending-details", types: [] };
  const ordered = orderTypes(types);
  return { key: `types:${ordered.join("/")}`, kind: "types", types: ordered };
}

const KIND_RANK: Record<LibraryGroupKind, number> = { types: 0, "pending-details": 1, "outside-catalog": 2 };

/** Rang du premier type, puis un seul type avant une combinaison, puis libellé. */
function compareGroups(a: LibraryGroup, b: LibraryGroup): number {
  return (
    KIND_RANK[a.kind] - KIND_RANK[b.kind] ||
    typeRank(a.types[0] ?? "") - typeRank(b.types[0] ?? "") ||
    a.types.length - b.types.length ||
    compareText(a.label, b.label)
  );
}

const groupLabel = (kind: LibraryGroupKind, types: string[]) =>
  kind === "types" ? types.join(" / ") : kind === "pending-details" ? PENDING_DETAILS_LABEL : OUTSIDE_CATALOG_LABEL;

function addCost(total: CostTotal, value: string | null, quantity: number) {
  if (value === null) return;
  if (value.toUpperCase() === "X") total.hasX = true;
  else if (/^\d+$/.test(value)) total.amount += Number(value) * quantity;
}

function buildLibrary(rows: DeckTableRow[]): LibrarySection {
  const groups = new Map<string, LibraryGroup>();
  const blood: CostTotal = { amount: 0, hasX: false };
  const pool: CostTotal = { amount: 0, hasX: false };
  for (const row of rows) {
    const { key, kind, types } = libraryGroupOf(row);
    let group = groups.get(key);
    if (!group) {
      group = { key, kind, types, label: groupLabel(kind, types), rows: [], total: 0, trifles: 0 };
      groups.set(key, group);
    }
    group.rows.push(row);
    group.total += row.quantity;
    const details = row.facts?.details ?? null;
    if (isTrifle(details)) group.trifles += row.quantity;
    if (details?.costType === "blood") addCost(blood, details.costValue, row.quantity);
    if (details?.costType === "pool") addCost(pool, details.costValue, row.quantity);
  }
  const ordered = [...groups.values()].sort(compareGroups);
  for (const group of ordered) group.rows.sort((a, b) => compareText(a.sortName, b.sortName));
  return { groups: ordered, total: sumQuantity(rows), proxies: sumProxies(rows), blood, pool };
}

/**
 * Les deux sections. Une carte absente du miroir n'a pas de catégorie connue :
 * elle va en bibliothèque, groupe « Hors catalogue local » (A5).
 */
export function buildDeckTables(
  lines: readonly LocalDeckCard[],
  facts: ReadonlyMap<number, DeckCardFacts>,
): DeckTables {
  const crypt: DeckTableRow[] = [];
  const library: DeckTableRow[] = [];
  for (const row of mergeDeckLines(lines, facts)) {
    (row.facts?.card.category === "crypt" ? crypt : library).push(row);
  }
  return { crypt: buildCrypt(crypt), library: buildLibrary(library) };
}

/**
 * Clans distincts de la crypte, du plus joué au moins joué puis par nom (P7,
 * icônes de la ligne de deck). Les cartes sans clan connu sont ignorées.
 */
export function cryptClans(
  lines: readonly LocalDeckCard[],
  facts: ReadonlyMap<number, DeckCardFacts>,
): string[] {
  const counts = new Map<string, number>();
  for (const line of lines) {
    const card = facts.get(line.cardId)?.card;
    if (card?.category !== "crypt" || !card.clanName) continue;
    counts.set(card.clanName, (counts.get(card.clanName) ?? 0) + line.quantity);
  }
  return [...counts.entries()]
    .sort(([clanA, countA], [clanB, countB]) => countB - countA || compareText(clanA, clanB))
    .map(([clan]) => clan);
}

export interface DeckListSummary {
  crypt: number;
  library: number;
  clans: string[];
}

/**
 * Ce que la ligne d'un deck affiche dans la liste (P7) : comptes crypte et
 * bibliothèque, clans de la crypte. Une carte absente du miroir ne compte
 * nulle part, comme dans `useLocalDeckCounts`.
 */
export function deckListSummary(
  lines: readonly LocalDeckCard[],
  facts: ReadonlyMap<number, DeckCardFacts>,
): DeckListSummary {
  let crypt = 0;
  let library = 0;
  for (const line of lines) {
    const category = facts.get(line.cardId)?.card.category;
    if (category === "crypt") crypt += line.quantity;
    else if (category === "library") library += line.quantity;
  }
  return { crypt, library, clans: cryptClans(lines, facts) };
}

/** Exemplaires encore libres d'une entrée de collection de la carte (tous decks déduits). */
export interface StockAvailability {
  languageCode: string;
  cardSetId: number;
  available: number;
}

export type PlusDecision =
  | { kind: "real" }
  | { kind: "proxy" }
  | { kind: "choose"; options: StockAvailability[] }
  | { kind: "disabled"; reason: string };

/**
 * Ce que fait le `+` d'une ligne de deck (P3, tranché à A0) : un exemplaire
 * réel pris au stock **identique** (même langue, même extension) s'il en
 * reste ; sinon, s'il en reste dans une autre langue ou extension, il y a
 * doute et l'utilisateur choisit dans le détail ; sinon un proxy si le deck
 * l'autorise ; sinon rien.
 */
export function plusDecision(
  line: Pick<LocalDeckCard, "languageCode" | "cardSetId">,
  stock: readonly StockAvailability[],
  proxyAllowed: boolean,
): PlusDecision {
  const identical = stock.find(
    (entry) => entry.languageCode === line.languageCode && entry.cardSetId === line.cardSetId,
  );
  if (identical && identical.available > 0) return { kind: "real" };
  const options = stock.filter(
    (entry) =>
      entry.available > 0 && !(entry.languageCode === line.languageCode && entry.cardSetId === line.cardSetId),
  );
  if (options.length > 0) return { kind: "choose", options };
  if (proxyAllowed) return { kind: "proxy" };
  return { kind: "disabled", reason: "Plus d'exemplaire disponible au stock, et ce deck n'autorise pas les proxies." };
}

/**
 * Une ligne de deck ramenée à `quantity` exemplaires, comme le `−` du
 * deckbuilder : les proxies sont gardés dans la limite de la nouvelle quantité,
 * si bien que les exemplaires réels sont rendus d'abord. `null` à 0 ou moins :
 * la ligne est retirée (P4 du lot Affichage des decks). Repris par la mise à
 * jour depuis VDB pour une baisse sans conflit (Lot 9, P7).
 */
export function lowerLine(
  line: Pick<LocalDeckCard, "quantity" | "proxyQuantity">,
  quantity: number,
): { quantity: number; proxyQuantity: number } | null {
  if (quantity <= 0) return null;
  return { quantity, proxyQuantity: Math.min(line.proxyQuantity, quantity) };
}

/**
 * Colonnes de disciplines de la crypte (P5, d'après l'affichage de VDB) : une
 * colonne par discipline présente, la plus répandue d'abord (en exemplaires),
 * puis par code. Chaque vampire place ses icônes dans ces colonnes, si bien
 * qu'une discipline garde sa place d'une ligne à l'autre.
 */
export function cryptDisciplineColumns(rows: readonly DeckTableRow[]): string[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    for (const discipline of row.facts?.details?.disciplines ?? []) {
      counts.set(discipline.code, (counts.get(discipline.code) ?? 0) + row.quantity);
    }
  }
  return [...counts.entries()]
    .sort(([codeA, countA], [codeB, countB]) => countB - countA || compareText(codeA, codeB))
    .map(([code]) => code);
}

const SECT_INITIALS: Readonly<Record<string, string>> = {
  Camarilla: "C",
  Sabbat: "S",
  Independent: "I",
  Anarch: "A",
  Laibon: "L",
  Imbued: "Imb",
};

/** Initiale de secte affichée sous le clan (P5) ; `null` sans secte connue. */
export function sectInitial(sect: string | null | undefined): string | null {
  if (!sect) return null;
  return SECT_INITIALS[sect] ?? sect.charAt(0).toUpperCase();
}
