import { foldText } from "../core/foldText";
import { cardLegality } from "./cardLegality";
import type { CardDetailRow, CardRow } from "./db";
import type { CardCategory } from "./types";

/**
 * Recherche dans le catalogue (lot Chercher, A6) : fonctions pures, sans Dexie.
 *
 * `filterCards(cards, criteria, context)` filtre le catalogue déjà joint
 * (`cards` + `cardDetails`) et indexé une fois (`buildSearchCatalog`), si bien
 * qu'une frappe ne parcourt jamais la base. `context` porte ce qui ne vient pas
 * du catalogue : cartes possédées, cartes du deck choisi, date d'évaluation.
 *
 * Une fonction par filtre de P1 (`docs/lot-chercher-plan.md`), qui rend `null`
 * quand le critère est inactif ; une fonction courte les compose en ET. Pas de
 * `switch` sur les clés : chaque mode est une petite fonction rangée dans une
 * table.
 *
 * Règles de lecture à connaître :
 * - tout texte passe par `foldText`, nom comme texte de carte : la recherche
 *   n'est sensible ni à la casse ni aux accents ;
 * - un filtre propre à une catégorie (disciplines de crypte, coût…) écarte
 *   l'autre catégorie : une carte de bibliothèque ne répond à aucun filtre de
 *   crypte ;
 * - une carte sans détails (miroir incomplet) ne répond à aucun filtre qui en
 *   a besoin, légalité comprise : elle n'est jamais lue comme légale ; le champ
 *   principal la cherche alors par son nom anglais seulement ;
 * - les sectes et titres exigés des cartes de bibliothèque arrivent lus par le
 *   serveur (A3) : un titre y implique déjà sa secte, et « non-anarch » y vaut
 *   les quatre autres sectes de vampire.
 */

// --- Index : ensembles précalculés -----------------------------------------

/** Ce qui se calcule une fois par carte, à la lecture du catalogue en mémoire. */
export interface CardIndex {
  /** Nom anglais replié, sans ponctuation, espaces réduits (« .44 Magnum » → « 44 magnum »). */
  bareName: string;
  /** Initiales des mots du nom replié (« Theo Bell » → « tb »). */
  initials: string;
  /** Noms traduits repliés, sans ponctuation. */
  bareTranslatedNames: string[];
  /** Disciplines par code, avec leur niveau (`true` : supérieur). */
  disciplines: Map<string, boolean>;
  /** Types, plus « Reflex » quand le texte contient `[REFLEX]` (définition de VDB). */
  types: Set<string>;
  /** Votes du titre, selon le barème de VDB ; 0 sans titre. */
  votes: number;
}

export interface SearchableCard {
  card: CardRow;
  /** `null` quand le miroir des détails est incomplet pour cette carte. */
  details: CardDetailRow | null;
  index: CardIndex;
}

export interface SearchCatalog {
  cards: SearchableCard[];
  /** Détails présents pour toutes les cartes : les filtres avancés sont utilisables. */
  complete: boolean;
}

/** Repli puis retrait de la ponctuation (lettres, chiffres et espaces seulement). */
export const bareText = (folded: string): string =>
  folded
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();

const initialsOf = (bare: string): string =>
  bare
    .split(" ")
    .filter((word) => word !== "")
    .map((word) => word[0])
    .join("");

/** Barème des votes de VDB, par titre replié. */
export const TITLE_VOTES: Readonly<Record<string, number>> = {
  primogen: 1,
  prince: 2,
  justicar: 3,
  imperator: 3,
  "inner circle": 4,
  bishop: 1,
  archbishop: 2,
  priscus: 3,
  cardinal: 3,
  regent: 4,
  "1 vote": 1,
  "2 votes": 2,
  magaji: 2,
  kholo: 2,
  baron: 2,
};

export const REFLEX_TYPE = "Reflex";

const votesOf = (title: string | null): number => (title === null ? 0 : (TITLE_VOTES[foldText(title)] ?? 0));

