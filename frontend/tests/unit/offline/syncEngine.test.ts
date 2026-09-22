import { afterEach, describe, expect, it, vi } from "vitest";
import { Outbox } from "../../../src/offline/core/outbox";
import { SyncEngine } from "../../../src/offline/core/syncEngine";
import type { SyncVerdict } from "../../../src/offline/core/types";
import {
  applied,
  FakeTransport,
  freshDbName,
  makeOp,
  manualTimers,
  rejected,
  TestDb,
  until,
  within,
  type TestOp,
} from "./helpers";

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.restoreAllMocks();
});

const allApplied = (operations: TestOp[]) => ({
  status: "ok" as const,
  verdicts: operations.map(applied),
});

function setup(
  responder: ConstructorParameters<typeof FakeTransport<TestOp>>[0],
  options: {
    name?: string;
    online?: boolean;
    maxBatchSize?: number;
    onFlushed?: () => void;
    lockName?: string | null;
  } = {},
) {
  const db = new TestDb(options.name ?? freshDbName("engine"));
  const outbox = new Outbox<TestOp>(db);
  const transport = new FakeTransport<TestOp>(responder);
  const clock = manualTimers();
  const state = { online: options.online ?? true };
  const engine = new SyncEngine<TestOp>({
    outbox,
    transport,
    maxBatchSize: options.maxBatchSize,
    isOnline: () => state.online,
    lockName: options.lockName === undefined ? null : options.lockName,
    backoff: { jitter: 0 },
    timers: clock.timers,
    onFlushed: options.onFlushed,
  });
  cleanups.push(async () => {
    engine.stop();
    await engine.whenIdle();
    outbox.close();
    db.close();
  });
  return { db, outbox, transport, engine, clock, state };
}

async function enqueueMany(outbox: Outbox<TestOp>, count: number) {
  const ops: TestOp[] = [];
  for (let i = 0; i < count; i++) {
    const op = makeOp();
    ops.push(op);
    await outbox.enqueue(op);
  }
  return ops;
}

describe("SyncEngine : rejeu", () => {
  it("envoie la file dans l'ordre de saisie et tranche les opérations appliquées", async () => {
    const { outbox, transport, engine } = setup((ops) => allApplied(ops));
    const ops = await enqueueMany(outbox, 3);

    const summary = await engine.flush();

    expect(summary).toMatchObject({ result: "drained", sent: 3, applied: 3, rejected: 0 });
    expect(transport.calls).toHaveLength(1);
    expect(transport.calls[0].map((op) => op.operation_id)).toEqual(
      ops.map((op) => op.operation_id),
    );
    expect(await outbox.list()).toEqual([]);
    expect(engine.getStatus()).toMatchObject({ pending: 0, rejected: 0, lastError: null });
    expect(engine.getStatus().lastSuccessAt).not.toBeNull();
  });

  it("découpe la file en lots sans la réordonner", async () => {
    const { outbox, transport, engine } = setup((ops) => allApplied(ops), { maxBatchSize: 5 });
    const ops = await enqueueMany(outbox, 12);

    await engine.flush();

    expect(transport.calls.map((call) => call.length)).toEqual([5, 5, 2]);
    expect(transport.calls.flat().map((op) => op.operation_id)).toEqual(
      ops.map((op) => op.operation_id),
    );
    expect(await outbox.list()).toEqual([]);
  });

  it("ne fait aucun appel quand la file est vide", async () => {
    const { transport, engine } = setup((ops) => allApplied(ops));
    expect(await engine.flush()).toMatchObject({ result: "drained", sent: 0 });
    expect(transport.calls).toEqual([]);
  });

  it("traite replayed comme applied : l'opération sort de la file", async () => {
    const { outbox, engine } = setup((ops) => ({
      status: "ok",
      verdicts: ops.map((op) => ({ ...applied(op), outcome: "replayed" as const })),
    }));
    await enqueueMany(outbox, 2);
    expect(await engine.flush()).toMatchObject({ replayed: 2, applied: 0 });
    expect(await outbox.list()).toEqual([]);
  });

  it("mémorise les références client renvoyées, au-delà du redémarrage", async () => {
    const name = freshDbName("engine-refs");
    const first = setup(
      (ops) => ({
        status: "ok",
        verdicts: ops.map((op) => ({ ...applied(op), refs: [{ ref: "ref-1", id: 42 }] })),
      }),
      { name },
    );
    await first.outbox.enqueue(makeOp({ type: "deck.create" }), { createsRef: "ref-1" });
    await first.engine.flush();
    first.engine.stop();
    first.outbox.close();
    first.db.close();

    const reopened = new TestDb(name);
    cleanups.push(() => reopened.close());
    expect((await reopened.refs.get("ref-1"))?.id).toBe(42);
  });
});

