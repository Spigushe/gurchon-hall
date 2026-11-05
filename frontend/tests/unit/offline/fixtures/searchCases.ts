import {
  NON_TITLED,
  NOT_REQUIRED,
  REFLEX_TYPE,
  REQUIRES_NON_TITLED,
  REQUIRES_TITLED,
  REQUIRES_TITLED_SPECIFIC,
  type SearchContext,
  type SearchCriteria,
} from "../../../../src/offline/vtes/cardSearch";
import { crypt, library, type CardSearchItem } from "./syntheticCatalog";

/**
 * Table de cas de `filterCards` (lot Chercher, étape E1, écrite avec C1b).
 *
 * Un catalogue synthétique de 32 cartes, chacune construite pour un ou deux
 * filtres, et une table de cas : critères, contexte, identifiants attendus
 * **exactement**. Chaque filtre et chaque mode a au moins un cas, et le test
 * vérifie que chaque cas a au moins une carte positive et une négative.
 *
 * Crypte : identifiants 1 à 10. Bibliothèque : 101 à 122. Date d'évaluation par
 * défaut : 2026-11-05.
 */

export const SEARCH_CATALOG: CardSearchItem[] = [
  // --- Crypte ---
  crypt({
    id: 1,
    name: "Theo Bell",
    clan: "Brujah",
    group: "G2",
    capacity: 7,
    disciplines: ["CEL", "dom", "POT"],
    text: "Camarilla: Archon. Theo can enter combat with any minion as a (D) action.",
    cardSetIds: [9, 20],
  }),
  crypt({
    id: 2,
    name: "Tremere Prince",
    clan: "Tremere",
    group: "G3",
    capacity: 9,
    title: "Prince",
    disciplines: ["AUS", "DOM", "THA"],
    text: "Camarilla Prince of Vienna.",
  }),
  crypt({
    id: 3,
    name: "Sabbat Bishop",
    clan: "Tzimisce",
    sect: "Sabbat",
    group: "G4",
    capacity: 8,
    title: "Bishop",
    disciplines: ["ani", "AUS", "VIC"],
    text: "Sabbat bishop.",
  }),
  crypt({
    id: 4,
    name: "Anarch Baron",
    clan: "Brujah",
    sect: "Anarch",
    group: "G5",
    capacity: 6,
    title: "Baron",
    disciplines: ["cel", "pot"],
    text: "Anarch Baron of Los Angeles.",
  }),
  crypt({
    id: 5,
    name: "Any Group Ventrue",
    clan: "Ventrue",
    group: "Any",
    capacity: 4,
    disciplines: ["dom", "for"],
    text: "Camarilla.",
  }),
  crypt({
    id: 6,
    name: "Imbued Avenger",
    clan: "Avenger",
    sect: "Imbued",
    group: "G4",
    capacity: 3,
    disciplines: ["def", "ven"],
    types: ["Imbued"],
    text: "Imbued.",
  }),
  crypt({
    id: 7,
    name: "Guruhi Magaji",
    clan: "Guruhi",
    sect: "Laibon",
    group: "G5",
    capacity: 10,
    title: "Magaji",
    disciplines: ["ani", "pot"],
    text: "Laibon magaji.",
  }),
  crypt({
    id: 8,
    name: "Lasombra Cardinal",
    clan: "Lasombra",
    sect: "Sabbat",
    path: "Caine",
    group: "G6",
    capacity: 11,
    title: "Cardinal",
    disciplines: ["DOM", "obf", "POT"],
    text: "Sabbat cardinal. Path of Caine.",
  }),
  crypt({
    id: 9,
    name: "Independent Voter",
    clan: "Ventrue",
    sect: "Independent",
    group: "G2",
    capacity: 1,
    title: "2 Votes",
    text: "Independent: 2 votes.",
  }),
  crypt({
    id: 10,
    name: "Inner Circle Ventrue",
    clan: "Ventrue",
    group: "G1",
    capacity: 11,
    title: "Inner Circle",
    disciplines: ["AUS", "DOM", "FOR", "PRE"],
    text: "Camarilla Inner Circle.",
  }),

  // --- Bibliothèque ---
  library({
    id: 101,
    name: "The World's a Canvas",
    types: ["Action Modifier"],
    disciplines: ["dom", "obf", "vic"],
    disciplineRequirement: "choice",
    text: "Only usable by a vampire with Dominate, Obfuscate or Vicissitude.",
  }),
  library({
    id: 102,
    name: "Combo Dominate Obfuscate",
    types: ["Action"],
    disciplines: ["dom", "obf"],
    disciplineRequirement: "combo",
    text: "Requires Dominate and Obfuscate.",
  }),
  library({
    id: 103,
    name: "Combo Dominate Potence",
    types: ["Action"],
    disciplines: ["dom", "pot"],
    disciplineRequirement: "combo",
    text: "Requires Dominate and Potence.",
  }),
  library({
    id: 104,
    name: "Mono Dominate",
    types: ["Action"],
    disciplines: ["dom"],
    disciplineRequirement: "mono",
    costType: "blood",
    costValue: "1",
    text: "[dom] +1 stealth.",
  }),
  library({
    id: 105,
    name: "Mono Obfuscate",
    types: ["Combat"],
    disciplines: ["obf"],
    disciplineRequirement: "mono",
    text: "[obf] Maneuver.",
  }),
  library({ id: 106, name: "Plain Master", types: ["Master"], costType: "pool", costValue: "2", text: "Master." }),
  library({
    id: 107,
    name: "Reflex Reaction",
    types: ["Reaction"],
    disciplines: ["aus"],
    disciplineRequirement: "mono",
    text: "[REFLEX] [aus] Cancel a frenzy card as it is played.",
  }),
  library({
    id: 108,
    name: "Prince Political Action",
    types: ["Political Action"],
    costType: "pool",
    costValue: "X",
    requiredSects: ["Camarilla"],
    requiredTitles: ["Prince"],
    libraryRequirement: "prince",
    text: "Requires a Prince.",
  }),
  library({
    id: 109,
    name: "Non-Anarch Titled Master",
    types: ["Master"],
    requiredSects: ["Camarilla", "Sabbat", "Laibon", "Independent"],
    requiresTitled: true,
    libraryRequirement: "non-anarch,titled",
    text: "Requires a titled non-anarch vampire.",
  }),
  library({
    id: 110,
    name: "Tremere Or Ventrue Action",
    types: ["Action"],
    clanRequirement: "Tremere, Ventrue",
    costType: "blood",
    costValue: "2",
    text: "Requires a Tremere or a Ventrue.",
  }),
  library({
    id: 111,
    name: "Path Political Action",
    types: ["Political Action"],
    pathRequirement: "Caine",
    text: "Requires Path of Caine.",
  }),
  library({
    id: 112,
    name: "Non-Titled Action",
    types: ["Action"],
    requiresNonTitled: true,
    libraryRequirement: "non-titled",
    text: "Requires a non-titled vampire.",
  }),
  library({ id: 113, name: "Banned Master", types: ["Master"], bannedOn: "2000-01-01", text: "Banned." }),
  library({ id: 114, name: "Future Master", types: ["Master"], legalFrom: "2027-01-01", text: "Not yet." }),
  library({
    id: 115,
    name: "Playing for Keeps",
    types: ["Master"],
    bannedOn: "1995-11-01",
    legalFrom: "1996-01-14",
    text: "Banned before being legal.",
  }),
  library({
    id: 116,
    name: ".44 Magnum",
    types: ["Equipment"],
    costType: "pool",
    costValue: "2",
    text: "Weapon: gun.",
    cardSetIds: [20],
  }),
  library({
    id: 117,
    name: "Jack's Hammer",
    types: ["Equipment"],
    costType: "pool",
    costValue: "1",
    text: "Weapon: melee.",
  }),
  library({
    id: 118,
    name: "Majesty",
    types: ["Combat"],
    disciplines: ["pre"],
    disciplineRequirement: "mono",
    text: "[pre] End combat.",
    translatedNames: [
      { language_code: "FR", name: "Majesté" },
      { language_code: "ES", name: "Majestad" },
    ],
  }),
  library({
    id: 119,
    name: "Two Types Card",
    types: ["Action Modifier", "Combat"],
    text: "Action modifier or combat.",
  }),
  library({ id: 120, name: "Swallowed by the Night", types: ["Action"], text: "+1 bleed." }),
  library({ id: 121, name: "Bleed the Vein", types: ["Action"], text: "Burn a blood." }),
  library({
    id: 122,
    name: "Anarch Only Action",
    types: ["Action"],
    requiredSects: ["Anarch"],
    libraryRequirement: "anarch",
    text: "Requires an anarch.",
  }),
];

