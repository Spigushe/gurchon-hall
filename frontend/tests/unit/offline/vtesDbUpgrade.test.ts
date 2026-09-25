import { describe, expect, it } from "vitest";
import { CORE_STORES_V1, CORE_STORES_V2, OfflineCoreDb } from "../../../src/offline/core/db";
import { Outbox } from "../../../src/offline/core/outbox";
import { VtesOfflineDb, VTES_STORES_V1 } from "../../../src/offline/vtes/db";
import * as ops from "../../../src/offline/vtes/operations";
import type { VtesOperation } from "../../../src/offline/vtes/types";
import { freshDbName } from "./helpers";

/**
 * Montée de version du schéma VtES au Lot 4 : `stock` et `deckCards` changent
 * de clé primaire (l'extension s'y ajoute), ce qu'IndexedDB ne permet pas sans
 * supprimer puis recréer le magasin (`db.ts`, commentaire sur `VTES_STORES_V2`
 * / `VTES_STORES_V3`). D'où deux crans de version Dexie (3 puis 4) pour une
 * seule évolution de schéma — le plan de lot parle de « version 3 », mais la
 * base ouvre en réalité en version 4 ; ce test vérifie le résultat, pas le
 * numéro exact.
 *
 * Le nom de fichier reprend la formulation du plan de lot (« montée de version
 * 2 → 3 ») mais couvre la migration réelle, 2 → 4.
 */

/** Base au schéma d'avant le Lot 4 (versions 1 et 2 seulement), pour simuler un navigateur qui l'a déjà ouverte. */
class PreLot4Db extends OfflineCoreDb {
  constructor(name: string) {
    super(name);
    this.version(1).stores({ ...CORE_STORES_V1, ...VTES_STORES_V1 });
    this.version(2).stores({ ...CORE_STORES_V2 });
  }
}

describe("montée de version 2 → 4 (Lot 4 : extension dans l'identité du stock)", () => {
  it("vide stock/decks/cards/deckCards, ajoute cardSets, garde outbox et settled", async () => {
    const name = freshDbName("upgrade");

    // 1. Un navigateur qui a déjà utilisé l'appli avant le Lot 4 : schéma
    // version 2, avec des données dans tous les miroirs, une opération en
    // file et une opération tranchée en attente de rafraîchissement.
    const before = new PreLot4Db(name);
    const outbox = new Outbox<VtesOperation>(before, { retainSettled: true });
    await before.stock.put({
      cardId: 1,
      languageCode: "FR",
      quantityOwned: 2,
      proxyAllowed: false,
      notes: null,
      cardName: "Élan vital",
      foldedName: "elan vital",
      category: "library",
    });
    await before.decks.put({
      id: 1,
      name: "Malkavien",
      foldedName: "malkavien",
      discriminator: "0001",
      createdOn: null,
      status: "draft",
      archetype: null,
      notes: null,
      archivedAt: null,
    });
    await before.deckCards.put({
      deckId: 1,
      cardId: 1,
      languageCode: "FR",
      quantity: 2,
      proxyQuantity: 0,
      cardName: "Élan vital",
    });
    await before.cards.put({
      id: 1,
      veknId: 100001,
      name: "Élan vital",
      foldedName: "elan vital",
      category: "library",
      clanName: null,
      capacity: null,
      groupCode: null,
      advanced: false,
      imageUrl: null,
    });
    const clock: ops.OperationClock = {
      newId: () => "cccccccc-0000-4000-8000-000000000001",
      now: () => "2026-09-24T10:00:00.000+02:00",
    };
    const queuedEntry = await outbox.enqueue(
      ops.deckUpdate(clock, "id:1", { notes: "toujours en file" }),
    );
    // Une opération déjà tranchée, dont le miroir n'a pas encore été relu
    // (`retainSettled`, cf. README) : sa forme est celle du contrat d'avant le
    // Lot 4 (pas de `card_set_id`), puisqu'elle a été journalisée avant.
    await before.settled.add({
      operationId: "cccccccc-0000-4000-8000-000000000002",
      type: "stock.upsert",
      operation: {
        type: "stock.upsert",
        operation_id: "cccccccc-0000-4000-8000-000000000002",
        recorded_at: "2026-09-24T09:59:00.000+02:00",
        data: { card_id: 1, language_code: "FR", quantity_owned: 2 },
      } as never,
      settledAt: "2026-09-24T09:59:00.000+02:00",
    });
    const settledCountBefore = await before.settled.count();
    const outboxCountBefore = await before.outbox.count();
    expect(outboxCountBefore).toBe(1);
    outbox.close();
    before.close();

    // 2. Le même nom de base, ouvert avec le schéma courant (Lot 4).
    const after = new VtesOfflineDb(name);
    try {
      expect(after.verno).toBe(4);

      // Miroirs vidés : la clé primaire a changé (stock, deckCards), ou la
      // forme des lignes a changé (cards, decks) sans que la clé bouge.
      expect(await after.stock.count()).toBe(0);
      expect(await after.deckCards.count()).toBe(0);
      expect(await after.cards.count()).toBe(0);
      expect(await after.decks.count()).toBe(0);
      // Nouveau miroir, vide jusqu'au premier rafraîchissement.
      expect(await after.cardSets.count()).toBe(0);

      // La file et les opérations tranchées en attente survivent : elles ne
      // portent aucune extension, changer leur corps changerait l'empreinte
      // (D4, docs/lot3-sync-contrat.md).
      expect(await after.outbox.count()).toBe(outboxCountBefore);
      const survivor = await after.outbox.get(queuedEntry.operationId);
      expect(survivor?.operation).toEqual(queuedEntry.operation);
      expect(await after.settled.count()).toBe(settledCountBefore);
    } finally {
      after.close();
    }
  });
});
