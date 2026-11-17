import { afterEach, describe, expect, it } from "vitest";
import { DuplicateOperationError, DuplicateRefError, Outbox } from "../../../src/offline/core/outbox";
import { freshDbName, makeOp, TestDb, until, type TestOp } from "./helpers";

// Lot 9, A4 : plusieurs opérations rangées en une seule transaction de la file.

const opened: Array<{ db: TestDb; outbox: Outbox<TestOp> }> = [];
function open(name = freshDbName("enqueue-all")) {
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

describe("Outbox.enqueueAll", () => {
  it("range les opérations dans l'ordre donné, après celles déjà en file", async () => {
    const { outbox } = open();
    const before = makeOp();
    await outbox.enqueue(before);
    const batch = [makeOp({ type: "deck.create" }), makeOp(), makeOp()];

    const entries = await outbox.enqueueAll([
      { operation: batch[0], createsRef: "ref-deck" },
      { operation: batch[1] },
      { operation: batch[2] },
    ]);

    expect(entries.map((entry) => entry.rank)).toEqual([2, 3, 4]);
    expect(entries[0].clientRef).toBe("ref-deck");
    expect("clientRef" in entries[1]).toBe(false);
    const listed = await outbox.list();
    expect(listed.map((entry) => entry.operationId)).toEqual([
      before.operation_id,
      ...batch.map((op) => op.operation_id),
    ]);
    expect(listed[1].operation).toEqual(batch[0]);
    expect(listed.every((entry) => entry.state === "pending" && entry.attempts === 0)).toBe(true);
  });

  it("ne range rien si une clé est déjà en file", async () => {
    const { outbox } = open();
    const known = makeOp();
    await outbox.enqueue(known);

    await expect(
      outbox.enqueueAll([{ operation: makeOp() }, { operation: { ...known, payload: { autre: 1 } } }]),
    ).rejects.toBeInstanceOf(DuplicateOperationError);
    expect((await outbox.list()).map((entry) => entry.operationId)).toEqual([known.operation_id]);
  });

  it("ne range rien si une clé est répétée dans le lot", async () => {
    const { outbox } = open();
    const op = makeOp();
    await expect(outbox.enqueueAll([{ operation: op }, { operation: op }])).rejects.toBeInstanceOf(
      DuplicateOperationError,
    );
    expect(await outbox.list()).toEqual([]);
  });

  it("ne range rien si une référence réservée est déjà prise, en file, connue ou dans le lot", async () => {
    const { outbox, db } = open();
    await outbox.enqueue(makeOp({ type: "deck.create" }), { createsRef: "en-file" });
    await db.refs.put({ ref: "connue", id: 3, boundAt: "2026-11-14T10:00:00.000+01:00" });

    for (const taken of ["en-file", "connue"]) {
      await expect(
        outbox.enqueueAll([{ operation: makeOp() }, { operation: makeOp(), createsRef: taken }]),
      ).rejects.toBeInstanceOf(DuplicateRefError);
    }
    await expect(
      outbox.enqueueAll([
        { operation: makeOp(), createsRef: "double" },
        { operation: makeOp(), createsRef: "double" },
      ]),
    ).rejects.toBeInstanceOf(DuplicateRefError);
    expect(await outbox.counts()).toEqual({ pending: 1, sending: 0, rejected: 0 });
  });

  it("un lot vide ne fait rien et n'annonce rien", async () => {
    const { outbox } = open();
    const seen: string[] = [];
    outbox.onChange((change) => seen.push(change));
    expect(await outbox.enqueueAll([])).toEqual([]);
    expect(seen).toEqual([]);
  });

  it("annonce le lot une seule fois, dans l'onglet et aux autres onglets", async () => {
    const { name, outbox } = open();
    const other = open(name);
    const here: string[] = [];
    const there: string[] = [];
    outbox.onChange((change) => here.push(change));
    other.outbox.onChange((change) => there.push(change));

    await outbox.enqueueAll([{ operation: makeOp() }, { operation: makeOp() }, { operation: makeOp() }]);

    expect(here).toEqual(["enqueued"]);
    await until(() => there.length > 0);
    expect(there).toEqual(["updated"]);
    expect(await other.outbox.counts()).toEqual({ pending: 3, sending: 0, rejected: 0 });
  });

  it("enqueue passe par les mêmes contrôles et rend son entrée", async () => {
    const { outbox } = open();
    const op = makeOp({ type: "deck.create" });
    const entry = await outbox.enqueue(op, { createsRef: "seule" });
    expect(entry).toMatchObject({ operationId: op.operation_id, rank: 1, clientRef: "seule" });
    await expect(outbox.enqueue(makeOp(), { createsRef: "seule" })).rejects.toBeInstanceOf(DuplicateRefError);
  });
});
