#!/usr/bin/env node
/**
 * Calcule le score CRAP de chaque fonction de `src/` et le compare à la
 * référence. Pendant TypeScript de `backend/scripts/crap_report.py`, avec les
 * mêmes règles de comptage et le même format de référence (`docs/qa-crap.md`).
 *
 *   CRAP(f) = comp(f)² × (1 − cov(f))³ + comp(f)
 *
 * comp : complexité cyclomatique de McCabe, lue dans l'AST du compilateur
 * TypeScript. cov : part des instructions du corps de la fonction exécutées par
 * vitest (`coverage/coverage-final.json`, fournisseur v8), sans les fonctions
 * imbriquées, mesurées à part.
 *
 * Usage (depuis `frontend/`) :
 *   npm run test:coverage                 produit coverage/coverage-final.json
 *   npm run crap                          rapport + contrôle de la référence
 *   npm run crap -- --update-baseline     réécrit la référence
 *
 * Options : --coverage <fichier>, --baseline <fichier>, --threshold <n>,
 * --top <n>, --json <fichier>, --update-baseline.
 *
 * Code de sortie : 1 si une fonction dépasse le seuil sans figurer dans la
 * référence, ou si une fonction de la référence a vu son score monter ; 0 sinon.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const FRONTEND_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = path.dirname(FRONTEND_DIR);
const DEFAULT_THRESHOLD = 30;

function parseArgs(argv) {
  const args = {
    coverage: path.join(FRONTEND_DIR, "coverage", "coverage-final.json"),
    source: path.join(FRONTEND_DIR, "src"),
    baseline: path.join(REPO_ROOT, "docs", "qa-baselines", "crap", "frontend.json"),
    threshold: DEFAULT_THRESHOLD,
    top: 15,
    json: null,
    updateBaseline: false,
  };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case "--coverage":
        args.coverage = path.resolve(argv[++i]);
        break;
      case "--baseline":
        args.baseline = path.resolve(argv[++i]);
        break;
      case "--threshold":
        args.threshold = Number(argv[++i]);
        break;
      case "--top":
        args.top = Number(argv[++i]);
        break;
      case "--json":
        args.json = path.resolve(argv[++i]);
        break;
      case "--update-baseline":
        args.updateBaseline = true;
        break;
      default:
        throw new Error(`Option inconnue : ${argv[i]}`);
    }
  }
  return args;
}

export function crapScore(complexity, coverage) {
  return complexity ** 2 * (1 - coverage) ** 3 + complexity;
}

const round1 = (value) => Math.round(value * 10) / 10;

function isFunctionLike(node) {
  return (
    (ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isArrowFunction(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isConstructorDeclaration(node) ||
      ts.isGetAccessorDeclaration(node) ||
      ts.isSetAccessorDeclaration(node)) &&
    node.body !== undefined
  );
}

const LOGICAL_OPERATORS = new Set([
  ts.SyntaxKind.AmpersandAmpersandToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.QuestionQuestionToken,
  ts.SyntaxKind.AmpersandAmpersandEqualsToken,
  ts.SyntaxKind.BarBarEqualsToken,
  ts.SyntaxKind.QuestionQuestionEqualsToken,
]);

/**
 * McCabe : 1 + un point par décision, sans descendre dans les fonctions
 * imbriquées. Ni `?.` ni les valeurs par défaut ne comptent, pour garder les
 * mêmes règles que le back (docs/qa-crap.md).
 */
export function cyclomaticComplexity(func) {
  let complexity = 1;
  const visit = (node) => {
    if (isFunctionLike(node)) return;
    switch (node.kind) {
      case ts.SyntaxKind.IfStatement:
      case ts.SyntaxKind.ConditionalExpression:
      case ts.SyntaxKind.ForStatement:
      case ts.SyntaxKind.ForInStatement:
      case ts.SyntaxKind.ForOfStatement:
      case ts.SyntaxKind.WhileStatement:
      case ts.SyntaxKind.DoStatement:
      case ts.SyntaxKind.CatchClause:
      case ts.SyntaxKind.CaseClause:
        complexity += 1;
        break;
      case ts.SyntaxKind.BinaryExpression:
        if (LOGICAL_OPERATORS.has(node.operatorToken.kind)) complexity += 1;
        break;
    }
    ts.forEachChild(node, visit);
  };
  // Le corps lui-même, pas seulement ses enfants : celui d'une fléchée peut
  // être une décision (`(a, b) => a && b`).
  visit(func.body);
  return complexity;
}

function propertyName(name, sourceFile) {
  return ts.isIdentifier(name) || ts.isPrivateIdentifier(name) ? name.text : name.getText(sourceFile);
}

