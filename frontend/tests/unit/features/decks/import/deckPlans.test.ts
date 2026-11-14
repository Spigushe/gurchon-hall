import { describe, expect, it } from "vitest";
import type { LocalDeckCard } from "../../../../../src/offline/vtes";
import type { ImportCard } from "../../../../../src/features/decks/import/cardIndex";
import {
  importDayLabel,
  importNotes,
  planDeckImport,
} from "../../../../../src/features/decks/import/deckImportPlan";
import { planDeckRefresh, type DeckRefreshChoices } from "../../../../../src/features/decks/import/deckRefreshPlan";
import { matchDecklist, type MatchedCard } from "../../../../../src/features/decks/import/matchDecklist";
import { decklistFromVdbDeck, parseDecklist } from "../../../../../src/features/decks/import/parseDecklist";
import { lowerLine } from "../../../../../src/features/decks/deckTablesModel";
import { apiDeck, EXTRACT, indexOf, MATCH_CASES, readFixture, toImportCard } from "./vdbFixtures";

// Lot 9, A3 : plans purs d'un import et d'une mise à jour depuis VDB.

const index = indexOf(EXTRACT);
const caseIndex = indexOf(MATCH_CASES.catalog);
const card = (veknId: number): ImportCard => index.byVeknId.get(veknId) ?? (caseIndex.byVeknId.get(veknId) as ImportCard);

describe("planDeckImport", () => {
  const source = (text: string) => {
    const decklist = parseDecklist(text);
    return { header: decklist.header, unreadable: decklist.unreadable, match: matchDecklist(decklist.lines, index) };
  };

  it("met toutes les lignes en proxy, dans la langue choisie et sous la dernière extension", () => {
    const plan = planDeckImport(source(readFixture("vdb/ref-text.txt")), {
      importedOn: "2026-11-13",
      languageCode: "FR",
      archetype: "rush",
    });
    expect(plan.deck).toMatchObject({
      name: "Guns and shit (mostly guns)",
      archetype: "rush",
      status: "draft",
      proxyAllowed: true,
    });
    expect("vdbDeckId" in plan.deck).toBe(false);
    expect(plan.lines.every((line) => line.quantity === line.proxyQuantity && line.languageCode === "FR")).toBe(true);
    expect(plan.lines.every((line) => line.cardSetId === card(line.cardId).latestCardSetId)).toBe(true);
    expect(plan.summary).toEqual({ cards: 30, crypt: 12, library: 80, proxies: 92 });
    expect(plan.report).toEqual({ unreadable: [], unmatched: [], deduced: [], assumed: [] });
  });

  it("garde le lien d'un deck lu par son adresse, sans date d'import dans les notes", () => {
    const deck = apiDeck("vdb/ref-api.json");
    const decklist = decklistFromVdbDeck(deck);
    const plan = planDeckImport(
      { header: decklist.header, unreadable: [], match: matchDecklist(decklist.lines, index) },
      { importedOn: "2026-11-13", vdbDeckId: deck.vdb_deck_id },
    );
    expect(plan.deck.vdbDeckId).toBe("4fc0ee5e9");
    expect(plan.deck.notes).not.toContain("Importé de VDB");
    expect(plan.deck.archetype).toBeNull();
    expect(plan.lines.every((line) => line.languageCode === "EN")).toBe(true);
  });

  it("préfère le nom saisi, puis celui de la liste, puis « Deck importé »", () => {
    const base = source("2x Blur");
    expect(planDeckImport(base, { importedOn: "2026-11-13" }).deck.name).toBe("Deck importé");
    expect(planDeckImport(base, { importedOn: "2026-11-13", name: "  Mon deck " }).deck.name).toBe("Mon deck");
    const named = source("Deck Name: Liste\n2x Blur");
    expect(planDeckImport(named, { importedOn: "2026-11-13", name: "   " }).deck.name).toBe("Liste");
  });

  it("rapporte lignes illisibles, non reconnues, groupes déduits et versions supposées", () => {
    const decklist = parseDecklist("0x Blur\n2x Carte inventée\n3x Tobias Smith\n2x Theo Bell\n1x Kalinda");
    const plan = planDeckImport(
      { header: decklist.header, unreadable: decklist.unreadable, match: matchDecklist(decklist.lines, caseIndex) },
      { importedOn: "2026-11-13" },
    );
    expect(plan.report.unreadable).toEqual([{ line: 1, text: "0x Blur" }]);
    expect(plan.report.unmatched).toEqual([{ line: 2, text: "2x Carte inventée", reason: "unknown_name" }]);
    // Tobias Smith (G3) : Theo Bell ne tient qu'en G2, Kalinda qu'en G2.
    expect(plan.report.deduced.map((line) => line.card.veknId)).toEqual([201362, 200745]);
    expect(plan.report.assumed).toEqual([]);
    expect(plan.summary).toEqual({ cards: 3, crypt: 6, library: 0, proxies: 6 });
  });

  it("une liste vide donne un deck sans ligne", () => {
    const plan = planDeckImport(source(""), { importedOn: "2026-11-13" });
    expect(plan.lines).toEqual([]);
    expect(plan.summary).toEqual({ cards: 0, crypt: 0, library: 0, proxies: 0 });
  });
});

