import { describe, expect, it } from "vitest";
import { bundleOptionLabel, groupBundles, type Bundle } from "../../../../src/features/stock/bundleOptions";
import type { CardSetRow } from "../../../../src/offline/vtes";

const set = (id: number, abbrev: string, releaseDate: string | null, fullName: string | null = null): CardSetRow => ({
  id,
  abbrev,
  fullName,
  releaseDate,
  company: null,
  isPlaceholder: false,
});

const bundle = (id: number, cardSetId: number, name: string | null, date: string | null, size: number | null = null): Bundle => ({
  id,
  card_set_id: cardSetId,
  code: "",
  name,
  size,
  release_date: date,
});

describe("groupBundles", () => {
  const sets = [
    set(1, "KMW", "2004-01-01", "Keepers of Tradition"),
    set(2, "V5", "2020-06-01", "Vampire 5th"),
    set(3, "PROMO", null),
    set(4, "AAA", null),
  ];

  it("range les extensions de la plus récente à la plus ancienne, sans date en dernier puis par abréviation", () => {
    const groups = groupBundles(
      [bundle(1, 3, "a", null), bundle(2, 1, "b", null), bundle(3, 2, "c", null), bundle(4, 4, "d", null)],
      sets,
    );
    expect(groups.map((group) => group.cardSetId)).toEqual([2, 1, 4, 3]);
    expect(groups.map((group) => group.label)).toEqual(["Vampire 5th", "Keepers of Tradition", "AAA", "PROMO"]);
  });

  it("trie les produits par date décroissante, puis nom replié, sans date en dernier", () => {
    const [group] = groupBundles(
      [
        bundle(1, 1, "Zèbre", "2004-01-01"),
        bundle(2, 1, "Élan", "2004-01-01"),
        bundle(3, 1, "Ancien", "2003-01-01"),
        bundle(4, 1, "Sans date", null),
        bundle(5, 1, null, "2004-01-01"),
      ],
      sets,
    );
    expect(group.bundles.map((b) => b.id)).toEqual([2, 5, 1, 3, 4]);
  });

  it("garde un produit sans nom ni date, et nomme une extension inconnue du miroir", () => {
    const groups = groupBundles([bundle(9, 99, null, null), bundle(8, 1, "x", null)], sets);
    expect(groups.map((group) => group.label)).toEqual(["Keepers of Tradition", "Extension 99"]);
    expect(groups[1].bundles).toHaveLength(1);
  });

  it("rend une liste vide sans produit", () => {
    expect(groupBundles([], sets)).toEqual([]);
  });
});

describe("bundleOptionLabel", () => {
  it("ajoute le nombre de cartes quand il est connu", () => {
    expect(bundleOptionLabel({ ...bundle(1, 1, "Brujah", null, 90), code: "PB" })).toBe("Brujah (PB) · 90 cartes");
    expect(bundleOptionLabel(bundle(1, 1, null, null))).toBe("Produit sans nom");
  });
});
