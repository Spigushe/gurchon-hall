import { describe, expect, it } from "vitest";
import type { CardChange, DeckRefreshPlan } from "../../../../../src/features/decks/import";
import {
  CHANGE_KIND_LABELS,
  VDB_REFRESH_ARCHIVED_MESSAGE,
  VDB_REFRESH_OFFLINE_MESSAGE,
  changeDetail,
  refreshBlockedReason,
  refreshEffectText,
  refreshReport,
} from "../../../../../src/features/decks/vdb/deckRefreshModel";

/** Lot 9, D3 : libellés de la mise à jour depuis VDB. */

const change = (overrides: Partial<CardChange>): CardChange => ({
  kind: "added",
  cardId: 1,
  label: "Blur",
  before: 0,
  after: 2,
  message: null,
  ...overrides,
});

const plan = (overrides: Partial<DeckRefreshPlan>): DeckRefreshPlan => ({
  deck: {},
  removed: [],
  saved: [],
  changes: [change({})],
  unchanged: 3,
  toDraft: false,
  allowsProxies: false,
  empty: false,
  ...overrides,
});

describe("changeDetail", () => {
  it.each<[Partial<CardChange>, string]>([
    [{ kind: "added", before: 0, after: 1 }, "1 proxy"],
    [{ kind: "added", before: 0, after: 3 }, "3 proxies"],
    [{ kind: "increased", before: 2, after: 3 }, "2 → 3, 1 proxy ajouté"],
    [{ kind: "increased", before: 1, after: 4 }, "1 → 4, 3 proxies ajoutés"],
    [{ kind: "decreased", before: 6, after: 4 }, "6 → 4"],
    [{ kind: "removed", before: 1, after: 0 }, "1 exemplaire retiré"],
    [{ kind: "removed", before: 2, after: 0 }, "2 exemplaires retirés"],
    [
      {
        kind: "remade",
        label: "Theo Bell (G2)",
        before: 2,
        after: 3,
        message: "Theo Bell (G2) : 2 lignes remplacées par 3 proxies, les exemplaires réels ont été rendus à la collection.",
      },
      "2 lignes remplacées par 3 proxies, les exemplaires réels ont été rendus à la collection.",
    ],
    [{ kind: "remade", before: 2, after: 3, message: null }, "2 → 3"],
  ])("%j → %s", (overrides, expected) => {
    expect(changeDetail(change(overrides))).toBe(expected);
  });

  it("nomme chaque sorte de changement", () => {
    expect(Object.values(CHANGE_KIND_LABELS)).toEqual(["Ajoutée", "Augmentée", "Diminuée", "Refaite en proxy", "Retirée"]);
  });
});

describe("refreshEffectText", () => {
  it("rien à écrire", () => {
    expect(refreshEffectText(plan({ empty: true, changes: [] }))).toBe(
      "Rien à mettre à jour : le deck a déjà la liste de VDB.",
    );
  });

  it("changements seuls, deck déjà brouillon", () => {
    expect(refreshEffectText(plan({ unchanged: 1 }))).toBe(
      "1 carte change, 1 inchangée. Nom, notes, archétype et versions jouées ne changent pas.",
    );
  });

  it("passage en brouillon et proxies de nouveau autorisés", () => {
    expect(
      refreshEffectText(plan({ changes: [change({}), change({ cardId: 2 })], toDraft: true, allowsProxies: true })),
    ).toBe(
      "2 cartes changent, 3 inchangées. Le deck repasse en brouillon. Il autorisera de nouveau les proxies, que la mise à jour ajoute. Nom, notes, archétype et versions jouées ne changent pas.",
    );
  });
});

describe("refreshReport et refreshBlockedReason", () => {
  it("le rapport ne garde que les cartes inconnues du catalogue", () => {
    const unmatched = [{ line: 2, text: "999999=1", reason: "unknown_vekn_id" as const }];
    expect(refreshReport({ resolved: [], cards: [], unmatched })).toEqual({
      unreadable: [],
      unmatched,
      deduced: [],
      assumed: [],
    });
  });

  it.each([
    [null, true, null],
    [null, false, VDB_REFRESH_OFFLINE_MESSAGE],
    ["2026-11-01T00:00:00Z", true, VDB_REFRESH_ARCHIVED_MESSAGE],
    ["2026-11-01T00:00:00Z", false, VDB_REFRESH_ARCHIVED_MESSAGE],
  ])("archivé %s, en ligne %s → %s", (archivedAt, online, expected) => {
    expect(refreshBlockedReason({ archivedAt }, online)).toBe(expected);
  });
});