/** Nom lisible et stable d'une fonction, y compris anonyme : la référence
 * désigne les fonctions par nom, pas par ligne, pour survivre aux décalages. */
function ownName(node, sourceFile) {
  if (ts.isConstructorDeclaration(node)) return "constructor";
  if (ts.isGetAccessorDeclaration(node)) return `get ${propertyName(node.name, sourceFile)}`;
  if (ts.isSetAccessorDeclaration(node)) return `set ${propertyName(node.name, sourceFile)}`;
  if (node.name) return propertyName(node.name, sourceFile);

  let parent = node.parent;
  while (
    ts.isParenthesizedExpression(parent) ||
    ts.isAsExpression(parent) ||
    ts.isSatisfiesExpression(parent)
  ) {
    parent = parent.parent;
  }
  if (
    ts.isVariableDeclaration(parent) ||
    ts.isPropertyDeclaration(parent) ||
    ts.isPropertyAssignment(parent) ||
    ts.isParameter(parent)
  ) {
    return propertyName(parent.name, sourceFile);
  }
  if (ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
    const target = parent.left;
    if (ts.isIdentifier(target)) return target.text;
    if (ts.isPropertyAccessExpression(target)) return target.name.text;
  }
  if (ts.isCallExpression(parent) || ts.isNewExpression(parent)) {
    // Fonction passée en argument : `useEffect(() => …)` devient
    // « useEffect(callback) », `items.map(…)` devient « map(callback) ».
    const callee = parent.expression;
    const calleeName = ts.isPropertyAccessExpression(callee)
      ? callee.name.text
      : ts.isIdentifier(callee)
        ? callee.text
        : "call";
    return `${calleeName}(callback)`;
  }
  if (ts.isJsxExpression(parent) && ts.isJsxAttribute(parent.parent)) {
    return parent.parent.name.getText(sourceFile);
  }
  if (ts.isExportAssignment(parent)) return "default";
  // Fonction rendue par une autre : `return (a, b) => …` ou `() => () => …`.
  if (ts.isReturnStatement(parent) || isFunctionLike(parent)) return "<retournée>";
  return "<anonyme>";
}

function position(sourceFile, offset) {
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(offset);
  return [line + 1, character];
}

const before = (a, b) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
const inside = (point, start, end) => !before(point, start) && before(point, end);

/** Fonctions d'un fichier, avec nom qualifié, complexité et étendue du corps. */
export function collectFunctions(sourceFile) {
  const functions = [];
  const seen = new Map();
  const visit = (node, prefix) => {
    if (isFunctionLike(node)) {
      const name = `${prefix}${ownName(node, sourceFile)}`;
      const count = (seen.get(name) ?? 0) + 1;
      seen.set(name, count);
      functions.push({
        name: count === 1 ? name : `${name}#${count}`,
        line: position(sourceFile, node.getStart(sourceFile))[0],
        complexity: cyclomaticComplexity(node),
        bodyStart: position(sourceFile, node.body.getStart(sourceFile)),
        bodyEnd: position(sourceFile, node.body.getEnd()),
        covered: 0,
        statements: 0,
      });
      ts.forEachChild(node, (child) => visit(child, `${name}.`));
      return;
    }
    if ((ts.isClassDeclaration(node) || ts.isClassExpression(node)) && node.name) {
      ts.forEachChild(node, (child) => visit(child, `${prefix}${node.name.text}.`));
      return;
    }
    ts.forEachChild(node, (child) => visit(child, prefix));
  };
  visit(sourceFile, "");
  return functions;
}

/** Attribue chaque instruction couverte ou non à la fonction la plus
 * profonde dont le corps la contient. */
export function applyCoverage(functions, fileCoverage) {
  for (const [id, location] of Object.entries(fileCoverage.statementMap)) {
    const start = [location.start.line, location.start.column];
    let owner = null;
    for (const func of functions) {
      if (inside(start, func.bodyStart, func.bodyEnd) && (owner === null || before(owner.bodyStart, func.bodyStart))) {
        owner = func;
      }
    }
    if (owner === null) continue;
    owner.statements += 1;
    if (fileCoverage.s[id] > 0) owner.covered += 1;
  }
}

function listSources(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listSources(full));
    else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts")) files.push(full);
  }
  return files.sort();
}

const normalize = (file) => {
  const resolved = path.resolve(file);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
};

