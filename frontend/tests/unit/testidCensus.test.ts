// @vitest-environment node
// Règles de comptage du recensement des data-testid (scripts/testid-census.mjs).
import { describe, expect, it } from "vitest";
import {
  formatList,
  mergeScans,
  missingFromCurrent,
  parseList,
  scanSource,
  summarize,
} from "../../scripts/testid-census.mjs";

describe("scanSource", () => {
  it("compte les littéraux data-testid, avec doublons", () => {
    const scan = scanSource(`<a data-testid="x" /><b data-testid="x" /><c data-testid='y' />`);
    expect(scan.static).toEqual(["x", "x"]);
  });

  it("lit la forme objet et l'accolade autour d'un littéral", () => {
    const scan = scanSource(`const p = { "data-testid": "obj" }; <i data-testid={"acc"} />`);
    expect(scan.static).toEqual(["obj", "acc"]);
  });

  it("range les props en testId à part", () => {
    const scan = scanSource(`<P testId="p1" primaryTestId="p2" />; const t = { testId: "p3" };`);
    expect(scan.prop).toEqual(["p1", "p2", "p3"]);
    expect(scan.static).toEqual([]);
  });

  it("range les gabarits à part, sous forme de motif", () => {
    const scan = scanSource("<a data-testid={`row-${id}-name`} /><b data-testid={`fixe`} />");
    expect(scan.dynamic).toEqual(["row-*-name"]);
    expect(scan.static).toEqual([]);
  });

  it("ignore les expressions qui relaient une prop", () => {
    const scan = scanSource(`<a data-testid={testId} data-testid={ok ? "a" : undefined} />`);
    expect(scan).toEqual({ static: [], prop: [], dynamic: [] });
  });
});

describe("résumé et référence", () => {
  const summary = summarize(
    mergeScans([scanSource(`<a data-testid="b" /><a data-testid="a" />`), scanSource(`<a data-testid="a" />`)]),
  );

  it("distingue identifiants et mentions", () => {
    expect(summary.static.mentions).toBe(3);
    expect(summary.static.distinct).toEqual(["a", "b"]);
  });

  it("écrit une ligne par identifiant, triée, et la relit", () => {
    const text = formatList(summary);
    expect(text).toBe("static\ta\nstatic\tb\n");
    expect(parseList(`# note\n${text}\n`)).toEqual(["static\ta", "static\tb"]);
  });

  it("ne signale que les disparitions", () => {
    const reference = ["static\ta", "static\tb"];
    expect(missingFromCurrent(reference, ["static\ta", "static\tc"])).toEqual(["static\tb"]);
    expect(missingFromCurrent(reference, ["static\ta", "static\tb", "static\tc"])).toEqual([]);
  });
});