describe("SyncEngine : idempotence des clés", () => {
  it("rejoue sous les MÊMES clés et la même charge utile après un échec réseau", async () => {
    const { outbox, transport, engine } = setup((ops, call) =>
      call === 1 ? { status: "unavailable", message: "réseau coupé" } : allApplied(ops),
    );
    const ops = await enqueueMany(outbox, 2);
    const before = structuredClone(await outbox.list());

    const first = await engine.flush();
    expect(first.result).toBe("retry");
    // Rien n'est perdu : tout est revenu en attente, intact.
    const afterFailure = await outbox.list();
    expect(afterFailure.map((entry) => entry.state)).toEqual(["pending", "pending"]);
    expect(afterFailure.map((entry) => entry.operation)).toEqual(
      before.map((entry) => entry.operation),
    );

    await engine.flush();
    expect(transport.calls[1]).toEqual(transport.calls[0]);
    expect(transport.calls[1].map((op) => op.operation_id)).toEqual(
      ops.map((op) => op.operation_id),
    );
    expect(await outbox.list()).toEqual([]);
  });

  it("après un redémarrage en plein envoi, rejoue la même clé", async () => {
    const name = freshDbName("engine-restart");
    let abandon!: () => void;
    const first = setup(
      () =>
        new Promise((resolve) => {
          // Le réseau ne répond jamais tant que le test n'a pas fini.
          abandon = () => resolve({ status: "unavailable", message: "onglet fermé" });
        }),
      { name },
    );
    const [op] = await enqueueMany(first.outbox, 1);
    void first.engine.flush();
    await until(async () => (await first.outbox.list())[0]?.state === "sending");
    first.outbox.close();
    first.db.close(); // « fermeture de l'onglet »

    const second = setup((ops) => allApplied(ops), { name });
    await second.engine.flush();
    expect(second.transport.calls[0].map((o) => o.operation_id)).toEqual([op.operation_id]);
    expect(await second.outbox.list()).toEqual([]);
    abandon(); // libère l'ancien onglet, dont la base est fermée : il abandonne sans bruit
  });
});

describe("SyncEngine : refus", () => {
  it("garde un rejected exposé, continue le lot, et ne le rejoue pas tel quel", async () => {
    const { outbox, transport, engine } = setup((ops) => ({
      status: "ok",
      verdicts: ops.map((op, index) =>
        index === 1 ? rejected(op, "conflict", "exemplaires insuffisants") : applied(op),
      ),
    }));
    const [a, b, c] = await enqueueMany(outbox, 3);

    const summary = await engine.flush();
    expect(summary).toMatchObject({ applied: 2, rejected: 1 });
    expect(engine.getStatus()).toMatchObject({ pending: 0, rejected: 1 });

    const stuck = await outbox.list();
    expect(stuck.map((entry) => entry.operationId)).toEqual([b.operation_id]);
    expect(stuck[0].rejection).toMatchObject({ code: "conflict", message: "exemplaires insuffisants" });
    expect([a, c]).toHaveLength(2);

    // Un second rejeu n'envoie rien : la même clé rendrait éternellement le même refus.
    await engine.flush();
    expect(transport.calls).toHaveLength(1);
  });

  it("une correction part sous une nouvelle clé et aboutit", async () => {
    const seenIds: string[] = [];
    const { outbox, engine } = setup((ops, call) => {
      seenIds.push(...ops.map((op) => op.operation_id));
      return call === 1
        ? { status: "ok", verdicts: ops.map((op) => rejected(op)) }
        : allApplied(ops);
    });
    const [a] = await enqueueMany(outbox, 1);
    await engine.flush();

    const fixed = await outbox.reissue(a.operation_id, (op) => ({ ...op, payload: { fixed: true } }));
    await engine.flush();

    expect(seenIds).toEqual([a.operation_id, fixed.operationId]);
    expect(seenIds[0]).not.toBe(seenIds[1]);
    expect(await outbox.list()).toEqual([]);
  });

  it("un replayed porteur d'une erreur devient un refus", async () => {
    const { outbox, engine } = setup((ops) => ({
      status: "ok",
      verdicts: ops.map((op): SyncVerdict => ({ ...rejected(op), outcome: "replayed" })),
    }));
    await enqueueMany(outbox, 1);
    await engine.flush();
    expect((await outbox.list("rejected"))[0].rejection?.replayed).toBe(true);
  });
});

