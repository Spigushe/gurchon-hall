import { afterEach, describe, expect, it } from "vitest";
import { Outbox } from "../../../src/offline/core/outbox";
import { freshDbName, makeOp, rejected, TestDb, type TestOp } from "./helpers";

const opened: Array<{ db: TestDb; outbox: Outbox<TestOp> }> = [];
function open() {
  const db = new TestDb(freshDbName("reissue-end"));
  const outbox = new Outbox<TestOp>(db);
  opened.push({ db, outbox });
  return { db, outbox };
}
afterEach(() => {
  for (const { db, outbox } of opened.splice(0)) {
    outbox.close();
    db.close();
  }
});

describe("Outbox.reissue avec une position", () => {
  it("`same` (défaut) reprend la place de l'opération refusée", async () => {
    const { outbox } = open();
    const [a, b, c] = [makeOp(), makeOp(), makeOp()];
    for (const op of [a, b, c]) await outbox.enqueue(op);
    await outbox.settle([rejected(a)]);
    const fixed = await outbox.reissue(a.operation_id, undefined, { position: "same" });
    expect((await outbox.list()).map((e) => e.operationId)).toEqual([
      fixed.operationId,
      b.operation_id,
      c.operation_id,
    ]);
    expect(fixed.rank).toBe(1);
  });

  it("`end` range la correction après tout ce qui est en file, sans réordonner le reste", async () => {
    const { outbox } = open();
    const [a, b, c] = [makeOp(), makeOp(), makeOp()];
    for (const op of [a, b, c]) await outbox.enqueue(op);
    await outbox.settle([rejected(a)]);
    const fixed = await outbox.reissue(a.operation_id, undefined, { position: "end" });
    expect((await outbox.list()).map((e) => e.operationId)).toEqual([
      b.operation_id,
      c.operation_id,
      fixed.operationId,
    ]);
    expect(fixed.rank).toBe(4);
    expect(fixed.reissuedFrom).toBe(a.operation_id);
    expect(await outbox.get(a.operation_id)).toBeUndefined();
  });

  it("`end` seul dans la file : rang 1, et la référence client est gardée", async () => {
    const { outbox } = open();
    const create = makeOp({ type: "x.create" });
    await outbox.enqueue(create, { createsRef: "ref-1" });
    await outbox.settle([rejected(create, "invalid")]);
    const fixed = await outbox.reissue(create.operation_id, undefined, { position: "end" });
    expect(fixed.rank).toBe(1);
    expect(fixed.clientRef).toBe("ref-1");
  });

  it("range le genre de la correspondance au verdict, sans genre quand il est absent", async () => {
    const { db, outbox } = open();
    const [a, b] = [makeOp(), makeOp()];
    await outbox.enqueue(a, { createsRef: "r-a" });
    await outbox.enqueue(b, { createsRef: "r-b" });
    await outbox.settle([
      { operationId: a.operation_id, outcome: "applied", error: null, refs: [{ ref: "r-a", id: 12 }] },
      {
        operationId: b.operation_id,
        outcome: "applied",
        error: null,
        refs: [{ ref: "r-b", id: 12, kind: "player" }],
      },
    ]);
    const rows = await db.refs.toArray();
    expect(rows.find((r) => r.ref === "r-a")).not.toHaveProperty("kind");
    expect(rows.find((r) => r.ref === "r-b")?.kind).toBe("player");
  });
});
