import "fake-indexeddb/auto";
import { CORE_STORES_V1, CORE_STORES_V2, OfflineCoreDb } from "../../../src/offline/core/db";
import type {
  OperationEnvelope,
  SyncTransport,
  SyncVerdict,
  TransportResult,
} from "../../../src/offline/core/types";

let counter = 0;

/** Nom de base unique : chaque test part d'une IndexedDB vierge. */
export function freshDbName(prefix = "test"): string {
  counter += 1;
  return `${prefix}-${counter}-${Math.random().toString(36).slice(2)}`;
}

/** Opération de test, sans domaine. */
export interface TestOp extends OperationEnvelope {
  payload?: Record<string, unknown>;
}

let opCounter = 0;
export function makeOp(overrides: Partial<TestOp> = {}): TestOp {
  opCounter += 1;
  return {
    operation_id: `00000000-0000-4000-8000-${String(opCounter).padStart(12, "0")}`,
    recorded_at: "2026-09-20T10:00:00.000+02:00",
    type: "thing.upsert",
    payload: { n: opCounter },
    ...overrides,
  };
}

export class TestDb extends OfflineCoreDb {
  constructor(name: string) {
    super(name);
    this.version(1).stores({ ...CORE_STORES_V1 });
    this.version(2).stores({ ...CORE_STORES_V2 });
  }
}

export const applied = (op: { operation_id: string }): SyncVerdict => ({
  operationId: op.operation_id,
  outcome: "applied",
  error: null,
  refs: [],
});

export const rejected = (
  op: { operation_id: string },
  code:
    | "conflict"
    | "not_found"
    | "invalid"
    | "unresolved_client_ref"
    | "mismatched_replay" = "conflict",
  message = "refus",
): SyncVerdict => ({
  operationId: op.operation_id,
  outcome: "rejected",
  error: { code, message },
  refs: [],
});

type Responder<TOp> = (
  operations: TOp[],
  call: number,
) => TransportResult | Promise<TransportResult>;

/** Transport scripté : enregistre chaque lot et mesure la concurrence. */
export class FakeTransport<TOp extends OperationEnvelope> implements SyncTransport<TOp> {
  calls: TOp[][] = [];
  inFlight = 0;
  maxInFlight = 0;
  constructor(public responder: Responder<TOp>) {}

  async send(operations: TOp[]): Promise<TransportResult> {
    this.calls.push(structuredClone(operations));
    this.inFlight += 1;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    try {
      return await this.responder(operations, this.calls.length);
    } finally {
      this.inFlight -= 1;
    }
  }
}

/** Minuteries manuelles : rien ne part tant que le test ne le décide. */
export function manualTimers() {
  const scheduled: Array<{
    id: number;
    callback: () => void;
    delayMs: number;
    cleared: boolean;
  }> = [];
  return {
    scheduled,
    timers: {
      setTimeout: (callback: () => void, delayMs: number) => {
        const timer = { id: scheduled.length + 1, callback, delayMs, cleared: false };
        scheduled.push(timer);
        return timer.id;
      },
      clearTimeout: (handle: unknown) => {
        const timer = scheduled.find((item) => item.id === handle);
        if (timer) timer.cleared = true;
      },
    },
    /** Minuteries encore actives. */
    active: () => scheduled.filter((timer) => !timer.cleared),
    fireLast: () => {
      const timer = [...scheduled].reverse().find((item) => !item.cleared);
      if (!timer) throw new Error("aucune minuterie active");
      timer.cleared = true;
      timer.callback();
    },
  };
}

/** Attend qu'une condition asynchrone se réalise (sans délai arbitraire). */
export async function until(
  check: () => boolean | Promise<boolean>,
  timeoutMs = 3000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error("condition non atteinte");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/**
 * Échoue vite au lieu de pendre : un interblocage se signale en quelques
 * secondes, avec son nom, plutôt qu'au délai global du test.
 */
export async function within<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} : pas résolu en ${ms} ms (interblocage ?)`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Passe `navigator.onLine` à `value` (jsdom) ; `restoreNavigatorOnLine` rend la main. */
export function setNavigatorOnLine(value: boolean): void {
  Object.defineProperty(window.navigator, "onLine", { configurable: true, value });
}

export function restoreNavigatorOnLine(): void {
  delete (window.navigator as unknown as Record<string, unknown>).onLine;
}
