import { describe, expect, it } from "vitest";
import { buildAddOperation, stockFreeFor, type AddState } from "../../../../src/features/search/addOperation";
import { withHeld } from "../../../../src/features/search/searchModel";
import type { DeckKey } from "../../../../src/offline/vtes";

const DECK = { key: "id:4" as DeckKey, proxyAllowed: true };
const STRICT = { key: "id:5" as DeckKey, proxyAllowed: false };

const base = (patch: Partial<AddState> = {}): AddState => ({
  cardId: 1,
  languageCode: "EN",
  cardSetId: 9,
  quantity: 3,
  possessed: 0,
  available: 4,
  owned: 4,
  deck: DECK,
  ...patch,
});

describe("buildAddOperation : deck", () => {
  it("prend au stock ce que « dont possédées » demande, le reste en proxy, sans rien acquérir", () => {
    const plan = buildAddOperation("deck", base({ possessed: 2 }));
    expect(plan).toEqual({
      ok: true,
      operation: {
        kind: "deck",
        deckKey: DECK.key,
        input: { cardId: 1, languageCode: "EN", cardSetId: 9, quantity: 3, proxyQuantity: 1, acquiredQuantity: 0 },
      },
      effect: "2 pris au stock · 1 en proxy",
      detail: "deck : 0 → 3, 1 proxy",
      added: 3,
    });
  });

  it("borne « dont possédées » au stock libre, la ligne existante comprise", () => {
    const existing = { quantity: 3, proxyQuantity: 0 };
    expect(stockFreeFor({ available: 4, existing })).toBe(1);
    const plan = buildAddOperation("deck", base({ possessed: 3, existing }));
    expect(plan.ok && plan.operation.kind === "deck" && plan.operation.input).toMatchObject({ quantity: 6, proxyQuantity: 2, acquiredQuantity: 0 });
    expect(plan.ok && plan.effect).toBe("1 pris au stock · 2 en proxy");
    expect(plan.ok && plan.detail).toBe("deck : 3 → 6, 2 proxies");
    expect(stockFreeFor({ available: undefined })).toBe(0);
  });

  it("tout en proxy quand rien n'est possédé", () => {
    const plan = buildAddOperation("deck", base({ possessed: 0, quantity: 1 }));
    expect(plan.ok && plan.effect).toBe("1 en proxy");
  });

  it("deck sans proxies : tout vient du stock, ou le refus dit ce qui manque", () => {
    const fits = buildAddOperation("deck", base({ deck: STRICT, quantity: 4 }));
    expect(fits.ok && fits.operation.kind === "deck" && fits.operation.input).toMatchObject({ quantity: 4, proxyQuantity: 0, acquiredQuantity: 0 });
    expect(fits.ok && fits.effect).toBe("4 pris au stock");
    expect(buildAddOperation("deck", base({ deck: STRICT, quantity: 8, available: 6 }))).toEqual({
      ok: false,
      error: "Ce deck n'autorise pas les proxies : il manque 2 exemplaires au stock. Baissez les copies à 6 ou ajoutez-les aussi à la collection (Les deux).",
    });
    expect(buildAddOperation("deck", base({ deck: STRICT, quantity: 1, available: 0 }))).toEqual({
      ok: false,
      error: "Ce deck n'autorise pas les proxies : il manque 1 exemplaire au stock. Ajoutez-les aussi à la collection (Les deux).",
    });
  });

  it("refuse une ligne au-delà du plafond entier", () => {
    const plan = buildAddOperation("deck", base({ existing: { quantity: 2_147_483_647, proxyQuantity: 2_147_483_647 }, quantity: 1 }));
    expect(plan).toEqual({ ok: false, error: "Le deck ne peut pas contenir autant d'exemplaires de cette carte." });
  });
});