export function indexCard(card: CardRow, details: CardDetailRow | null): SearchableCard {
  const bareName = bareText(card.foldedName);
  const types = new Set(details?.types ?? []);
  if (details?.foldedText.includes("[reflex]")) types.add(REFLEX_TYPE);
  return {
    card,
    details,
    index: {
      bareName,
      initials: initialsOf(bareName),
      bareTranslatedNames: (details?.foldedTranslatedNames ?? []).map(bareText),
      disciplines: new Map((details?.disciplines ?? []).map((link) => [link.code, link.superior])),
      types,
      votes: votesOf(details?.title ?? null),
    },
  };
}

/** Joint les deux magasins et indexe chaque carte. L'ordre est celui de `cards`. */
export function buildSearchCatalog(cards: CardRow[], details: CardDetailRow[]): SearchCatalog {
  const byId = new Map(details.map((row) => [row.id, row]));
  return {
    cards: cards.map((card) => indexCard(card, byId.get(card.id) ?? null)),
    complete: cards.length > 0 && cards.every((card) => byId.has(card.id)),
  };
}

// --- Critères ---------------------------------------------------------------

/** Champ d'une ligne de texte : nom et texte, nom seul, texte seul. */
export type TextField = "all" | "name" | "text";

export interface TextLine {
  value: string;
  field: TextField;
  /** `and` : doit correspondre ; `not` : ne doit pas. */
  mode: "and" | "not";
}

/** OU, ET, NON : modes d'un filtre à plusieurs valeurs. */
export type SetMode = "or" | "and" | "not";
/** Les quatre modes des disciplines de bibliothèque. */
export type LibraryDisciplineMode = "or" | "and" | "not" | "only";

export interface ValueFilter<M extends string = SetMode> {
  values: string[];
  mode: M;
}

export type Comparison = "le" | "eq" | "ge";

export interface NumberLine {
  op: Comparison;
  value: number;
}

export type DisciplineLevel = "inferior" | "superior";

export interface DisciplineChoice {
  code: string;
  level: DisciplineLevel;
}

/** Valeur « non requis » des filtres d'exigence de bibliothèque (clan, secte). */
export const NOT_REQUIRED = "__not_required__";
/** Valeur « non titré » du filtre de titre de crypte. */
export const NON_TITLED = "__non_titled__";
/** Valeurs du titre requis en bibliothèque, à côté des titres précis. */
export const REQUIRES_TITLED = "__titled__";
export const REQUIRES_TITLED_SPECIFIC = "__titled_specific__";
export const REQUIRES_NON_TITLED = "__non_titled_required__";

export interface CryptCriteria {
  /** Grille des disciplines (vertus comprises), en ET ; inférieure = « au moins inférieure ». */
  disciplines?: DisciplineChoice[];
  /** Paires OU : exactement deux disciplines, OU dans la paire, ET entre paires. */
  disciplinePairs?: Array<[DisciplineChoice, DisciplineChoice]>;
  /** Clan et voie de la carte. */
  clans?: ValueFilter;
  sects?: ValueFilter<"or" | "not">;
  /** Codes de groupe (`G1`…`G7`), en OU ; une carte de groupe « Any » répond toujours. */
  groups?: string[];
  capacity?: { lines: NumberLine[]; mode: "or" | "not" };
  /** Titres en OU, `NON_TITLED` compris. */
  titles?: string[];
  /** `none` : aucun vote ; un nombre : au moins autant de votes. */
  votes?: "none" | 1 | 2 | 3 | 4;
}

export interface LibraryCriteria {
  /** Types en OU, ET ou NON ; `REFLEX_TYPE` compris. */
  types?: ValueFilter;
  disciplines?: ValueFilter<LibraryDisciplineMode> | { mode: "not_required" };
  /** Clans et voies requis, `NOT_REQUIRED` compris. */
  clans?: ValueFilter<"or" | "not">;
  /** Sectes requises, `NOT_REQUIRED` compris. */
  sects?: ValueFilter<"or" | "not">;
  /** Titres requis : titres précis, `REQUIRES_TITLED`, `REQUIRES_TITLED_SPECIFIC`, `REQUIRES_NON_TITLED`. */
  titles?: ValueFilter<"or" | "not">;
  bloodCost?: NumberLine;
  poolCost?: NumberLine;
}

