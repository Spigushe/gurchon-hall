import { describe, expect, it } from "vitest";
import {
  collectClientRefs,
  groupCascades,
  type OperationReferences,
} from "../../../src/offline/core/references";
import { assertNever } from "../../../src/offline/core/assertNever";

describe("collectClientRefs (marcheur générique)", () => {
  const fields = [
    { path: "target", kind: "a" },
    { path: "data.owner", kind: "b" },
    { path: "data.rows[].who", kind: "c" },
  ];

  it("lit les références client aux chemins déclarés, tableaux compris", () => {
    const operation = {
      target: { client_ref: "t1" },
      data: {
        owner: { client_ref: "o1" },
        rows: [{ who: { client_ref: "w1" } }, { who: { client_ref: "w2" } }],
      },
    };
    expect(collectClientRefs(operation, fields)).toEqual([
      { kind: "a", clientRef: "t1" },
      { kind: "b", clientRef: "o1" },
      { kind: "c", clientRef: "w1" },
      { kind: "c", clientRef: "w2" },
    ]);
  });

  it("ignore les désignations par identifiant, les champs absents ou nuls et les formes inattendues", () => {
    const operation = {
      target: { id: 3 },
      data: {
        owner: null,
        rows: [{ who: { me: true } }, { who: null }, "x", { who: { client_ref: "" } }],
      },
    };
    expect(collectClientRefs(operation, fields)).toEqual([]);
    expect(collectClientRefs({ data: { rows: "pas un tableau" } }, fields)).toEqual([]);
    expect(collectClientRefs(null, fields)).toEqual([]);
  });
});

describe("groupCascades", () => {
  type Item = { id: string } & OperationReferences;
  const make = (id: string, creates: string | null, uses: string[] = [], kind = "k"): Item => ({
    id,
    creates: creates === null ? null : { kind, clientRef: creates },
    uses: uses.map((clientRef) => ({ kind, clientRef })),
  });
  const group = (items: Item[]) =>
    groupCascades(items, (item) => item).map((g) => [g.root.id, g.dependents.map((d) => d.id)]);

  it("range sous la création refusée ce qui la désigne, de proche en proche", () => {
    const items = [
      make("deck", "d"),
      make("ligne", null, ["d"]),
      make("autre", "x", ["d"]), // dépendante qui crée à son tour
      make("suite", null, ["x"]),
      make("seule", null),
    ];
    expect(group(items)).toEqual([
      ["deck", ["ligne", "autre", "suite"]],
      ["seule", []],
    ]);
  });

  it("ne confond pas deux genres qui portent la même référence", () => {
    const items = [make("deck", "r", [], "deck"), make("joueur", null, ["r"], "player")];
    expect(group(items)).toEqual([
      ["deck", []],
      ["joueur", []],
    ]);
  });

  it("reconnaît une création rangée après son utilisation (correction en fin de file)", () => {
    expect(group([make("ligne", null, ["d"]), make("deck", "d")])).toEqual([["deck", ["ligne"]]]);
  });

  it("ne boucle pas sur un cycle", () => {
    expect(group([make("a", "a", ["b"]), make("b", "b", ["a"])])).toHaveLength(1);
  });

  it("rend une liste vide pour aucun refus", () => {
    expect(group([])).toEqual([]);
  });
});

describe("assertNever", () => {
  it("échoue bruyamment avec le contexte et la valeur", () => {
    expect(() => assertNever("zzz" as never, "Type inconnu")).toThrow('Type inconnu : "zzz"');
  });
});