describe("notes d'un deck importé", () => {
  const header = { name: null, author: "Guillermo Gutierrez", description: "Trophy hunter deck" };

  it("auteur, description, puis la date d'import d'un deck non lié", () => {
    expect(importNotes(header, false, "2026-11-13")).toBe(
      "Auteur : Guillermo Gutierrez\n\nTrophy hunter deck\n\nImporté de VDB le 13 novembre 2026",
    );
    expect(importNotes(header, true, "2026-11-13")).toBe("Auteur : Guillermo Gutierrez\n\nTrophy hunter deck");
  });

  it("rien à dire : null", () => {
    expect(importNotes({ name: null, author: null, description: null }, true, "2026-11-13")).toBeNull();
  });

  it("formate le jour en français, et rend tel quel ce qui n'est pas une date", () => {
    expect(importDayLabel("2026-01-01")).toBe("1 janvier 2026");
    expect(importDayLabel("hier")).toBe("hier");
  });
});

describe("lowerLine, le − du deckbuilder", () => {
  it.each([
    [{ quantity: 4, proxyQuantity: 1 }, 3, { quantity: 3, proxyQuantity: 1 }],
    [{ quantity: 4, proxyQuantity: 4 }, 2, { quantity: 2, proxyQuantity: 2 }],
    [{ quantity: 4, proxyQuantity: 3 }, 2, { quantity: 2, proxyQuantity: 2 }],
    [{ quantity: 4, proxyQuantity: 0 }, 1, { quantity: 1, proxyQuantity: 0 }],
    [{ quantity: 1, proxyQuantity: 0 }, 0, null],
  ])("%j ramenée à %i → %j", (line, quantity, expected) => {
    expect(lowerLine(line, quantity)).toEqual(expected);
  });
});

// --- Mise à jour depuis VDB ---------------------------------------------------

const deckLine = (cardId: number, quantity: number, proxyQuantity = 0, languageCode = "EN", cardSetId = 1): LocalDeckCard => ({
  cardId,
  languageCode,
  cardSetId,
  quantity,
  proxyQuantity,
  cardName: null,
  pending: false,
});

const vdb = (...entries: Array<[number, number]>): MatchedCard[] =>
  entries.map(([veknId, quantity]) => ({ card: card(veknId), quantity }));

const choices: DeckRefreshChoices = { status: "active", proxyAllowed: true, cardOf: (id) => card(id) };

const THEO_G2 = 201362;
const BLUR = 100227;
const PURSUIT = 101523;
const TORN_SIGNPOST = 101993;
const SACRE_COEUR = 101670;
const THEO_G6 = 201613;