function collectScores(sourceDir, coveragePath) {
  const report = JSON.parse(readFileSync(coveragePath, "utf-8"));
  const coverageByFile = new Map(Object.entries(report).map(([file, data]) => [normalize(file), data]));
  const scores = [];
  for (const file of listSources(sourceDir)) {
    const relPath = path.relative(FRONTEND_DIR, file).split(path.sep).join("/");
    const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
    const sourceFile = ts.createSourceFile(file, readFileSync(file, "utf-8"), ts.ScriptTarget.Latest, true, kind);
    const functions = collectFunctions(sourceFile);
    const fileCoverage = coverageByFile.get(normalize(file));
    if (fileCoverage) applyCoverage(functions, fileCoverage);
    for (const func of functions) {
      // Absente du rapport, une fonction est tenue pour non couverte ; sans
      // instruction mesurée (corps vide), elle n'a rien à couvrir.
      const coverage = !fileCoverage ? 0 : func.statements === 0 ? 1 : func.covered / func.statements;
      scores.push({
        key: `${relPath}::${func.name}`,
        path: relPath,
        line: func.line,
        complexity: func.complexity,
        coverage,
        crap: round1(crapScore(func.complexity, coverage)),
      });
    }
  }
  return scores;
}

/**
 * Règle de la référence : au-dessus du seuil, une fonction absente de la
 * référence (`fresh`) ou dont le score a monté (`worse`) fait échouer ; une
 * entrée qui a baissé ou disparu (`improved`) invite à resserrer la référence.
 */
export function compareToBaseline(scores, baseline, threshold) {
  const current = new Map(scores.map((s) => [s.key, s.crap]));
  const above = scores.filter((s) => s.crap > threshold);
  return {
    fresh: above.filter((s) => !(s.key in baseline)),
    worse: above.filter((s) => s.key in baseline && s.crap > baseline[s.key]),
    improved: Object.keys(baseline)
      .filter((key) => (current.get(key) ?? 0) < baseline[key])
      .sort(),
  };
}

function loadBaseline(file) {
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf-8")).functions : {};
}

function writeBaseline(file, scores, threshold) {
  const functions = Object.fromEntries(
    scores
      .filter((s) => s.crap > threshold)
      .map((s) => [s.key, s.crap])
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ threshold, functions }, null, 2) + "\n", "utf-8");
}

const pct = (value) => `${Math.round(value * 100)}%`;
const row = (s) =>
  `${s.crap.toFixed(1).padStart(8)}  ${String(s.complexity).padStart(4)}  ${pct(s.coverage).padStart(6)}  ` +
  `${s.path}:${s.line}  ${s.key.split("::")[1]}`;

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!existsSync(args.coverage)) {
    console.error(`${args.coverage} introuvable : lancer \`npm run test:coverage\` d'abord.`);
    return 1;
  }

  const scores = collectScores(args.source, args.coverage);
  scores.sort((a, b) => b.crap - a.crap || (a.key < b.key ? -1 : 1));

  if (args.json) {
    const rows = scores.map((s) => ({
      function: s.key,
      line: s.line,
      complexity: s.complexity,
      coverage: Math.round(s.coverage * 10000) / 10000,
      crap: s.crap,
    }));
    writeFileSync(args.json, JSON.stringify(rows, null, 2) + "\n", "utf-8");
  }

  const above = scores.filter((s) => s.crap > args.threshold);
  if (args.updateBaseline) {
    writeBaseline(args.baseline, scores, args.threshold);
    console.log(`Référence réécrite : ${args.baseline} (${above.length} fonctions au-dessus de ${args.threshold}).`);
    return 0;
  }

  console.log(
    `CRAP frontend : ${scores.length} fonctions, ${above.length} au-dessus de ${args.threshold}, ` +
      `pire ${(scores[0]?.crap ?? 0).toFixed(1)}.`,
  );
  console.log(`\n${"CRAP".padStart(8)}  ${"comp".padStart(4)}  ${"couv.".padStart(6)}  fonction`);
  for (const s of scores.slice(0, args.top)) console.log(row(s));

  const baseline = loadBaseline(args.baseline);
  const current = new Map(scores.map((s) => [s.key, s.crap]));
  const { fresh, worse, improved } = compareToBaseline(scores, baseline, args.threshold);

  if (improved.length > 0) {
    console.log(
      `\n${improved.length} entrée(s) de la référence ont baissé ou disparu : resserrer la référence (--update-baseline).`,
    );
    for (const key of improved) {
      console.log(`  ${key} : ${baseline[key].toFixed(1)} -> ${(current.get(key) ?? 0).toFixed(1)}`);
    }
  }

  if (fresh.length > 0 || worse.length > 0) {
    console.error(`\nÉCHEC : régression CRAP (seuil ${args.threshold}).`);
    for (const s of fresh) console.error(`  nouvelle : ${row(s)}`);
    for (const s of worse) console.error(`  en hausse (${baseline[s.key].toFixed(1)} avant) : ${row(s)}`);
    return 1;
  }

  console.log("\nAucune régression CRAP par rapport à la référence.");
  return 0;
}

// Importé par les tests (tests/unit/crapReport.test.ts), le module ne lance rien.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
