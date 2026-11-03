// Recensement des `data-testid` de frontend/src (Lot Chercher, étape E0).
//
// Usage, depuis frontend/ :
//   node scripts/testid-census.mjs                       résumé chiffré
//   node scripts/testid-census.mjs --list                liste triée (format de la référence)
//   node scripts/testid-census.mjs --check <référence>   échoue si un identifiant a disparu
//   node scripts/testid-census.mjs --list > <référence> régénère la référence
//
// Trois familles, comptées à part :
//   static   `data-testid="x"` ou `"data-testid": "x"` : littéral. C'est le chiffre
//            comparable à ceux des Lots 5 et 5c (193 au Lot 5c).
//   prop     littéral passé par une prop qui finit par `testId` (`testId="x"`,
//            `primaryTestId="x"`, `testId: "x"`) : le composant qui la reçoit le pose
//            en `data-testid`. Identifiant réel, mais absent du chiffre « static ».
//   dynamic  gabarit `data-testid={`a-${x}`}` ou prop gabarit : l'identifiant réel
//            dépend d'une valeur d'exécution. Exclu des totaux d'identifiants,
//            compté à part sous forme de motif (`${…}` devient `*`).
// Une expression non littérale (`data-testid={testId}`) relaie une prop : elle n'est
// ni comptée ni listée, de même qu'un littéral dans une condition
// (`data-testid={desktop ? "x" : undefined}`, un seul cas). Les fichiers `*.test.*` de src/ sont ignorés.
//
// Une référence est une liste de lignes `famille<TAB>identifiant`. Le contrôle ne
// regarde que les disparitions : un identifiant en moins est une rupture possible
// pour les e2e, un identifiant en plus est le cours normal d'un lot.

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SRC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src");

const STRING = String.raw`"([^"\n]*)"`;
const TEMPLATE = "`([^`\\n]*)`";
const ATTRIBUTE = String.raw`(?:data-testid|[A-Za-z]*[tT]estId)`;
const STATIC_RE = new RegExp(String.raw`["']?data-testid["']?\s*(?:=|:)\s*\{?\s*${STRING}`, "g");
const PROP_RE = new RegExp(String.raw`\b[A-Za-z]*[tT]estId\s*(?:=|:)\s*\{?\s*${STRING}`, "g");
const DYNAMIC_RE = new RegExp(String.raw`${ATTRIBUTE}["']?\s*(?:=|:)\s*\{?\s*${TEMPLATE}`, "g");

function matches(regex, source) {
  return [...source.matchAll(regex)].map((m) => m[1]);
}

/** Identifiants d'un source, par famille, avec doublons (une entrée par mention). */
export function scanSource(source) {
  const staticIds = matches(STATIC_RE, source);
  const propIds = matches(PROP_RE, source);
  const dynamic = matches(DYNAMIC_RE, source)
    .filter((template) => template.includes("${"))
    .map((template) => template.replace(/\$\{[^}]*\}/g, "*"));
  return { static: staticIds, prop: propIds, dynamic };
}

/** Additionne les mentions de plusieurs fichiers. */
export function mergeScans(scans) {
  const merged = { static: [], prop: [], dynamic: [] };
  for (const scan of scans) {
    for (const family of Object.keys(merged)) merged[family].push(...scan[family]);
  }
  return merged;
}

/** Mentions brutes, distincts triés, par famille. */
export function summarize(scan) {
  const out = {};
  for (const family of Object.keys(scan)) {
    out[family] = { mentions: scan[family].length, distinct: [...new Set(scan[family])].sort() };
  }
  return out;
}

export function formatList(summary) {
  const lines = [];
  for (const family of Object.keys(summary)) {
    for (const id of summary[family].distinct) lines.push(`${family}\t${id}`);
  }
  return lines.join("\n") + "\n";
}

export function parseList(text) {
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "" && !line.startsWith("#"))
    .map((line) => line.trim());
}

/** Lignes de la référence qui ne figurent plus dans la liste courante. */
export function missingFromCurrent(referenceLines, currentLines) {
  const current = new Set(currentLines);
  return referenceLines.filter((line) => !current.has(line));
}

function sourceFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(full));
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) files.push(full);
  }
  return files.sort();
}

function censusOfSrc() {
  return summarize(mergeScans(sourceFiles(SRC_DIR).map((f) => scanSource(readFileSync(f, "utf8")))));
}

function describe(summary) {
  const rows = Object.entries(summary).map(
    ([family, { mentions, distinct }]) => `${family.padEnd(8)} ${distinct.length} distincts, ${mentions} mentions`,
  );
  return rows.join("\n") + "\n";
}

function main(argv) {
  const summary = censusOfSrc();
  const checkAt = argv.indexOf("--check");
  if (checkAt >= 0) {
    const reference = parseList(readFileSync(argv[checkAt + 1], "utf8"));
    const missing = missingFromCurrent(reference, parseList(formatList(summary)));
    if (missing.length === 0) {
      process.stdout.write(`Aucun identifiant disparu (${reference.length} en référence).\n`);
      return 0;
    }
    process.stderr.write(`Identifiants disparus :\n${missing.join("\n")}\n`);
    return 1;
  }
  process.stdout.write(argv.includes("--list") ? formatList(summary) : describe(summary));
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
