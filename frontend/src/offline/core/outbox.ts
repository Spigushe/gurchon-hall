import type { OfflineCoreDb } from "./db";
import { newUuid, toLocalIso } from "./ids";
import type {
  OperationEnvelope,
  OutboxEntry,
  OutboxState,
  Rejection,
  SyncVerdict,
} from "./types";

export interface OutboxCounts {
  /** En attente ou en cours d'envoi (tout ce qui n'est pas encore tranché). */
  pending: number;
  /** Parmi `pending`, celles dont l'envoi est en cours. */
  sending: number;
  /** Refusées, à corriger par l'appelant. */
  rejected: number;
}

export type OutboxChange = "enqueued" | "updated";

export interface EnqueueOptions {
  /**
   * Référence client que cette opération **réserve** (création d'un objet).
   * Refusée d'emblée si elle est déjà prise par une autre opération de la file
   * ou par une correspondance connue : une référence ne se réutilise jamais.
   */
  createsRef?: string;
}

export class DuplicateOperationError extends Error {
  constructor(operationId: string) {
    super(
      `L'opération ${operationId} est déjà en file : une clé d'idempotence ne se ` +
        `réutilise pas, et une opération en file ne se modifie pas.`,
    );
    this.name = "DuplicateOperationError";
  }
}

export class DuplicateRefError extends Error {
  constructor(ref: string) {
    super(`La référence client ${ref} est déjà utilisée : elle ne se réutilise jamais.`);
    this.name = "DuplicateRefError";
  }
}

export class NotRejectedError extends Error {
  constructor(operationId: string) {
    super(`L'opération ${operationId} n'existe pas ou n'est pas refusée.`);
    this.name = "NotRejectedError";
  }
}

const CHANNEL_PREFIX = "offline-outbox:";

/**
 * File d'attente persistante des écritures (pattern « outbox »).
 *
 * Garanties, dans l'ordre où elles comptent :
 *
 * 1. **La clé ne change pas.** `enqueue` reçoit une opération dont
 *    `operation_id` a été tiré à la saisie et la range telle quelle. Rien dans
 *    cette classe ne régénère une clé, et aucune méthode ne modifie la charge
 *    utile d'une entrée : le serveur refuserait le rejeu d'une clé avec un
 *    autre corps (`mismatched_replay`). Le seul moyen de « corriger » est
 *    `reissue`, qui produit une **nouvelle** opération sous une nouvelle clé.
 * 2. **Tout est persistant.** Le rang, l'état, la charge utile vivent dans
 *    IndexedDB : rechargement, fermeture d'onglet et mise à jour du service
 *    worker ne changent rien (la file n'est pas dans le service worker).
 * 3. **L'ordre est celui de la saisie**, porté par `rank`, et conservé par
 *    `reissue` (une correction reprend la place de l'opération refusée).
 * 4. Une opération **tranchée** (`applied` / `replayed`) sort de la file, dans
 *    la même transaction que la mémorisation des références client.
 *
 * Les changements sont annoncés aux abonnés de l'onglet (`onChange`) et aux
 * autres onglets par `BroadcastChannel` quand il existe.
 */
export class Outbox<TOp extends OperationEnvelope = OperationEnvelope> {
  private readonly listeners = new Set<(change: OutboxChange) => void>();
  private readonly channel: BroadcastChannel | null;
  private epoch = 0;

  /**
   * `retainSettled` : garde chaque opération tranchée dans la table `settled`
   * (transaction du verdict) jusqu'à ce qu'un rafraîchissement des miroirs la
   * prenne en charge. Requiert `CORE_STORES_V2` dans la base.
   */
  constructor(
    private readonly db: OfflineCoreDb,
    private readonly options: { now?: () => Date; retainSettled?: boolean } = {},
  ) {
    this.channel =
      typeof BroadcastChannel === "undefined"
        ? null
        : new BroadcastChannel(`${CHANNEL_PREFIX}${db.name}`);
    if (this.channel) {
      this.channel.onmessage = () => this.emit("updated", false);
    }
  }

  /**
   * Compteur qui avance à chaque verdict appliqué dans cet onglet. Permet à un
   * rafraîchissement des miroirs de détecter qu'un rejeu a tranché des
   * opérations pendant qu'il lisait le serveur (son instantané serait périmé).
   */
  get settleEpoch(): number {
    return this.epoch;
  }

