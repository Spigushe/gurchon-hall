import { describe, expect, it } from "vitest";
import {
  PREVIEW_GAP,
  PREVIEW_MARGIN,
  cardPreviewPosition,
} from "../../../../src/features/decks/cardPreviewPosition";

const SIZE = { width: 180, height: 251 };
const VIEWPORT = { width: 1440, height: 900 };

describe("placement de l'aperçu d'une carte (issue #71)", () => {
  it("se place sous le nom, aligné à gauche, quand il y a la place", () => {
    expect(cardPreviewPosition({ top: 100, bottom: 120, left: 300 }, SIZE, VIEWPORT)).toEqual({
      top: 120 + PREVIEW_GAP,
      left: 300,
    });
  });

  it("passe au-dessus du nom quand il manque de place en bas", () => {
    expect(cardPreviewPosition({ top: 800, bottom: 820, left: 300 }, SIZE, VIEWPORT)).toEqual({
      top: 800 - PREVIEW_GAP - SIZE.height,
      left: 300,
    });
  });

  it("reste dans la fenêtre à droite, sur un téléphone", () => {
    const phone = { width: 390, height: 844 };
    expect(cardPreviewPosition({ top: 100, bottom: 120, left: 300 }, SIZE, phone).left).toBe(
      390 - PREVIEW_MARGIN - SIZE.width,
    );
  });

  it("ne sort ni en haut ni en bas d'une fenêtre trop petite", () => {
    const tiny = { width: 390, height: 300 };
    const { top } = cardPreviewPosition({ top: 140, bottom: 160, left: 10 }, SIZE, tiny);
    expect(top).toBeGreaterThanOrEqual(PREVIEW_MARGIN);
    expect(top + SIZE.height).toBeLessThanOrEqual(300 - PREVIEW_MARGIN);
  });

  it("garde la marge à gauche", () => {
    expect(cardPreviewPosition({ top: 100, bottom: 120, left: -40 }, SIZE, VIEWPORT).left).toBe(PREVIEW_MARGIN);
  });
});
