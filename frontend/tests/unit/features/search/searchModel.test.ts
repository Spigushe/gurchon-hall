import { describe, expect, it } from "vitest";
import {
  COMMON_FILTERS,
  CRYPT_FILTERS,
  LIBRARY_FILTERS,
  activeFilterTotal,
  clearFilter,
  countLabel,
  criteriaOf,
  cycleCryptDiscipline,
  filterMode,
  filterSummary,
  initialState,
  isDefaultSort,
  isFilterActive,
  nextMode,
  resetFilters,
  sortById,
  sortForCategory,
  sortId,
  sortOptions,
  toggleInFilter,
  toggleSort,
  valueLabel,
  visibleSections,
  type FilterKey,
  type SearchState,
  type SummaryContext,
} from "../../../../src/features/search/searchModel";
import { VIRTUE_CODES } from "../../../../src/components/glyphs/glyphs";
import { NON_TITLED, NOT_REQUIRED, REQUIRES_TITLED, type DeckKey } from "../../../../src/offline/vtes";

const DECK = "id:4" as DeckKey;

const ctx: SummaryContext = {
  cardSetName: (id) => `Set ${id}`,
  deckName: (key) => (key === DECK ? "Banu Princes" : null),
  disciplineName: (code) => ({ dom: "Dominate", obf: "Obfuscate", pot: "Potence", def: "Defense", cel: "Celerity" })[code] ?? code,
  virtues: VIRTUE_CODES,
};

/** Un état où chaque filtre est actif. */
function everything(): SearchState {
  const state = initialState("bleed", DECK);
  return {
    ...state,
    category: "crypt",
    common: {
      textLines: [
        { value: "stealth", field: "text", mode: "and" },
        { value: "  ", field: "all", mode: "and" },
      ],
      cardSetIds: [9, 20],
      legality: "banned",
      owned: "owned",
      inDeck: "in",
    },
    crypt: {
      disciplines: [
        { code: "dom", level: "superior" },
        { code: "def", level: "inferior" },
      ],
      disciplinePairs: [
        [
          { code: "cel", level: "superior" },
          { code: "pot", level: "inferior" },
        ],
      ],
      clans: { values: ["Ventrue", "Tremere", "Brujah"], mode: "not" },
      sects: { values: ["Camarilla"], mode: "or" },
      groups: ["G5", "G4"],
      capacity: { lines: [{ op: "ge", value: 8 }, { op: "le", value: 3 }], mode: "not" },
      titles: ["Prince", NON_TITLED],
      votes: 2,
    },
    library: {
      types: { values: ["Action"], mode: "and" },
      disciplines: { values: ["dom", "obf"], mode: "only" },
      clans: { values: [NOT_REQUIRED], mode: "or" },
      sects: { values: ["Sabbat"], mode: "not" },
      titles: { values: [REQUIRES_TITLED], mode: "or" },
      bloodCost: { op: "le", value: 2 },
      poolCost: { op: "eq", value: 1 },
    },
  };
}

const ALL_KEYS: FilterKey[] = [...COMMON_FILTERS, ...CRYPT_FILTERS, ...LIBRARY_FILTERS];

