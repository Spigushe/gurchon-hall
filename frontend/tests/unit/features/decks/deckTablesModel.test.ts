import { describe, expect, it } from "vitest";
import {
  buildDeckTables,
  cryptClans,
  cryptDisciplineColumns,
  cryptGroupsLabel,
  isTrifle,
  mergeDeckLines,
  plusDecision,
  sectInitial,
  OUTSIDE_CATALOG_LABEL,
  PENDING_DETAILS_LABEL,
  type DeckCardFacts,
} from "../../../../src/features/decks/deckTablesModel";
import type { LocalDeckCard } from "../../../../src/offline/vtes";
import { crypt, library, mirrorRows, type CardSearchItem } from "../../offline/fixtures/syntheticCatalog";

/** Faits du miroir pour ces cartes ; `withoutDetails` simule un miroir incomplet. */
function factsOf(items: CardSearchItem[], { withoutDetails = false } = {}): Map<number, DeckCardFacts> {
  const { cards, details } = mirrorRows(items);
  return new Map(cards.map((card, index) => [card.id, { card, details: withoutDetails ? null : details[index] }]));
}

let nextSet = 1;
function line(cardId: number, quantity: number, extra: Partial<LocalDeckCard> = {}): LocalDeckCard {
  return {
    cardId,
    languageCode: "EN",
    cardSetId: nextSet++,
    quantity,
    proxyQuantity: 0,
    cardName: null,
    pending: false,
    ...extra,
  };
}

const vampire = (id: number, name: string, capacity: number, group: string, clan = "Ventrue") =>
  crypt({ id, name, capacity, group, clan });

describe("mergeDeckLines : une ligne par carte (P2)", () => {
  it("somme quantités et proxies, garde les lignes d'origine et l'attente", () => {
    const facts = factsOf([library({ id: 1, name: "Govern the Unaligned", types: ["Action"] })]);
    const rows = mergeDeckLines(
      [
        line(1, 3, { languageCode: "EN" }),
        line(1, 2, { languageCode: "FR", proxyQuantity: 1, pending: true }),
      ],
      facts,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ quantity: 5, proxyQuantity: 1, pending: true, name: "Govern the Unaligned" });
    expect(rows[0].lines.map((l) => l.languageCode)).toEqual(["EN", "FR"]);
  });

  it("une carte hors miroir garde le nom de la ligne, ou « Carte n° »", () => {
    const rows = mergeDeckLines([line(7, 1, { cardName: "Inconnue" }), line(8, 1)], new Map());
    expect(rows.map((row) => row.name)).toEqual(["Inconnue", "Carte n° 8"]);
    expect(rows.every((row) => row.facts === null)).toBe(true);
  });
});

describe("crypte", () => {
  const items = [
    vampire(10, "Laura Goldman", 3, "G5"),
    vampire(11, "Saku Pihlajamäki", 8, "G6"),
    vampire(12, "Atiena", 6, "G6"),
    vampire(13, "Aline Gädeke", 7, "G6"),
    crypt({ id: 14, name: "Anarch Convert", capacity: 1, group: "Any", clan: "Caitiff" }),
  ];
  const facts = factsOf(items);

  it("trie par capacité décroissante, puis par nom replié", () => {
    const tables = buildDeckTables([line(10, 1), line(12, 2), line(11, 2), line(13, 2), line(14, 1)], facts);
    expect(tables.crypt.rows.map((row) => row.name)).toEqual([
      "Saku Pihlajamäki",
      "Aline Gädeke",
      "Atiena",
      "Laura Goldman",
      "Anarch Convert",
    ]);
    expect(tables.crypt.total).toBe(8);
    expect(tables.library.groups).toEqual([]);
  });

  it("capacité moyenne pondérée par les quantités, à une décimale", () => {
    const tables = buildDeckTables([line(11, 2), line(10, 1)], facts);
    expect(tables.crypt.averageCapacity).toBe(6.3);
  });

  it("groupes : « Any » neutre, plage si contigus, liste sinon", () => {
    expect(buildDeckTables([line(10, 1), line(11, 1), line(14, 1)], facts).crypt.groupsLabel).toBe("G5–6");
    expect(buildDeckTables([line(11, 1)], facts).crypt.groupsLabel).toBe("G6");
    expect(buildDeckTables([line(14, 1)], facts).crypt.groupsLabel).toBeNull();
    const gap = factsOf([vampire(20, "A", 4, "G2"), vampire(21, "B", 4, "G4")]);
    expect(cryptGroupsLabel(mergeDeckLines([line(20, 1), line(21, 1)], gap))).toBe("G2 · G4");
  });

  it("sans capacité connue, la moyenne est nulle", () => {
    const tables = buildDeckTables([], facts);
    expect(tables.crypt.averageCapacity).toBeNull();
    expect(tables.crypt.groupsLabel).toBeNull();
  });
});

