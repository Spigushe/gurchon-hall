import type { Outbox, OutboxCounts } from "./outbox";
import type { OperationEnvelope, OutboxEntry, SyncTransport, TransportResult } from "./types";

/** Nombre maximal d'opérations par lot accepté par `POST /sync` (contrat). */
export const DEFAULT_MAX_BATCH_SIZE = 200;

export interface BackoffOptions {
  baseMs: number;
  factor: number;
  maxMs: number;
  /** Amplitude relative du hasard ajouté au délai (0,2 = ±20 %). */
  jitter: number;
}

export const DEFAULT_BACKOFF: BackoffOptions = {
  baseMs: 1_000,
  factor: 2,
  maxMs: 60_000,
  jitter: 0.2,
};

/** Photo de l'état de synchronisation, immuable, faite pour `useSyncExternalStore`. */
export interface SyncStatus {
  /** Connectivité déclarée par le navigateur (`navigator.onLine`). */
  online: boolean;
  /** Un rejeu est en cours dans cet onglet. */
  running: boolean;
  /** Opérations non tranchées (en attente ou en cours d'envoi). */
  pending: number;
  /** Parmi elles, celles dont l'envoi est en cours. */
  sending: number;
  /** Opérations refusées, à corriger. */
  rejected: number;
  /** Dernier échec de transport (réseau, 5xx, 501…), effacé au premier succès. */
  lastError: string | null;
  /** Dernier aller-retour réussi avec le serveur (ISO). */
  lastSuccessAt: string | null;
  /** Prochain essai automatique programmé (ISO), sinon `null`. */
  nextRetryAt: string | null;
  /** Échecs de transport consécutifs. */
  failures: number;
}

export type FlushResult =
  /** La file a été vidée de ce qui était envoyable. */
  | "drained"
  /** Un échec de transport a interrompu le rejeu ; un nouvel essai est programmé. */
  | "retry"
  /** Un autre onglet tient le verrou d'envoi. */
  | "locked";

export interface FlushSummary {
  result: FlushResult;
  /** Opérations envoyées (verdict reçu). */
  sent: number;
  applied: number;
  replayed: number;
  rejected: number;
}

export interface SyncEngineOptions<TOp extends OperationEnvelope> {
  outbox: Outbox<TOp>;
  transport: SyncTransport<TOp>;
  maxBatchSize?: number;
  backoff?: Partial<BackoffOptions>;
  /** Source de la connectivité ; défaut : `navigator.onLine`. */
  isOnline?: () => boolean;
  /**
   * Nom du verrou Web Locks qui empêche deux onglets d'envoyer en même temps.
   * `null` le désactive (l'exclusion reste garantie dans l'onglet).
   */
  lockName?: string | null;
  /** Délai avant de retenter quand un autre onglet tient le verrou. */
  lockedRetryMs?: number;
  /** Appelée après chaque rejeu qui a tranché au moins une opération. */
  onFlushed?: (summary: FlushSummary) => void | Promise<void>;
  now?: () => Date;
  random?: () => number;
  /** Minuteries injectables (tests déterministes) ; défaut : celles du navigateur. */
  timers?: {
    setTimeout: (callback: () => void, delayMs: number) => unknown;
    clearTimeout: (handle: unknown) => void;
  };
}

/**
 * Moteur de rejeu de la file vers `POST /sync`.
 *
 * Déclencheurs : événement `online`, retour au premier plan
 * (`visibilitychange`, seul mécanisme fiable sur iOS, où la Background Sync API
 * manque), démarrage, saisie d'une opération, échéance d'un backoff, et
 * `flush()` manuel. Les déclenchements automatiques respectent la connectivité
 * déclarée ; `flush()` manuel tente toujours.
 *
 * Invariants :
 * - **jamais deux envois concurrents** : un seul rejeu à la fois dans l'onglet
 *   (un appel pendant un rejeu le fait repasser une fois de plus, sans
 *   doublon), et un verrou Web Locks entre onglets quand le navigateur en a ;
 * - **aucune opération perdue** : un échec de transport remet le lot en
 *   attente, sous les mêmes clés ; le délai de nouvel essai croît de façon
 *   exponentielle (1 s, 2 s, 4 s… plafonné) ;
 * - **l'ordre de la file est celui du lot** : rien n'est réordonné ni compacté ;
 * - un verdict `applied` ou `replayed` tranche l'opération (elle sort), un
 *   `rejected` (ou un `replayed` porteur d'une erreur) la garde en état
 *   `rejected` ; le lot continue quoi qu'il arrive à l'une d'elles ;
 * - une réponse **422** ne bloque pas la file : le lot est bissecté jusqu'à
 *   isoler l'opération mal formée, refusée localement (`invalid_request`),
 *   pendant que les autres passent.
 */