describe("état de Chercher", () => {
  it("part sans filtre, avec « pas dans ce deck » quand un deck cible arrive par l'adresse (P12)", () => {
    expect(initialState("x").common.inDeck).toBeNull();
    expect(initialState("x", DECK).common.inDeck).toBe("not_in");
    expect(initialState().query).toBe("");
  });

  it("n'applique les filtres d'une catégorie que sous cette catégorie", () => {
    const state = everything();
    expect(criteriaOf({ ...state, category: "all" })).toMatchObject({ category: null, crypt: undefined, library: undefined });
    expect(criteriaOf(state).crypt).toBe(state.crypt);
    expect(criteriaOf(state).library).toBeUndefined();
    expect(criteriaOf({ ...state, category: "library" }).library).toBe(state.library);
    expect(criteriaOf(state, "autre").query).toBe("autre");
    expect(criteriaOf({ ...state, deckKey: null }).inDeck).toBeNull();
  });

  it("compte les filtres actifs de la catégorie choisie seulement", () => {
    const state = everything();
    expect(ALL_KEYS.every((key) => isFilterActive(state, key, VIRTUE_CODES))).toBe(true);
    expect(activeFilterTotal(state, VIRTUE_CODES)).toBe(COMMON_FILTERS.length + CRYPT_FILTERS.length);
    expect(activeFilterTotal({ ...state, category: "all" }, VIRTUE_CODES)).toBe(COMMON_FILTERS.length);
    expect(activeFilterTotal(initialState(), VIRTUE_CODES)).toBe(0);
    // Un deck sans deck cible ne compte pas.
    expect(isFilterActive({ ...state, deckKey: null }, "deck", VIRTUE_CODES)).toBe(false);
  });

  it("tient pour inactif un filtre vidé qui garde son mode", () => {
    const state = initialState();
    const kept = { ...state, library: { types: toggleInFilter({ values: ["Action"], mode: "not" }, "Action", "or") } };
    expect(kept.library.types).toEqual({ values: [], mode: "not" });
    expect(isFilterActive(kept, "types", VIRTUE_CODES)).toBe(false);
    expect(toggleInFilter(undefined, "Combat", "or")).toEqual({ values: ["Combat"], mode: "or" });
    expect(isFilterActive({ ...state, library: { disciplines: { mode: "not_required" } } }, "libraryDisciplines", VIRTUE_CODES)).toBe(true);
  });

  it("efface chaque filtre sans toucher aux autres, vertus et disciplines séparées", () => {
    const state = everything();
    for (const key of ALL_KEYS) {
      const cleared = clearFilter(state, key, VIRTUE_CODES);
      expect(isFilterActive(cleared, key, VIRTUE_CODES)).toBe(false);
      for (const other of ALL_KEYS.filter((item) => item !== key)) {
        expect(isFilterActive(cleared, other, VIRTUE_CODES), `${key} efface ${other}`).toBe(true);
      }
    }
  });

  it("réinitialise les filtres visibles, garde texte, catégorie, deck cible et tri", () => {
    const state = { ...everything(), sort: { key: "capacity" as const } };
    const reset = resetFilters(state, VIRTUE_CODES);
    expect(activeFilterTotal(reset, VIRTUE_CODES)).toBe(0);
    expect(reset).toMatchObject({ query: "bleed", category: "crypt", deckKey: DECK, sort: { key: "capacity" } });
    // Les filtres de bibliothèque, masqués sous « Crypte », restent.
    expect(isFilterActive({ ...reset, category: "library" }, "types", VIRTUE_CODES)).toBe(true);
  });

  it("range les filtres par section selon la catégorie", () => {
    expect(visibleSections("all").map((section) => section.id)).toEqual(["common"]);
    expect(visibleSections("crypt").map((section) => section.id)).toEqual(["common", "crypt"]);
    expect(visibleSections("library").map((section) => section.id)).toEqual(["common", "library"]);
  });
});