describe("planDeckRefresh, un cas par règle de P7", () => {
  it.each([
    {
      rule: "carte nouvelle : une ligne en proxy, langue choisie, dernière extension",
      deck: [],
      list: vdb([THEO_G6, 2]),
      saved: [{ cardId: THEO_G6, languageCode: "FR", cardSetId: card(THEO_G6).latestCardSetId, quantity: 2, proxyQuantity: 2 }],
      removed: [],
      kind: "added",
    },
    {
      rule: "hausse sur une ligne : ajoutée en proxies",
      deck: [deckLine(BLUR, 2, 0)],
      list: vdb([BLUR, 3]),
      saved: [{ cardId: BLUR, languageCode: "EN", cardSetId: 1, quantity: 3, proxyQuantity: 1 }],
      removed: [],
      kind: "increased",
    },
    {
      rule: "baisse sur une ligne : exemplaires réels rendus d'abord",
      deck: [deckLine(PURSUIT, 6, 2)],
      list: vdb([PURSUIT, 4]),
      saved: [{ cardId: PURSUIT, languageCode: "EN", cardSetId: 1, quantity: 4, proxyQuantity: 2 }],
      removed: [],
      kind: "decreased",
    },
    {
      rule: "baisse sur une ligne tout en proxy : les proxies suivent",
      deck: [deckLine(PURSUIT, 6, 6)],
      list: vdb([PURSUIT, 4]),
      saved: [{ cardId: PURSUIT, languageCode: "EN", cardSetId: 1, quantity: 4, proxyQuantity: 4 }],
      removed: [],
      kind: "decreased",
    },
    {
      rule: "carte retirée chez VDB : ses lignes sont retirées",
      deck: [deckLine(TORN_SIGNPOST, 1, 0), deckLine(TORN_SIGNPOST, 1, 1, "FR")],
      list: [],
      saved: [],
      removed: [
        { cardId: TORN_SIGNPOST, languageCode: "EN", cardSetId: 1 },
        { cardId: TORN_SIGNPOST, languageCode: "FR", cardSetId: 1 },
      ],
      kind: "removed",
    },
    {
      rule: "conflit : plusieurs lignes refaites en une ligne de proxies",
      deck: [deckLine(THEO_G2, 1, 0, "EN", 5), deckLine(THEO_G2, 1, 0, "FR", 6)],
      list: vdb([THEO_G2, 3]),
      saved: [{ cardId: THEO_G2, languageCode: "FR", cardSetId: card(THEO_G2).latestCardSetId, quantity: 3, proxyQuantity: 3 }],
      removed: [
        { cardId: THEO_G2, languageCode: "EN", cardSetId: 5 },
        { cardId: THEO_G2, languageCode: "FR", cardSetId: 6 },
      ],
      kind: "remade",
    },
  ])("$rule", ({ deck, list, saved, removed, kind }) => {
    const plan = planDeckRefresh(deck, list, { ...choices, languageCode: "FR" });
    expect(plan.saved).toEqual(saved);
    expect(plan.removed).toEqual(removed);
    expect(plan.changes.map((change) => change.kind)).toEqual([kind]);
    expect(plan).toMatchObject({ toDraft: true, empty: false, deck: { status: "draft" } });
  });

  it("carte inchangée : rien, quelle que soit sa répartition", () => {
    const plan = planDeckRefresh(
      [deckLine(BLUR, 1, 0, "EN"), deckLine(BLUR, 1, 1, "FR"), deckLine(PURSUIT, 6, 0)],
      vdb([BLUR, 2], [PURSUIT, 6]),
      choices,
    );
    expect(plan).toMatchObject({ saved: [], removed: [], changes: [], unchanged: 2, empty: true, toDraft: false });
    expect(plan.deck).toEqual({});
  });

  it("le message d'un conflit dit si des exemplaires réels ont été rendus", () => {
    const real = planDeckRefresh([deckLine(THEO_G2, 1, 0, "EN"), deckLine(THEO_G2, 1, 1, "FR")], vdb([THEO_G2, 3]), choices);
    expect(real.changes[0].message).toBe(
      "Theo Bell (G2) : 2 lignes remplacées par 3 proxies, les exemplaires réels ont été rendus à la collection.",
    );
    const proxies = planDeckRefresh([deckLine(BLUR, 1, 1, "EN"), deckLine(BLUR, 1, 1, "FR")], vdb([BLUR, 1]), choices);
    expect(proxies.changes[0].message).toBe("Blur : 2 lignes remplacées par 1 proxy.");
  });

  it("un deck déjà en brouillon ne reçoit pas de patch de statut", () => {
    const plan = planDeckRefresh([], vdb([BLUR, 1]), { ...choices, status: "draft" });
    expect(plan).toMatchObject({ toDraft: false, deck: {} });
  });

  it("rend l'autorisation de proxy à un deck qui l'a perdue, seulement s'il écrit des proxies", () => {
    const withProxies = planDeckRefresh([], vdb([BLUR, 1]), { ...choices, proxyAllowed: false });
    expect(withProxies).toMatchObject({ allowsProxies: true, deck: { status: "draft", proxyAllowed: true } });
    const realOnly = planDeckRefresh([deckLine(BLUR, 3, 0)], vdb([BLUR, 2]), { ...choices, proxyAllowed: false });
    expect(realOnly).toMatchObject({ allowsProxies: false, deck: { status: "draft" } });
    expect("proxyAllowed" in realOnly.deck).toBe(false);
  });

  it("libelle une carte retirée par le catalogue, à défaut par la ligne", () => {
    const named = planDeckRefresh([{ ...deckLine(THEO_G6, 1), cardName: "Theo Bell" }], [], choices);
    expect(named.changes[0].label).toBe("Theo Bell (G6)");
    const bare = planDeckRefresh([{ ...deckLine(999, 1), cardName: "Carte locale" }], [], { status: "active", proxyAllowed: true });
    expect(bare.changes[0].label).toBe("Carte locale");
    expect(planDeckRefresh([deckLine(998, 1)], [], { status: "active", proxyAllowed: true }).changes[0].label).toBe("Carte 998");
  });

  it("additionne deux entrées VDB d'une même carte", () => {
    const plan = planDeckRefresh([], [...vdb([BLUR, 1]), ...vdb([BLUR, 2])], choices);
    expect(plan.saved).toMatchObject([{ cardId: BLUR, quantity: 3, proxyQuantity: 3 }]);
  });
});

