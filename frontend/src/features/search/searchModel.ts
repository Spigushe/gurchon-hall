import {
  NON_TITLED,
  NOT_REQUIRED,
  REQUIRES_NON_TITLED,
  REQUIRES_TITLED,
  REQUIRES_TITLED_SPECIFIC,
  type CardSort,
  type CryptCriteria,
  type DeckKey,
  type DisciplineChoice,
  type LegalityFilter,
  type LibraryCriteria,
  type LibraryDisciplineMode,
  type NumberLine,
  type SearchCriteria,
  type SetMode,
  type TextLine,
} from "../../offline/vtes";

/**
 * État de la page Chercher (lot Chercher, D1c) et sa traduction en critères de
 * `filterCards`. Fonctions pures, testées à part : la page ne fait que relier
 * ces fonctions aux contrôles.
 *
 * Choix de lecture :
 * - sous « Toutes », les filtres de crypte et de bibliothèque sont masqués
 *   (handoff) **et** ne s'appliquent pas : ils restent dans l'état, si bien
 *   que revenir à leur catégorie les retrouve ; sous « Crypte », les filtres
 *   de bibliothèque sont ignorés, et inversement ;
 * - le filtre « deck » n'est actif qu'avec un deck choisi ;
 * - le tri par défaut (`sort: null`) est le nom replié, avec les cartes
 *   trouvées par leur nom devant celles trouvées par leur texte (proposition
 *   de P1 et P9, retenue par le handoff D0) ; un tri choisi efface ce
 *   regroupement.
 */

export type CategoryTab = "all" | "crypt" | "library";

export type OwnedFilter = "owned" | "not_owned" | null;
export type DeckFilter = "in" | "not_in" | null;

export interface CommonFilters {
  textLines: TextLine[];
  cardSetIds: number[];
  legality: LegalityFilter | null;
  owned: OwnedFilter;
  inDeck: DeckFilter;
}

export interface SearchState {
  query: string;
  category: CategoryTab;
  common: CommonFilters;
  crypt: CryptCriteria;
  library: LibraryCriteria;
  /** Deck cible : filtre « dans ce deck » (P4) et, plus tard, feuille d'ajout (P12). */
  deckKey: DeckKey | null;
  /** `null` : tri par défaut. */
  sort: CardSort | null;
}

export const EMPTY_COMMON: CommonFilters = { textLines: [], cardSetIds: [], legality: null, owned: null, inDeck: null };

export function initialState(query = "", deckKey: DeckKey | null = null): SearchState {
  return {
    query,
    category: "all",
    common: { ...EMPTY_COMMON, inDeck: deckKey ? "not_in" : null },
    crypt: {},
    library: {},
    deckKey,
    sort: null,
  };
}

/** Les critères que lit `filterCards`, la catégorie choisie décidant quels filtres propres s'appliquent. */
export function criteriaOf(state: SearchState, query: string = state.query): SearchCriteria {
  const { common, category } = state;
  return {
    query,
    textLines: common.textLines,
    category: category === "all" ? null : category,
    cardSetIds: common.cardSetIds,
    legality: common.legality,
    owned: common.owned,
    inDeck: state.deckKey ? common.inDeck : null,
    crypt: category === "crypt" ? state.crypt : undefined,
    library: category === "library" ? state.library : undefined,
  };
}

/** Tri par défaut : regroupement par le nom. Un tri choisi l'efface. */
export const isDefaultSort = (sort: CardSort | null) => sort === null || (sort.key === "name" && sort.direction !== "desc");

// --- Filtres : clés, sections, activité ------------------------------------

export type CommonFilterKey = "text" | "cardSets" | "legality" | "owned" | "deck";
export type CryptFilterKey = "cryptDisciplines" | "virtues" | "cryptClans" | "cryptSects" | "groups" | "capacity" | "cryptTitles" | "votes";
export type LibraryFilterKey = "types" | "libraryDisciplines" | "libraryClans" | "librarySects" | "libraryTitles" | "bloodCost" | "poolCost";
export type FilterKey = CommonFilterKey | CryptFilterKey | LibraryFilterKey;

export const COMMON_FILTERS: CommonFilterKey[] = ["text", "cardSets", "legality", "owned", "deck"];
export const CRYPT_FILTERS: CryptFilterKey[] = ["cryptDisciplines", "virtues", "cryptClans", "cryptSects", "groups", "capacity", "cryptTitles", "votes"];
export const LIBRARY_FILTERS: LibraryFilterKey[] = ["types", "libraryDisciplines", "libraryClans", "librarySects", "libraryTitles", "bloodCost", "poolCost"];