export type LegalityFilter = "legal" | "banned" | "not_yet_legal";

export interface SearchCriteria {
  /** Champ principal : nom (noms traduits compris) et texte anglais. */
  query?: string;
  textLines?: TextLine[];
  category?: CardCategory | null;
  /** Extensions en OU : carte imprimée dans l'une d'elles. */
  cardSetIds?: number[];
  legality?: LegalityFilter | null;
  owned?: "owned" | "not_owned" | null;
  inDeck?: "in" | "not_in" | null;
  crypt?: CryptCriteria;
  library?: LibraryCriteria;
}

export interface SearchContext {
  /** Cartes dont une entrée de collection a au moins un exemplaire. */
  ownedCardIds?: ReadonlySet<number>;
  /** Cartes présentes dans le deck choisi (projection, file comprise). */
  deckCardIds?: ReadonlySet<number>;
  /** Date d'évaluation de la légalité, `YYYY-MM-DD` (`todayUtc()` côté appelant). */
  on: string;
}

type Predicate = (item: SearchableCard) => boolean;

// --- Outils de comparaison --------------------------------------------------

const SET_MODES: Record<SetMode, (owned: ReadonlySet<string>, selected: string[]) => boolean> = {
  or: (owned, selected) => selected.some((value) => owned.has(value)),
  and: (owned, selected) => selected.every((value) => owned.has(value)),
  not: (owned, selected) => !selected.some((value) => owned.has(value)),
};

/** Compare les valeurs d'une carte à une sélection, selon le mode. */
export const matchValues = (owned: ReadonlySet<string>, filter: ValueFilter): boolean =>
  SET_MODES[filter.mode](owned, filter.values);

const COMPARISONS: Record<Comparison, (actual: number, expected: number) => boolean> = {
  le: (actual, expected) => actual <= expected,
  eq: (actual, expected) => actual === expected,
  ge: (actual, expected) => actual >= expected,
};

export const compareNumber = (actual: number, line: NumberLine): boolean =>
  COMPARISONS[line.op](actual, line.value);

const active = <T>(values: readonly T[] | undefined): values is readonly T[] =>
  values !== undefined && values.length > 0;

/** Un filtre qui a besoin des détails : faux sans eux. */
const withDetails =
  (test: (item: SearchableCard, details: CardDetailRow) => boolean): Predicate =>
  (item) =>
    item.details !== null && test(item, item.details);

const ofCategory = (category: CardCategory, test: Predicate): Predicate => (item) =>
  item.card.category === category && test(item);

// --- Texte ------------------------------------------------------------------

interface Needle {
  folded: string;
  /**
   * La saisie repliée, espaces réduits, comparée au nom **sans ponctuation** :
   * « 44 magnum » trouve « .44 Magnum », « jacks » trouve « Jack's Hammer ».
   * La saisie, elle, garde sa ponctuation : « [obf] » cherche l'icône, pas
   * tout nom qui contient « obf ».
   */
  bare: string;
  /** Saisie de deux à cinq lettres ou chiffres sans espace : comparée aussi aux initiales. */
  initials: boolean;
}

export const needleOf = (value: string): Needle => {
  const folded = foldText(value).trim();
  return {
    folded,
    bare: folded.replace(/\s+/g, " "),
    initials: /^[\p{L}\p{N}]{2,5}$/u.test(folded),
  };
};

const includesBare = (haystacks: string[], bare: string) =>
  bare !== "" && haystacks.some((haystack) => haystack.includes(bare));