describe("SyncEngine : 422", () => {
  it("isole l'opération mal formée sans bloquer les autres (bissection)", async () => {
    const { outbox, transport, engine } = setup((ops) =>
      ops.some((op) => op.payload?.bad)
        ? { status: "invalid", message: "quantity : valeur négative" }
        : allApplied(ops),
    );
    const ops = await enqueueMany(outbox, 4);
    // Remplace la troisième par une opération mal formée (avant tout envoi).
    await outbox.settle([applied(ops[2])]);
    const bad = makeOp({ payload: { bad: true } });
    await outbox.enqueue(bad);
    const tail = makeOp();
    await outbox.enqueue(tail);

    const summary = await engine.flush();

    expect(summary).toMatchObject({ result: "drained", rejected: 1 });
    const left = await outbox.list();
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({ operationId: bad.operation_id, state: "rejected" });
    expect(left[0].rejection).toMatchObject({
      code: "invalid_request",
      message: "quantity : valeur négative",
    });
    // Toutes les autres sont passées : pas de file bloquée par une seule opération.
    const sentIds = new Set(transport.calls.flat().map((op) => op.operation_id));
    expect(sentIds.has(tail.operation_id)).toBe(true);
  });

  it("refuse localement une opération seule que le serveur juge invalide", async () => {
    const { outbox, engine } = setup(() => ({ status: "invalid", message: "lot mal formé" }));
    await enqueueMany(outbox, 1);
    await engine.flush();
    expect((await outbox.list("rejected"))[0].rejection?.code).toBe("invalid_request");
  });
});

describe("SyncEngine : échecs de transport", () => {
  it("attend avec un backoff exponentiel plafonné, sans rien perdre", async () => {
    const { outbox, engine, clock } = setup(() => ({
      status: "unavailable",
      message: "Bad Gateway",
      httpStatus: 502,
    }));
    await enqueueMany(outbox, 1);
    engine.start();
    await engine.whenIdle();

    const delays: number[] = [];
    for (let i = 0; i < 9; i++) {
      await until(() => clock.active().length > 0);
      delays.push(clock.active()[0].delayMs);
      clock.fireLast();
      await until(() => engine.getStatus().failures === i + 2);
      await engine.whenIdle();
    }

    expect(delays).toEqual([1000, 2000, 4000, 8000, 16000, 32000, 60000, 60000, 60000]);
    expect(engine.getStatus().lastError).toContain("Bad Gateway");
    expect(engine.getStatus().lastError).toContain("502");
    expect(engine.getStatus().nextRetryAt).not.toBeNull();
    expect(await outbox.counts()).toMatchObject({ pending: 1, rejected: 0 });
  });

  it("respecte un Retry-After plus long que le backoff, jamais plus court", async () => {
    let retryAfterMs = 5000;
    const { outbox, engine, clock } = setup(() => ({
      status: "unavailable",
      message: "écriture en cours",
      httpStatus: 503,
      retryAfterMs,
    }));
    await enqueueMany(outbox, 1);
    engine.start(); // les nouveaux essais ne se programment que moteur démarré
    await until(() => clock.active().length > 0);
    await engine.whenIdle();
    expect(clock.active()[0].delayMs).toBe(5000); // backoff de 1 s, serveur à 5 s
    retryAfterMs = 100;
    clock.fireLast();
    await until(() => engine.getStatus().failures === 2);
    await engine.whenIdle();
    expect(clock.active()[0].delayMs).toBe(2000); // backoff de 2 s, serveur à 0,1 s
  });

  it("un succès remet le compteur d'échecs à zéro", async () => {
    let fail = true;
    const { outbox, engine } = setup((ops) =>
      fail ? { status: "unavailable", message: "hors service" } : allApplied(ops),
    );
    await enqueueMany(outbox, 1);
    await engine.flush();
    expect(engine.getStatus().failures).toBe(1);
    fail = false;
    await engine.flush();
    expect(engine.getStatus()).toMatchObject({ failures: 0, lastError: null, pending: 0 });
  });

  it("traite un transport qui lève comme une indisponibilité", async () => {
    const { outbox, engine } = setup(() => {
      throw new Error("boom");
    });
    await enqueueMany(outbox, 1);
    expect((await engine.flush()).result).toBe("retry");
    expect(engine.getStatus().lastError).toBe("boom");
    expect(await outbox.counts()).toMatchObject({ pending: 1 });
  });

  it("garde en attente ce qui n'a pas reçu de verdict", async () => {
    const { outbox, engine } = setup((ops) => ({
      status: "ok",
      verdicts: [applied(ops[0])],
    }));
    const [, b] = await enqueueMany(outbox, 2);
    expect((await engine.flush()).result).toBe("retry");
    const left = await outbox.list();
    expect(left.map((entry) => entry.operationId)).toEqual([b.operation_id]);
    expect(left[0].state).toBe("pending");
  });
});