export const FILTER_LABELS: Record<FilterKey, string> = {
  text: "Texte",
  cardSets: "Extension",
  legality: "Légalité",
  owned: "Possédée",
  deck: "Deck",
  cryptDisciplines: "Disciplines",
  virtues: "Vertus",
  cryptClans: "Clan",
  cryptSects: "Secte",
  groups: "Groupe",
  capacity: "Capacité",
  cryptTitles: "Titre",
  votes: "Votes",
  types: "Type",
  libraryDisciplines: "Disciplines",
  libraryClans: "Clan requis",
  librarySects: "Secte requise",
  libraryTitles: "Titre requis",
  bloodCost: "Coût en sang",
  poolCost: "Coût en pool",
};

/** Les filtres visibles sous une catégorie, par section. */
export function visibleSections(category: CategoryTab): Array<{ id: "common" | "crypt" | "library"; keys: FilterKey[] }> {
  const sections: Array<{ id: "common" | "crypt" | "library"; keys: FilterKey[] }> = [{ id: "common", keys: COMMON_FILTERS }];
  if (category === "crypt") sections.push({ id: "crypt", keys: CRYPT_FILTERS });
  if (category === "library") sections.push({ id: "library", keys: LIBRARY_FILTERS });
  return sections;
}

export const SECTION_LABELS = { common: "Communs", crypt: "Crypte", library: "Bibliothèque" } as const;

const nonEmpty = (values: readonly unknown[] | undefined) => (values?.length ?? 0) > 0;
const filled = (filter: { values: readonly unknown[] } | undefined) => nonEmpty(filter?.values);
const textLineActive = (line: TextLine) => line.value.trim() !== "";
export const isVirtue = (choice: DisciplineChoice, virtues: ReadonlySet<string>) => virtues.has(choice.code);

/** Un filtre est-il actif ? `virtues` sépare les vertus de la grille des disciplines de crypte. */
export function isFilterActive(state: SearchState, key: FilterKey, virtues: ReadonlySet<string>): boolean {
  const { common, crypt, library } = state;
  const tests: Record<FilterKey, () => boolean> = {
    text: () => common.textLines.some(textLineActive),
    cardSets: () => common.cardSetIds.length > 0,
    legality: () => common.legality !== null,
    owned: () => common.owned !== null,
    deck: () => state.deckKey !== null && common.inDeck !== null,
    cryptDisciplines: () =>
      (crypt.disciplines ?? []).some((choice) => !isVirtue(choice, virtues)) || nonEmpty(crypt.disciplinePairs),
    virtues: () => (crypt.disciplines ?? []).some((choice) => isVirtue(choice, virtues)),
    cryptClans: () => filled(crypt.clans),
    cryptSects: () => filled(crypt.sects),
    groups: () => nonEmpty(crypt.groups),
    capacity: () => nonEmpty(crypt.capacity?.lines),
    cryptTitles: () => nonEmpty(crypt.titles),
    votes: () => crypt.votes !== undefined,
    types: () => filled(library.types),
    libraryDisciplines: () => library.disciplines?.mode === "not_required" || filled(library.disciplines as { values: string[] } | undefined),
    libraryClans: () => filled(library.clans),
    librarySects: () => filled(library.sects),
    libraryTitles: () => filled(library.titles),
    bloodCost: () => library.bloodCost !== undefined,
    poolCost: () => library.poolCost !== undefined,
  };
  return tests[key]();
}

/** Nombre de filtres actifs qui s'appliquent à la catégorie choisie (« 4 filtres »). */
export function activeFilterTotal(state: SearchState, virtues: ReadonlySet<string>): number {
  return visibleSections(state.category)
    .flatMap((section) => section.keys)
    .filter((key) => isFilterActive(state, key, virtues)).length;
}

