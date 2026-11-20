import { cryptName, compareFolded, splitDeck, vdbName, type VdbExportInput } from "./exportVdbText";

/**
 * Export d'un deck au format `JOL` de VDB (Lot 13, P9, A11), sur les exports réels
 * `ref-jol.txt` et `difficile-jol.txt` : une ligne `2xNom` par carte, sans
 * en-tête ni espace après le `x`, la crypte d'abord puis la bibliothèque, chacune
 * par nom (insensible à la casse et aux accents). Un *advanced* garde `(ADV)` ;
 * le groupe d'un vampire réimprimé (`(G6)`) n'est pas écrit, VDB ne le fait que
 * pour `TEXT` et `TWD` (écart assumé, un nom seul se relit comme la version
 * d'origine, ou celle que la crypte rend légale, à l'import du Lot 9).
 */
export function exportVdbJol(input: VdbExportInput): string {
  const { crypt, library } = splitDeck(input);
  const none = new Set<number>();
  const lines = [
    ...crypt.map((row) => ({ quantity: row.quantity, name: cryptName(row, none) })),
    ...library.map((row) => ({ quantity: row.quantity, name: vdbName(row.name) })),
  ];
  const byName = (a: { name: string }, b: { name: string }) => compareFolded(a.name, b.name);
  const cryptCount = crypt.length;
  const sorted = [...lines.slice(0, cryptCount).sort(byName), ...lines.slice(cryptCount).sort(byName)];
  return sorted.map((line) => `${line.quantity}x${line.name}\n`).join("");
}
