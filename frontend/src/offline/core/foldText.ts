import { CASEFOLD_EXCEPTIONS, COMBINING_RANGES } from "./foldData";

/**
 * Repli de texte pour la recherche locale : sans casse, sans accents.
 *
 * Reproduit à l'identique `app.db.folding.fold_text` du back :
 *
 *     _strip_marks(_strip_marks(NFKD(text)).casefold())
 *
 * La parité est exigée parce qu'une même saisie doit donner les mêmes
 * résultats en ligne (recherche `q` du serveur) et hors ligne (IndexedDB).
 * Trois points où JavaScript ne fournit pas l'équivalent tel quel, et ce qui
 * les remplace :
 *
 *  - `unicodedata.combining()` (classe de combinaison non nulle) n'est pas
 *    `\p{M}` : `COMBINING_RANGES` est la table exacte de Python ;
 *  - `str.casefold()` n'est pas `toLowerCase()` (ß -> ss, ς -> σ, ligatures...) :
 *    `CASEFOLD_EXCEPTIONS` porte les écarts, caractère par caractère, ce qui
 *    évite aussi la règle contextuelle du sigma final de `toLowerCase()` ;
 *  - `normalize("NFKD")` vient du moteur JS, pas de Python : les deux suivent
 *    Unicode, un écart n'est possible que pour des caractères récents que les
 *    deux versions d'Unicode ne connaissent pas encore (cf. `foldData.ts`).
 *
 * Portée réelle, comme au back : les lettres qui ne se décomposent pas restent
 * elles-mêmes (« œ » ne devient pas « oe », « ł » ne devient pas « l »).
 *
 * Les tables sont générées (`tools/`) : les régénérer si Python change de
 * version d'Unicode côté back.
 */

const COMBINING = new RegExp(
  `[${COMBINING_RANGES.map(([start, end]) =>
    start === end
      ? `\\u{${start.toString(16)}}`
      : `\\u{${start.toString(16)}}-\\u{${end.toString(16)}}`,
  ).join("")}]`,
  "gu",
);

// Une unité de code hors ASCII (surrogates compris) suffit à quitter la voie rapide.
const NON_ASCII = /[-￿]/;

function stripMarks(text: string): string {
  return text.replace(COMBINING, "");
}

function casefold(text: string): string {
  let result = "";
  for (const char of text) {
    result += CASEFOLD_EXCEPTIONS[char.codePointAt(0) as number] ?? char.toLowerCase();
  }
  return result;
}

/** Texte sans casse ni accents ; `null` et `undefined` restent `null`. */
export function foldText(text: string): string;
export function foldText(text: string | null | undefined): string | null;
export function foldText(text: string | null | undefined): string | null {
  if (text === null || text === undefined) return null;
  // Voie rapide : en ASCII pur, NFKD et la suppression des marques ne changent
  // rien, et le repli de casse se réduit à `toLowerCase()`.
  if (!NON_ASCII.test(text)) return text.toLowerCase();
  // Le second retrait des marques rattrape celles que le repli de casse fait
  // naître (même raison qu'au back).
  return stripMarks(casefold(stripMarks(text.normalize("NFKD"))));
}

/**
 * Texte `haystack` contenant `needle`, casse et accents ignorés.
 *
 * Équivalent de `contains_folded` du back (`fold_text(col) LIKE %q% ESCAPE`) :
 * les jokers `%`, `_` et `\` saisis restent littéraux, ce que `includes` donne
 * par construction. Un texte cherché vide trouve tout.
 */
export function containsFolded(
  haystack: string | null | undefined,
  needle: string,
): boolean {
  return (foldText(haystack) ?? "").includes(foldText(needle));
}
