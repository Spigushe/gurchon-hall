// Génère `core/foldData.ts` à partir de la référence Python
// (`dump_fold_reference.py --source ...`).
//
// Usage : node src/offline/tools/gen_fold_data.mjs <fold-source.json>
//
// Deux tables sortent de là :
//  - `COMBINING_RANGES` : les points de code que `unicodedata.combining()`
//    (classe de combinaison non nulle) retire. Ce n'est PAS `\p{M}` : les
//    marques de classe 0 (espacantes, englobantes) restent côté Python ;
//  - `CASEFOLD_EXCEPTIONS` : les points de code dont `str.casefold()` diffère du
//    `toLowerCase()` de JavaScript appliqué caractère par caractère (ß, ς, ſ,
//    ligatures, grec à iota souscrit, cherokee...). Le reste passe par
//    `toLowerCase()`, ce qui garde la table courte.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const source = JSON.parse(readFileSync(process.argv[2], "utf-8"));
const outFile = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../core/foldData.ts",
);

const exceptions = [];
for (const [hex, folded] of Object.entries(source.casefold)) {
  const char = String.fromCodePoint(parseInt(hex, 16));
  if (char.toLowerCase() !== folded) exceptions.push([parseInt(hex, 16), folded]);
}
// Un point de code que Python laisse intact mais dont JS change la casse : il
// faut aussi le neutraliser (ex. certains capitales que Python ne replie pas).
const inSource = new Set(Object.keys(source.casefold).map((h) => parseInt(h, 16)));
for (let cp = 0; cp < 0x110000; cp++) {
  if (cp >= 0xd800 && cp < 0xe000) continue;
  if (inSource.has(cp)) continue;
  const char = String.fromCodePoint(cp);
  if (char.toLowerCase() !== char) exceptions.push([cp, char]);
}
exceptions.sort((a, b) => a[0] - b[0]);

const hex = (n) => `0x${n.toString(16)}`;
const ranges = source.combining.map(([a, b]) => `[${hex(a)},${hex(b)}]`).join(",");
const exc = exceptions
  .map(([cp, folded]) => `${hex(cp)}:${JSON.stringify(folded)}`)
  .join(",");

writeFileSync(
  outFile,
  `// FICHIER GÉNÉRÉ par tools/gen_fold_data.mjs : ne pas modifier à la main.
// Référence : Python ${source.python}, Unicode ${source.unicode_version}
// (\`app.db.folding.fold_text\` du back). Voir tools/dump_fold_reference.py.

/** Plages [début, fin] des points de code de classe de combinaison non nulle. */
export const COMBINING_RANGES: ReadonlyArray<readonly [number, number]> = [${ranges}];

/**
 * Points de code dont \`str.casefold()\` (Python) diffère de \`toLowerCase()\`
 * (JavaScript, caractère isolé).
 */
export const CASEFOLD_EXCEPTIONS: Readonly<Record<number, string>> = {${exc}};
`,
);
console.log(
  `${source.combining.length} plages, ${exceptions.length} exceptions -> ${outFile}`,
);
