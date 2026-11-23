import { describe, expect, it } from "vitest";
import {
  VDB_CARDTYPE_ORDER,
  compareLibraryTypeGroups,
  libraryTypeGroup,
  type LibraryTypeGroup,
} from "../../../../src/features/decks/libraryTypeOrder";

// Ordre des groupes de bibliothèque, figé sur `cardtypeSortedFull.json` de VDB pour toutes les
// decklists. Le fichier est recopié tel quel et mis à jour par le workflow
// `vdb-cardtype-order.yml` : ces tests vérifient sa forme et la règle qui en tire l'ordre, pas
// son contenu ligne à ligne.

const sortLabels = (cards: string[][]) =>
  cards
    .map((types) => libraryTypeGroup(types))
    .filter((group): group is LibraryTypeGroup => group !== null)
    .sort(compareLibraryTypeGroups)
    .map((group) => group.label);

describe("copie de cardtypeSortedFull.json", () => {
  it("est une liste de libellés non vides, sans doublon, même à l'ordre des types près", () => {
    expect(VDB_CARDTYPE_ORDER.length).toBeGreaterThan(0);
    for (const label of VDB_CARDTYPE_ORDER) {
      expect(typeof label).toBe("string");
      expect(label.split("/").every((type) => type.trim() === type && type.length > 0)).toBe(true);
    }
    const keys = VDB_CARDTYPE_ORDER.map((label) => label.split("/").sort().join("/"));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("nomme en type seul chaque type d'une combinaison", () => {
    const singles = new Set(VDB_CARDTYPE_ORDER.filter((label) => !label.includes("/")));
    for (const label of VDB_CARDTYPE_ORDER) for (const type of label.split("/")) expect(singles).toContain(type);
  });
});

describe("libraryTypeGroup", () => {
  it("rend chaque libellé de la liste à son rang", () => {
    VDB_CARDTYPE_ORDER.forEach((label, rank) => {
      expect(libraryTypeGroup(label.split("/"))).toEqual({ types: label.split("/"), rank, label });
    });
  });

  it("retrouve une combinaison de la liste quel que soit l'ordre des types de la carte", () => {
    const listed = VDB_CARDTYPE_ORDER.find((label) => label.includes("/"));
    expect(listed).toBeDefined();
    const reversed = (listed ?? "").split("/").reverse();
    expect(libraryTypeGroup(reversed)?.label).toBe(listed);
  });

  it("met un libellé hors liste après la liste, ses types dans l'ordre des types seuls", () => {
    const [first] = VDB_CARDTYPE_ORDER.filter((label) => !label.includes("/"));
    expect(libraryTypeGroup(["Inconnu", first])).toEqual({
      types: [first, "Inconnu"],
      rank: VDB_CARDTYPE_ORDER.length,
      label: `${first}/Inconnu`,
    });
  });

  it("n'a pas de groupe pour une carte sans type", () => {
    expect(libraryTypeGroup([])).toBeNull();
  });
});

describe("compareLibraryTypeGroups", () => {
  it("suit la liste, puis les libellés hors liste par ordre alphabétique", () => {
    const shuffled = [...VDB_CARDTYPE_ORDER].reverse().map((label) => label.split("/").reverse());
    expect(sortLabels([["Zeta"], ["Alpha", "Beta"], ...shuffled])).toEqual([...VDB_CARDTYPE_ORDER, "Alpha/Beta", "Zeta"]);
  });
});