describe("bibliothèque", () => {
  const items = [
    library({ id: 1, name: "Anarch Free Press, The", types: ["Master"], text: "Unique master.", costType: "pool", costValue: "2" }),
    library({ id: 2, name: "Villein", types: ["Master"], text: "Master: trifle.\nPut this card on a vampire." }),
    library({ id: 3, name: "Govern the Unaligned", types: ["Action"], costType: "blood", costValue: "1" }),
    library({ id: 4, name: "Bum's Rush", types: ["Action"] }),
    library({ id: 5, name: "Deflection", types: ["Reaction"] }),
    library({ id: 6, name: "Telepathic Misdirection", types: ["Reaction"] }),
    library({ id: 7, name: "Swallowed by the Night", types: ["Combat", "Action Modifier"], costType: "blood", costValue: "X" }),
    library({ id: 8, name: "Conditioning", types: ["Action Modifier"], costType: "blood", costValue: "1" }),
    library({ id: 9, name: "Fame", types: ["Master"], text: "Unique master. Put this card in play." }),
    library({ id: 10, name: "Sense the Sin", types: ["Power"] }),
    library({ id: 11, name: "Ivory Bow", types: ["Equipment"], costType: "pool", costValue: "3" }),
  ];
  const facts = factsOf(items);
  const all = items.map((item) => line(item.id, 2));

  it("groupe par type dans l'ordre du handoff, combinaisons au rang de leur premier type (P6)", () => {
    const tables = buildDeckTables(all, facts);
    expect(tables.library.groups.map((group) => group.label)).toEqual([
      "Master",
      "Action",
      "Action Modifier",
      "Action Modifier / Combat",
      "Equipment",
      "Reaction",
      "Power",
    ]);
  });

  it("trie les cartes d'un groupe par nom replié", () => {
    const action = buildDeckTables(all, facts).library.groups.find((group) => group.label === "Action");
    expect(action?.rows.map((row) => row.name)).toEqual(["Bum's Rush", "Govern the Unaligned"]);
  });

  it("totaux de sang et de réserve multipliés par les quantités, X à part", () => {
    const { blood, pool, total } = buildDeckTables(all, facts).library;
    expect(blood).toEqual({ amount: 4, hasX: true });
    expect(pool).toEqual({ amount: 10, hasX: false });
    expect(total).toBe(22);
  });

  it("compte les trifles en exemplaires, par le mot entier (A3)", () => {
    const master = buildDeckTables(all, facts).library.groups[0];
    expect(master.trifles).toBe(2);
  });

  it("proxies sommés par section", () => {
    const tables = buildDeckTables([line(3, 3, { proxyQuantity: 2 }), line(4, 1, { proxyQuantity: 1 })], facts);
    expect(tables.library.proxies).toBe(3);
    expect(tables.crypt.proxies).toBe(0);
  });

  it("miroir incomplet : un seul groupe « détails à venir », sans coût", () => {
    const tables = buildDeckTables(all, factsOf(items, { withoutDetails: true }));
    expect(tables.library.groups.map((group) => group.label)).toEqual([PENDING_DETAILS_LABEL]);
    expect(tables.library.blood).toEqual({ amount: 0, hasX: false });
  });

  it("une carte hors miroir va en bibliothèque, groupe « Hors catalogue local », en dernier", () => {
    const tables = buildDeckTables([line(3, 1), line(999, 2)], facts);
    expect(tables.library.groups.map((group) => group.label)).toEqual(["Action", OUTSIDE_CATALOG_LABEL]);
    expect(tables.library.groups[1].total).toBe(2);
  });
});