describe("buildAddOperation : collection", () => {
  it("écrit la quantité de la projection plus n", () => {
    const plan = buildAddOperation("collection", base({ quantity: 2, deck: null }), "en anglais (KoT)");
    expect(plan).toEqual({
      ok: true,
      operation: { kind: "stock", input: { cardId: 1, languageCode: "EN", cardSetId: 9, quantityOwned: 6 } },
      effect: "Vous en aurez 6 en anglais (KoT)",
      detail: "Collection : 4 → 6",
      added: 2,
    });
    expect(buildAddOperation("collection", base({ owned: 2_147_483_647, quantity: 1 }))).toMatchObject({ ok: false });
  });
});

describe("buildAddOperation : les deux", () => {
  it("un achat déclaré : les exemplaires remplacent d'abord les proxies, puis s'ajoutent", () => {
    const plan = buildAddOperation("both", base({ quantity: 3, existing: { quantity: 6, proxyQuantity: 2 } }));
    expect(plan).toEqual({
      ok: true,
      operation: {
        kind: "deck",
        deckKey: DECK.key,
        input: { cardId: 1, languageCode: "EN", cardSetId: 9, quantity: 7, proxyQuantity: 0, acquiredQuantity: 3 },
      },
      effect: "2 exemplaires remplacent 2 proxies · 1 s'ajoute au deck",
      detail: "Collection : 4 → 7 · deck : 6 → 7, aucun proxy",
      added: 3,
    });
  });

  it("sans proxy à remplacer, tout s'ajoute aux deux ; tout remplacé, rien ne s'ajoute au deck", () => {
    expect(buildAddOperation("both", base({ quantity: 1 }))).toMatchObject({ ok: true, effect: "1 exemplaire s'ajoute au deck et à la collection" });
    expect(buildAddOperation("both", base({ quantity: 2 }))).toMatchObject({ ok: true, effect: "2 exemplaires s'ajoutent au deck et à la collection" });
    const all = buildAddOperation("both", base({ quantity: 1, existing: { quantity: 3, proxyQuantity: 3 } }));
    expect(all).toMatchObject({ ok: true, effect: "1 exemplaire remplace 1 proxy" });
    const many = buildAddOperation("both", base({ quantity: 4, existing: { quantity: 1, proxyQuantity: 1 } }));
    expect(many).toMatchObject({ ok: true, effect: "1 exemplaire remplace 1 proxy · 3 s'ajoutent au deck" });
  });

  it("ne vaut que pour un deck, et refuse une quantité au-delà du plafond", () => {
    expect(buildAddOperation("both", base({ deck: null }))).toEqual({ ok: false, error: "Choisissez un deck." });
    expect(buildAddOperation("both", base({ owned: 2_147_483_647 }))).toMatchObject({ ok: false });
  });
});

describe("préconditions communes", () => {
  it("quantité entière d'au moins 1, extension choisie", () => {
    expect(buildAddOperation("collection", base({ quantity: 0 }))).toEqual({ ok: false, error: "La quantité est un entier, 1 ou plus." });
    expect(buildAddOperation("deck", base({ quantity: 1.5 }))).toMatchObject({ ok: false });
    expect(buildAddOperation("deck", base({ cardSetId: null }))).toEqual({ ok: false, error: "Choisissez une extension." });
    expect(buildAddOperation("deck", base({ deck: null }))).toEqual({ ok: false, error: "Choisissez un deck." });
  });
});

describe("ligne confirmée maintenue", () => {
  const row = (id: number) => ({ card: { id } });
  it("remet à sa place une carte que les filtres écartent depuis l'ajout", () => {
    const next = [row(1), row(3), row(4)];
    expect(withHeld(next, [{ item: row(2), index: 1 }]).map((item) => item.card.id)).toEqual([1, 2, 3, 4]);
    expect(withHeld(next, [{ item: row(3), index: 0 }]).map((item) => item.card.id)).toEqual([1, 3, 4]);
    expect(withHeld([], [{ item: row(9), index: 5 }]).map((item) => item.card.id)).toEqual([9]);
    expect(withHeld(next, [{ item: row(8), index: 2 }, { item: row(7), index: 0 }]).map((item) => item.card.id)).toEqual([7, 1, 8, 3, 4]);
  });
});