describe("SyncEngine : jamais deux envois concurrents", () => {
  it("fusionne des flush() simultanés", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { outbox, transport, engine } = setup(async (ops) => {
      await gate;
      return allApplied(ops);
    });
    await enqueueMany(outbox, 2);

    const first = engine.flush();
    const second = engine.flush();
    const third = engine.flush();
    await until(() => transport.calls.length === 1);
    release();
    await Promise.all([first, second, third]);

    expect(transport.maxInFlight).toBe(1);
    expect(transport.calls).toHaveLength(1);
  });

  it("reprend ce qui a été saisi pendant un envoi, sans envoi parallèle", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { outbox, transport, engine } = setup(async (ops, call) => {
      if (call === 1) await gate;
      return allApplied(ops);
    });
    const [a] = await enqueueMany(outbox, 1);
    const running = engine.flush();
    await until(() => transport.calls.length === 1);

    const late = makeOp();
    await outbox.enqueue(late);
    void engine.flush(); // demandé pendant l'envoi
    release();
    await running;

    expect(transport.maxInFlight).toBe(1);
    expect(transport.calls.map((call) => call.map((op) => op.operation_id))).toEqual([
      [a.operation_id],
      [late.operation_id],
    ]);
    expect(await outbox.list()).toEqual([]);
  });

  it("cède au verrou d'un autre onglet, puis réessaie", async () => {
    // Web Locks factice : verrou déjà pris ailleurs.
    const request = vi.fn(
      async (_name: string, _options: unknown, callback: (lock: unknown) => Promise<unknown>) =>
        callback(null),
    );
    vi.stubGlobal("navigator", { onLine: true, locks: { request } });
    cleanups.push(() => vi.unstubAllGlobals());

    const { outbox, transport, engine, clock } = setup((ops) => allApplied(ops), {
      lockName: "test-lock",
    });
    await enqueueMany(outbox, 1);
    engine.start();
    const summary = await engine.flush();

    expect(summary.result).toBe("locked");
    expect(transport.calls).toEqual([]);
    expect(request).toHaveBeenCalledWith("test-lock", { ifAvailable: true }, expect.any(Function));
    // Une saisie ne doit pas rester coincée : un nouvel essai est programmé.
    expect(clock.active().length).toBeGreaterThan(0);
  });
});

describe("SyncEngine : déclencheurs", () => {
  it("reprend la file au démarrage", async () => {
    const name = freshDbName("engine-boot");
    const first = setup((ops) => allApplied(ops), { name, online: false });
    await enqueueMany(first.outbox, 2); // saisie hors ligne
    first.outbox.close();
    first.db.close();

    const second = setup((ops) => allApplied(ops), { name });
    second.engine.start();
    await until(async () => (await second.outbox.list()).length === 0);
    expect(second.transport.calls).toHaveLength(1);
  });

  it("n'envoie rien tant qu'on est hors ligne, puis part à l'événement online", async () => {
    const { outbox, transport, engine, state } = setup((ops) => allApplied(ops), {
      online: false,
    });
    engine.start();
    await enqueueMany(outbox, 1);
    await engine.refreshCounts();
    expect(engine.getStatus()).toMatchObject({ online: false, pending: 1 });
    expect(transport.calls).toEqual([]);

    state.online = true;
    window.dispatchEvent(new Event("online"));
    await until(async () => (await outbox.list()).length === 0);

    expect(transport.calls).toHaveLength(1);
    expect(engine.getStatus().online).toBe(true);
  });

  it("part dès la saisie quand on est en ligne", async () => {
    const { outbox, transport, engine } = setup((ops) => allApplied(ops));
    engine.start();
    await outbox.enqueue(makeOp());
    await until(async () => (await outbox.list()).length === 0);
    expect(transport.calls).toHaveLength(1);
  });

  it("reprend au retour au premier plan", async () => {
    const { outbox, transport, engine } = setup((ops) => allApplied(ops));
    engine.start();
    await engine.whenIdle();
    // Saisie faite pendant que l'appli était en arrière-plan, envoi manqué.
    await outbox.enqueue(makeOp());
    await until(async () => (await outbox.list()).length === 0);
    transport.calls.length = 0;

    await outbox.enqueue(makeOp());
    await until(async () => (await outbox.list()).length === 0);
    document.dispatchEvent(new Event("visibilitychange"));
    await engine.whenIdle();
    expect(transport.maxInFlight).toBe(1);
  });

  it("ne réagit plus après stop()", async () => {
    const { outbox, transport, engine } = setup((ops) => allApplied(ops));
    engine.start();
    await engine.whenIdle(); // la reprise du démarrage se termine d'abord
    engine.stop();
    await outbox.enqueue(makeOp());
    window.dispatchEvent(new Event("online"));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(transport.calls).toEqual([]);
  });

  it("un flush() manuel tente même hors ligne déclaré", async () => {
    const { outbox, transport, engine } = setup((ops) => allApplied(ops), { online: false });
    await enqueueMany(outbox, 1);
    await engine.flush();
    expect(transport.calls).toHaveLength(1);
  });

  it("est redémarrable (React StrictMode monte deux fois)", async () => {
    const { outbox, transport, engine } = setup((ops) => allApplied(ops));
    engine.start();
    engine.stop();
    engine.start();
    await outbox.enqueue(makeOp());
    await until(async () => (await outbox.list()).length === 0);
    expect(transport.calls).toHaveLength(1);
  });
});

