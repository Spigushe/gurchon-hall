import { describe, expect, it } from "vitest";
import { isCatalogLoading } from "../../../../src/features/catalog/catalogLoading";

// Lot 12, A8 : « Catalogue en cours de chargement » au lieu de « 0 / 0 ».
const mirror = (cards: number, details: number) => ({ cards, details, complete: cards > 0 && details >= cards });

describe("isCatalogLoading", () => {
  it("vrai tant que le miroir n'a pas été lu", () => {
    expect(isCatalogLoading(undefined, "idle")).toBe(true);
  });

  it("vrai pour un catalogue vide ou incomplet en cours de lecture", () => {
    expect(isCatalogLoading(mirror(0, 0), "loading")).toBe(true);
    expect(isCatalogLoading(mirror(4212, 0), "loading")).toBe(true);
  });

  it("faux pour un catalogue vide hors lecture (hors ligne, échec)", () => {
    expect(isCatalogLoading(mirror(0, 0), "idle")).toBe(false);
    expect(isCatalogLoading(mirror(0, 0), "error")).toBe(false);
  });

  it("faux pour un catalogue complet, même pendant sa mise à jour", () => {
    expect(isCatalogLoading(mirror(4212, 4212), "loading")).toBe(false);
    expect(isCatalogLoading(mirror(4212, 4212), "idle")).toBe(false);
  });
});