/** Le nom : anglais, sans ponctuation, initiales, puis noms traduits. */
export function nameMatches(item: SearchableCard, needle: Needle): boolean {
  if (item.card.foldedName.includes(needle.folded)) return true;
  if (includesBare([item.index.bareName], needle.bare)) return true;
  if (needle.initials && item.index.initials === needle.folded) return true;
  if (item.details?.foldedTranslatedNames.some((name) => name.includes(needle.folded))) return true;
  return includesBare(item.index.bareTranslatedNames, needle.bare);
}

/** Le texte anglais de la carte ; faux sans détails. */
export const textMatches = (item: SearchableCard, needle: Needle): boolean =>
  item.details !== null && item.details.foldedText.includes(needle.folded);

const FIELD_MATCHERS: Record<TextField, (item: SearchableCard, needle: Needle) => boolean> = {
  all: (item, needle) => nameMatches(item, needle) || textMatches(item, needle),
  name: nameMatches,
  text: textMatches,
};

function queryPredicate(criteria: SearchCriteria): Predicate | null {
  const needle = needleOf(criteria.query ?? "");
  if (needle.folded === "") return null;
  return (item) => FIELD_MATCHERS.all(item, needle);
}

function textLinesPredicate(criteria: SearchCriteria): Predicate | null {
  const lines = (criteria.textLines ?? [])
    .map((line) => ({ ...line, needle: needleOf(line.value) }))
    .filter((line) => line.needle.folded !== "");
  if (lines.length === 0) return null;
  return (item) =>
    lines.every((line) => FIELD_MATCHERS[line.field](item, line.needle) === (line.mode === "and"));
}

// --- Communs ----------------------------------------------------------------

function categoryPredicate(criteria: SearchCriteria): Predicate | null {
  const category = criteria.category;
  return category ? (item) => item.card.category === category : null;
}

function cardSetPredicate(criteria: SearchCriteria): Predicate | null {
  if (!active(criteria.cardSetIds)) return null;
  const selected = new Set(criteria.cardSetIds);
  return (item) => item.card.cardSetIds.some((id) => selected.has(id));
}

const LEGALITY_TESTS: Record<LegalityFilter, (legality: ReturnType<typeof cardLegality>) => boolean> = {
  legal: (legality) => !legality.banned && !legality.notYetLegal,
  banned: (legality) => legality.banned,
  not_yet_legal: (legality) => legality.notYetLegal,
};

function legalityPredicate(criteria: SearchCriteria, context: SearchContext): Predicate | null {
  const filter = criteria.legality;
  if (!filter) return null;
  return withDetails((_, details) =>
    LEGALITY_TESTS[filter](cardLegality(details.bannedOn, details.legalFrom, context.on)),
  );
}

const membership = (ids: ReadonlySet<number> | undefined, wanted: boolean): Predicate => (item) =>
  (ids?.has(item.card.id) ?? false) === wanted;

function ownedPredicate(criteria: SearchCriteria, context: SearchContext): Predicate | null {
  return criteria.owned ? membership(context.ownedCardIds, criteria.owned === "owned") : null;
}

function inDeckPredicate(criteria: SearchCriteria, context: SearchContext): Predicate | null {
  return criteria.inDeck ? membership(context.deckCardIds, criteria.inDeck === "in") : null;
}

// --- Crypte -----------------------------------------------------------------

/** Inférieure se lit « au moins inférieure », supérieure « supérieure seulement ». */
export const hasDiscipline = (item: SearchableCard, choice: DisciplineChoice): boolean => {
  const superior = item.index.disciplines.get(choice.code);
  return superior !== undefined && (choice.level === "inferior" || superior);
};

function cryptDisciplinesPredicate(crypt: CryptCriteria): Predicate | null {
  const grid = crypt.disciplines;
  if (!active(grid)) return null;
  return withDetails((item) => grid.every((choice) => hasDiscipline(item, choice)));
}

function cryptPairsPredicate(crypt: CryptCriteria): Predicate | null {
  const pairs = crypt.disciplinePairs;
  if (!active(pairs)) return null;
  return withDetails((item) => pairs.every((pair) => pair.some((choice) => hasDiscipline(item, choice))));
}