/** Efface un filtre, sans toucher aux autres. */
export function clearFilter(state: SearchState, key: FilterKey, virtues: ReadonlySet<string>): SearchState {
  const { common, crypt, library } = state;
  const keepOthers = (keepVirtues: boolean) =>
    (crypt.disciplines ?? []).filter((choice) => isVirtue(choice, virtues) === keepVirtues);
  const clears: Record<FilterKey, () => SearchState> = {
    text: () => ({ ...state, common: { ...common, textLines: [] } }),
    cardSets: () => ({ ...state, common: { ...common, cardSetIds: [] } }),
    legality: () => ({ ...state, common: { ...common, legality: null } }),
    owned: () => ({ ...state, common: { ...common, owned: null } }),
    deck: () => ({ ...state, common: { ...common, inDeck: null } }),
    cryptDisciplines: () => ({ ...state, crypt: { ...crypt, disciplines: keepOthers(true), disciplinePairs: [] } }),
    virtues: () => ({ ...state, crypt: { ...crypt, disciplines: keepOthers(false) } }),
    cryptClans: () => ({ ...state, crypt: { ...crypt, clans: undefined } }),
    cryptSects: () => ({ ...state, crypt: { ...crypt, sects: undefined } }),
    groups: () => ({ ...state, crypt: { ...crypt, groups: [] } }),
    capacity: () => ({ ...state, crypt: { ...crypt, capacity: undefined } }),
    cryptTitles: () => ({ ...state, crypt: { ...crypt, titles: [] } }),
    votes: () => ({ ...state, crypt: { ...crypt, votes: undefined } }),
    types: () => ({ ...state, library: { ...library, types: undefined } }),
    libraryDisciplines: () => ({ ...state, library: { ...library, disciplines: undefined } }),
    libraryClans: () => ({ ...state, library: { ...library, clans: undefined } }),
    librarySects: () => ({ ...state, library: { ...library, sects: undefined } }),
    libraryTitles: () => ({ ...state, library: { ...library, titles: undefined } }),
    bloodCost: () => ({ ...state, library: { ...library, bloodCost: undefined } }),
    poolCost: () => ({ ...state, library: { ...library, poolCost: undefined } }),
  };
  return clears[key]();
}

/** « Réinitialiser » : retire les filtres de la catégorie choisie, garde le texte cherché, la catégorie, le deck cible et le tri. */
export function resetFilters(state: SearchState, virtues: ReadonlySet<string>): SearchState {
  return visibleSections(state.category)
    .flatMap((section) => section.keys)
    .reduce((next, key) => clearFilter(next, key, virtues), state);
}

// --- Modes ------------------------------------------------------------------

export type AnyMode = SetMode | LibraryDisciplineMode;

export const MODE_LABELS: Record<AnyMode, string> = { or: "OU", and: "ET", not: "NON", only: "SEULEMENT" };

/** Mode suivant, en boucle (la pastille qui cycle au toucher). */
export function nextMode<M extends AnyMode>(modes: readonly M[], current: M): M {
  return modes[(modes.indexOf(current) + 1) % modes.length];
}

export const GENERIC_MODE_HELP: Record<SetMode, string> = {
  or: "Au moins une des valeurs cochées.",
  and: "Toutes les valeurs cochées, sur la même carte.",
  not: "Aucune des valeurs cochées.",
};

/** Phrases d'aide du handoff (écran 30), pour les disciplines de bibliothèque. */
export const LIBRARY_DISCIPLINE_HELP: Record<LibraryDisciplineMode, string> = {
  or: "Au moins une des disciplines cochées.",
  and: "Toutes les disciplines cochées, sur la même carte.",
  not: "Aucune des disciplines cochées.",
  only: "Jouable avec les seules disciplines cochées : les cartes sans discipline restent, celles qui en demandent une autre sortent.",
};

// --- Grilles de disciplines --------------------------------------------------

/** Crypte : rien → inférieure → supérieure → rien. */
export function cycleCryptDiscipline(choices: DisciplineChoice[], code: string): DisciplineChoice[] {
  const current = choices.find((choice) => choice.code === code);
  const others = choices.filter((choice) => choice.code !== code);
  if (!current) return [...others, { code, level: "inferior" }];
  if (current.level === "inferior") return [...others, { code, level: "superior" }];
  return others;
}

export const toggleValue = <T>(values: readonly T[], value: T): T[] =>
  values.includes(value) ? values.filter((item) => item !== value) : [...values, value];

/**
 * Coche ou décoche une valeur d'un filtre à modes. Un filtre vidé garde son
 * mode : il est inactif (`filterCards` ignore un filtre sans valeur), mais le
 * mode choisi avant la première valeur n'est pas perdu.
 */
export function toggleInFilter<M extends string>(
  filter: { values: string[]; mode: M } | undefined,
  value: string,
  defaultMode: M,
): { values: string[]; mode: M } {
  return { values: toggleValue(filter?.values ?? [], value), mode: filter?.mode ?? defaultMode };
}

// --- Résumés (valeur affichée à droite d'une ligne de filtre) ----------------

export interface SummaryContext {
  cardSetName: (id: number) => string;
  deckName: (key: DeckKey) => string | null;
  disciplineName: (code: string) => string;
  virtues: ReadonlySet<string>;
}