export class SyncEngine<TOp extends OperationEnvelope> {
  private readonly outbox: Outbox<TOp>;
  private readonly transport: SyncTransport<TOp>;
  private readonly maxBatchSize: number;
  private readonly backoff: BackoffOptions;
  private readonly isOnlineFn: () => boolean;
  private readonly lockName: string | null;
  private readonly lockedRetryMs: number;
  private readonly onFlushed?: (summary: FlushSummary) => void | Promise<void>;
  private readonly now: () => Date;
  private readonly random: () => number;
  private readonly timers: NonNullable<SyncEngineOptions<TOp>["timers"]>;

  private readonly listeners = new Set<() => void>();
  private status: SyncStatus;
  private inFlight: Promise<FlushSummary> | null = null;
  /** Résolue à la fin de la phase d'envoi du rejeu en cours, sans attendre `onFlushed`. */
  private drainDone: Promise<void> | null = null;
  private markDrained: (() => void) | null = null;
  private dirty = false;
  private started = false;
  private retryTimer: unknown = null;
  private unsubscribeOutbox: (() => void) | null = null;
  private detachEnvironment: (() => void) | null = null;

  constructor(options: SyncEngineOptions<TOp>) {
    this.outbox = options.outbox;
    this.transport = options.transport;
    this.maxBatchSize = Math.max(1, options.maxBatchSize ?? DEFAULT_MAX_BATCH_SIZE);
    this.backoff = { ...DEFAULT_BACKOFF, ...options.backoff };
    this.isOnlineFn =
      options.isOnline ?? (() => (typeof navigator === "undefined" ? true : navigator.onLine));
    this.lockName = options.lockName === undefined ? "offline-sync" : options.lockName;
    this.lockedRetryMs = options.lockedRetryMs ?? 2_000;
    this.onFlushed = options.onFlushed;
    this.now = options.now ?? (() => new Date());
    this.random = options.random ?? Math.random;
    this.timers = options.timers ?? {
      setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
      clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    };
    this.status = {
      online: this.isOnlineFn(),
      running: false,
      pending: 0,
      sending: 0,
      rejected: 0,
      lastError: null,
      lastSuccessAt: null,
      nextRetryAt: null,
      failures: 0,
    };
  }

  // --- État observable ------------------------------------------------------

  /** Photo courante ; même référence tant que rien ne change. */
  getStatus = (): SyncStatus => this.status;

  /** Compatible `useSyncExternalStore` : renvoie la fonction de désabonnement. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private patchStatus(patch: Partial<SyncStatus>): void {
    const next = { ...this.status, ...patch };
    const changed = (Object.keys(next) as Array<keyof SyncStatus>).some(
      (key) => next[key] !== this.status[key],
    );
    if (!changed) return;
    this.status = next;
    for (const listener of [...this.listeners]) listener();
  }

  /** Relit les compteurs de la file (à appeler au démarrage, puis à chaque changement). */
  async refreshCounts(): Promise<OutboxCounts> {
    const counts = await this.outbox.counts();
    this.patchStatus(counts);
    return counts;
  }

  /** Rafraîchissement déclenché par un événement : une lecture ratée (base fermée) n'a pas à remonter. */
  private refreshCountsQuietly(): void {
    this.refreshCounts().catch((error) => {
      console.debug("[offline] lecture des compteurs impossible", error);
    });
  }

  // --- Cycle de vie ---------------------------------------------------------

