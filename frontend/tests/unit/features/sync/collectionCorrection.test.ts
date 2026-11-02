import { describe, expect, it } from "vitest";
import { collectionCorrection, type CollectionFields } from "../../../../src/features/sync/collectionCorrection";
import * as ops from "../../../../src/offline/vtes/operations";
import type { VtesOperation } from "../../../../src/offline/vtes/types";

let counter = 0;
const clock: ops.OperationClock = {
  newId: () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`,
  now: () => "2026-10-24T20:00:00.000+02:00",
};

const fields = (patch: Partial<CollectionFields> = {}): CollectionFields => ({
  quantity: 2,
  proxyQuantity: 0,
  proxyAllowed: false,
  name: "Banu",
  status: "draft",
  ...patch,
});

function corrected(operation: VtesOperation, patch: Partial<CollectionFields>): VtesOperation {
  const result = collectionCorrection(operation, fields(patch));
  if (result === null || "error" in result) throw new Error(`correction refusée : ${JSON.stringify(result)}`);
  return result.transform(operation);
}

const errorOf = (operation: VtesOperation, patch: Partial<CollectionFields>) => {
  const result = collectionCorrection(operation, fields(patch));
  return result !== null && "error" in result ? result.error : null;
};

const deck = { deckId: 3 };
const stock = ops.stockUpsert(clock, { card_id: 1, language_code: "FR", card_set_id: 5, quantity_owned: 1 });
const deckCard = ops.deckCardUpsert(clock, deck, {
  card_id: 1,
  language_code: "FR",
  card_set_id: 5,
  quantity: 2,
  proxy_quantity: 1,
});
const bundle = ops.bundleDeposit(clock, 7, "EN", 1);
const created = ops.deckCreate(clock, "ref-1", { name: "Ancien nom", proxyAllowed: false });

describe("corrections de collection", () => {
  it("stock : nouvelle quantité possédée, 0 compris", () => {
    expect(corrected(stock, { quantity: 0 })).toMatchObject({ data: { quantity_owned: 0 } });
    expect(errorOf(stock, { quantity: -1 })).toMatch(/0 ou plus/);
    expect(errorOf(stock, { quantity: Number.NaN })).toMatch(/0 ou plus/);
  });

  it("ligne de deck : quantité et proxies bornés par la quantité", () => {
    expect(corrected(deckCard, { quantity: 4, proxyQuantity: 4 })).toMatchObject({
      data: { quantity: 4, proxy_quantity: 4 },
    });
    expect(errorOf(deckCard, { quantity: 0 })).toMatch(/1 ou plus/);
    expect(errorOf(deckCard, { quantity: 2, proxyQuantity: 3 })).toMatch(/entre 0 et la quantité/);
    expect(errorOf(deckCard, { proxyQuantity: -1 })).toMatch(/entre 0 et la quantité/);
  });

  it("versement : au moins un produit", () => {
    expect(corrected(bundle, { quantity: 3 })).toMatchObject({ data: { count: 3 } });
    expect(errorOf(bundle, { quantity: 0 })).toMatch(/1 ou plus/);
  });

  it("création de deck : nom rogné obligatoire, proxies repris du formulaire", () => {
    expect(corrected(created, { name: "  Banu  ", proxyAllowed: true })).toMatchObject({
      data: { name: "Banu", proxy_allowed: true },
    });
    expect(errorOf(created, { name: "   " })).toBe("Le nom du deck est obligatoire.");
  });

  it("modification de deck : seuls les champs portés par l'opération changent", () => {
    const rename = ops.deckUpdate(clock, deck, { name: "Ancien" });
    expect(corrected(rename, { name: " Nouveau ", status: "active", proxyAllowed: true }).data).toEqual({
      name: "Nouveau",
    });
    expect(errorOf(rename, { name: "" })).toBe("Le nom du deck est obligatoire.");

    const statusAndProxy = ops.deckUpdate(clock, deck, { status: "draft", proxyAllowed: false });
    expect(corrected(statusAndProxy, { name: "", status: "active", proxyAllowed: true }).data).toEqual({
      status: "active",
      proxy_allowed: true,
    });
  });

  it("la transformation laisse intacte une opération d'un autre type", () => {
    const other = ops.deckDelete(clock, deck);
    for (const operation of [stock, deckCard, bundle, created, ops.deckUpdate(clock, deck, { name: "X" })]) {
      const result = collectionCorrection(operation, fields());
      expect(result !== null && "transform" in result && result.transform(other)).toBe(other);
    }
  });

  it("rend null hors de la collection", () => {
    expect(collectionCorrection(ops.deckDelete(clock, deck), fields())).toBeNull();
  });
});
