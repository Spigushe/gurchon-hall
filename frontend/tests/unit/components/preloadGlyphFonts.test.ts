import { describe, expect, it, vi } from "vitest";
import {
  GLYPH_FONT_FAMILIES,
  preloadGlyphFonts,
} from "../../../src/components/glyphs/preloadGlyphFonts";

describe("preloadGlyphFonts", () => {
  it("demande les deux polices d'icônes", async () => {
    const load = vi.fn().mockResolvedValue([]);
    await preloadGlyphFonts({ load });
    expect(load.mock.calls.map(([font]) => font)).toEqual(
      GLYPH_FONT_FAMILIES.map((family) => `1em "${family}"`),
    );
  });

  it("ne lève pas quand le chargement échoue", async () => {
    const load = vi.fn().mockRejectedValue(new Error("hors ligne"));
    await expect(preloadGlyphFonts({ load })).resolves.toBeUndefined();
  });

  it("ne lève pas quand `load` lève de façon synchrone", async () => {
    const load = vi.fn(() => {
      throw new SyntaxError("descripteur refusé");
    });
    await expect(preloadGlyphFonts({ load })).resolves.toBeUndefined();
  });

  it("ne fait rien sans API de polices", async () => {
    await expect(preloadGlyphFonts(undefined)).resolves.toBeUndefined();
  });
});
