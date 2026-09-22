import { describe, expect, it } from "vitest";
import { newUuid, toLocalIso } from "../../../src/offline/core/ids";
import * as ops from "../../../src/offline/vtes/operations";
import {
  FALLBACK_LANGUAGE,
  knownLanguageCodes,
  resolveLanguageCode,
} from "../../../src/offline/vtes/languages";
import { deckKeyOf, parseDeckKey, toDeckRef } from "../../../src/offline/vtes/types";
import { VtesOfflineDb } from "../../../src/offline/vtes/db";
import { freshDbName } from "./helpers";

const clock: ops.OperationClock = {
  newId: () => "11111111-1111-4111-8111-111111111111",
  now: () => "2026-09-20T14:03:11.123+02:00",
};

describe("identifiants et horodatage", () => {
  it("tire des UUID v4 distincts", () => {
    const ids = new Set(Array.from({ length: 50 }, () => newUuid()));
    expect(ids.size).toBe(50);
    for (const id of ids) {
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    }
  });

  it("garde un UUID valide sans crypto.randomUUID (contexte non sécurisé)", () => {
    const real = globalThis.crypto;
    Object.defineProperty(globalThis, "crypto", {
      value: { getRandomValues: real.getRandomValues.bind(real) },
      configurable: true,
    });
    try {
      expect(newUuid()).toMatch(/^[0-9a-f-]{36}$/);
      expect(newUuid()).not.toBe(newUuid());
    } finally {
      Object.defineProperty(globalThis, "crypto", { value: real, configurable: true });
    }
  });

  it("écrit recorded_at avec le fuseau local, exigé par le contrat", () => {
    const stamp = toLocalIso(new Date(2026, 8, 20, 14, 3, 11, 5));
    expect(stamp).toMatch(/^2026-09-20T14:03:11\.005[+-]\d{2}:\d{2}$/);
    expect(new Date(stamp).getTime()).toBe(new Date(2026, 8, 20, 14, 3, 11, 5).getTime());
  });
});

describe("constructeurs d'opérations (charge utile du contrat)", () => {
  it("stock.upsert : clé et instant fixés à la saisie, champs omis absents", () => {
    const op = ops.stockUpsert(clock, { cardId: 5, languageCode: "FR", quantityOwned: 2 });
    expect(op).toEqual({
      type: "stock.upsert",
      operation_id: clock.newId(),
      recorded_at: "2026-09-20T14:03:11.123+02:00",
      data: { card_id: 5, language_code: "FR", quantity_owned: 2 },
    });
    // Aucune clé `undefined` : la représentation JSON est celle qui est empreintée.
    expect(Object.keys(op.data)).toEqual(["card_id", "language_code", "quantity_owned"]);
  });

  it("distingue effacer une note (null explicite) de ne pas y toucher", () => {
    const erased = ops.stockUpsert(clock, { cardId: 1, languageCode: "EN", notes: null });
    const untouched = ops.stockUpsert(clock, { cardId: 1, languageCode: "EN" });
    expect(erased.data).toHaveProperty("notes", null);
    expect(untouched.data).not.toHaveProperty("notes");
  });

  it("deck.create porte la référence client, sans discriminant", () => {
    const op = ops.deckCreate(clock, "ref-1", { name: "Malkavien", status: "draft" });
    expect(op).toMatchObject({
      type: "deck.create",
      client_ref: "ref-1",
      data: { name: "Malkavien", status: "draft" },
    });
    expect(op.data).not.toHaveProperty("discriminator");
  });

  it("désigne un deck par id ou par référence client, jamais les deux", () => {
    expect(toDeckRef({ deckId: 12 })).toEqual({ deck_id: 12 });
    expect(toDeckRef({ clientRef: "abc" })).toEqual({ client_ref: "abc" });
    expect(toDeckRef("id:12")).toEqual({ deck_id: 12 });
    expect(toDeckRef("ref:abc")).toEqual({ client_ref: "abc" });
    expect(deckKeyOf(parseDeckKey("ref:abc"))).toBe("ref:abc");
    expect(deckKeyOf({ deckId: 3 })).toBe("id:3");
  });

  it("deck.update : l'archivage est un champ, pas une opération", () => {
    const op = ops.deckUpdate(clock, "id:4", { archived: true });
    expect(op).toMatchObject({ type: "deck.update", deck: { deck_id: 4 }, data: { archived: true } });
  });

  it("couvre les huit types d'opérations du contrat", () => {
    const all = [
      ops.stockUpsert(clock, { cardId: 1, languageCode: "EN" }),
      ops.stockDelete(clock, 1, "EN"),
      ops.deckCreate(clock, "r", { name: "d" }),
      ops.deckUpdate(clock, "ref:r", { name: "e" }),
      ops.deckDelete(clock, "ref:r"),
      ops.deckCardUpsert(clock, "ref:r", { cardId: 1, languageCode: "EN", quantity: 2 }),
      ops.deckCardDelete(clock, "ref:r", 1, "EN"),
      ops.bundleDeposit(clock, 9, "EN", 2),
    ];
    expect(all.map((op) => op.type)).toEqual([
      "stock.upsert",
      "stock.delete",
      "deck.create",
      "deck.update",
      "deck.delete",
      "deck_card.upsert",
      "deck_card.delete",
      "bundle.deposit",
    ]);
  });
});

describe("langue inconnue : repli sur XX", () => {
  const known = ["EN", "FR", "ES", "XX"];

  it("garde une langue connue, en majuscules", () => {
    expect(resolveLanguageCode("fr", known)).toBe("FR");
    expect(resolveLanguageCode("  es ", known)).toBe("ES");
  });

  it("se rabat sur XX pour une langue absente", () => {
    expect(FALLBACK_LANGUAGE).toBe("XX");
    expect(resolveLanguageCode("de", known)).toBe("XX");
    expect(resolveLanguageCode("JP", known)).toBe("XX");
  });

  it("refuse un code vide : une entrée n'est jamais sans langue", () => {
    expect(() => resolveLanguageCode("   ", known)).toThrow(RangeError);
  });

  it("dérive les langues connues de la liste miroir, du stock et de XX", async () => {
    const db = new VtesOfflineDb(freshDbName("langs"));
    try {
      // Jamais synchronisé : langues semées par le serveur.
      expect([...(await knownLanguageCodes(db))].sort()).toEqual(["EN", "ES", "FR", "XX"]);

      await db.languages.bulkPut([
        { code: "EN", label: "Anglais", sortOrder: 0 },
        { code: "DE", label: "Allemand", sortOrder: 1 },
      ]);
      expect([...(await knownLanguageCodes(db))].sort()).toEqual(["DE", "EN", "XX"]);

      // Une langue déjà en stock a forcément été acceptée par le serveur.
      await db.stock.put({
        cardId: 1,
        languageCode: "PT",
        quantityOwned: 1,
        proxyAllowed: false,
        notes: null,
        cardName: null,
        foldedName: "",
        category: null,
      });
      expect((await knownLanguageCodes(db)).has("PT")).toBe(true);
    } finally {
      db.close();
    }
  });
});
