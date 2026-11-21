import { describe, expect, it } from "vitest";
import type { LocalDeckCard } from "../../../../src/offline/vtes";
import { compareLists, deckQuantities } from "../../../../src/features/share/compareModel";
import { duplicateNotes, planDuplicate } from "../../../../src/features/share/duplicateModel";
import { effectiveList, unreadableText } from "../../../../src/features/share/effectiveList";
import { cardRowOf } from "../../../../src/offline/vtes/refresh";
import { crypt, library } from "../../offline/fixtures/syntheticCatalog";

const items = [
  crypt({ id: 1, name: "Anson" }),
  crypt({ id: 2, name: "Beckett" }),
  library({ id: 10, name: "Blur", cardSetIds: [3, 5] }),
  library({ id: 11, name: "Vessel" }),
];
const shared = {
  cards: [
    { card: items[0], quantity: 4 },
    { card: items[2], quantity: 3 },
    { card: items[3], quantity: 2 },
  ],
};
const facts = new Map(items.map((card) => [card.id, { card: cardRowOf(card), details: null }] as const));
const category = (id: number) => facts.get(id)?.card.category ?? null;

describe("effectiveList", () => {
  it("rend la liste du lien sans révision", () => {
    expect(effectiveList(shared, null)).toEqual({
      cards: [
        { cardId: 1, quantity: 4 },
        { cardId: 10, quantity: 3 },
        { cardId: 11, quantity: 2 },
      ],
      unreadable: 0,
    });
  });

  it("applique les écarts : ajout, retrait total, retrait partiel, et compte l'illisible", () => {
    const result = effectiveList(shared, "2=1;11=-2;10=-1;zz");
    expect(result.cards).toEqual([
      { cardId: 1, quantity: 4 },
      { cardId: 2, quantity: 1 },
      { cardId: 10, quantity: 2 },
    ]);
    expect(result.unreadable).toBe(1);
  });

  it("dit les écarts illisibles au singulier et au pluriel", () => {
    expect(unreadableText(0)).toBeNull();
    expect(unreadableText(1)).toBe("1 modification illisible ignorée");
    expect(unreadableText(3)).toBe("3 modifications illisibles ignorées");
  });
});

describe("planDuplicate", () => {
  const cards = effectiveList(shared, null).cards;
  const choices = { name: "Copie", archetype: "bleed" as const, notes: "  une note " };

  it("met tout en proxy, en anglais, sous la dernière extension, en brouillon", () => {
    const plan = planDuplicate(cards, facts, choices);
    expect(plan.deck).toEqual({ name: "Copie", notes: "une note", archetype: "bleed", status: "draft", proxyAllowed: true });
    expect(plan.deck).not.toHaveProperty("vdbDeckId");
    expect(plan.lines).toEqual([
      { cardId: 1, languageCode: "EN", cardSetId: 9, quantity: 4, proxyQuantity: 4 },
      { cardId: 10, languageCode: "EN", cardSetId: 5, quantity: 3, proxyQuantity: 3 },
      { cardId: 11, languageCode: "EN", cardSetId: 9, quantity: 2, proxyQuantity: 2 },
    ]);
    expect(plan.summary).toEqual({ cards: 3, crypt: 4, library: 5, proxies: 9 });
    expect(plan.missing).toEqual([]);
  });

  it("signale une carte absente du miroir sans l'écrire, et garde un nom non vide", () => {
    const plan = planDuplicate([...cards, { cardId: 99, quantity: 1 }], facts, {
      ...choices,
      name: "  ",
      languageCode: "FR",
    });
    expect(plan.missing).toEqual([99]);
    expect(plan.lines.map((line) => line.cardId)).toEqual([1, 10, 11]);
    expect(plan.lines[0].languageCode).toBe("FR");
    expect(plan.deck.name).toBe("Deck importé");
  });

  it("reprend les notes du lien puis date la copie", () => {
    expect(duplicateNotes({ notes: "Mes notes" }, "2026-11-20")).toBe(
      "Mes notes\n\nDupliqué de la liste partagée le 20 novembre 2026",
    );
    expect(duplicateNotes({ notes: null }, "2026-11-20")).toBe("Dupliqué de la liste partagée le 20 novembre 2026");
  });
});

describe("compareLists", () => {
  const line = (cardId: number, quantity: number, languageCode = "EN", cardSetId = 1): LocalDeckCard => ({
    cardId,
    languageCode,
    cardSetId,
    quantity,
    proxyQuantity: 0,
    cardName: null,
    pending: false,
  });

  it("additionne les lignes d'une même carte, langues et extensions confondues", () => {
    expect(deckQuantities([line(10, 2), line(10, 1, "FR", 3), line(2, 1)])).toEqual([
      { cardId: 2, quantity: 1 },
      { cardId: 10, quantity: 3 },
    ]);
  });

  it("va de la liste partagée à mon deck : entrées, sorties et quantités différentes", () => {
    const mine = deckQuantities([line(1, 4), line(2, 1), line(10, 1), line(10, 1, "FR", 3)]);
    const other = effectiveList(shared, null).cards;
    // Mon deck : Anson 4, Beckett 1, Blur 2 ; la liste : Anson 4, Blur 3, Vessel 2.
    // Mon deck est l'arrivée : Beckett y entre, Vessel en sort, Blur passe de 3 à 2.
    const result = compareLists(mine, other, (id) => facts.get(id)?.card.name ?? "?", category);
    expect(result.changes.entries.map((c) => [c.name, c.to])).toEqual([["Beckett", 1]]);
    expect(result.changes.exits.map((c) => [c.name, c.from])).toEqual([["Vessel", 2]]);
    expect(result.changes.changed.map((c) => [c.name, c.from, c.to])).toEqual([["Blur", 3, 2]]);
    expect(result.mine).toEqual({ crypt: 5, library: 2 });
    expect(result.shared).toEqual({ crypt: 4, library: 5 });
  });

  it("ne trouve aucun écart entre deux listes identiques", () => {
    const same = effectiveList(shared, null).cards;
    const result = compareLists(same, same, () => "x", category);
    expect(result.changes).toEqual({ entries: [], exits: [], changed: [] });
  });
});
