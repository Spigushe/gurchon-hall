import { describe, expect, it } from "vitest";
import { deckLegalityVersion } from "../../../../src/features/decks/deckLegalityVersion";

const deck = { pending: false, status: "draft" as const };
const line = (cardId: number, quantity: number) => ({ cardId, quantity });

describe("deckLegalityVersion", () => {
  it("null tant que les lignes ne sont pas lues", () => {
    expect(deckLegalityVersion(deck, undefined)).toBeNull();
  });

  it("ne dépend pas de l'ordre des lignes", () => {
    expect(deckLegalityVersion(deck, [line(2, 1), line(1, 3)])).toBe(
      deckLegalityVersion(deck, [line(1, 3), line(2, 1)]),
    );
  });

  it("additionne les lignes d'une même carte (langues, extensions)", () => {
    expect(deckLegalityVersion(deck, [line(1, 2), line(1, 1)])).toBe(deckLegalityVersion(deck, [line(1, 3)]));
  });

  it("change avec la quantité, la carte, le statut et l'état en attente", () => {
    const base = deckLegalityVersion(deck, [line(1, 3)]);
    expect(deckLegalityVersion(deck, [line(1, 4)])).not.toBe(base);
    expect(deckLegalityVersion(deck, [line(1, 3), line(2, 1)])).not.toBe(base);
    expect(deckLegalityVersion({ ...deck, status: "active" }, [line(1, 3)])).not.toBe(base);
    expect(deckLegalityVersion({ ...deck, pending: true }, [line(1, 3)])).not.toBe(base);
  });

  it("un deck vide a une empreinte (distincte d'une lecture en cours)", () => {
    expect(deckLegalityVersion(deck, [])).toBe("synced|draft|");
  });
});