describe("planDeckRefresh, la mise à jour réelle des fixtures (maj-avant → maj-apres)", () => {
  const listOf = (path: string) => matchDecklist(decklistFromVdbDeck(apiDeck(path)).lines, index).cards;

  /** Le deck tel qu'importé depuis maj-avant : une ligne tout en proxy par carte. */
  const imported = (): LocalDeckCard[] =>
    listOf("vdb/maj-avant-api.json").map(({ card: item, quantity }) =>
      deckLine(item.id, quantity, quantity, "EN", item.latestCardSetId),
    );

  it("ajoute Theo Bell (G6) et Sacré-Cœur, retire Torn Signpost, Pursuit 6 → 4, Blur 2 → 3", () => {
    const plan = planDeckRefresh(imported(), listOf("vdb/maj-apres-api.json"), choices);
    expect(plan.changes.map(({ kind, label, before, after }) => ({ kind, label, before, after }))).toEqual([
      { kind: "added", label: "Sacré-Cœur Cathedral, France", before: 0, after: 1 },
      { kind: "added", label: "Theo Bell (G6)", before: 0, after: 1 },
      { kind: "increased", label: "Blur", before: 2, after: 3 },
      { kind: "decreased", label: "Pursuit", before: 6, after: 4 },
      { kind: "removed", label: "Torn Signpost", before: 1, after: 0 },
    ]);
    expect(plan.unchanged).toBe(listOf("vdb/maj-avant-api.json").length - 3);
    expect(plan.removed).toEqual([{ cardId: TORN_SIGNPOST, languageCode: "EN", cardSetId: card(TORN_SIGNPOST).latestCardSetId }]);
    expect(plan.saved.find((line) => line.cardId === SACRE_COEUR)).toMatchObject({ quantity: 1, proxyQuantity: 1 });
  });

  it("appliquée, la mise à jour retrouve la liste de VDB, et une seconde lecture ne trouve plus rien", () => {
    const deck = imported();
    const plan = planDeckRefresh(deck, listOf("vdb/maj-apres-api.json"), choices);
    const key = (line: { cardId: number; languageCode: string; cardSetId: number }) =>
      `${line.cardId}|${line.languageCode}|${line.cardSetId}`;
    const after = new Map(deck.map((line) => [key(line), line]));
    for (const line of plan.removed) after.delete(key(line));
    for (const line of plan.saved) {
      after.set(key(line), deckLine(line.cardId, line.quantity, line.proxyQuantity ?? 0, line.languageCode, line.cardSetId));
    }
    const totals = [...after.values()]
      .map((line) => ({ vekn_id: card(line.cardId).veknId, quantity: line.quantity }))
      .sort((a, b) => a.vekn_id - b.vekn_id);
    expect(totals).toEqual(apiDeck("vdb/maj-apres-api.json").cards);
    expect(planDeckRefresh([...after.values()], listOf("vdb/maj-apres-api.json"), choices).empty).toBe(true);
  });

  it("toutes les cartes de la table de cas d'appariement servent à libeller une carte retirée", () => {
    for (const item of MATCH_CASES.catalog) {
      const plan = planDeckRefresh([deckLine(item.vekn_id, 1)], [], { ...choices, cardOf: () => toImportCard(item) });
      expect(plan.changes[0].label.startsWith(item.name)).toBe(true);
    }
  });
});
