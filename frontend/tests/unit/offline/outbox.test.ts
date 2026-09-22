import { afterEach, describe, expect, it } from "vitest";
import {
  DuplicateOperationError,
  DuplicateRefError,
  NotRejectedError,
  Outbox,
} from "../../../src/offline/core/outbox";
import { lastSettledSeq, pruneSettled, readSettled } from "../../../src/offline/core/settled";
import { applied, freshDbName, makeOp, rejected, TestDb, type TestOp } from "./helpers";

const opened: Array<{ db: TestDb; outbox: Outbox<TestOp> }> = [];
function open(name = freshDbName("outbox")) {
  const db = new TestDb(name);
  const outbox = new Outbox<TestOp>(db);
  opened.push({ db, outbox });
  return { name, db, outbox };
}

afterEach(() => {
  for (const { db, outbox } of opened.splice(0)) {
    outbox.close();
    db.close();
  }
});

describe("Outbox : saisie", () => {
  it("range les opérations dans l'ordre, telles quelles, sous leur clé d'origine", async () => {
    const { outbox } = open();
    const a = makeOp();
    const b = makeOp();
    const c = makeOp();
    for (const op of [a, b, c]) await outbox.enqueue(op);

    const entries = await outbox.list();
    expect(entries.map((entry) => entry.operationId)).toEqual([
      a.operation_id,
      b.operation_id,
      c.operation_id,
    ]);
    expect(entries.map((entry) => entry.rank)).toEqual([1, 2, 3]);
    expect(entries[0].operation).toEqual(a);
    expect(entries.every((entry) => entry.state === "pending")).toBe(true);
    expect(entries[0].recordedAt).toBe(a.recorded_at);
  });

  it("refuse de réutiliser une clé d'idempotence", async () => {
    const { outbox } = open();
    const op = makeOp();
    await outbox.enqueue(op);
    await expect(outbox.enqueue({ ...op, payload: { autre: 1 } })).rejects.toBeInstanceOf(
      DuplicateOperationError,
    );
    // L'opération d'origine n'a pas bougé.
    expect((await outbox.get(op.operation_id))?.operation).toEqual(op);
  });

  it("refuse de réutiliser une référence client, en file ou déjà connue", async () => {
    const { outbox, db } = open();
    await outbox.enqueue(makeOp({ type: "deck.create" }), { createsRef: "ref-1" });
    await expect(
      outbox.enqueue(makeOp({ type: "deck.create" }), { createsRef: "ref-1" }),
    ).rejects.toBeInstanceOf(DuplicateRefError);

    await db.refs.put({ ref: "ref-2", id: 7, boundAt: "2026-09-20T10:00:00.000+02:00" });
    await expect(
      outbox.enqueue(makeOp({ type: "deck.create" }), { createsRef: "ref-2" }),
    ).rejects.toBeInstanceOf(DuplicateRefError);
    expect(await outbox.counts()).toEqual({ pending: 1, sending: 0, rejected: 0 });
  });

  it("ne rend la main qu'après l'écriture IndexedDB, sans réseau", async () => {
    const { outbox, db } = open();
    const op = makeOp();
    await outbox.enqueue(op);
    expect(await db.outbox.get(op.operation_id)).toBeDefined();
  });
});

describe("Outbox : persistance", () => {
  it("retrouve file, clés, rang et références après réouverture de la base", async () => {
    const first = open();
    const a = makeOp();
    const b = makeOp({ type: "deck.create" });
    await first.outbox.enqueue(a);
    await first.outbox.enqueue(b, { createsRef: "ref-x" });
    await first.outbox.markSending([a.operation_id]);
    await first.outbox.settle([
      {
        operationId: b.operation_id,
        outcome: "applied",
        error: null,
        refs: [{ ref: "ref-x", id: 12 }],
      },
    ]);
    first.outbox.close();
    first.db.close();

    // « Rechargement » : nouvelle instance, même base.
    const second = open(first.name);
    const entries = await second.outbox.list();
    expect(entries).toHaveLength(1);
    expect(entries[0].operationId).toBe(a.operation_id);
    expect(entries[0].operation).toEqual(a);
    expect(entries[0].state).toBe("sending"); // l'issue de l'envoi reste inconnue
    expect(entries[0].attempts).toBe(1);
    expect(await second.db.refs.get("ref-x")).toMatchObject({ ref: "ref-x", id: 12 });

    // La clé ne change jamais : elle est toujours la même après remise en attente.
    expect(await second.outbox.releaseSending()).toBe(1);
    const after = await second.outbox.list();
    expect(after[0].operationId).toBe(a.operation_id);
    expect(after[0].state).toBe("pending");
  });

  it("garde l'ordre relatif des saisies après un vidage de la file", async () => {
    const { outbox } = open();
    const a = makeOp();
    await outbox.enqueue(a);
    await outbox.settle([applied(a)]);
    const first = await outbox.enqueue(makeOp());
    const second = await outbox.enqueue(makeOp());
    expect(second.rank).toBeGreaterThan(first.rank);
  });
});