function cryptClansPredicate(crypt: CryptCriteria): Predicate | null {
  const filter = crypt.clans;
  if (!filter || !active(filter.values)) return null;
  return withDetails((item, details) => {
    const values = new Set([item.card.clanName, details.path].filter((value) => value !== null));
    return matchValues(values, filter);
  });
}

function cryptSectsPredicate(crypt: CryptCriteria): Predicate | null {
  const filter = crypt.sects;
  if (!filter || !active(filter.values)) return null;
  return withDetails((_, details) => matchValues(new Set(details.sect ? [details.sect] : []), filter));
}

export const ANY_GROUP = "Any";

function cryptGroupsPredicate(crypt: CryptCriteria): Predicate | null {
  if (!active(crypt.groups)) return null;
  const groups = new Set(crypt.groups);
  return (item) => item.card.groupCode === ANY_GROUP || groups.has(item.card.groupCode ?? "");
}

function cryptCapacityPredicate(crypt: CryptCriteria): Predicate | null {
  const filter = crypt.capacity;
  if (!filter || !active(filter.lines)) return null;
  return (item) => {
    const capacity = item.card.capacity;
    const any = capacity !== null && filter.lines.some((line) => compareNumber(capacity, line));
    return any === (filter.mode === "or");
  };
}

function cryptTitlesPredicate(crypt: CryptCriteria): Predicate | null {
  if (!active(crypt.titles)) return null;
  const titles = new Set(crypt.titles);
  return withDetails((_, details) => titles.has(details.title ?? NON_TITLED));
}

function cryptVotesPredicate(crypt: CryptCriteria): Predicate | null {
  const votes = crypt.votes;
  if (votes === undefined) return null;
  const test = votes === "none" ? (n: number) => n === 0 : (n: number) => n >= votes;
  return withDetails((item) => test(item.index.votes));
}

const CRYPT_BUILDERS: Array<(crypt: CryptCriteria) => Predicate | null> = [
  cryptDisciplinesPredicate,
  cryptPairsPredicate,
  cryptClansPredicate,
  cryptSectsPredicate,
  cryptGroupsPredicate,
  cryptCapacityPredicate,
  cryptTitlesPredicate,
  cryptVotesPredicate,
];

// --- Bibliothèque -----------------------------------------------------------

/**
 * Disciplines de bibliothèque, au sens de krcg (tableau de P1). *D* : les
 * disciplines de la carte ; *S* : les cochées. Une carte sans exigence n'a pas
 * de *D*.
 */
type DisciplineTest = (requirement: CardDetailRow["disciplineRequirement"], disciplines: string[], selected: Set<string>) => boolean;

const intersects = (disciplines: string[], selected: Set<string>) => disciplines.some((code) => selected.has(code));
const within = (disciplines: string[], selected: Set<string>) => disciplines.every((code) => selected.has(code));
const covers = (disciplines: string[], selected: Set<string>) => [...selected].every((code) => disciplines.includes(code));

/** ET : la carte ne peut pas se jouer sans chacune des cochées. Une carte au choix n'exige aucune discipline en particulier, sauf réduite à une seule. */
const requiresEach: DisciplineTest = (requirement, disciplines, selected) =>
  requirement === "choice" ? disciplines.length === 1 && covers(disciplines, selected) && selected.size === 1 : covers(disciplines, selected);

/** SEULEMENT : un vampire qui n'a que les cochées peut jouer la carte. */
const playableWith: DisciplineTest = (requirement, disciplines, selected) =>
  requirement === "combo" ? within(disciplines, selected) : intersects(disciplines, selected);

const LIBRARY_DISCIPLINE_MODES: Record<LibraryDisciplineMode, DisciplineTest> = {
  or: (_, disciplines, selected) => intersects(disciplines, selected),
  and: requiresEach,
  not: (_, disciplines, selected) => !intersects(disciplines, selected),
  only: playableWith,
};