const COMPARISON_SIGNS = { le: "≤", eq: "=", ge: "≥" } as const;
export const numberLineLabel = (line: NumberLine) => `${COMPARISON_SIGNS[line.op]} ${line.value}`;

const listOf = (values: readonly string[], max = 2) =>
  values.length <= max ? values.join(", ") : `${values.slice(0, max).join(", ")} +${values.length - max}`;

export const LEGALITY_LABELS: Record<LegalityFilter, string> = {
  legal: "légale aujourd'hui",
  banned: "bannie",
  not_yet_legal: "pas encore légale",
};

export const OWNED_LABELS = { owned: "possédée", not_owned: "non possédée" } as const;
export const DECK_FILTER_LABELS = { in: "dans ce deck", not_in: "pas dans ce deck" } as const;

export const SPECIAL_VALUE_LABELS: Record<string, string> = {
  [NOT_REQUIRED]: "non requis",
  [NON_TITLED]: "non titré",
  [REQUIRES_TITLED]: "n'importe quel titre",
  [REQUIRES_TITLED_SPECIFIC]: "un titre précis",
  [REQUIRES_NON_TITLED]: "non titré",
};

export const valueLabel = (value: string) => SPECIAL_VALUE_LABELS[value] ?? value;

const VOTE_LABELS = { none: "aucun vote", 1: "1 et plus", 2: "2 et plus", 3: "3 et plus", 4: "4 et plus" } as const;

const choiceLabel = (choice: DisciplineChoice, ctx: SummaryContext) =>
  `${ctx.disciplineName(choice.code)}${choice.level === "superior" ? " sup." : ""}`;

/** La valeur affichée d'un filtre ; `null` quand il est inactif (« indifférent »). */
export function filterSummary(state: SearchState, key: FilterKey, ctx: SummaryContext): string | null {
  if (!isFilterActive(state, key, ctx.virtues)) return null;
  const { common, crypt, library } = state;
  const disciplines = (virtue: boolean) =>
    (crypt.disciplines ?? []).filter((choice) => isVirtue(choice, ctx.virtues) === virtue).map((choice) => choiceLabel(choice, ctx));
  const summaries: Record<FilterKey, () => string> = {
    text: () => listOf(common.textLines.filter(textLineActive).map((line) => `${line.mode === "not" ? "sans " : ""}« ${line.value.trim()} »`), 1),
    cardSets: () => listOf(common.cardSetIds.map(ctx.cardSetName), 1),
    legality: () => LEGALITY_LABELS[common.legality as LegalityFilter],
    owned: () => OWNED_LABELS[common.owned as "owned" | "not_owned"],
    deck: () => `${ctx.deckName(state.deckKey as DeckKey) ?? "deck"} · ${DECK_FILTER_LABELS[common.inDeck as "in" | "not_in"]}`,
    cryptDisciplines: () =>
      listOf([...disciplines(false), ...(crypt.disciplinePairs ?? []).map((pair) => pair.map((c) => choiceLabel(c, ctx)).join(" ou "))]),
    virtues: () => listOf(disciplines(true)),
    cryptClans: () => listOf(crypt.clans?.values ?? []),
    cryptSects: () => listOf(crypt.sects?.values ?? []),
    groups: () => (crypt.groups ?? []).map((group) => group.replace(/^G/, "")).sort().join(", "),
    capacity: () => (crypt.capacity?.lines ?? []).map(numberLineLabel).join(" ou "),
    cryptTitles: () => listOf((crypt.titles ?? []).map(valueLabel)),
    votes: () => VOTE_LABELS[crypt.votes as keyof typeof VOTE_LABELS],
    types: () => listOf(library.types?.values ?? []),
    libraryDisciplines: () =>
      library.disciplines?.mode === "not_required"
        ? "non requise"
        : listOf(((library.disciplines as { values: string[] }).values).map(ctx.disciplineName)),
    libraryClans: () => listOf((library.clans?.values ?? []).map(valueLabel)),
    librarySects: () => listOf((library.sects?.values ?? []).map(valueLabel)),
    libraryTitles: () => listOf((library.titles?.values ?? []).map(valueLabel)),
    bloodCost: () => numberLineLabel(library.bloodCost as NumberLine),
    poolCost: () => numberLineLabel(library.poolCost as NumberLine),
  };
  return summaries[key]();
}

