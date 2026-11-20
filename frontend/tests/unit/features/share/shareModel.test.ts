import { describe, expect, it } from "vitest";
import type { DeckShareRead } from "../../../../src/features/share/shareApi";
import {
  deleteSharesNote,
  deckLabel,
  freezeBlockedMessage,
  groupShares,
  pendingOperationsOnDeck,
  purgeConfirmation,
  purgedMessage,
  shareBlockedReason,
  shareLink,
  shareMeta,
  sharePreview,
} from "../../../../src/features/share/shareModel";

function share(id: number, over: Partial<DeckShareRead> = {}, deck: Partial<DeckShareRead["deck"]> = {}): DeckShareRead {
  return {
    id,
    token: `tok${id}`.padEnd(8, "x"),
    kind: "live",
    show_notes: false,
    created_at: "2026-11-20T10:00:00Z",
    frozen_name: null,
    deck_version_number: null,
    deck: { id: 1, name: "Banu Princes", discriminator: "0001", archived_at: null, deleted_at: null, ...deck },
    ...over,
  };
}

describe("shareLink", () => {
  it("écrit l'adresse de la page publique dans le hash de la PWA", () => {
    expect(shareLink("https://gurchon.spigushe.com", "aB3x_9pQ")).toBe("https://gurchon.spigushe.com/#/liste/aB3x_9pQ");
  });
});

describe("shareMeta", () => {
  it("dit la date d'un vivant, la version d'un figé de version, la date d'un figé de la liste courante", () => {
    expect(shareMeta(share(1))).toBe("créé le 20 novembre 2026");
    expect(shareMeta(share(2, { kind: "frozen", deck_version_number: 3 }))).toBe("version v3 · 20 novembre 2026");
    expect(shareMeta(share(3, { kind: "frozen" }))).toBe("liste du 20 novembre 2026");
  });
});

describe("pendingOperationsOnDeck", () => {
  const entry = (operation: object) => ({ operation }) as never;
  const deck = { id: 7, clientRef: "ref-1" };
  it("compte les opérations qui touchent le deck, par identifiant ou par référence client", () => {
    const entries = [
      entry({ type: "deck.create", client_ref: "ref-1", data: {} }),
      entry({ type: "deck.update", deck: { deck_id: 7 }, data: {} }),
      entry({ type: "deck_card.upsert", deck: { client_ref: "ref-1" }, data: {} }),
      entry({ type: "deck_card.delete", deck: { deck_id: 8 } }),
      entry({ type: "deck.create", client_ref: "autre", data: {} }),
      entry({ type: "stock.delete", card_id: 1 }),
      entry({ type: "game.delete", game: { game_id: 1 } }),
    ];
    expect(pendingOperationsOnDeck(entries, deck)).toBe(3);
  });

  it("un deck sans identifiant ni référence n'est visé par aucune opération", () => {
    expect(pendingOperationsOnDeck([entry({ type: "deck.update", deck: { deck_id: 7 }, data: {} })], { id: null, clientRef: null })).toBe(0);
  });
});

describe("freezeBlockedMessage", () => {
  it("annonce les modifications à synchroniser, au singulier comme au pluriel, et rien sans file", () => {
    expect(freezeBlockedMessage(0)).toBeNull();
    expect(freezeBlockedMessage(1)).toBe("1 modification à synchroniser avant de figer la liste");
    expect(freezeBlockedMessage(3)).toBe("3 modifications à synchroniser avant de figer la liste");
  });
});

describe("sharePreview", () => {
  const deck = { name: "Banu Princes", archetype: "bleed" as const, notes: "Mes remarques" };
  it("montre toujours le nom, l'archétype et l'auteur ; les notes seulement si la case est cochée", () => {
    expect(sharePreview(deck, "lea-v", false)).toEqual({ name: "Banu Princes", archetype: "Bleed", author: "lea-v", notes: null });
    expect(sharePreview(deck, "lea-v", true).notes).toBe("Mes remarques");
  });
  it("sans archétype ni notes : pas d'archétype, notes vides", () => {
    expect(sharePreview({ name: "X", archetype: null, notes: null }, null, true)).toEqual({
      name: "X",
      archetype: null,
      author: null,
      notes: "",
    });
  });
});

describe("groupShares", () => {
  it("groupe par deck les liens des decks vivants, et range à part ceux des decks supprimés", () => {
    const gone = { id: 9, name: "Ancien", discriminator: "0002", deleted_at: "2026-11-01T00:00:00Z" };
    const grouped = groupShares([
      share(1),
      share(2, { kind: "frozen" }, { id: 2, name: "Autre", discriminator: "0003" }),
      share(3, { kind: "frozen" }),
      share(4, { kind: "frozen" }, gone),
    ]);
    expect(grouped.groups.map((group) => [group.deck.id, group.shares.map((item) => item.id)])).toEqual([
      [1, [1, 3]],
      [2, [2]],
    ]);
    expect(grouped.deleted.map((item) => item.id)).toEqual([4]);
    expect(deckLabel(grouped.groups[0].deck)).toBe("Banu Princes#0001");
  });
});

describe("textes des purges", () => {
  it("la confirmation porte le nombre de liens visés", () => {
    expect(purgeConfirmation("selected", 1)).toMatchObject({ question: expect.stringContaining("1 lien ?"), confirm: "Purger 1 lien" });
    expect(purgeConfirmation("selected", 3).confirm).toBe("Purger 3 liens");
    expect(purgeConfirmation("deleted_decks", 2).question).toContain("2 liens de decks supprimés");
    expect(purgeConfirmation("all", 5)).toMatchObject({ confirm: "Tout purger (5)", question: expect.stringContaining("5 liens du compte") });
  });
  it("le retour dit le nombre de liens purgés", () => {
    expect(purgedMessage(0)).toBe("Aucun lien à purger.");
    expect(purgedMessage(1)).toBe("1 lien purgé.");
    expect(purgedMessage(4)).toBe("4 liens purgés.");
  });
});

describe("deleteSharesNote", () => {
  it("hors ligne ou pas encore lu : une phrase prudente, sans nombre", () => {
    expect(deleteSharesNote(null)).not.toMatch(/\d/);
    expect(deleteSharesNote(null)).toContain("figés");
  });
  it("dit combien de figés resteront publics et combien de vivants seront révoqués", () => {
    expect(deleteSharesNote([share(1, { kind: "frozen" }), share(2, { kind: "frozen" }), share(3)])).toBe(
      "2 liens figés resteront publics après la suppression. 1 lien vivant sera révoqué.",
    );
    expect(deleteSharesNote([share(1, { kind: "frozen" })])).toBe("1 lien figé restera public après la suppression.");
    expect(deleteSharesNote([share(1), share(2)])).toBe("2 liens vivants seront révoqués.");
  });
});

describe("shareBlockedReason", () => {
  it("grise « Partager » hors ligne et pour un deck pas encore connu du serveur", () => {
    expect(shareBlockedReason({ id: 4 }, true)).toBeNull();
    expect(shareBlockedReason({ id: 4 }, false)).toContain("réseau");
    expect(shareBlockedReason({ id: null }, true)).toContain("pas encore synchronisé");
  });
});