/** Une carte sans exigence répond à NON et à « non requise » seulement. */
export function libraryDisciplineMatches(
  details: CardDetailRow,
  filter: NonNullable<LibraryCriteria["disciplines"]>,
): boolean {
  const disciplines = details.disciplines.map((link) => link.code);
  const required = disciplines.length > 0;
  if (filter.mode === "not_required") return !required;
  if (!required) return filter.mode === "not";
  return LIBRARY_DISCIPLINE_MODES[filter.mode](details.disciplineRequirement, disciplines, new Set(filter.values));
}

function libraryDisciplinesPredicate(library: LibraryCriteria): Predicate | null {
  const filter = library.disciplines;
  if (!filter || (filter.mode !== "not_required" && !active(filter.values))) return null;
  return withDetails((_, details) => libraryDisciplineMatches(details, filter));
}

function libraryTypesPredicate(library: LibraryCriteria): Predicate | null {
  const filter = library.types;
  if (!filter || !active(filter.values)) return null;
  return withDetails((item) => matchValues(item.index.types, filter));
}

/** Les valeurs d'exigence d'une carte, ou `NOT_REQUIRED` quand elle n'en a aucune. */
const requirementValues = (values: string[]): Set<string> => new Set(values.length > 0 ? values : [NOT_REQUIRED]);

function libraryClansPredicate(library: LibraryCriteria): Predicate | null {
  const filter = library.clans;
  if (!filter || !active(filter.values)) return null;
  return withDetails((_, details) =>
    matchValues(requirementValues([...details.clanRequirements, ...details.pathRequirements]), filter),
  );
}

function librarySectsPredicate(library: LibraryCriteria): Predicate | null {
  const filter = library.sects;
  if (!filter || !active(filter.values)) return null;
  return withDetails((_, details) => matchValues(requirementValues(details.requiredSects), filter));
}

/** Titres requis : les titres précis, plus les trois valeurs synthétiques. */
export function requiredTitleValues(details: CardDetailRow): Set<string> {
  const values = new Set(details.requiredTitles);
  if (details.requiredTitles.length > 0) values.add(REQUIRES_TITLED_SPECIFIC);
  if (details.requiresTitled) values.add(REQUIRES_TITLED);
  if (details.requiresNonTitled) values.add(REQUIRES_NON_TITLED);
  return values;
}

function libraryTitlesPredicate(library: LibraryCriteria): Predicate | null {
  const filter = library.titles;
  if (!filter || !active(filter.values)) return null;
  return withDetails((_, details) => matchValues(requiredTitleValues(details), filter));
}

/**
 * Coût dans une monnaie : un coût absent vaut 0, un coût « X » passe toujours
 * (comme chez VDB).
 */
export function costMatches(details: CardDetailRow, costType: "blood" | "pool", line: NumberLine): boolean {
  if (details.costType !== costType) return compareNumber(0, line);
  if (details.costValue === "X") return true;
  return compareNumber(Number(details.costValue ?? 0), line);
}

const costPredicate =
  (costType: "blood" | "pool", pick: (library: LibraryCriteria) => NumberLine | undefined) =>
  (library: LibraryCriteria): Predicate | null => {
    const line = pick(library);
    return line ? withDetails((_, details) => costMatches(details, costType, line)) : null;
  };

const LIBRARY_BUILDERS: Array<(library: LibraryCriteria) => Predicate | null> = [
  libraryTypesPredicate,
  libraryDisciplinesPredicate,
  libraryClansPredicate,
  librarySectsPredicate,
  libraryTitlesPredicate,
  costPredicate("blood", (library) => library.bloodCost),
  costPredicate("pool", (library) => library.poolCost),
];

const nonNull = <T>(value: T | null): value is T => value !== null;

/** Les filtres d'une catégorie, chacun écartant l'autre catégorie. */
function categoryPredicates<T>(
  category: CardCategory,
  criteria: T | undefined,
  builders: Array<(criteria: T) => Predicate | null>,
): Predicate[] {
  if (!criteria) return [];
  return builders
    .map((build) => build(criteria))
    .filter(nonNull)
    .map((test) => ofCategory(category, test));
}

