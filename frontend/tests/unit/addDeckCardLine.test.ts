import { describe, expect, it } from "vitest";
import { computeAddedLine } from "../../src/features/decks/useAddDeckCard";

describe("computeAddedLine : état complet de la ligne après ajout (Lot Chercher, D1a)", () => {
  it("sans ligne existante : copies, proxies et manque tels que saisis", () => {
    expect(computeAddedLine({ copies: 3, possessed: 3, available: 1, existing: undefined })).toEqual({
      quantity: 3,
      proxyQuantity: 0,
      acquiredQuantity: 2,
    });
    expect(computeAddedLine({ copies: 1, possessed: 0, available: 0, existing: undefined })).toEqual({
      quantity: 1,
      proxyQuantity: 1,
      acquiredQuantity: 0,
    });
  });

  it("avec une ligne existante : la quantité et les proxies s'ajoutent, l'ajout ne l'écrase pas", () => {
    expect(
      computeAddedLine({ copies: 1, possessed: 0, available: 0, existing: { quantity: 2, proxyQuantity: 2 } }),
    ).toEqual({ quantity: 3, proxyQuantity: 3, acquiredQuantity: 0 });
  });

  it("l'acquisition tient compte des exemplaires réels déjà placés dans la ligne", () => {
    // 2 réels déjà dans la ligne, 3 disponibles pour ce deck : 2 de plus exigent 1 acquis.
    expect(
      computeAddedLine({ copies: 2, possessed: 2, available: 3, existing: { quantity: 2, proxyQuantity: 0 } }),
    ).toEqual({ quantity: 4, proxyQuantity: 0, acquiredQuantity: 1 });
    // Le disponible couvre tout : rien à acquérir.
    expect(
      computeAddedLine({ copies: 1, possessed: 1, available: 3, existing: { quantity: 2, proxyQuantity: 0 } }),
    ).toMatchObject({ acquiredQuantity: 0 });
  });

  it("n'acquiert jamais plus que les exemplaires réels ajoutés, et rien tant que le stock n'est pas lu", () => {
    expect(
      computeAddedLine({ copies: 1, possessed: 1, available: 0, existing: { quantity: 3, proxyQuantity: 0 } }),
    ).toMatchObject({ acquiredQuantity: 1 });
    expect(computeAddedLine({ copies: 2, possessed: 2, available: undefined, existing: undefined })).toMatchObject({
      acquiredQuantity: 0,
    });
  });
});