  /** Libère le canal inter-onglets (tests, démontage). */
  close(): void {
    this.channel?.close();
    this.listeners.clear();
  }

  onChange(listener: (change: OutboxChange) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(change: OutboxChange, broadcast = true): void {
    if (broadcast) this.channel?.postMessage(change);
    for (const listener of [...this.listeners]) listener(change);
  }

  /**
   * Range une opération en fin de file. Résolue quand l'écriture IndexedDB est
   * faite : c'est tout ce que la saisie attend, jamais le réseau.
   */
  async enqueue(operation: TOp, options: EnqueueOptions = {}): Promise<OutboxEntry<TOp>> {
    const { outbox, refs } = this.db;
    const entry = await this.db.transaction("rw", outbox, refs, async () => {
      if (await outbox.get(operation.operation_id)) {
        throw new DuplicateOperationError(operation.operation_id);
      }
      if (options.createsRef !== undefined) {
        const taken =
          (await outbox.where("clientRef").equals(options.createsRef).count()) > 0 ||
          (await refs.get(options.createsRef)) !== undefined;
        if (taken) throw new DuplicateRefError(options.createsRef);
      }
      const last = await outbox.orderBy("rank").last();
      const created: OutboxEntry<TOp> = {
        operationId: operation.operation_id,
        rank: (last?.rank ?? 0) + 1,
        type: operation.type,
        state: "pending",
        operation,
        recordedAt: operation.recorded_at,
        attempts: 0,
        ...(options.createsRef !== undefined ? { clientRef: options.createsRef } : {}),
      };
      await outbox.add(created as OutboxEntry<OperationEnvelope>);
      return created;
    });
    this.emit("enqueued");
    return entry;
  }

  async get(operationId: string): Promise<OutboxEntry<TOp> | undefined> {
    return (await this.db.outbox.get(operationId)) as OutboxEntry<TOp> | undefined;
  }

  /** Entrées dans l'ordre de la file, éventuellement filtrées par état. */
  async list(state?: OutboxState): Promise<OutboxEntry<TOp>[]> {
    const rows = await this.db.outbox.orderBy("rank").toArray();
    const filtered = state ? rows.filter((row) => row.state === state) : rows;
    return filtered as OutboxEntry<TOp>[];
  }

  async counts(): Promise<OutboxCounts> {
    const rows = await this.db.outbox.toArray();
    let sending = 0;
    let rejected = 0;
    for (const row of rows) {
      if (row.state === "sending") sending++;
      else if (row.state === "rejected") rejected++;
    }
    return { pending: rows.length - rejected, sending, rejected };
  }

  /**
   * Remplace une opération **refusée** par une nouvelle, sous une **nouvelle
   * clé** et à la même place dans la file. `transform` reçoit l'ancienne
   * opération et rend la version corrigée (sans transformation : même contenu,
   * nouvelle clé, utile quand le motif a disparu, par exemple un refus en
   * cascade ou un stock corrigé entre-temps). `operation_id` et `recorded_at`
   * sont imposés ici : la correction est une nouvelle saisie.
   *
   * La référence client d'une création refusée est conservée (le serveur ne
   * réserve une référence que pour une création appliquée).
   */
  async reissue(
    operationId: string,
    transform: (operation: TOp) => TOp = (operation) => operation,
  ): Promise<OutboxEntry<TOp>> {
    const { outbox } = this.db;
    const created = await this.db.transaction("rw", outbox, async () => {
      const old = (await outbox.get(operationId)) as OutboxEntry<TOp> | undefined;
      if (!old || old.state !== "rejected") throw new NotRejectedError(operationId);
      const now = toLocalIso(this.options.now?.() ?? new Date());
      const operation: TOp = {
        ...transform(structuredClone(old.operation)),
        operation_id: newUuid(),
        recorded_at: now,
      };
      const entry: OutboxEntry<TOp> = {
        operationId: operation.operation_id,
        rank: old.rank,
        type: operation.type,
        state: "pending",
        operation,
        recordedAt: now,
        attempts: 0,
        ...(old.clientRef !== undefined ? { clientRef: old.clientRef } : {}),
        reissuedFrom: old.operationId,
      };
      await outbox.delete(old.operationId);
      await outbox.add(entry as OutboxEntry<OperationEnvelope>);
      return entry;
    });
    this.emit("enqueued");
    return created;
  }

  /** Abandonne une opération refusée (l'utilisateur renonce à sa saisie). */
  async discard(operationId: string): Promise<void> {
    const { outbox } = this.db;
    await this.db.transaction("rw", outbox, async () => {
      const row = await outbox.get(operationId);
      if (!row || row.state !== "rejected") throw new NotRejectedError(operationId);
      await outbox.delete(operationId);
    });
    this.emit("updated");
  }

  // --- Côté moteur de rejeu -------------------------------------------------

  /** Prochaines opérations à envoyer, dans l'ordre de la file. */
  async nextPending(limit: number): Promise<OutboxEntry<TOp>[]> {
    const rows = await this.db.outbox.orderBy("rank").toArray();
    return rows.filter((row) => row.state === "pending").slice(0, limit) as OutboxEntry<TOp>[];
  }

  async markSending(operationIds: string[]): Promise<void> {
    const { outbox } = this.db;
    await this.db.transaction("rw", outbox, async () => {
      for (const id of operationIds) {
        const row = await outbox.get(id);
        if (row && row.state === "pending") {
          await outbox.update(id, { state: "sending", attempts: row.attempts + 1 });
        }
      }
    });
    this.emit("updated");
  }

  /**
   * Remet en attente toute opération restée `sending` : l'issue de son envoi
   * est inconnue (réseau coupé en route, onglet fermé). À n'appeler que sous le
   * verrou d'envoi, quand personne d'autre ne peut être en train d'envoyer.
   * Rejouer sous la même clé est sans risque : c'est le rôle de l'idempotence.
   */
  async releaseSending(): Promise<number> {
    const { outbox } = this.db;
    const released = await this.db.transaction("rw", outbox, async () => {
      return outbox.where("state").equals("sending").modify({ state: "pending" });
    });
    if (released > 0) this.emit("updated");
    return released;
  }

  /**
   * Applique des verdicts, en une transaction : une opération tranchée sort de
   * la file et ses références client sont mémorisées ; un refus reste, avec son
   * motif. Renvoie le nombre d'opérations traitées par issue.
   */
  async settle(
    verdicts: SyncVerdict[],
    boundAt: string = toLocalIso(this.options.now?.() ?? new Date()),
  ): Promise<{ applied: number; replayed: number; rejected: number }> {
    const { outbox, refs } = this.db;
    const retain = this.options.retainSettled === true;
    const tables = retain ? [outbox, refs, this.db.settled] : [outbox, refs];
    const tally = { applied: 0, replayed: 0, rejected: 0 };
    await this.db.transaction("rw", tables, async () => {
      for (const verdict of verdicts) {
        const row = await outbox.get(verdict.operationId);
        if (!row) continue; // écartée entre-temps, ou déjà tranchée par un autre onglet
        const refused = verdict.outcome === "rejected" || verdict.error !== null;
        if (refused) {
          const rejection: Rejection = {
            code: verdict.error?.code ?? "invalid",
            message: verdict.error?.message ?? "Opération refusée par le serveur.",
            replayed: verdict.outcome === "replayed",
          };
          await outbox.update(verdict.operationId, { state: "rejected", rejection });
          tally.rejected++;
          continue;
        }
        await outbox.delete(verdict.operationId);
        if (retain) {
          // Même transaction que la sortie de la file : une lecture ne peut
          // jamais voir l'opération absente des deux endroits à la fois.
          await this.db.settled.add({
            operationId: verdict.operationId,
            type: row.type,
            operation: row.operation,
            settledAt: boundAt,
          });
        }
        for (const { ref, id } of verdict.refs) {
          await refs.put({ ref, id, boundAt });
        }
        tally[verdict.outcome === "replayed" ? "replayed" : "applied"]++;
      }
    });
    this.epoch++;
    this.emit("updated");
    return tally;
  }

  /** Refus décidé côté client (charge utile mal formée, 422 sur l'opération seule). */
  async rejectLocally(operationId: string, message: string): Promise<void> {
    await this.db.outbox.update(operationId, {
      state: "rejected",
      rejection: { code: "invalid_request", message, replayed: false },
    });
    this.emit("updated");
  }
}
