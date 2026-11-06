/**
 * Icônes de krcg (lot Chercher, handoff `docs/design-handoff/CHERCHER.md`,
 * « Icônes (KRCG) ») : une icône est une lettre d'une des deux polices
 * auto-hébergées (`src/assets/fonts/`), « Ankha VTES » (`ankha2.otf`) pour les
 * disciplines, types, coûts et vertus, « VTES Clans » (`vtes-clans.otf`) pour
 * les clans. Table reprise de `krcg-blogger.js` et relue sur les polices le
 * 2026-11-05 (rendu de chaque code) : Oblivion (`ø` / `Ø`), Striga (`à` /
 * `á`) et Maleficia (`â` / `ã`), absents de la table du handoff, y sont.
 *
 * Inférieure = minuscule, supérieure = majuscule, sauf Temporis (`?` / `!`)
 * et Obtenebration (`$` / `£`). Les vertus et Flight n'ont qu'un glyphe.
 * Hecata n'a pas de glyphe connu dans `vtes-clans.otf` : il s'affiche sans
 * icône plutôt qu'avec une icône devinée.
 */

export type GlyphFont = "ankha" | "clans";

export interface Glyph {
  font: GlyphFont;
  char: string;
}

const ankha = (char: string): Glyph => ({ font: "ankha", char });

/** Discipline → [inférieure, supérieure]. */
const DISCIPLINE_CHARS: Readonly<Record<string, readonly [string, string]>> = {
  abo: ["w", "W"],
  ani: ["i", "I"],
  aus: ["a", "A"],
  cel: ["c", "C"],
  chi: ["k", "K"],
  dai: ["y", "Y"],
  dem: ["e", "E"],
  dom: ["d", "D"],
  for: ["f", "F"],
  mal: ["â", "ã"],
  mel: ["m", "M"],
  myt: ["x", "X"],
  nec: ["n", "N"],
  obe: ["b", "B"],
  obf: ["o", "O"],
  obl: ["ø", "Ø"],
  obt: ["$", "£"],
  pot: ["p", "P"],
  pre: ["r", "R"],
  pro: ["j", "J"],
  qui: ["q", "Q"],
  san: ["g", "G"],
  ser: ["s", "S"],
  spi: ["z", "Z"],
  str: ["à", "á"],
  tem: ["?", "!"],
  tha: ["t", "T"],
  thn: ["h", "H"],
  val: ["l", "L"],
  vic: ["v", "V"],
  vis: ["u", "U"],
  // Vertus des imbued et Flight : un seul glyphe, quel que soit le niveau.
  def: ["@", "@"],
  fli: ["^", "^"],
  inn: ["#", "#"],
  jud: ["%", "%"],
  mar: ["&", "&"],
  red: ["*", "*"],
  ven: ["(", "("],
  viz: [")", ")"],
};

/** Les vertus des imbued, rangées à part dans la grille de crypte. */
export const VIRTUE_CODES: ReadonlySet<string> = new Set(["def", "inn", "jud", "mar", "red", "ven", "viz"]);

export function disciplineGlyph(code: string, superior = false): Glyph | null {
  const chars = DISCIPLINE_CHARS[code.toLowerCase()];
  return chars ? ankha(chars[superior ? 1 : 0]) : null;
}

/** Type de bibliothèque → glyphe ; Master n'en a pas. */
const TYPE_CHARS: Readonly<Record<string, string>> = {
  action: "0",
  "action modifier": "1",
  "political action": "2",
  ally: "3",
  combat: "4",
  equipment: "5",
  reflex: "6",
  reaction: "7",
  retainer: "8",
  event: "[",
  power: "§",
  conviction: "¤",
};

export function typeGlyph(type: string): Glyph | null {
  const char = TYPE_CHARS[type.toLowerCase()];
  return char === undefined ? null : ankha(char);
}

const BLOOD_CHARS: Readonly<Record<string, string>> = { "1": "'", "2": ";", "3": ".", "4": ",", X: "-" };
const POOL_CHARS: Readonly<Record<string, string>> = {
  "1": '"',
  "2": ":",
  "3": "/",
  "4": "\\",
  "5": "]",
  "6": "`",
  X: "_",
};