  /**
   * Branche les déclencheurs (`online`, `offline`, `visibilitychange`, saisies)
   * et lance la reprise au démarrage. Idempotent, et redémarrable après
   * `stop()` (React StrictMode monte deux fois).
   */
  start(): void {
    if (this.started) return;
    this.started = true;

    const onOnline = () => {
      this.patchStatus({ online: true });
      this.clearRetryTimer();
      void this.flush();
    };
    const onOffline = () => {
      this.patchStatus({ online: false });
      this.clearRetryTimer();
    };
    const onVisible = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        this.autoFlush();
      }
    };
    if (typeof window !== "undefined") {
      window.addEventListener("online", onOnline);
      window.addEventListener("offline", onOffline);
    }
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisible);
    }
    this.detachEnvironment = () => {
      if (typeof window !== "undefined") {
        window.removeEventListener("online", onOnline);
        window.removeEventListener("offline", onOffline);
      }
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisible);
      }
    };

    this.unsubscribeOutbox = this.outbox.onChange((change) => {
      this.refreshCountsQuietly();
      if (change === "enqueued") this.autoFlush();
    });

    this.patchStatus({ online: this.isOnlineFn() });
    this.refreshCountsQuietly();
    this.autoFlush(); // reprise au démarrage
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.detachEnvironment?.();
    this.detachEnvironment = null;
    this.unsubscribeOutbox?.();
    this.unsubscribeOutbox = null;
    this.clearRetryTimer();
  }

  /** Déclenchement automatique : seulement démarré, en ligne, et sans rejeu déjà en cours. */
  private autoFlush(): void {
    if (!this.started) return;
    const online = this.isOnlineFn();
    this.patchStatus({ online });
    if (!online) return;
    void this.flush();
  }

  private clearRetryTimer(): void {
    if (this.retryTimer !== null) {
      this.timers.clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.patchStatus({ nextRetryAt: null });
  }

  private scheduleRetry(delayMs: number): void {
    if (!this.started) return;
    if (this.retryTimer !== null) this.timers.clearTimeout(this.retryTimer);
    this.retryTimer = this.timers.setTimeout(() => {
      this.retryTimer = null;
      this.patchStatus({ nextRetryAt: null });
      this.autoFlush();
    }, delayMs);
    this.patchStatus({
      nextRetryAt: new Date(this.now().getTime() + delayMs).toISOString(),
    });
  }

  // --- Rejeu ----------------------------------------------------------------

  /**
   * Rejoue la file maintenant. Si un rejeu est déjà en cours, en demande un
   * de plus à sa fin (pour les opérations saisies entre-temps) et rend la même
   * promesse : jamais deux envois concurrents.
   */
  flush(): Promise<FlushSummary> {
    if (this.inFlight) {
      this.dirty = true;
      return this.inFlight;
    }
    this.drainDone = new Promise<void>((resolve) => {
      this.markDrained = resolve;
    });
    this.inFlight = this.run();
    return this.inFlight;
  }

  /**
   * Résolue quand plus aucun rejeu n'est en cours dans cet onglet, **rappel
   * `onFlushed` compris** : ne pas l'attendre depuis `onFlushed` (le rejeu
   * attend le rappel, qui attendrait le rejeu : interblocage). Pour savoir que
   * les verdicts sont tous tombés, `whenDrained` suffit et ne l'attend pas.
   */
  async whenIdle(): Promise<void> {
    while (this.inFlight) await this.inFlight;
  }

  /**
   * Résolue quand la phase d'envoi du rejeu en cours est finie : la file est
   * vidée ou le rejeu a échoué, et les verdicts sont appliqués. Ne dépend pas de
   * `onFlushed` : c'est ce qu'il faut attendre depuis ce rappel ou depuis tout
   * ce qu'il déclenche.
   */
  async whenDrained(): Promise<void> {
    while (this.drainDone) await this.drainDone;
  }

  private async run(): Promise<FlushSummary> {
    await Promise.resolve(); // le prologue ne s'exécute jamais avant l'affectation de `inFlight`
    this.clearRetryTimer();
    this.patchStatus({ running: true });
    const total: FlushSummary = { result: "drained", sent: 0, applied: 0, replayed: 0, rejected: 0 };
    try {
      for (;;) {
        this.dirty = false;
        const summary = await this.withLock(() => this.drain());
        total.result = summary.result;
        total.sent += summary.sent;
        total.applied += summary.applied;
        total.replayed += summary.replayed;
        total.rejected += summary.rejected;
        // Contrôle de `dirty` et libération de `inFlight` dans le même tour
        // synchrone : un `flush()` ne peut pas tomber entre les deux.
        if (summary.result !== "drained" || !this.dirty) break;
      }
    } catch (error) {
      // Erreur locale inattendue (IndexedDB) : on la garde visible, on ne perd rien.
      this.patchStatus({ lastError: describeError(error) });
      total.result = "retry";
    } finally {
      this.inFlight = null;
      const markDrained = this.markDrained;
      this.drainDone = null;
      this.markDrained = null;
      this.patchStatus({ running: false });
      markDrained?.();
    }
    // Ne rejette jamais : un rejeu lancé par un déclencheur automatique n'a
    // personne pour attraper l'erreur, et l'état d'échec est déjà dans `status`.
    try {
      await this.refreshCounts();
    } catch (error) {
      console.debug("[offline] lecture des compteurs impossible", error);
      return total;
    }
    if (total.result === "locked") {
      if (this.status.pending > 0) this.scheduleRetry(this.lockedRetryMs);
    } else if (total.sent > 0 && this.onFlushed) {
      try {
        await this.onFlushed(total);
      } catch (error) {
        console.warn("[offline] onFlushed a échoué", error);
      }
    }
    return total;
  }

  private async withLock(task: () => Promise<FlushSummary>): Promise<FlushSummary> {
    const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
    if (!this.lockName || !locks) return task();
    return locks.request(this.lockName, { ifAvailable: true }, async (lock) =>
      lock
        ? task()
        : ({ result: "locked", sent: 0, applied: 0, replayed: 0, rejected: 0 } as FlushSummary),
    );
  }

  /** Vide la file par lots ; s'arrête au premier échec de transport. */
  private async drain(): Promise<FlushSummary> {
    const summary: FlushSummary = { result: "drained", sent: 0, applied: 0, replayed: 0, rejected: 0 };
    // Sous le verrou, plus personne n'envoie : ce qui reste `sending` est un
    // envoi dont on ignore l'issue (onglet fermé, réseau coupé en route).
    await this.outbox.releaseSending();
    for (;;) {
      const batch = await this.outbox.nextPending(this.maxBatchSize);
      if (batch.length === 0) return summary;
      await this.outbox.markSending(batch.map((entry) => entry.operationId));
      const failure = await this.sendAndSettle(batch, summary);
      if (failure) {
        await this.outbox.releaseSending();
        this.onTransportFailure(failure);
        summary.result = "retry";
        return summary;
      }
      this.patchStatus({
        failures: 0,
        lastError: null,
        lastSuccessAt: this.now().toISOString(),
      });
    }
  }

  /**
   * Envoie un lot et applique les verdicts. Renvoie l'échec de transport
   * éventuel (le lot n'est alors pas tranché, ou seulement en partie).
   */
  private async sendAndSettle(
    entries: OutboxEntry<TOp>[],
    summary: FlushSummary,
  ): Promise<Extract<TransportResult, { status: "unavailable" }> | null> {
    let result: TransportResult;
    try {
      result = await this.transport.send(entries.map((entry) => entry.operation));
    } catch (error) {
      // Un transport bien écrit ne lève pas ; s'il le fait, c'est un échec réseau.
      result = { status: "unavailable", message: describeError(error) };
    }

    if (result.status === "unavailable") return result;

    if (result.status === "invalid") {
      if (entries.length === 1) {
        await this.outbox.rejectLocally(entries[0].operationId, result.message);
        summary.sent += 1;
        summary.rejected += 1;
        return null;
      }
      // Bissection : on isole l'opération fautive sans bloquer les autres.
      const middle = Math.ceil(entries.length / 2);
      const first = await this.sendAndSettle(entries.slice(0, middle), summary);
      if (first) return first;
      return this.sendAndSettle(entries.slice(middle), summary);
    }

    const byId = new Map(result.verdicts.map((verdict) => [verdict.operationId, verdict]));
    const known = entries.filter((entry) => byId.has(entry.operationId));
    const tally = await this.outbox.settle(known.map((entry) => byId.get(entry.operationId)!));
    summary.sent += known.length;
    summary.applied += tally.applied;
    summary.replayed += tally.replayed;
    summary.rejected += tally.rejected;
    if (known.length < entries.length) {
      // Réponse incomplète : ce qui n'a pas de verdict reste en attente.
      return {
        status: "unavailable",
        message: `Réponse incomplète : ${entries.length - known.length} opération(s) sans verdict.`,
      };
    }
    return null;
  }

  private onTransportFailure(failure: {
    message: string;
    httpStatus?: number;
    retryAfterMs?: number;
  }): void {
    const failures = this.status.failures + 1;
    const raw = this.backoff.baseMs * this.backoff.factor ** (failures - 1);
    const capped = Math.min(this.backoff.maxMs, raw);
    const spread = 1 - this.backoff.jitter + 2 * this.backoff.jitter * this.random();
    // Le serveur qui dit quand revenir (503 + Retry-After) a le dernier mot,
    // sauf si son délai est plus court que notre backoff.
    const delay = Math.max(0, Math.round(capped * spread), failure.retryAfterMs ?? 0);
    this.patchStatus({
      failures,
      lastError: failure.httpStatus ? `${failure.message} (HTTP ${failure.httpStatus})` : failure.message,
    });
    // Hors ligne, inutile de programmer : l'événement `online` prendra le relais.
    if (this.isOnlineFn()) this.scheduleRetry(delay);
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