/** Mode courant d'un filtre à modes, affiché en pastille à côté de son libellé ; `null` sans mode ou inactif. */
export function filterMode(state: SearchState, key: FilterKey, virtues: ReadonlySet<string>): AnyMode | null {
  if (!isFilterActive(state, key, virtues)) return null;
  const { crypt, library } = state;
  const modes: Partial<Record<FilterKey, AnyMode | undefined>> = {
    cryptClans: crypt.clans?.mode,
    cryptSects: crypt.sects?.mode,
    capacity: crypt.capacity?.mode,
    types: library.types?.mode,
    libraryDisciplines: library.disciplines?.mode === "not_required" ? undefined : library.disciplines?.mode,
    libraryClans: library.clans?.mode,
    librarySects: library.sects?.mode,
    libraryTitles: library.titles?.mode,
  };
  return modes[key] ?? null;
}

// --- Tri ---------------------------------------------------------------------

export interface SortOption {
  id: string;
  label: string;
  sort: CardSort | null;
}

const SORTS: Record<string, SortOption> = {
  name: { id: "name", label: "Nom", sort: null },
  nameDesc: { id: "nameDesc", label: "Nom (Z → A)", sort: { key: "name", direction: "desc" } },
  capacity: { id: "capacity", label: "Capacité croissante", sort: { key: "capacity" } },
  capacityDesc: { id: "capacityDesc", label: "Capacité décroissante", sort: { key: "capacity", direction: "desc" } },
  group: { id: "group", label: "Groupe croissant", sort: { key: "group" } },
  groupDesc: { id: "groupDesc", label: "Groupe décroissant", sort: { key: "group", direction: "desc" } },
  cost: { id: "cost", label: "Coût croissant", sort: { key: "cost" } },
  costDesc: { id: "costDesc", label: "Coût décroissant", sort: { key: "cost", direction: "desc" } },
};

const SORTS_BY_CATEGORY: Record<CategoryTab, string[]> = {
  all: ["name", "nameDesc"],
  crypt: ["name", "nameDesc", "capacity", "capacityDesc", "group", "groupDesc"],
  library: ["name", "nameDesc", "cost", "costDesc"],
};

/** Tris de P9 proposés sous une catégorie. */
export const sortOptions = (category: CategoryTab): SortOption[] => SORTS_BY_CATEGORY[category].map((id) => SORTS[id]);

export function sortId(sort: CardSort | null): string {
  if (isDefaultSort(sort)) return "name";
  const found = Object.values(SORTS).find(
    (option) => option.sort?.key === sort?.key && (option.sort?.direction ?? "asc") === (sort?.direction ?? "asc"),
  );
  return found?.id ?? "name";
}

export const sortById = (id: string): CardSort | null => SORTS[id]?.sort ?? null;

/** Un tri qui ne vaut pas pour la catégorie choisie retombe sur le nom. */
export function sortForCategory(sort: CardSort | null, category: CategoryTab): CardSort | null {
  return SORTS_BY_CATEGORY[category].includes(sortId(sort)) ? sort : null;
}

/** Clic sur un en-tête de colonne (bureau) : même clé, sens inversé ; autre clé, sens croissant. */
export function toggleSort(sort: CardSort | null, key: CardSort["key"]): CardSort | null {
  const current = sort ?? { key: "name" };
  if (current.key !== key) return key === "name" ? null : { key };
  const next: CardSort = { key, direction: current.direction === "desc" ? "asc" : "desc" };
  return isDefaultSort(next) ? null : next;
}

/** Compteur de résultats (« 4 par le nom · 17 par le texte », sinon « 86 résultats »). */
export function countLabel(total: number, byName: number | undefined, query: string): string {
  if (byName !== undefined && query.trim() !== "" && byName < total) {
    return `${byName} par le nom · ${total - byName} par le texte`;
  }
  return `${total} résultat${total > 1 ? "s" : ""}`;
}

// --- Ligne confirmée maintenue (D2, handoff 38) -------------------------------

export interface HeldRow<T extends { card: { id: number } }> {
  item: T;
  /** Position de la ligne au moment de l'ajout. */
  index: number;
}

/**
 * Remet à sa place une carte qu'on vient d'ajouter et que les filtres
 * écarteraient désormais (« pas dans ce deck ») : elle reste visible jusqu'au
 * prochain changement de filtre, qui vide `held`.
 */
export function withHeld<T extends { card: { id: number } }>(results: readonly T[], held: ReadonlyArray<HeldRow<T>>): T[] {
  const shown = [...results];
  const present = new Set(shown.map((item) => item.card.id));
  for (const entry of [...held].sort((a, b) => a.index - b.index)) {
    if (present.has(entry.item.card.id)) continue;
    shown.splice(Math.min(entry.index, shown.length), 0, entry.item);
    present.add(entry.item.card.id);
  }
  return shown;
}