/** Coût en sang ou en pool ; `null` pour la conviction et les valeurs sans glyphe. */
export function costGlyph(costType: string | null, value: string | null): Glyph | null {
  if (value === null) return null;
  const table = costType === "blood" ? BLOOD_CHARS : costType === "pool" ? POOL_CHARS : null;
  const char = table?.[value.toUpperCase()];
  return char === undefined ? null : ankha(char);
}

export const MERGED_GLYPH = ankha("µ");
export const ADVANCED_GLYPH = ankha("|");
export const CONVICTION_GLYPH = ankha("¤");

/** Clan, credo ou voie (nom du catalogue, replié en minuscules) → glyphe de `vtes-clans.otf`. */
const CLAN_CHARS: Readonly<Record<string, string>> = {
  abomination: "A",
  ahrimane: "B",
  akunanse: "C",
  avenger: "1",
  baali: "E",
  "banu haqim": "n",
  "blood brother": "F",
  brujah: "o",
  "brujah antitribu": "H",
  caitiff: "I",
  "daughter of cacophony": "J",
  defender: "2",
  gangrel: "p",
  "gangrel antitribu": "M",
  gargoyle: "N",
  giovanni: "O",
  guruhi: "P",
  "harbinger of skulls": "Q",
  innocent: "3",
  ishtarri: "R",
  judge: "4",
  kiasyd: "S",
  lasombra: "w",
  malkavian: "q",
  "malkavian antitribu": "V",
  martyr: "5",
  ministry: "r",
  nagaraja: "W",
  nosferatu: "s",
  "nosferatu antitribu": "Y",
  osebo: "Z",
  pander: "a",
  ravnos: "b",
  redeemer: "6",
  salubri: "c",
  "salubri antitribu": "d",
  samedi: "e",
  toreador: "t",
  "toreador antitribu": "g",
  tremere: "u",
  "tremere antitribu": "i",
  "true brujah": "j",
  tzimisce: "k",
  ventrue: "v",
  "ventrue antitribu": "m",
  visionary: "7",
};

export function clanGlyph(name: string | null): Glyph | null {
  if (name === null) return null;
  const char = CLAN_CHARS[name.toLowerCase()];
  return char === undefined ? null : { font: "clans", char };
}

/** Mot-clé d'une icône dans le texte de carte (`[pot]`, `[MERGED]`, `[ACTION MODIFIER]`, `[2 CONVICTION]`). */
export interface TextIcon {
  glyph: Glyph;
  label: string;
}

const CONVICTION_TOKEN = /^(\d) CONVICTION$/;

/**
 * Lit un jeton entre crochets du texte de carte (krcg) : discipline (casse =
 * niveau), `MERGED`, `FLIGHT`, type, conviction. `null` pour un jeton inconnu,
 * laissé tel quel dans le texte.
 */
export function textIcon(token: string, disciplineName: (code: string) => string): TextIcon | null {
  if (token === "MERGED") return { glyph: MERGED_GLYPH, label: "Fusionné" };
  if (token === "FLIGHT") return { glyph: ankha("^"), label: "Flight" };
  const conviction = CONVICTION_TOKEN.exec(token);
  if (conviction) return { glyph: CONVICTION_GLYPH, label: `${conviction[1]} conviction` };
  const type = typeGlyph(token);
  if (type) return { glyph: type, label: titleCase(token) };
  const superior = token === token.toUpperCase();
  const glyph = disciplineGlyph(token, superior);
  if (!glyph) return null;
  return { glyph, label: disciplineLabel(disciplineName(token.toLowerCase()), superior, token.toLowerCase()) };
}

const titleCase = (text: string) =>
  text
    .toLowerCase()
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

/** Disciplines à un seul niveau : les vertus et Flight. */
export const isSingleLevel = (code: string) => VIRTUE_CODES.has(code) || code === "fli";

/**
 * « Potence supérieure » : le nom accessible d'une icône de discipline. Une
 * vertu ou Flight n'a pas de niveau ; passer son code évite d'en inventer un.
 */
export const disciplineLabel = (name: string, superior: boolean, code?: string) =>
  code !== undefined && isSingleLevel(code) ? name : `${name} ${superior ? "supérieure" : "inférieure"}`;