describe("résumés et modes", () => {
  it("résume chaque filtre actif, et rend null pour un filtre inactif", () => {
    const state = everything();
    const summaries = Object.fromEntries(ALL_KEYS.map((key) => [key, filterSummary(state, key, ctx)]));
    expect(summaries).toEqual({
      text: "« stealth »",
      cardSets: "Set 9 +1",
      legality: "bannie",
      owned: "possédée",
      deck: "Banu Princes · dans ce deck",
      cryptDisciplines: "Dominate sup., Celerity sup. ou Potence",
      virtues: "Defense",
      cryptClans: "Ventrue, Tremere +1",
      cryptSects: "Camarilla",
      groups: "4, 5",
      capacity: "≥ 8 ou ≤ 3",
      cryptTitles: "Prince, non titré",
      votes: "2 et plus",
      types: "Action",
      libraryDisciplines: "Dominate, Obfuscate",
      libraryClans: "non requis",
      librarySects: "Sabbat",
      libraryTitles: "n'importe quel titre",
      bloodCost: "≤ 2",
      poolCost: "= 1",
    });
    expect(filterSummary(initialState(), "text", ctx)).toBeNull();
    const notRequired = { ...state, library: { disciplines: { mode: "not_required" as const } } };
    expect(filterSummary(notRequired, "libraryDisciplines", ctx)).toBe("non requise");
    const negative = { ...state, common: { ...state.common, textLines: [{ value: "bleed", field: "all" as const, mode: "not" as const }] } };
    expect(filterSummary(negative, "text", ctx)).toBe("sans « bleed »");
    expect(filterSummary({ ...state, deckKey: "id:99" as DeckKey }, "deck", ctx)).toBe("deck · dans ce deck");
  });

  it("donne le mode des filtres qui en ont un", () => {
    const state = everything();
    expect(filterMode(state, "cryptClans", VIRTUE_CODES)).toBe("not");
    expect(filterMode(state, "libraryDisciplines", VIRTUE_CODES)).toBe("only");
    expect(filterMode(state, "capacity", VIRTUE_CODES)).toBe("not");
    expect(filterMode(state, "groups", VIRTUE_CODES)).toBeNull();
    expect(filterMode(initialState(), "types", VIRTUE_CODES)).toBeNull();
    expect(filterMode({ ...state, library: { disciplines: { mode: "not_required" } } }, "libraryDisciplines", VIRTUE_CODES)).toBeNull();
  });

  it("fait cycler la pastille de mode et la grille de crypte", () => {
    expect(nextMode(["or", "and", "not", "only"], "not")).toBe("only");
    expect(nextMode(["or", "and", "not", "only"], "only")).toBe("or");
    const once = cycleCryptDiscipline([], "dom");
    expect(once).toEqual([{ code: "dom", level: "inferior" }]);
    const twice = cycleCryptDiscipline(once, "dom");
    expect(twice).toEqual([{ code: "dom", level: "superior" }]);
    expect(cycleCryptDiscipline(twice, "dom")).toEqual([]);
    expect(valueLabel(NOT_REQUIRED)).toBe("non requis");
    expect(valueLabel("Prince")).toBe("Prince");
  });
});

describe("tri et compteur", () => {
  it("propose les tris de P9 selon la catégorie", () => {
    expect(sortOptions("all").map((option) => option.id)).toEqual(["name", "nameDesc"]);
    expect(sortOptions("crypt").map((option) => option.id)).toContain("capacityDesc");
    expect(sortOptions("library").map((option) => option.id)).toContain("cost");
    expect(sortById("capacityDesc")).toEqual({ key: "capacity", direction: "desc" });
    expect(sortById("inconnu")).toBeNull();
    expect(sortId({ key: "cost" })).toBe("cost");
    expect(sortId(null)).toBe("name");
    expect(sortId({ key: "name", direction: "desc" })).toBe("nameDesc");
  });

  it("le tri par nom croissant est le tri par défaut, qui regroupe par le nom", () => {
    expect(isDefaultSort(null)).toBe(true);
    expect(isDefaultSort({ key: "name" })).toBe(true);
    expect(isDefaultSort({ key: "name", direction: "desc" })).toBe(false);
    expect(isDefaultSort({ key: "cost" })).toBe(false);
  });

  it("retombe sur le nom quand le tri ne vaut pas pour la catégorie", () => {
    expect(sortForCategory({ key: "capacity" }, "library")).toBeNull();
    expect(sortForCategory({ key: "capacity" }, "crypt")).toEqual({ key: "capacity" });
    expect(sortForCategory(null, "crypt")).toBeNull();
  });

  it("inverse le sens au second clic sur un en-tête", () => {
    expect(toggleSort(null, "capacity")).toEqual({ key: "capacity" });
    expect(toggleSort({ key: "capacity" }, "capacity")).toEqual({ key: "capacity", direction: "desc" });
    expect(toggleSort({ key: "capacity", direction: "desc" }, "capacity")).toEqual({ key: "capacity", direction: "asc" });
    expect(toggleSort(null, "name")).toEqual({ key: "name", direction: "desc" });
    expect(toggleSort({ key: "name", direction: "desc" }, "name")).toBeNull();
    expect(toggleSort({ key: "cost" }, "name")).toBeNull();
  });

  it("distingue les correspondances par le nom et par le texte", () => {
    expect(countLabel(21, 4, "bleed")).toBe("4 par le nom · 17 par le texte");
    expect(countLabel(4, 4, "bleed")).toBe("4 résultats");
    expect(countLabel(1, undefined, "")).toBe("1 résultat");
    expect(countLabel(0, 0, "  ")).toBe("0 résultat");
  });
});
