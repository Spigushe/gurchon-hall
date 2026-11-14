import { describe, expect, it } from "vitest";
import {
  lineWord,
  localDay,
  reportEntries,
  reportSummary,
  vdbReadError,
} from "../../../../../src/features/decks/import/importLabels";
import type { ImportReport } from "../../../../../src/features/decks/import/deckImportPlan";
import { continueBlocked, linkedDeckOf } from "../../../../../src/features/decks/vdb/importSheetModel";
import type { LocalDeck } from "../../../../../src/offline/vtes";

// Lot 9, D2 : libellés de la feuille d'import et règles de son bouton « Continuer ».

const EMPTY: ImportReport = { unreadable: [], unmatched: [], deduced: [], assumed: [] };

describe("rapport de l'aperçu", () => {
  it("est vide quand tout est reconnu sans convention", () => {
    expect(reportSummary(EMPTY)).toBeNull();
    expect(reportEntries(EMPTY)).toEqual([]);
  });

  it("range les lignes dans l'ordre du texte, au pluriel quand il faut", () => {
    const report: ImportReport = {
      ...EMPTY,
      unreadable: [{ line: 9, text: "0x Blur" }],
      unmatched: [
        { line: 3, text: "1x Foo", reason: "unknown_name" },
        { line: 4, text: "1x Blur (ADV)", reason: "no_such_version" },
      ],
    };
    expect(reportSummary(report)).toBe("3 lignes non reconnues");
    expect(reportEntries(report).map((entry) => [entry.line, entry.message])).toEqual([
      [3, "carte introuvable dans le catalogue"],
      [4, "cette version de la carte n'existe pas"],
      [9, "ligne illisible"],
    ]);
  });

  it("parle d'entrées pour une adresse ou un deck lu chez VDB", () => {
    expect(lineWord("vdb-url")).toBe("Entrée");
    expect(lineWord("vdb-api")).toBe("Entrée");
    expect(lineWord("lackey")).toBe("Ligne");
  });
});

describe("vdbReadError", () => {
  it.each([
    [404, null, null, "Deck VDB introuvable."],
    [404, "Autre motif.", null, "Autre motif."],
    [422, null, null, "Cet identifiant de deck VDB n'a pas la forme attendue."],
    [429, null, null, "réessayez dans un instant."],
    [502, null, null, "Lecture chez VDB impossible."],
  ] as const)("%s", (status, detail, retryAfter, expected) => {
    expect(vdbReadError(status, detail, retryAfter)).toContain(expected);
  });
});

describe("localDay", () => {
  it("rend le jour local AAAA-MM-JJ", () => {
    expect(localDay(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
  });
});

const deck = (key: string, vdbDeckId: string | null, createdOn: string | null) =>
  ({ key, vdbDeckId, createdOn }) as LocalDeck;

describe("feuille d'import : deck lié et bouton « Continuer »", () => {
  it("prend le deck lié le plus récent, un deck pas encore synchronisé en tête", () => {
    const decks = [deck("id:1", "abc", "2026-01-01"), deck("id:2", "abc", "2026-03-01"), deck("id:3", "xyz", null)];
    expect(linkedDeckOf(decks, "abc")?.key).toBe("id:2");
    expect(linkedDeckOf([...decks, deck("ref:x", "abc", null)], "abc")?.key).toBe("ref:x");
    expect(linkedDeckOf(decks, "zzz")).toBeNull();
    expect(linkedDeckOf(undefined, "abc")).toBeNull();
  });

  const ready = { catalogEmpty: false, loading: false, linked: false, online: true };
  const list = { kind: "list", decklist: { format: "jol", header: { name: null, author: null, description: null }, lines: [], unreadable: [] } } as const;
  const link = { kind: "vdb-deck", vdbDeckId: "abc" } as const;

  it.each([
    ["liste prête", list, ready, false],
    ["sans catalogue", list, { ...ready, catalogEmpty: true }, true],
    ["pendant une lecture", link, { ...ready, loading: true }, true],
    ["lien en ligne", link, ready, false],
    ["lien hors ligne", link, { ...ready, online: false }, true],
    ["lien déjà lié", link, { ...ready, linked: true }, true],
    ["champ vide", { kind: "empty" } as const, ready, true],
    ["adresse invalide", { kind: "invalid-url", reason: "non" } as const, ready, true],
  ])("%s", (_name, source, context, blocked) => {
    expect(continueBlocked(source, context)).toBe(blocked);
  });
});