describe("SyncEngine : état observable", () => {
  it("notifie les abonnés et garde la même photo tant que rien ne change", async () => {
    const { outbox, engine } = setup((ops) => allApplied(ops));
    const listener = vi.fn();
    engine.subscribe(listener);
    const snapshot = engine.getStatus();
    expect(engine.getStatus()).toBe(snapshot);

    await enqueueMany(outbox, 2);
    await engine.refreshCounts();
    expect(engine.getStatus()).not.toBe(snapshot);
    expect(engine.getStatus().pending).toBe(2);
    expect(listener).toHaveBeenCalled();
  });

  it("expose les compteurs en attente, en cours et refusées", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { outbox, engine, transport } = setup(async (ops) => {
      await gate;
      return { status: "ok", verdicts: ops.map((op, i) => (i === 0 ? rejected(op) : applied(op))) };
    });
    await enqueueMany(outbox, 3);
    const running = engine.flush();
    await until(() => transport.calls.length === 1);
    await engine.refreshCounts();
    expect(engine.getStatus()).toMatchObject({ running: true, pending: 3, sending: 3, rejected: 0 });

    release();
    await running;
    expect(engine.getStatus()).toMatchObject({ running: false, pending: 0, sending: 0, rejected: 1 });
  });

  it("appelle onFlushed quand des opérations ont été tranchées", async () => {
    const onFlushed = vi.fn();
    const { outbox, engine } = setup((ops) => allApplied(ops), { onFlushed });
    await engine.flush();
    expect(onFlushed).not.toHaveBeenCalled();
    await enqueueMany(outbox, 1);
    await engine.flush();
    expect(onFlushed).toHaveBeenCalledTimes(1);
  });
});

describe("SyncEngine : whenDrained et whenIdle", () => {
  it("whenDrained ne dépend pas de onFlushed, whenIdle si", async () => {
    let releaseHook!: () => void;
    const hook = new Promise<void>((resolve) => {
      releaseHook = resolve;
    });
    const { outbox, engine } = setup((ops) => allApplied(ops), { onFlushed: () => hook });
    await enqueueMany(outbox, 2);

    const flushed = engine.flush();
    let idle = false;
    void engine.whenIdle().then(() => {
      idle = true;
    });
    await within(engine.whenDrained(), 2000, "whenDrained()"); // les verdicts sont tombés
    expect(await outbox.list()).toEqual([]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(idle).toBe(false); // le rappel n'est pas fini

    releaseHook();
    await flushed;
    await within(engine.whenIdle(), 2000, "whenIdle()");
    expect(idle).toBe(true);
  });

  it("un rappel onFlushed peut attendre whenDrained sans interbloquer le rejeu", async () => {
    const seen: number[] = [];
    const ref: { engine?: SyncEngine<TestOp> } = {};
    const { outbox, engine } = setup((ops) => allApplied(ops), {
      onFlushed: async () => {
        await ref.engine?.whenDrained();
        seen.push((await outbox.list()).length);
      },
    });
    ref.engine = engine;
    await enqueueMany(outbox, 1);
    await within(engine.flush(), 2000, "flush()");
    expect(seen).toEqual([0]);
  });
});
