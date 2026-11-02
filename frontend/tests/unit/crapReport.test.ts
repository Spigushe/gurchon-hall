// @vitest-environment node
// Règles de comptage du score CRAP (`scripts/crap-report.mjs`, docs/qa-crap.md).
// Mêmes cas que `backend/tests/test_crap_report.py` : les deux analyseurs
// doivent compter de la même façon.
import ts from "typescript";
import { describe, expect, it } from "vitest";
import {
  applyCoverage,
  collectFunctions,
  compareToBaseline,
  crapScore,
} from "../../scripts/crap-report.mjs";

type Fn = { name: string; complexity: number; covered: number; statements: number };

function parse(source: string) {
  return ts.createSourceFile("m.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

function functions(source: string): Fn[] {
  return collectFunctions(parse(source));
}

const complexityOf = (source: string) => functions(source)[0].complexity;

describe("complexité cyclomatique", () => {
  it.each([
    ["function f() { return 1; }", 1],
    ["function f(x: number) { if (x > 0) return 1; else if (x < 0) return -1; else return 0; }", 3],
    ["const f = (a: boolean, b: boolean, c: boolean) => (a && b) || c;", 3],
    ["const f = (a: boolean) => (a ? 1 : 2);", 2],
    ["function f(xs: number[]) { for (const x of xs) { let y = x; while (y) y--; } }", 3],
    ["function f() { try { g(); } catch { h(); } }", 2],
    ["function f(x: number) { switch (x) { case 1: return 'un'; case 2: return 'deux'; default: return 'autre'; } }", 3],
    ["const f = (a?: { b?: number }, c = 1) => a?.b ?? c;", 2],
    ["const C = ({ on }: { on: boolean }) => <div>{on && <span />}</div>;", 2],
  ])("%s → %i", (source, expected) => {
    expect(complexityOf(source)).toBe(expected);
  });

  it("mesure une fonction imbriquée à part", () => {
    const [outer, inner] = functions("function f(x: number) { const g = (y: number) => (y ? y : 0); return g(x); }");
    expect([outer.name, outer.complexity]).toEqual(["f", 1]);
    expect([inner.name, inner.complexity]).toEqual(["f.g", 2]);
  });
});

describe("noms des fonctions", () => {
  it("nomme les fonctions anonymes d'après leur contexte", () => {
    const names = functions(`
      class Engine { start() { return new Promise((resolve) => resolve(1)); } }
      export function Page() {
        useEffect(() => {}, []);
        let transform = (op: number) => op;
        transform = (op: number) => op + 1;
        return <button onClick={() => transform(1)} />;
      }
      function compare() { return (a: number, b: number) => a - b; }
    `).map((f) => f.name);
    expect(names).toEqual([
      "Engine.start",
      "Engine.start.Promise(callback)",
      "Page",
      "Page.useEffect(callback)",
      "Page.transform",
      "Page.transform#2",
      "Page.onClick",
      "compare",
      "compare.<retournée>",
    ]);
  });
});

describe("couverture par fonction", () => {
  it("attribue chaque instruction à la fonction la plus profonde", () => {
    const source = parse(
      ["function outer(x: number) {", "  if (x) return 1;", "  const inner = () => 2;", "  return inner;", "}"].join(
        "\n",
      ),
    );
    const fns = collectFunctions(source);
    const at = (line: number, column: number) => ({ start: { line, column }, end: { line, column: column + 1 } });
    applyCoverage(fns, {
      statementMap: { 0: at(2, 2), 1: at(2, 9), 2: at(3, 2), 3: at(3, 22), 4: at(4, 2) },
      s: { 0: 1, 1: 0, 2: 1, 3: 0, 4: 1 },
    });
    const [outer, inner] = fns;
    expect([outer.covered, outer.statements]).toEqual([3, 4]);
    expect([inner.covered, inner.statements]).toEqual([0, 1]);
  });
});

describe("score CRAP", () => {
  it.each([
    [1, 1, 1],
    [5, 0, 30],
    [5, 1, 5],
    [10, 0.5, 22.5],
    [31, 1, 31],
  ])("comp %i, couverture %f → %f", (complexity, coverage, expected) => {
    expect(crapScore(complexity, coverage)).toBeCloseTo(expected);
  });

  it("compare à la référence", () => {
    const score = (key: string, crap: number) => ({ key, crap });
    const { fresh, worse, improved } = compareToBaseline(
      [
        score("a.ts::nouvelle", 42),
        score("a.ts::enHausse", 42),
        score("a.ts::stable", 42),
        score("a.ts::enBaisse", 5),
        score("a.ts::sousLeSeuil", 30),
      ],
      { "a.ts::enHausse": 35, "a.ts::stable": 42, "a.ts::enBaisse": 40, "a.ts::disparue": 50 },
      30,
    );
    expect(fresh.map((s: { key: string }) => s.key)).toEqual(["a.ts::nouvelle"]);
    expect(worse.map((s: { key: string }) => s.key)).toEqual(["a.ts::enHausse"]);
    expect(improved).toEqual(["a.ts::disparue", "a.ts::enBaisse"]);
  });
});
