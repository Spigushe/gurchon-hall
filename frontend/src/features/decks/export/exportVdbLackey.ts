import { cryptName, compareFolded, splitDeck, vdbName, type VdbExportInput } from "./exportVdbText";

/**
 * Export d'un deck au format `LACKEY` de VDB (Lot 13, P9, A11), sur les exports
 * réels `ref-lackey.txt` et `difficile-lackey.txt` : la bibliothèque d'abord, par
 * nom, puis une ligne `Crypt:` et la crypte par nom ; chaque ligne est la
 * quantité calée sur 8 caractères, puis le nom en ASCII (accents retirés,
 * `/` supprimé). Comme pour `JOL`, pas de `(G6)`.
 */

/** Lettres que la décomposition Unicode ne ramène pas à l'ASCII. */
const LATIN_EXTRAS: Record<string, string> = {
  ł: "l",
  Ł: "L",
  ø: "o",
  Ø: "O",
  đ: "d",
  Đ: "D",
  œ: "oe",
  Œ: "Oe",
  æ: "ae",
  Æ: "Ae",
  ß: "ss",
  ð: "d",
  Ð: "D",
  þ: "th",
  Þ: "Th",
  "’": "'",
  "‘": "'",
  "–": "-",
  "—": "-",
};

/** Nom en ASCII pur : accents retirés, lettres étendues transcrites, `/` et tout reste non ASCII supprimés. */
export function lackeyName(name: string): string {
  return [...name.normalize("NFD").replace(/\p{M}/gu, "")]
    .map((char) => LATIN_EXTRAS[char] ?? char)
    .join("")
    .replace(/\//g, "")
    .replace(/[^\x20-\x7e]/g, "");
}

const QUANTITY_WIDTH = 8;

const lackeyLine = (quantity: number, name: string) => `${String(quantity).padEnd(QUANTITY_WIDTH)}${name}\n`;

export function exportVdbLackey(input: VdbExportInput): string {
  const { crypt, library } = splitDeck(input);
  const none = new Set<number>();
  const lines = (rows: typeof crypt, nameOf: (row: (typeof crypt)[number]) => string) =>
    rows
      .map((row) => ({ quantity: row.quantity, name: lackeyName(nameOf(row)) }))
      .sort((a, b) => compareFolded(a.name, b.name))
      .map((line) => lackeyLine(line.quantity, line.name));
  return [
    ...lines(library, (row) => vdbName(row.name)),
    "Crypt:\n",
    ...lines(crypt, (row) => cryptName(row, none)),
  ].join("");
}
