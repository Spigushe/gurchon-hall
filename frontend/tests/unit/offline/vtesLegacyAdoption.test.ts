import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, describe, expect, it } from "vitest";
import { VtesOfflineDb } from "../../../src/offline/vtes/db";
import {
  LEGACY_DB_NAME,
  adoptLegacyDatabase,
  hasPendingLegacyOperations,
} from "../../../src/offline/vtes/legacy";
import * as ops from "../../../src/offline/vtes/operations";
import type { VtesOperation } from "../../../src/offline/vtes/types";
import { freshDbName } from "./helpers";

// Un identifiant distinct par appel (plusieurs opérations cohabitent dans un
// même test, parfois dans la même base) : un nouvel UUID à chaque fois, pas
// une clé constante comme dans `vtesTransport.test.ts`, qui n'en crée qu'une.
let idCounter = 0;
const clock: ops.OperationClock = {
  newId: () => {
    idCounter += 1;
    return `11111111-1111-4111-8111-${String(idCounter).padStart(12, "0")}`;
  },
  now: () => "2026-10-01T10:00:00.000+02:00",
};

afterEach(async () => {
  // Nom fixe partagé par les tests : on nettoie pour ne rien laisser fuir
  // d'un test à l'autre (le vrai code supprime déjà la base une fois adoptée,
  // ce `afterEach` couvre les tests qui ne vont pas jusque-là).
  await Dexie.delete(LEGACY_DB_NAME);
});

async function seedLegacy(opsToEnqueue: VtesOperation[]) {
  const legacy = new VtesOfflineDb(LEGACY_DB_NAME);
  for (const operation of opsToEnqueue) {
    await legacy.outbox.add({
      operationId: operation.operation_id,
      rank: (await legacy.outbox.count()) + 1,
      type: operation.type,
      state: "pending",
      operation,
      recordedAt: operation.recorded_at,
      attempts: 0,
    });
  }
  legacy.close();
}

describe("hasPendingLegacyOperations", () => {
  it("rend false quand aucune base historique n'existe", async () => {
    expect(await hasPendingLegacyOperations()).toBe(false);
  });

  it("rend false quand la base existe mais que sa file est vide", async () => {
    const legacy = new VtesOfflineDb(LEGACY_DB_NAME);
    await legacy.languages.put({ code: "EN", label: "Anglais", sortOrder: 0 }); // base « existe » sans file
    legacy.close();
    expect(await hasPendingLegacyOperations()).toBe(false);
  });

  it("rend true quand la base historique a des opérations en attente", async () => {
    await seedLegacy([ops.stockUpsert(clock, { cardId: 1, languageCode: "EN", cardSetId: 1 })]);
    expect(await hasPendingLegacyOperations()).toBe(true);
  });
});

describe("adoptLegacyDatabase", () => {
  it("ne fait rien si aucune base historique n'existe", async () => {
    const target = freshDbName("target");
    const result = await adoptLegacyDatabase(target);
    expect(result).toEqual({ adopted: false, operations: 0 });
    expect(await Dexie.exists(target)).toBe(false);
  });

  it("ne fait rien si la base historique existe mais que sa file est vide", async () => {
    const legacy = new VtesOfflineDb(LEGACY_DB_NAME);
    await legacy.languages.put({ code: "EN", label: "Anglais", sortOrder: 0 });
    legacy.close();

    const target = freshDbName("target");
    const result = await adoptLegacyDatabase(target);
    expect(result).toEqual({ adopted: false, operations: 0 });
    expect(await Dexie.exists(LEGACY_DB_NAME)).toBe(true); // pas supprimée : rien à adopter
  });

  it("recopie la file sans modification (mêmes clés, mêmes corps) puis supprime l'ancienne base", async () => {
    const opA = ops.stockUpsert(clock, { cardId: 1, languageCode: "EN", cardSetId: 1, quantityOwned: 3 });
    const opB = ops.deckCreate(clock, "ref-1", { name: "Malkavien" });
    await seedLegacy([opA, opB]);

    const targetDbName = freshDbName("target");
    const result = await adoptLegacyDatabase(targetDbName);
    expect(result).toEqual({ adopted: true, operations: 2 });
    expect(await Dexie.exists(LEGACY_DB_NAME)).toBe(false); // ancienne base supprimée

    const target = new VtesOfflineDb(targetDbName);
    try {
      const rows = await target.outbox.orderBy("rank").toArray();
      expect(rows.map((row) => row.operationId)).toEqual([opA.operation_id, opB.operation_id]);
      // « Sans modification » : même opération, octet pour octet (même empreinte d'idempotence).
      expect(rows.map((row) => row.operation)).toEqual([opA, opB]);
      expect(rows.every((row) => row.state === "pending")).toBe(true);
      expect(rows[1].clientRef).toBeUndefined(); // seedLegacy n'a pas posé de référence
    } finally {
      target.close();
    }
  });

  it("recopie settled et les correspondances client_ref", async () => {
    const legacy = new VtesOfflineDb(LEGACY_DB_NAME);
    const op = ops.deckCreate(clock, "ref-1", { name: "Ventrue" });
    // Une opération encore en file (sinon rien à adopter), plus un état
    // "settled"/"refs" réaliste issu d'un verdict déjà tranché par ailleurs.
    await legacy.outbox.add({
      operationId: op.operation_id,
      rank: 1,
      type: op.type,
      state: "pending",
      operation: op,
      recordedAt: op.recorded_at,
      attempts: 0,
    });
    const settledOp = ops.stockUpsert(clock, { cardId: 2, languageCode: "FR", cardSetId: 1 });
    await legacy.settled.add({
      operationId: settledOp.operation_id,
      type: settledOp.type,
      operation: settledOp,
      settledAt: "2026-10-01T09:00:00.000Z",
    });
    await legacy.refs.put({ ref: "ref-1", id: 42, boundAt: "2026-10-01T09:00:00.000Z" });
    legacy.close();

    const targetDbName = freshDbName("target");
    await adoptLegacyDatabase(targetDbName);

    const target = new VtesOfflineDb(targetDbName);
    try {
      expect((await target.refs.get("ref-1"))?.id).toBe(42);
      const settledRows = await target.settled.toArray();
      expect(settledRows).toHaveLength(1);
      expect(settledRows[0].operationId).toBe(settledOp.operation_id);
      expect(settledRows[0].operation).toEqual(settledOp); // contenu inchangé
    } finally {
      target.close();
    }
  });

  it("ajoute à la suite d'une file déjà présente dans la base cible, sans réordonner ni écraser", async () => {
    const targetDbName = freshDbName("target");
    const target = new VtesOfflineDb(targetDbName);
    const already = ops.stockUpsert(clock, { cardId: 9, languageCode: "EN", cardSetId: 1 });
    await target.outbox.add({
      operationId: already.operation_id,
      rank: 1,
      type: already.type,
      state: "pending",
      operation: already,
      recordedAt: already.recorded_at,
      attempts: 0,
    });
    target.close();

    const adopted = ops.stockUpsert(clock, { cardId: 10, languageCode: "EN", cardSetId: 1 });
    await seedLegacy([adopted]);
    await adoptLegacyDatabase(targetDbName);

    const reopened = new VtesOfflineDb(targetDbName);
    try {
      const rows = await reopened.outbox.orderBy("rank").toArray();
      expect(rows.map((row) => row.operationId)).toEqual([already.operation_id, adopted.operation_id]);
      expect(rows[0].rank).toBeLessThan(rows[1].rank); // ordre conservé, pas de collision de rang
    } finally {
      reopened.close();
    }
  });
});