describe("isTrifle (A3)", () => {
  const detailsOf = (item: CardSearchItem) => factsOf([item]).get(item.id)?.details ?? null;
  it.each([
    ["master trifle", library({ id: 1, name: "a", types: ["Master"], text: "Master: trifle. Do a thing." }), true],
    ["master sans le mot", library({ id: 2, name: "b", types: ["Master"], text: "Master. Do a thing." }), false],
    ["mot collé à un autre", library({ id: 3, name: "c", types: ["Master"], text: "Trifles are not counted." }), false],
    ["carte non master qui le cite", library({ id: 4, name: "d", types: ["Action"], text: "Play a trifle master." }), false],
  ])("%s", (_label, item, expected) => {
    expect(isTrifle(detailsOf(item))).toBe(expected);
  });

  it("sans détails, pas de trifle", () => {
    expect(isTrifle(null)).toBe(false);
  });
});

describe("cryptClans (P7)", () => {
  it("clans distincts de la crypte, du plus joué au moins joué, puis par nom", () => {
    const facts = factsOf([
      vampire(1, "A", 5, "G5", "Brujah"),
      vampire(2, "B", 5, "G5", "Ventrue"),
      vampire(3, "C", 5, "G5", "Banu Haqim"),
      library({ id: 4, name: "Action", types: ["Action"] }),
    ]);
    expect(cryptClans([line(1, 2), line(2, 4), line(3, 2), line(4, 9)], facts)).toEqual([
      "Ventrue",
      "Banu Haqim",
      "Brujah",
    ]);
  });
});

describe("plusDecision (P3)", () => {
  const line = { languageCode: "FR", cardSetId: 9 };
  const entry = (languageCode: string, cardSetId: number, available: number) => ({ languageCode, cardSetId, available });

  it("stock identique d'abord", () => {
    expect(plusDecision(line, [entry("FR", 9, 1), entry("EN", 9, 3)], false)).toEqual({ kind: "real" });
  });

  it("doute : d'autres langues ou extensions disponibles, on fait choisir", () => {
    expect(plusDecision(line, [entry("FR", 9, 0), entry("EN", 9, 2), entry("FR", 21, 0)], true)).toEqual({
      kind: "choose",
      options: [entry("EN", 9, 2)],
    });
  });

  it("sans stock : proxy si le deck l'autorise, sinon désactivé", () => {
    expect(plusDecision(line, [entry("FR", 9, 0)], true)).toEqual({ kind: "proxy" });
    expect(plusDecision(line, [], false).kind).toBe("disabled");
  });
});

describe("cryptDisciplineColumns (P5)", () => {
  it("une colonne par discipline, la plus répandue en exemplaires d'abord, puis par code", () => {
    const facts = factsOf([
      crypt({ id: 1, name: "A", disciplines: ["CEL", "obf"] }),
      crypt({ id: 2, name: "B", disciplines: ["obf", "qui"] }),
      crypt({ id: 3, name: "C", disciplines: ["aus"] }),
    ]);
    const rows = mergeDeckLines([line(1, 1), line(2, 2), line(3, 1)], facts);
    expect(cryptDisciplineColumns(rows)).toEqual(["obf", "qui", "aus", "cel"]);
  });
});

describe("sectInitial", () => {
  it.each([
    ["Camarilla", "C"],
    ["Sabbat", "S"],
    ["Independent", "I"],
    ["Imbued", "Imb"],
    ["Inconnue", "I"],
    [null, null],
  ])("%s", (sect, expected) => {
    expect(sectInitial(sect)).toBe(expected);
  });
});
