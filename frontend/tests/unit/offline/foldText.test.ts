import { describe, expect, it } from "vitest";
import { containsFolded, foldText } from "../../../src/offline/core/foldText";
import parityFixture from "./fixtures/fold-parity.json";

/**
 * Parité avec `app.db.folding.fold_text` (back). Deux niveaux :
 *  - les cas figés par `backend/tests/test_text_search.py`, recopiés ici ;
 *  - la fixture exhaustive `fold-parity.json`, produite par le vrai `fold_text`
 *    Python (`tools/dump_fold_reference.py`) sur tout l'espace Unicode : chaque
 *    point de code qu'il modifie y figure avec sa valeur, tous les autres
 *    doivent rester intacts.
 */

describe("foldText : cas figés côté back", () => {
  it.each([
    ["Élan vital", "elan vital"],
    ["ÉLAN", "elan"],
    ["École", "ecole"],
    ["Niño", "nino"],
    ["Ça", "ca"],
    ["Éloïse", "eloise"],
    ["Straße", "strasse"],
    ["İstanbul", "istanbul"],
    ["ﬁn", "fin"],
    ["Plain", "plain"],
    ["", ""],
  ])("%s -> %s", (raw, folded) => {
    expect(foldText(raw)).toBe(folded);
  });

  it("laisse un null tel quel", () => {
    expect(foldText(null)).toBeNull();
    expect(foldText(undefined)).toBeNull();
  });

  it.each([
    ["œ", "œ"],
    ["Œuvre", "œuvre"],
    ["Ł", "ł"],
    ["Øystein", "øystein"],
  ])("laisse les lettres sans décomposition : %s -> %s", (raw, folded) => {
    expect(foldText(raw)).toBe(folded);
  });

  it("est idempotent", () => {
    const once = foldText("Élan Œuvre Łódź İ ß");
    expect(foldText(once)).toBe(once);
  });

  it("replie le sigma final comme casefold (pas de contexte)", () => {
    expect(foldText("ΑΣ")).toBe("ασ");
    expect(foldText("ας")).toBe("ασ");
  });
});

describe("foldText : parité exhaustive avec Python", () => {
  const fixture = parityFixture as {
    unassigned: Array<[number, number]>;
    changed: Record<string, string>;
  };
  // Seul écart toléré : un caractère que l'Unicode du moteur JS connaît et pas
  // celui de Python (le test ne doit pas casser à chaque mise à jour de Node).
  const isUnassignedForPython = (cp: number) =>
    fixture.unassigned.some(([start, end]) => cp >= start && cp <= end);
  const changed = new Map(
    Object.entries(fixture.changed).map(([hex, folded]) => [parseInt(hex, 16), folded]),
  );

  // Calcul pur sur les 1,1 million de points de code : ~1,5 s à vide, ~6 s sous
  // une charge CPU 6 fois supérieure au nombre de coeurs. Délai explicite plutôt
  // qu'un délai global démesuré pour les autres tests.
  it("replie chaque point de code comme fold_text", { timeout: 30_000 }, () => {
    expect(changed.size).toBeGreaterThan(10_000);
    const mismatches: string[] = [];
    for (let cp = 0; cp < 0x110000; cp++) {
      if (cp >= 0xd800 && cp < 0xe000) continue;
      const char = String.fromCodePoint(cp);
      const expected = changed.get(cp) ?? char;
      const actual = foldText(char);
      if (actual !== expected && !isUnassignedForPython(cp)) {
        mismatches.push(`U+${cp.toString(16)} : attendu ${expected}, obtenu ${actual}`);
        if (mismatches.length >= 20) break;
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("garde la parité sur des textes composés (chaque caractère se replie indépendamment)", () => {
    // Ligatures, iota souscrit, pleine chasse, marques nées du repli de casse :
    // aucun de ces caractères n'interagit avec son voisin, le repli du texte est
    // donc la concaténation des replis de Python, point de code par point de code.
    const samples = ["ǰ Ǆ ŉ ẖ", "ΐ ΰ ᾳ", "ｆｕｌｌ ％", "ﬃ ﬆ ﬀ", "Ç é ñ ü", "Straße ẞ ς Σ"];
    for (const raw of samples) {
      const expected = [...raw]
        .map((char) => changed.get(char.codePointAt(0) as number) ?? char)
        .join("");
      expect(foldText(raw), raw).toBe(expected);
    }
  });
});

describe("containsFolded : équivalent de contains_folded", () => {
  const names = [
    "Élan vital",
    "École de sang",
    "Niño",
    "Ça ira",
    "Plain",
    "100% Bleed",
    "Under_score",
    "Elan brut",
    "Łódź",
    "Œuvre",
  ];
  const search = (q: string) => names.filter((name) => containsFolded(name, q)).sort();

  it.each(["élan", "ÉLAN", "Élan", "elan", "ELAN", "éLAN"])(
    "« %s » trouve « Élan vital » et « Elan brut »",
    (q) => {
      expect(search(q)).toEqual(["Elan brut", "Élan vital"]);
    },
  );

  it("ignore accents et casse pour les autres noms", () => {
    expect(search("ecole")).toEqual(["École de sang"]);
    expect(search("NIÑO")).toEqual(["Niño"]);
    expect(search("ca")).toEqual(["Ça ira"]);
    expect(search("ç")).toEqual(["Under_score", "Ça ira", "École de sang"].sort());
    expect(search("PLAIN")).toEqual(["Plain"]);
  });

  it("ne rapproche pas les lettres sans décomposition", () => {
    expect(search("ł")).toEqual(["Łódź"]);
    expect(search("Ł")).toEqual(["Łódź"]);
    expect(search("œ")).toEqual(["Œuvre"]);
    expect(search("ŒUVRE")).toEqual(["Œuvre"]);
    expect(search("oe")).toEqual([]);
    expect(search("lodz")).toEqual([]);
  });

  it("garde les jokers littéraux", () => {
    expect(search("%")).toEqual(["100% Bleed"]);
    expect(search("_")).toEqual(["Under_score"]);
    expect(search("%%")).toEqual([]);
    expect(search("e_l")).toEqual([]);
    expect(search("100%")).toEqual(["100% Bleed"]);
    expect(search("É%")).toEqual([]);
    expect(search("％")).toEqual(["100% Bleed"]);
  });

  it("un texte cherché absent ne trouve rien, un texte vide trouve tout", () => {
    expect(search("zzz")).toEqual([]);
    expect(search("")).toHaveLength(names.length);
  });

  it("un texte nul ne contient rien", () => {
    expect(containsFolded(null, "a")).toBe(false);
  });
});
