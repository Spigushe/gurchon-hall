import { NON_TITLED, NOT_REQUIRED, REFLEX_TYPE, REQUIRES_NON_TITLED, REQUIRES_TITLED, REQUIRES_TITLED_SPECIFIC, type SearchCatalog } from "../../offline/vtes";
import { VIRTUE_CODES } from "../../components/glyphs/glyphs";

/**
 * Valeurs proposées par les filtres de Chercher (D1c), lues dans le catalogue
 * en mémoire plutôt qu'écrites en dur : une discipline, un clan ou un type que
 * krcg ajoute apparaît sans changer le code. Les listes fermées de P1 (sectes,
 * titres de crypte, votes) gardent leur ordre ; une valeur que le catalogue ne
 * connaît pas n'est pas proposée.
 */

export interface DisciplineOption {
  code: string;
  name: string;
}

export interface SearchOptions {
  /** Disciplines de la grille de crypte, vertus exclues, par code. */
  cryptDisciplines: DisciplineOption[];
  virtues: DisciplineOption[];
  /** Disciplines des cartes de bibliothèque (Flight, Maleficia, Striga et vertus comprises). */
  libraryDisciplines: DisciplineOption[];
  /** Clans, credos et voies des cartes de crypte. */
  cryptClans: string[];
  /** Clans et voies exigés par les cartes de bibliothèque, « non requis » en tête. */
  libraryClans: string[];
  sects: string[];
  groups: string[];
  cryptTitles: string[];
  libraryTitles: string[];
  types: string[];
  disciplineName: (code: string) => string;
}

/** Ordre de P1 ; une secte absente du catalogue n'est pas proposée. */
const SECT_ORDER = ["Camarilla", "Sabbat", "Laibon", "Independent", "Anarch", "Imbued"];
const CRYPT_TITLE_ORDER = [
  "Primogen",
  "Prince",
  "Justicar",
  "Inner Circle",
  "Baron",
  "1 Vote",
  "2 Votes",
  "Bishop",
  "Archbishop",
  "Priscus",
  "Cardinal",
  "Regent",
  "Magaji",
];

const byText = (a: string, b: string) => a.localeCompare(b, "fr");
const sorted = (values: Iterable<string>) => [...values].sort(byText);

/** Garde l'ordre fixe pour les valeurs connues, puis les autres par ordre alphabétique. */
function ordered(found: ReadonlySet<string>, order: readonly string[]): string[] {
  const known = order.filter((value) => found.has(value));
  return [...known, ...sorted([...found].filter((value) => !order.includes(value)))];
}

const addAll = (target: Set<string>, values: Iterable<string | null>) => {
  for (const value of values) if (value) target.add(value);
};

export function buildSearchOptions(catalog: SearchCatalog | undefined): SearchOptions {
  const names = new Map<string, string>();
  const cryptCodes = new Set<string>();
  const libraryCodes = new Set<string>();
  const cryptClans = new Set<string>();
  const libraryClans = new Set<string>();
  const sects = new Set<string>();
  const groups = new Set<string>();
  const cryptTitles = new Set<string>();
  const libraryTitles = new Set<string>();
  const types = new Set<string>();

  for (const { card, details } of catalog?.cards ?? []) {
    if (!details) continue;
    for (const link of details.disciplines) names.set(link.code, link.name);
    const codes = details.disciplines.map((link) => link.code);
    if (card.category === "crypt") {
      addAll(cryptCodes, codes);
      addAll(cryptClans, [card.clanName, details.path]);
      addAll(sects, [details.sect]);
      addAll(groups, [card.groupCode]);
      addAll(cryptTitles, [details.title]);
    } else {
      addAll(libraryCodes, codes);
      addAll(libraryClans, [...details.clanRequirements, ...details.pathRequirements]);
      addAll(libraryTitles, details.requiredTitles);
      addAll(types, details.types);
    }
  }
  if (catalog?.cards.some((item) => item.index.types.has(REFLEX_TYPE))) types.add(REFLEX_TYPE);

  const option = (code: string): DisciplineOption => ({ code, name: names.get(code) ?? code });
  const codesOf = (codes: Set<string>, keep: (code: string) => boolean) => sorted([...codes].filter(keep)).map(option);
  return {
    cryptDisciplines: codesOf(cryptCodes, (code) => !VIRTUE_CODES.has(code)),
    virtues: codesOf(cryptCodes, (code) => VIRTUE_CODES.has(code)),
    libraryDisciplines: codesOf(libraryCodes, () => true),
    cryptClans: sorted(cryptClans),
    libraryClans: [NOT_REQUIRED, ...sorted(libraryClans)],
    sects: ordered(sects, SECT_ORDER),
    groups: sorted([...groups].filter((group) => group !== "Any")),
    cryptTitles: [...ordered(cryptTitles, CRYPT_TITLE_ORDER), NON_TITLED],
    libraryTitles: [REQUIRES_TITLED, REQUIRES_TITLED_SPECIFIC, REQUIRES_NON_TITLED, ...ordered(libraryTitles, CRYPT_TITLE_ORDER)],
    types: sorted(types),
    disciplineName: (code) => names.get(code) ?? code,
  };
}

/** Sectes exigées par la bibliothèque : les mêmes, « non requise » en tête. */
export const librarySectOptions = (options: SearchOptions) => [NOT_REQUIRED, ...options.sects];
