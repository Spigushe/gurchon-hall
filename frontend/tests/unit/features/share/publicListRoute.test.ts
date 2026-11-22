import { describe, expect, it } from "vitest";
import { isPublicListHash, parsePublicListHash } from "../../../../src/features/share/publicListRoute";

describe("parsePublicListHash", () => {
  it("lit un jeton valide, sans révision", () => {
    expect(parsePublicListHash("#/liste/aB3x_9pQ")).toEqual({ kind: "list", token: "aB3x_9pQ", revision: null });
  });

  it("rend le paramètre revision brut, sans le couper sur = ni ;", () => {
    const hash = "#/liste/aB3x_9pQ?revision=100845=1;102366=-1;201436=-1";
    expect(parsePublicListHash(hash)).toEqual({
      kind: "list",
      token: "aB3x_9pQ",
      revision: "100845=1;102366=-1;201436=-1",
    });
  });

  it("ne décode pas la révision et s'arrête à l'esperluette suivante", () => {
    expect(parsePublicListHash("#/liste/aB3x_9pQ?x=1&revision=a%3D1;b=2&y=3")).toMatchObject({
      revision: "a%3D1;b=2",
    });
  });

  it("lit une révision vide ou absente comme nulle", () => {
    expect(parsePublicListHash("#/liste/aB3x_9pQ?revision=")).toMatchObject({ revision: null });
    expect(parsePublicListHash("#/liste/aB3x_9pQ?autre=1")).toMatchObject({ revision: null });
    expect(parsePublicListHash("#/liste/aB3x_9pQ?")).toMatchObject({ kind: "list", revision: null });
  });

  it.each([
    ["trop court", "#/liste/aB3x_9p"],
    ["trop long", "#/liste/aB3x_9pQz"],
    ["caractère interdit", "#/liste/aB3x-9pQ"],
    ["accent", "#/liste/aB3xé9pQ"],
    ["vide", "#/liste/"],
    ["sous-chemin", "#/liste/aB3x_9pQ/plus"],
    ["jeton trop court avec révision", "#/liste/abc?revision=1=1"],
  ])("signale un jeton invalide : %s", (_label, hash) => {
    expect(parsePublicListHash(hash)).toEqual({ kind: "invalid" });
  });

  it.each([
    "",
    "#",
    "#/",
    "#/decks",
    "#/decks?action=nouveau",
    "#/liste",
    "#/listes/aB3x_9pQ",
    "#/decks/liste/aB3x_9pQ",
    "/liste/aB3x_9pQ",
  ])("laisse l'application normale tranquille : %j", (hash) => {
    expect(parsePublicListHash(hash)).toEqual({ kind: "none" });
    expect(isPublicListHash(hash)).toBe(false);
  });

  it("isPublicListHash vaut vrai aussi pour un jeton invalide", () => {
    expect(isPublicListHash("#/liste/x")).toBe(true);
  });
});