describe("Outbox : verdicts", () => {
  it("un applied ou un replayed sort de la file et mémorise les références", async () => {
    const { outbox, db } = open();
    const a = makeOp();
    const b = makeOp();
    await outbox.enqueue(a);
    await outbox.enqueue(b);
    const tally = await outbox.settle([
      { ...applied(a), refs: [{ ref: "r", id: 3 }] },
      { ...applied(b), outcome: "replayed" },
    ]);
    expect(tally).toEqual({ applied: 1, replayed: 1, rejected: 0 });
    expect(await outbox.list()).toEqual([]);
    expect((await db.refs.get("r"))?.id).toBe(3);
  });

  it("un rejected reste, avec son motif, et ne se rejoue pas tel quel", async () => {
    const { outbox } = open();
    const a = makeOp();
    await outbox.enqueue(a);
    await outbox.markSending([a.operation_id]);
    await outbox.settle([rejected(a, "conflict", "exemplaires insuffisants")]);

    const entry = (await outbox.list("rejected"))[0];
    expect(entry.rejection).toEqual({
      code: "conflict",
      message: "exemplaires insuffisants",
      replayed: false,
    });
    expect(await outbox.nextPending(10)).toEqual([]);
    expect(await outbox.counts()).toEqual({ pending: 0, sending: 0, rejected: 1 });
  });

  it("un replayed porteur d'une erreur est un refus mémorisé", async () => {
    const { outbox } = open();
    const a = makeOp();
    await outbox.enqueue(a);
    await outbox.settle([{ ...rejected(a, "not_found", "deck inconnu"), outcome: "replayed" }]);
    const entry = (await outbox.list("rejected"))[0];
    expect(entry.rejection).toMatchObject({ code: "not_found", replayed: true });
  });

  it("ignore un verdict pour une opération qui n'est plus en file", async () => {
    const { outbox } = open();
    expect(await outbox.settle([applied(makeOp())])).toEqual({
      applied: 0,
      replayed: 0,
      rejected: 0,
    });
  });
});

describe("Outbox : correction d'un refus", () => {
  it("réémet sous une NOUVELLE clé, à la même place, sans toucher à l'ancienne charge utile", async () => {
    const { outbox } = open();
    const a = makeOp({ payload: { quantity: 9 } });
    const b = makeOp();
    await outbox.enqueue(a);
    await outbox.enqueue(b);
    await outbox.settle([rejected(a)]);

    const fixed = await outbox.reissue(a.operation_id, (op) => ({
      ...op,
      payload: { quantity: 2 },
    }));
    expect(fixed.operationId).not.toBe(a.operation_id);
    expect(fixed.operation.operation_id).toBe(fixed.operationId);
    expect(fixed.operation.payload).toEqual({ quantity: 2 });
    expect(fixed.reissuedFrom).toBe(a.operation_id);
    expect(fixed.state).toBe("pending");

    const entries = await outbox.list();
    expect(entries.map((entry) => entry.operationId)).toEqual([fixed.operationId, b.operation_id]);
    expect(await outbox.get(a.operation_id)).toBeUndefined();
  });

  it("garde la référence client d'une création refusée", async () => {
    const { outbox } = open();
    const create = makeOp({ type: "deck.create" });
    await outbox.enqueue(create, { createsRef: "ref-9" });
    await outbox.settle([rejected(create, "invalid")]);
    const fixed = await outbox.reissue(create.operation_id);
    expect(fixed.clientRef).toBe("ref-9");
  });

  it("refuse de corriger ce qui n'est pas refusé (une opération en file ne se modifie pas)", async () => {
    const { outbox } = open();
    const a = makeOp();
    await outbox.enqueue(a);
    await expect(outbox.reissue(a.operation_id)).rejects.toBeInstanceOf(NotRejectedError);
    await expect(outbox.reissue("inconnue")).rejects.toBeInstanceOf(NotRejectedError);
    await expect(outbox.discard(a.operation_id)).rejects.toBeInstanceOf(NotRejectedError);
  });

  it("permet d'abandonner un refus", async () => {
    const { outbox } = open();
    const a = makeOp();
    await outbox.enqueue(a);
    await outbox.settle([rejected(a)]);
    await outbox.discard(a.operation_id);
    expect(await outbox.list()).toEqual([]);
  });
});

describe("Outbox : notifications", () => {
  it("annonce les saisies et les changements", async () => {
    const { outbox } = open();
    const seen: string[] = [];
    outbox.onChange((change) => seen.push(change));
    const a = makeOp();
    await outbox.enqueue(a);
    await outbox.markSending([a.operation_id]);
    expect(seen).toEqual(["enqueued", "updated"]);
  });
});

describe("Outbox : opérations tranchées retenues", () => {
  it("garde une opération tranchée jusqu'à ce qu'un rafraîchissement la reprenne", async () => {
    const { db } = open();
    const outbox = new Outbox<TestOp>(db, { retainSettled: true });
    opened.push({ db, outbox });
    const [a, b, c] = [makeOp(), makeOp({ type: "other.upsert" }), makeOp()];
    for (const op of [a, b, c]) await outbox.enqueue(op);

    await outbox.settle([applied(a), applied(b), rejected(c)]);
    expect(await outbox.list()).toMatchObject([{ operationId: c.operation_id, state: "rejected" }]);
    // Tranchées : retenues dans l'ordre du verdict ; refusée : jamais retenue.
    expect((await readSettled(db)).map((entry) => entry.operationId)).toEqual([a.operation_id, b.operation_id]);
    expect(await lastSettledSeq(db)).toBe(2);

    // Le curseur borne l'effacement, le domaine le filtre.
    await pruneSettled(db, 2, (type) => type === "other.upsert");
    expect((await readSettled(db)).map((entry) => entry.operationId)).toEqual([a.operation_id]);
    await pruneSettled(db, 0);
    expect(await readSettled(db)).toHaveLength(1);
    await pruneSettled(db, 2);
    expect(await readSettled(db)).toEqual([]);
  });

  it("ne retient rien par défaut", async () => {
    const { db, outbox } = open();
    const op = makeOp();
    await outbox.enqueue(op);
    await outbox.settle([applied(op)]);
    expect(await db.settled.count()).toBe(0);
  });
});