const COMMON_BUILDERS: Array<(criteria: SearchCriteria, context: SearchContext) => Predicate | null> = [
  queryPredicate,
  textLinesPredicate,
  categoryPredicate,
  cardSetPredicate,
  legalityPredicate,
  ownedPredicate,
  inDeckPredicate,
];

/** Les filtres actifs d'une recherche, en ET. */
export function searchPredicates(criteria: SearchCriteria, context: SearchContext): Predicate[] {
  return [
    ...COMMON_BUILDERS.map((build) => build(criteria, context)).filter(nonNull),
    ...categoryPredicates("crypt", criteria.crypt, CRYPT_BUILDERS),
    ...categoryPredicates("library", criteria.library, LIBRARY_BUILDERS),
  ];
}

/** Nombre de filtres actifs hors champ principal (le compteur du bouton « Filtres »). */
export const activeFilterCount = (criteria: SearchCriteria, context: SearchContext): number =>
  searchPredicates({ ...criteria, query: undefined }, context).length;

export function filterCards(
  cards: readonly SearchableCard[],
  criteria: SearchCriteria,
  context: SearchContext,
): SearchableCard[] {
  const predicates = searchPredicates(criteria, context);
  return cards.filter((item) => predicates.every((test) => test(item)));
}

// --- Tri (P9) ---------------------------------------------------------------

export type CardSortKey = "name" | "capacity" | "group" | "cost";

export interface CardSort {
  key: CardSortKey;
  direction?: "asc" | "desc";
}

const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Nom replié, puis groupe, puis identifiant : l'ordre par défaut, et le départage de tous les tris. */
const byName = (a: SearchableCard, b: SearchableCard) =>
  compareText(a.card.foldedName, b.card.foldedName) ||
  compareText(a.card.groupCode ?? "", b.card.groupCode ?? "") ||
  a.card.id - b.card.id;

/** Rang du coût : valeur croissante, « X » après les nombres, sans coût en dernier. */
export const costRank = (details: CardDetailRow | null): number => {
  const value = details?.costValue ?? null;
  if (value === null) return Number.MAX_SAFE_INTEGER;
  return value === "X" ? Number.MAX_SAFE_INTEGER - 1 : Number(value);
};

/** Une valeur absente se range toujours en dernier, quel que soit le sens. */
const SORT_VALUES: Record<Exclude<CardSortKey, "name">, (item: SearchableCard) => number | null> = {
  capacity: (item) => item.card.capacity,
  group: (item) => (item.card.groupCode?.startsWith("G") ? Number(item.card.groupCode.slice(1)) : null),
  cost: (item) => {
    const rank = costRank(item.details);
    return rank === Number.MAX_SAFE_INTEGER ? null : rank;
  },
};

function compareValues(a: number | null, b: number | null, sign: number): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return (a - b) * sign;
}

export function sortCards(cards: readonly SearchableCard[], sort: CardSort = { key: "name" }): SearchableCard[] {
  const sign = sort.direction === "desc" ? -1 : 1;
  if (sort.key === "name") return [...cards].sort((a, b) => byName(a, b) * sign);
  const value = SORT_VALUES[sort.key];
  return [...cards].sort((a, b) => compareValues(value(a), value(b), sign) || byName(a, b));
}

/**
 * Proposition de P1, à valider en D1c : sous le tri par défaut, les cartes dont
 * le **nom** correspond au champ principal passent devant celles qui ne
 * correspondent que par le texte, chaque groupe gardant son ordre. Rend aussi
 * la taille du premier groupe, pour un compteur qui distingue les deux.
 */
export function nameMatchesFirst(
  cards: readonly SearchableCard[],
  query: string,
): { cards: SearchableCard[]; byName: number } {
  const needle = needleOf(query);
  if (needle.folded === "") return { cards: [...cards], byName: cards.length };
  const named = cards.filter((item) => nameMatches(item, needle));
  const rest = cards.filter((item) => !nameMatches(item, needle));
  return { cards: [...named, ...rest], byName: named.length };
}
