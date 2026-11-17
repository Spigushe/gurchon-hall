import { describe, expect, it } from "vitest";
import type { LocalDeckCard } from "../../../../../src/offline/vtes";
import type { ImportCard } from "../../../../../src/features/decks/import/cardIndex";
import { planDeckRefresh, type DeckRefreshChoices } from "../../../../../src/features/decks/import/deckRefreshPlan";
import type { MatchedCard } from "../../../../../src/features/decks/import/matchDecklist";
import { EXTRACT, indexOf } from "./vdbFixtures";

// Lot 9, étape E : les règles de P7 **combinées**. `deckPlans.test.ts` a un cas par règle et la
// mise à jour réelle maj-avant → maj-apres ; ici, des decks où plusieurs règles jouent en même
// temps (dont la carte refaite, absente de la mise à jour réelle), sur des lignes de langues et
// d'extensions différentes.

const index = indexOf(EXTRACT);
const card = (veknId: number): ImportCard => index.byVeknId.get(veknId) as ImportCard;

const line = (cardId: number, quantity: number, proxyQuantity = 0, languageCode = "EN", cardSetId = 1): LocalDeckCard => ({
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

const BLUR = 100227;
const PURSUIT = 101523;
const TORN_SIGNPOST = 101993;
const SACRE_COEUR = 101670;
const THEO_G2 = 201362;
const THEO_G6 = 201613;
const ARCHON = 100085;
const DISARM = 100549;
const FLASH = 100744;

/** Un deck où chaque règle de P7 joue : une carte par sorte de changement, et deux inchangées. */
const mixedDeck = (): LocalDeckCard[] => [
  line(BLUR, 2, 2), // augmentée : 2 → 3
  line(PURSUIT, 6, 2), // diminuée : 6 → 4, deux proxies sur six
  line(TORN_SIGNPOST, 1, 0), // retirée chez VDB
  line(THEO_G2, 1, 0, "EN", 5), // refaite : deux lignes, 2 → 3
  line(THEO_G2, 1, 1, "FR", 6),
  line(ARCHON, 1, 0), // inchangée, une ligne
  line(DISARM, 2, 0, "EN", 5), // inchangée, deux lignes : la répartition ne compte pas
  line(DISARM, 2, 2, "FR", 6),
];

const mixedList = (): MatchedCard[] =>
  vdb([BLUR, 3], [PURSUIT, 4], [THEO_G2, 3], [ARCHON, 1], [DISARM, 4], [SACRE_COEUR, 1], [THEO_G6, 2]);

const key = (l: { cardId: number; languageCode: string; cardSetId: number }) => `${l.cardId}|${l.languageCode}|${l.cardSetId}`;

describe("planDeckRefresh, les règles de P7 en même temps", () => {
  it("classe chaque carte dans sa sorte, dans l'ordre ajoutées, augmentées, diminuées, refaites, retirées", () => {
    const plan = planDeckRefresh(mixedDeck(), mixedList(), choices);
    expect(plan.changes.map(({ kind, label, before, after }) => ({ kind, label, before, after }))).toEqual([
      { kind: "added", label: "Sacré-Cœur Cathedral, France", before: 0, after: 1 },
      { kind: "added", label: "Theo Bell (G6)", before: 0, after: 2 },
      { kind: "increased", label: "Blur", before: 2, after: 3 },
      { kind: "decreased", label: "Pursuit", before: 6, after: 4 },
      { kind: "remade", label: "Theo Bell (G2)", before: 2, after: 3 },
      { kind: "removed", label: "Torn Signpost", before: 1, after: 0 },
    ]);
    expect(plan.unchanged).toBe(2);
    expect(plan).toMatchObject({ toDraft: true, empty: false, allowsProxies: false, deck: { status: "draft" } });
  });

  it("n'écrit que ce qui change : retraits d'abord, une ligne refaite, aucune ligne des cartes inchangées", () => {
    const plan = planDeckRefresh(mixedDeck(), mixedList(), choices);
    expect(plan.removed.map(key).sort()).toEqual(
      [`${THEO_G2}|EN|5`, `${THEO_G2}|FR|6`, `${TORN_SIGNPOST}|EN|1`].sort(),
    );
    const latest = (veknId: number) => card(veknId).latestCardSetId;
    expect(plan.saved).toHaveLength(5);
    expect(plan.saved).toEqual(
      expect.arrayContaining([
        { cardId: SACRE_COEUR, languageCode: "EN", cardSetId: latest(SACRE_COEUR), quantity: 1, proxyQuantity: 1 },
        { cardId: THEO_G6, languageCode: "EN", cardSetId: latest(THEO_G6), quantity: 2, proxyQuantity: 2 },
        { cardId: BLUR, languageCode: "EN", cardSetId: 1, quantity: 3, proxyQuantity: 3 },
        { cardId: PURSUIT, languageCode: "EN", cardSetId: 1, quantity: 4, proxyQuantity: 2 },
        { cardId: THEO_G2, languageCode: "EN", cardSetId: latest(THEO_G2), quantity: 3, proxyQuantity: 3 },
      ]),
    );
    expect(plan.saved.some((l) => l.cardId === ARCHON || l.cardId === DISARM)).toBe(false);
  });

  it("le message de la carte refaite dit les deux lignes, les trois proxies et les exemplaires rendus", () => {
    const plan = planDeckRefresh(mixedDeck(), mixedList(), choices);
    const remade = plan.changes.find((change) => change.kind === "remade");
    expect(remade?.message).toBe(
      "Theo Bell (G2) : 2 lignes remplacées par 3 proxies, les exemplaires réels ont été rendus à la collection.",
    );
    expect(plan.changes.filter((change) => change.message !== null)).toHaveLength(1);
  });

  it("appliquée, le plan laisse un deck égal à la liste de VDB, et la lecture suivante est vide", () => {
    const deck = mixedDeck();
    const plan = planDeckRefresh(deck, mixedList(), choices);
    const after = new Map(deck.map((l) => [key(l), l]));
    for (const removed of plan.removed) after.delete(key(removed));
    for (const saved of plan.saved) {
      after.set(key(saved), line(saved.cardId, saved.quantity, saved.proxyQuantity ?? 0, saved.languageCode, saved.cardSetId));
    }
    const totals = new Map<number, number>();
    for (const l of after.values()) totals.set(l.cardId, (totals.get(l.cardId) ?? 0) + l.quantity);
    expect(Object.fromEntries(totals)).toEqual(
      Object.fromEntries(mixedList().map(({ card: matched, quantity }) => [matched.id, quantity])),
    );
    expect(planDeckRefresh([...after.values()], mixedList(), { ...choices, status: "draft" })).toMatchObject({
      empty: true,
      toDraft: false,
      changes: [],
    });
  });

  it("un deck déjà en brouillon qui n'autorise plus les proxies : pas de passage en brouillon, autorisation rendue", () => {
    const plan = planDeckRefresh(mixedDeck(), mixedList(), { ...choices, status: "draft", proxyAllowed: false });
    expect(plan.toDraft).toBe(false);
    expect(plan.allowsProxies).toBe(true);
    expect(plan.deck).toEqual({ proxyAllowed: true });
  });

  it("des retraits et des baisses seuls n'écrivent aucun proxy : l'autorisation perdue n'est pas rendue", () => {
    const deck = [line(TORN_SIGNPOST, 1, 0), line(PURSUIT, 6, 0), line(THEO_G2, 1, 0, "EN", 5), line(THEO_G2, 1, 0, "FR", 6)];
    // Conflit à la baisse : 2 lignes à 1 exemplaire réel, VDB n'en veut plus qu'un. La ligne
    // refaite est un proxy, donc l'autorisation est rendue ; sans conflit, elle ne l'est pas.
    const conflict = planDeckRefresh(deck, vdb([PURSUIT, 4], [THEO_G2, 1]), { ...choices, proxyAllowed: false });
    expect(conflict.changes.map((c) => c.kind)).toEqual(["decreased", "remade", "removed"]);
    expect(conflict.allowsProxies).toBe(true);
    expect(conflict.changes.find((c) => c.kind === "remade")?.message).toBe(
      "Theo Bell (G2) : 2 lignes remplacées par 1 proxy, les exemplaires réels ont été rendus à la collection.",
    );
    const plain = planDeckRefresh(
      [line(TORN_SIGNPOST, 1, 0), line(PURSUIT, 6, 0)],
      vdb([PURSUIT, 4]),
      { ...choices, proxyAllowed: false },
    );
    expect(plain.changes.map((c) => c.kind)).toEqual(["decreased", "removed"]);
    expect(plain.allowsProxies).toBe(false);
    expect("proxyAllowed" in plain.deck).toBe(false);
  });

  it("deux cartes en conflit à la fois : chacune refaite sous sa langue, sans mélange de lignes", () => {
    const deck = [
      line(FLASH, 1, 0, "EN", 5),
      line(FLASH, 2, 0, "FR", 6),
      line(DISARM, 1, 1, "EN", 5),
      line(DISARM, 1, 0, "ES", 7),
    ];
    const plan = planDeckRefresh(deck, vdb([FLASH, 2], [DISARM, 5]), { ...choices, languageCode: "ES" });
    expect(plan.changes.map((c) => [c.kind, c.cardId])).toEqual([
      ["remade", DISARM],
      ["remade", FLASH],
    ]);
    expect(plan.saved.map((l) => [l.cardId, l.languageCode, l.quantity, l.proxyQuantity])).toEqual(
      expect.arrayContaining([
        [FLASH, "ES", 2, 2],
        [DISARM, "ES", 5, 5],
      ]),
    );
    expect(plan.removed).toHaveLength(4);
    expect(plan.unchanged).toBe(0);
  });

  it("une carte en conflit dont le total ne bouge pas reste inchangée, même mêlée à d'autres changements", () => {
    const deck = [line(FLASH, 1, 0, "EN", 5), line(FLASH, 2, 1, "FR", 6), line(BLUR, 1, 0)];
    const plan = planDeckRefresh(deck, vdb([FLASH, 3], [BLUR, 2]), choices);
    expect(plan.changes.map((c) => c.kind)).toEqual(["increased"]);
    expect(plan.unchanged).toBe(1);
    expect(plan.removed).toEqual([]);
  });

  it("la liste de VDB vide retire tout, sans rien écrire", () => {
    const plan = planDeckRefresh(mixedDeck(), [], choices);
    expect(plan.saved).toEqual([]);
    expect(plan.removed).toHaveLength(mixedDeck().length);
    expect(new Set(plan.changes.map((c) => c.kind))).toEqual(new Set(["removed"]));
    expect(plan.unchanged).toBe(0);
    expect(plan.allowsProxies).toBe(false);
  });
});