export const CRYPT_IDS = SEARCH_CATALOG.filter((card) => card.category === "crypt").map((card) => card.id);
export const LIBRARY_IDS = SEARCH_CATALOG.filter((card) => card.category === "library").map((card) => card.id);
export const ALL_IDS = SEARCH_CATALOG.map((card) => card.id);

/** Les identifiants d'une liste, sauf ceux nommés. */
export const except = (ids: number[], ...excluded: number[]) => ids.filter((id) => !excluded.includes(id));

export const DEFAULT_ON = "2026-11-05";

export interface SearchCase {
  description: string;
  criteria: SearchCriteria;
  context?: Partial<SearchContext>;
  /** Identifiants attendus, dans n'importe quel ordre. */
  expected: number[];
}

const dom = { code: "dom", level: "inferior" } as const;
const DOM = { code: "dom", level: "superior" } as const;

export const SEARCH_CASES: SearchCase[] = [
  // --- Champ principal (nom, noms traduits, texte) ---
  { description: "champ principal : nom et texte (« bleed »)", criteria: { query: "bleed" }, expected: [120, 121] },
  { description: "champ principal : casse ignorée", criteria: { query: "THEO" }, expected: [1] },
  { description: "variante : nom sans ponctuation (« 44 magnum »)", criteria: { query: "44 magnum" }, expected: [116] },
  { description: "variante : apostrophe ignorée (« jacks »)", criteria: { query: "jacks" }, expected: [117] },
  { description: "variante : initiales (« tb »)", criteria: { query: "tb" }, expected: [1] },
  { description: "nom traduit FR, accent ignoré (« majeste »)", criteria: { query: "majeste" }, expected: [118] },
  { description: "nom traduit ES (« majestad »)", criteria: { query: "majestad" }, expected: [118] },
  { description: "icône de discipline dans le texte (« [obf] »)", criteria: { query: "[obf]" }, expected: [105] },

  // --- Lignes de texte ---
  {
    description: "ligne texte seul, ET",
    criteria: { textLines: [{ value: "bleed", field: "text", mode: "and" }] },
    expected: [120],
  },
  {
    description: "ligne nom seul, ET",
    criteria: { textLines: [{ value: "bleed", field: "name", mode: "and" }] },
    expected: [121],
  },
  {
    description: "ligne nom et texte, NON",
    criteria: { textLines: [{ value: "bleed", field: "all", mode: "not" }] },
    expected: except(ALL_IDS, 120, 121),
  },
  {
    description: "deux lignes en ET : texte « weapon », mais pas « magnum » dans le nom",
    criteria: {
      textLines: [
        { value: "weapon", field: "text", mode: "and" },
        { value: "magnum", field: "name", mode: "not" },
      ],
    },
    expected: [117],
  },
  {
    description: "une ligne vide est ignorée",
    criteria: { textLines: [{ value: "  ", field: "all", mode: "and" }], category: "crypt" },
    expected: CRYPT_IDS,
  },

  // --- Communs ---
  { description: "catégorie crypte", criteria: { category: "crypt" }, expected: CRYPT_IDS },
  { description: "catégorie bibliothèque", criteria: { category: "library" }, expected: LIBRARY_IDS },
  { description: "extension, en OU", criteria: { cardSetIds: [20, 999] }, expected: [1, 116] },
  {
    description: "légalité : légale à la date du jour",
    criteria: { legality: "legal" },
    expected: except(ALL_IDS, 113, 114, 115),
  },
  { description: "légalité : bannie", criteria: { legality: "banned" }, expected: [113, 115] },
  { description: "légalité : pas encore légale", criteria: { legality: "not_yet_legal" }, expected: [114] },
  {
    description: "légalité : Playing for Keeps bannie entre ses deux dates",
    criteria: { legality: "banned" },
    context: { on: "1995-12-25" },
    expected: [115],
  },
  {
    description: "légalité : Playing for Keeps pas encore légale entre ses deux dates",
    criteria: { legality: "not_yet_legal" },
    context: { on: "1995-12-25" },
    expected: [114, 115],
  },
  {
    description: "statut : possédée",
    criteria: { owned: "owned" },
    context: { ownedCardIds: new Set([1, 104]) },
    expected: [1, 104],
  },
  {
    description: "statut : non possédée",
    criteria: { owned: "not_owned", category: "crypt" },
    context: { ownedCardIds: new Set([1, 104]) },
    expected: except(CRYPT_IDS, 1),
  },
  {
    description: "statut : dans ce deck",
    criteria: { inDeck: "in" },
    context: { deckCardIds: new Set([104, 105]) },
    expected: [104, 105],
  },
  {
    description: "statut : pas dans ce deck",
    criteria: { inDeck: "not_in", category: "library" },
    context: { deckCardIds: new Set([104, 105]) },
    expected: except(LIBRARY_IDS, 104, 105),
  },

  // --- Crypte : disciplines ---
  { description: "crypte : Dominate au moins inférieure", criteria: { crypt: { disciplines: [dom] } }, expected: [1, 2, 5, 8, 10] },
  { description: "crypte : Dominate supérieure seulement", criteria: { crypt: { disciplines: [DOM] } }, expected: [2, 8, 10] },
  {
    description: "crypte : grille en ET (Dominate et Potence)",
    criteria: { crypt: { disciplines: [dom, { code: "pot", level: "inferior" }] } },
    expected: [1, 8],
  },
  {
    description: "crypte : paire OU (Vicissitude ou Thaumaturgie)",
    criteria: {
      crypt: { disciplinePairs: [[{ code: "vic", level: "inferior" }, { code: "tha", level: "inferior" }]] },
    },
    expected: [2, 3],
  },
  {
    description: "crypte : paire OU en ET avec la grille",
    criteria: {
      crypt: {
        disciplines: [DOM],
        disciplinePairs: [[{ code: "vic", level: "inferior" }, { code: "tha", level: "superior" }]],
      },
    },
    expected: [2],
  },
  { description: "crypte : vertu des imbued (Defense)", criteria: { crypt: { disciplines: [{ code: "def", level: "inferior" }] } }, expected: [6] },

  // --- Crypte : clan, secte, groupe, capacité, titre, votes ---
  { description: "crypte : clan en OU", criteria: { crypt: { clans: { values: ["Brujah", "Tremere"], mode: "or" } } }, expected: [1, 2, 4] },
  { description: "crypte : clan et voie en ET", criteria: { crypt: { clans: { values: ["Lasombra", "Caine"], mode: "and" } } }, expected: [8] },
  { description: "crypte : clan en NON", criteria: { crypt: { clans: { values: ["Brujah"], mode: "not" } } }, expected: except(CRYPT_IDS, 1, 4) },
  { description: "crypte : credo des imbued", criteria: { crypt: { clans: { values: ["Avenger"], mode: "or" } } }, expected: [6] },
  { description: "crypte : secte en OU", criteria: { crypt: { sects: { values: ["Sabbat"], mode: "or" } } }, expected: [3, 8] },
  { description: "crypte : secte en NON", criteria: { crypt: { sects: { values: ["Camarilla"], mode: "not" } } }, expected: [3, 4, 6, 7, 8, 9] },
  { description: "crypte : secte Imbued", criteria: { crypt: { sects: { values: ["Imbued"], mode: "or" } } }, expected: [6] },
  { description: "crypte : groupe, « Any » toujours retenu", criteria: { crypt: { groups: ["G2"] } }, expected: [1, 5, 9] },
  { description: "crypte : groupes en OU", criteria: { crypt: { groups: ["G4", "G5"] } }, expected: [3, 4, 5, 6, 7] },
  { description: "crypte : capacité ≥ 10", criteria: { crypt: { capacity: { lines: [{ op: "ge", value: 10 }], mode: "or" } } }, expected: [7, 8, 10] },
  { description: "crypte : capacité = 7", criteria: { crypt: { capacity: { lines: [{ op: "eq", value: 7 }], mode: "or" } } }, expected: [1] },
  {
    description: "crypte : capacité de 4 à 7, écrite NON [≤ 3, ≥ 8]",
    criteria: { crypt: { capacity: { lines: [{ op: "le", value: 3 }, { op: "ge", value: 8 }], mode: "not" } } },
    expected: [1, 4, 5],
  },
  { description: "crypte : titres en OU", criteria: { crypt: { titles: ["Prince", "Bishop"] } }, expected: [2, 3] },
  { description: "crypte : non titré", criteria: { crypt: { titles: [NON_TITLED] } }, expected: [1, 5, 6] },
  { description: "crypte : aucun vote", criteria: { crypt: { votes: "none" } }, expected: [1, 5, 6] },
  { description: "crypte : 2 votes et plus", criteria: { crypt: { votes: 2 } }, expected: [2, 4, 7, 8, 9, 10] },
  { description: "crypte : 3 votes et plus", criteria: { crypt: { votes: 3 } }, expected: [8, 10] },
  { description: "crypte : 4 votes et plus", criteria: { crypt: { votes: 4 } }, expected: [10] },

  // --- Bibliothèque : disciplines, tableau de P1, S = {Dominate, Obfuscate} ---
  {
    description: "bibliothèque : disciplines OU (mentionne l'une)",
    criteria: { library: { disciplines: { values: ["dom", "obf"], mode: "or" } } },
    expected: [101, 102, 103, 104, 105],
  },
  {
    description: "bibliothèque : disciplines ET (exige chacune) — The World's a Canvas exclue",
    criteria: { library: { disciplines: { values: ["dom", "obf"], mode: "and" } } },
    expected: [102],
  },
  {
    description: "bibliothèque : disciplines NON (ne mentionne aucune), cartes sans discipline comprises",
    criteria: { library: { disciplines: { values: ["dom", "obf"], mode: "not" } } },
    expected: except(LIBRARY_IDS, 101, 102, 103, 104, 105),
  },
  {
    description: "bibliothèque : disciplines SEULEMENT (jouable avec les seules cochées)",
    criteria: { library: { disciplines: { values: ["dom", "obf"], mode: "only" } } },
    expected: [101, 102, 104, 105],
  },
  {
    description: "bibliothèque : discipline non requise",
    criteria: { library: { disciplines: { mode: "not_required" } } },
    expected: except(LIBRARY_IDS, 101, 102, 103, 104, 105, 107, 118),
  },
  {
    description: "bibliothèque : ET avec Dominate seul (mono et combinées)",
    criteria: { library: { disciplines: { values: ["dom"], mode: "and" } } },
    expected: [102, 103, 104],
  },
  {
    description: "bibliothèque : SEULEMENT avec Dominate seul (mono et au choix)",
    criteria: { library: { disciplines: { values: ["dom"], mode: "only" } } },
    expected: [101, 104],
  },

  // --- Bibliothèque : types ---
  { description: "bibliothèque : type en OU, carte à deux types comprise", criteria: { library: { types: { values: ["Combat"], mode: "or" } } }, expected: [105, 118, 119] },
  { description: "bibliothèque : types en ET", criteria: { library: { types: { values: ["Action Modifier", "Combat"], mode: "and" } } }, expected: [119] },
  {
    description: "bibliothèque : types en NON",
    criteria: { library: { types: { values: ["Master", "Action"], mode: "not" } } },
    expected: [101, 105, 107, 108, 111, 116, 117, 118, 119],
  },
  { description: "bibliothèque : type Reflex (texte `[REFLEX]`)", criteria: { library: { types: { values: [REFLEX_TYPE], mode: "or" } } }, expected: [107] },

  // --- Bibliothèque : clan, secte et titre requis ---
  { description: "bibliothèque : clan requis, prérequis à deux clans découpé", criteria: { library: { clans: { values: ["Ventrue"], mode: "or" } } }, expected: [110] },
  { description: "bibliothèque : voie requise", criteria: { library: { clans: { values: ["Caine"], mode: "or" } } }, expected: [111] },
  { description: "bibliothèque : clan non requis", criteria: { library: { clans: { values: [NOT_REQUIRED], mode: "or" } } }, expected: except(LIBRARY_IDS, 110, 111) },
  { description: "bibliothèque : clan requis en NON", criteria: { library: { clans: { values: ["Tremere"], mode: "not" } } }, expected: except(LIBRARY_IDS, 110) },
  { description: "bibliothèque : secte requise, titre qui l'implique et « non-anarch »", criteria: { library: { sects: { values: ["Camarilla"], mode: "or" } } }, expected: [108, 109] },
  { description: "bibliothèque : « non-anarch » répond au Sabbat", criteria: { library: { sects: { values: ["Sabbat"], mode: "or" } } }, expected: [109] },
  { description: "bibliothèque : « non-anarch » ne répond pas à Anarch", criteria: { library: { sects: { values: ["Anarch"], mode: "or" } } }, expected: [122] },
  { description: "bibliothèque : secte non requise", criteria: { library: { sects: { values: [NOT_REQUIRED], mode: "or" } } }, expected: except(LIBRARY_IDS, 108, 109, 122) },
  { description: "bibliothèque : secte requise en NON", criteria: { library: { sects: { values: ["Camarilla"], mode: "not" } } }, expected: except(LIBRARY_IDS, 108, 109) },
  { description: "bibliothèque : titre précis requis", criteria: { library: { titles: { values: ["Prince"], mode: "or" } } }, expected: [108] },
  { description: "bibliothèque : titré requis", criteria: { library: { titles: { values: [REQUIRES_TITLED], mode: "or" } } }, expected: [109] },
  { description: "bibliothèque : titre précis requis, quel qu'il soit", criteria: { library: { titles: { values: [REQUIRES_TITLED_SPECIFIC], mode: "or" } } }, expected: [108] },
  { description: "bibliothèque : non titré requis", criteria: { library: { titles: { values: [REQUIRES_NON_TITLED], mode: "or" } } }, expected: [112] },
  { description: "bibliothèque : titré requis en NON", criteria: { library: { titles: { values: [REQUIRES_TITLED], mode: "not" } } }, expected: except(LIBRARY_IDS, 109) },

  // --- Bibliothèque : coûts ---
  { description: "bibliothèque : coût en sang ≥ 1", criteria: { library: { bloodCost: { op: "ge", value: 1 } } }, expected: [104, 110] },
  { description: "bibliothèque : coût en sang = 0, absent compris", criteria: { library: { bloodCost: { op: "eq", value: 0 } } }, expected: except(LIBRARY_IDS, 104, 110) },
  { description: "bibliothèque : coût en pool ≥ 2, « X » toujours retenu", criteria: { library: { poolCost: { op: "ge", value: 2 } } }, expected: [106, 108, 116] },
  { description: "bibliothèque : coût en pool ≤ 1, absent valant 0", criteria: { library: { poolCost: { op: "le", value: 1 } } }, expected: except(LIBRARY_IDS, 106, 116) },

  // --- Combinaisons ---
  {
    description: "un filtre de crypte écarte la bibliothèque (catégorie « toutes »)",
    criteria: { crypt: { sects: { values: ["Camarilla"], mode: "or" } } },
    expected: [1, 2, 5, 10],
  },
  {
    description: "trois filtres combinés : clan Tremere, Thaumaturgie supérieure, un mot du texte",
    criteria: {
      query: "vienna",
      crypt: { clans: { values: ["Tremere"], mode: "or" }, disciplines: [{ code: "tha", level: "superior" }] },
    },
    expected: [2],
  },
];
