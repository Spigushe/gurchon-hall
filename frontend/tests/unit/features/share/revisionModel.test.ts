import { describe, expect, it } from "vitest";
import {
  applyRevision,
  encodeRevision,
  formatDelta,
  noticeMessages,
  parseRevision,
  splitKnown,
  withQuantity,
} from "../../../../src/features/share/revisionModel";

const ORIGINAL = [
  { cardId: 100845, quantity: 2 },
  { cardId: 102366, quantity: 1 },
  { cardId: 201436, quantity: 3 },
];

describe("parseRevision : table de cas", () => {
  const cases: [string, string | null, { deltas: [number, number][]; unreadable: number }][] = [
    ["aucun paramètre", null, { deltas: [], unreadable: 0 }],
    ["paramètre vide", "", { deltas: [], unreadable: 0 }],
    ["exemple de VDB", "100845=1;102366=-1;201436=-1", { deltas: [[100845, 1], [102366, -1], [201436, -1]], unreadable: 0 }],
    ["trié par identifiant", "201436=-1;100845=2", { deltas: [[100845, 2], [201436, -1]], unreadable: 0 }],
    ["écart nul non gardé", "100845=0;102366=1", { deltas: [[102366, 1]], unreadable: 0 }],
    ["signe plus accepté", "100845=+2", { deltas: [[100845, 2]], unreadable: 0 }],
    ["doublon sommé", "100845=1;100845=2", { deltas: [[100845, 3]], unreadable: 0 }],
    ["doublon qui s'annule", "100845=1;100845=-1", { deltas: [], unreadable: 0 }],
    ["adresse tronquée (sans écart)", "100845=1;1023", { deltas: [[100845, 1]], unreadable: 1 }],
    ["adresse tronquée (écart manquant)", "100845=1;102366=", { deltas: [[100845, 1]], unreadable: 1 }],
    ["identifiant non numérique", "abc=1;100845=1", { deltas: [[100845, 1]], unreadable: 1 }],
    ["écart non numérique", "100845=x", { deltas: [], unreadable: 1 }],
    ["écart décimal", "100845=1.5", { deltas: [], unreadable: 1 }],
    ["identifiant nul", "0=1", { deltas: [], unreadable: 1 }],
    ["identifiant hors borne", "2147483648=1", { deltas: [], unreadable: 1 }],
    ["écart démesuré", "100845=100000", { deltas: [], unreadable: 1 }],
    ["point-virgule final", "100845=1;", { deltas: [[100845, 1]], unreadable: 0 }],
    ["encodé en pourcentage", "100845%3D1%3B102366%3D-1", { deltas: [[100845, 1], [102366, -1]], unreadable: 0 }],
  ];
  it.each(cases)("%s", (_name, raw, expected) => {
    expect(parseRevision(raw)).toEqual({
      deltas: expected.deltas.map(([cardId, delta]) => ({ cardId, delta })),
      unreadable: expected.unreadable,
    });
  });
});

describe("encodeRevision", () => {
  it("écrit l'exemple de VDB, trié", () => {
    expect(
      encodeRevision([
        { cardId: 201436, delta: -1 },
        { cardId: 100845, delta: 1 },
        { cardId: 102366, delta: -1 },
      ]),
    ).toBe("100845=1;102366=-1;201436=-1");
  });
  it("retire les écarts nuls et rend null s'il n'en reste aucun", () => {
    expect(encodeRevision([{ cardId: 5, delta: 0 }])).toBeNull();
    expect(encodeRevision([])).toBeNull();
  });
  it("somme un doublon", () => {
    expect(encodeRevision([{ cardId: 5, delta: 1 }, { cardId: 5, delta: 1 }])).toBe("5=2");
  });
  it("relit ce qu'elle écrit", () => {
    const deltas = [{ cardId: 7, delta: -2 }, { cardId: 9, delta: 4 }];
    expect(parseRevision(encodeRevision(deltas)).deltas).toEqual(deltas);
  });
});

describe("applyRevision : table de cas", () => {
  it("ajoute une carte inconnue de la liste (originalQuantity 0)", () => {
    expect(applyRevision(ORIGINAL, [{ cardId: 300000, delta: 2 }]).lines).toContainEqual({
      cardId: 300000,
      quantity: 2,
      originalQuantity: 0,
    });
  });
  it("retire en partie", () => {
    const { lines, clamped } = applyRevision(ORIGINAL, [{ cardId: 201436, delta: -1 }]);
    expect(lines.find((line) => line.cardId === 201436)).toEqual({ cardId: 201436, quantity: 2, originalQuantity: 3 });
    expect(clamped).toBe(0);
  });
  it("retire en totalité (l'opposé de la quantité d'origine)", () => {
    const { lines, clamped } = applyRevision(ORIGINAL, [{ cardId: 201436, delta: -3 }]);
    expect(lines.find((line) => line.cardId === 201436)).toEqual({ cardId: 201436, quantity: 0, originalQuantity: 3 });
    expect(clamped).toBe(0);
  });
  it("ignore un écart nul", () => {
    expect(applyRevision(ORIGINAL, [{ cardId: 100845, delta: 0 }]).lines).toEqual(
      ORIGINAL.map(({ cardId, quantity }) => ({ cardId, quantity, originalQuantity: quantity })),
    );
  });
  it("ramène à zéro un retrait qui passerait sous zéro, et le compte", () => {
    const { lines, clamped } = applyRevision(ORIGINAL, [{ cardId: 102366, delta: -5 }]);
    expect(lines.find((line) => line.cardId === 102366)).toEqual({ cardId: 102366, quantity: 0, originalQuantity: 1 });
    expect(clamped).toBe(1);
  });
  it("compte un retrait d'une carte absente de la liste, sans en faire une ligne", () => {
    const { lines, clamped } = applyRevision(ORIGINAL, [{ cardId: 999999, delta: -1 }]);
    expect(lines.map((line) => line.cardId)).toEqual([100845, 102366, 201436]);
    expect(clamped).toBe(1);
  });
  it("applique l'exemple de VDB", () => {
    const { lines, clamped } = applyRevision(ORIGINAL, parseRevision("100845=1;102366=-1;201436=-1").deltas);
    expect(lines).toEqual([
      { cardId: 100845, quantity: 3, originalQuantity: 2 },
      { cardId: 102366, quantity: 0, originalQuantity: 1 },
      { cardId: 201436, quantity: 2, originalQuantity: 3 },
    ]);
    expect(clamped).toBe(0);
  });
  it("somme les doublons passés directement", () => {
    const { lines } = applyRevision(ORIGINAL, [{ cardId: 100845, delta: 1 }, { cardId: 100845, delta: 1 }]);
    expect(lines[0].quantity).toBe(4);
  });
});

describe("withQuantity, splitKnown, messages", () => {
  it("remplace l'écart d'une carte par quantité - origine et l'efface au retour", () => {
    const first = withQuantity([{ cardId: 1, delta: 5 }], 2, 3, 4);
    expect(first).toEqual([{ cardId: 1, delta: 5 }, { cardId: 2, delta: 1 }]);
    expect(withQuantity(first, 2, 3, 3)).toEqual([{ cardId: 1, delta: 5 }]);
    expect(withQuantity(first, 2, 3, -4)).toEqual([{ cardId: 1, delta: 5 }, { cardId: 2, delta: -3 }]);
  });
  it("écarte les cartes inconnues", () => {
    expect(splitKnown([{ cardId: 1, delta: 1 }, { cardId: 2, delta: 1 }], new Set([1]))).toEqual({
      kept: [{ cardId: 1, delta: 1 }],
      unknown: 1,
    });
  });
  it("dit ce qui a été ignoré", () => {
    expect(noticeMessages({ unreadable: 1, unknown: 0, clamped: 0, lookupFailed: false })).toEqual([
      "1 modification illisible ignorée",
    ]);
    expect(noticeMessages({ unreadable: 2, unknown: 1, clamped: 2, lookupFailed: false })).toEqual([
      "2 modifications illisibles ignorées",
      "1 carte inconnue ignorée",
      "2 retraits supérieurs à la quantité ramenés à zéro",
    ]);
    expect(noticeMessages({ unreadable: 0, unknown: 0, clamped: 0, lookupFailed: false })).toEqual([]);
    expect(noticeMessages({ unreadable: 0, unknown: 1, clamped: 0, lookupFailed: true })[0]).toMatch(/pas pu être lue/);
  });
  it("formate un écart avec un vrai signe moins", () => {
    expect([formatDelta(2), formatDelta(-1)]).toEqual(["+2", "−1"]);
  });
});
