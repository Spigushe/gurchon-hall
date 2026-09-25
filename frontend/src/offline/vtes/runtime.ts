import { apiClient } from "../../api-client/client";
import { newUuid } from "../core/ids";
import { Outbox, type EnqueueOptions } from "../core/outbox";
import { SyncEngine, type SyncEngineOptions } from "../core/syncEngine";
import type { OutboxEntry } from "../core/types";
import type { OfflineRuntime } from "../react/context";
import { DEFAULT_DB_NAME, VtesOfflineDb } from "./db";
import { knownLanguageCodes, resolveLanguageCode } from "./languages";
import {
  bundleDeposit,
  deckCardDelete,
  deckCardUpsert,
  deckCreate,
  deckDelete,
  deckUpdate,
  stockDelete,
  stockUpsert,
  systemClock,
  type DeckCardInput,
  type DeckInput,
  type DeckPatch,
  type OperationClock,
  type StockInput,
} from "./operations";
import {
  refreshCardSets,
  refreshCatalog,
  refreshDecks,
  refreshLanguages,
  refreshStock,
} from "./refresh";
import { createVtesSyncTransport } from "./transport";
import type { ApiClient, DeckKey, DeckSelector, VtesOperation } from "./types";

type DeckTarget = DeckSelector | DeckKey;
type Entry = OutboxEntry<VtesOperation>;

/**
 * Écritures de l'utilisateur. **Toutes** passent par la file : chaque méthode
 * tire la clé d'idempotence à l'instant de la saisie, range l'opération dans
 * IndexedDB et rend la main dès que c'est fait. Aucune n'attend le réseau ; le
 * rejeu part en arrière-plan si l'on est en ligne (§10 de CLAUDE.md).
 */
export interface VtesActions {
  saveStock(input: StockInput): Promise<Entry>;
  removeStock(cardId: number, languageCode: string, cardSetId: number): Promise<Entry>;
  /** Le deck n'a pas d'identifiant serveur : la référence rendue le désigne d'ici là. */
  createDeck(input: DeckInput): Promise<{ clientRef: string; key: DeckKey; entry: Entry }>;
  updateDeck(deck: DeckTarget, patch: DeckPatch): Promise<Entry>;
  archiveDeck(deck: DeckTarget, archived?: boolean): Promise<Entry>;
  deleteDeck(deck: DeckTarget): Promise<Entry>;
  saveDeckCard(deck: DeckTarget, input: DeckCardInput): Promise<Entry>;
  removeDeckCard(
    deck: DeckTarget,
    cardId: number,
    languageCode: string,
    cardSetId: number,
  ): Promise<Entry>;
  depositBundle(bundleId: number, languageCode: string, count?: number): Promise<Entry>;
}

export interface RefreshOptions {
  /** Relire aussi le catalogue complet (~4 000 cartes) ; coûteux, à demander explicitement. */
  catalog?: boolean;
}

export interface RefreshReport {
  /** `false` si un échec, un rejeu concurrent ou un dépassement de délai a empêché de tout mettre à jour. */
  complete: boolean;
  refreshed: string[];
  errors: string[];
}

export interface VtesOfflineRuntime extends OfflineRuntime<VtesOperation> {
  db: VtesOfflineDb;
  actions: VtesActions;
  /**
   * Relit les miroirs depuis les `GET` (en ligne seulement) ; ne lève jamais.
   * Un appel pendant une lecture en cours attend la lecture suivante (jamais une
   * lecture commencée avant lui) ; les options des appelants qui attendent la
   * même lecture s'additionnent.
   */
  refresh(options?: RefreshOptions): Promise<RefreshReport>;
  /** Ferme la base et les canaux (tests, démontage définitif). */
  dispose(): void;
}

export interface VtesOfflineOptions {
  client?: ApiClient;
  dbName?: string;
  /** Options du moteur (backoff, taille de lot, verrou, connectivité injectée…). */
  engine?: Partial<Omit<SyncEngineOptions<VtesOperation>, "outbox" | "transport">>;
  /** Rafraîchir les miroirs au démarrage, au retour du réseau et après chaque rejeu (défaut : oui). */
  autoRefresh?: boolean;
  clock?: OperationClock;
  /** Délai au-delà duquel un rafraîchissement est déclaré perdu (défaut : 60 s). */
  refreshTimeoutMs?: number;
}

const DEFAULT_REFRESH_TIMEOUT_MS = 60_000;

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Assemble la couche offline VtES : base Dexie, file, moteur de rejeu vers
 * `POST /sync`, écritures et rafraîchissement des miroirs.
 *
 * C'est le seul endroit qui relie le cœur générique (`../core`) au domaine
 * VtES et au client d'API généré : le remplacer suffit pour brancher un autre
 * domaine (Barrin) sur le même cœur.
 */
export function createVtesOffline(options: VtesOfflineOptions = {}): VtesOfflineRuntime {
  const client = options.client ?? apiClient;
  const clock = options.clock ?? systemClock;
  const autoRefresh = options.autoRefresh ?? true;
  const refreshTimeoutMs = options.refreshTimeoutMs ?? DEFAULT_REFRESH_TIMEOUT_MS;

  const db = new VtesOfflineDb(options.dbName ?? DEFAULT_DB_NAME);
  // `retainSettled` : une opération tranchée reste projetée jusqu'au rafraîchissement
  // qui la reprend, sinon son effet disparaîtrait entre le verdict et la relecture.
  const outbox = new Outbox<VtesOperation>(db, { retainSettled: true });

  const runRefresh = async (opts: RefreshOptions): Promise<RefreshReport> => {
    const online = typeof navigator === "undefined" ? true : navigator.onLine;
    if (!online) return { complete: false, refreshed: [], errors: ["hors ligne"] };

    const steps: Array<[string, () => Promise<number>]> = [
      ["languages", () => refreshLanguages(client, db)],
      ["cardSets", () => refreshCardSets(client, db)],
      ["stock", () => refreshStock(client, db)],
      ["decks", () => refreshDecks(client, db)],
    ];
    if (opts.catalog) steps.push(["catalog", () => refreshCatalog(client, db)]);

    let report: RefreshReport = { complete: false, refreshed: [], errors: [] };
    // Un verdict tombé pendant la lecture rendrait l'instantané périmé (une
    // opération tranchée sortirait de la file avant que le serveur qu'on a lu
    // ne la contienne) : on relit, au plus trois fois.
    for (let attempt = 0; attempt < 3; attempt++) {
      // Un rejeu en cours va changer ce que le serveur contient : on attend la
      // fin de son envoi. Surtout pas `whenIdle()` : il attend aussi `onFlushed`,
      // qui appelle `refresh()`, qui attendrait ce rejeu (interblocage).
      await engine.whenDrained();
      const epoch = outbox.settleEpoch;
      report = { complete: true, refreshed: [], errors: [] };
      for (const [name, step] of steps) {
        try {
          await step();
          report.refreshed.push(name);
        } catch (error) {
          report.complete = false;
          report.errors.push(`${name} : ${describe(error)}`);
        }
      }
      if (outbox.settleEpoch === epoch) return report;
      report.complete = false;
      report.errors.push("un rejeu a tranché des opérations pendant la lecture");
    }
    return report;
  };

  /**
   * Garde-fou : un rafraîchissement qui ne finit pas (réseau qui ne répond
   * jamais, attente qui ne se dénoue pas) rendrait tous les suivants muets,
   * puisqu'ils se fondent dans lui. Passé le délai, on rend un rapport d'échec et
   * on libère la place ; la lecture abandonnée, si elle finit un jour, écrit
   * comme n'importe quelle lecture.
   */
  const guarded = (run: Promise<RefreshReport>): Promise<RefreshReport> =>
    new Promise((resolve) => {
      const timer = setTimeout(() => {
        resolve({
          complete: false,
          refreshed: [],
          errors: [`rafraîchissement sans réponse après ${refreshTimeoutMs} ms`],
        });
      }, refreshTimeoutMs);
      run.then(
        (report) => {
          clearTimeout(timer);
          resolve(report);
        },
        (error) => {
          clearTimeout(timer);
          resolve({ complete: false, refreshed: [], errors: [describe(error)] });
        },
      );
    });

  // Coalescence : un rafraîchissement en cours, et au plus un derrière lui.
  // Un appel qui arrive pendant une lecture ne s'y fond pas : cette lecture a
  // commencé avant lui et peut ne pas voir ce qui vient de se passer (typiquement
  // le rejeu qui appelle `refresh` dans `onFlushed`). Il attend donc le suivant,
  // qui part quand le premier a fini et réunit les options de tous ses appelants.
  let active: Promise<RefreshReport> | null = null;
  let trailing: { catalog: boolean; promise: Promise<RefreshReport> } | null = null;

  const launch = (opts: RefreshOptions): Promise<RefreshReport> => {
    const run: Promise<RefreshReport> = guarded(runRefresh(opts)).finally(() => {
      // Si un suivant attend, c'est lui qui prend la place (pas de trou où deux
      // lectures se croiseraient).
      if (!trailing && active === run) active = null;
    });
    active = run;
    return run;
  };

  const refresh = (opts: RefreshOptions = {}): Promise<RefreshReport> => {
    if (!active) return launch(opts);
    if (!trailing) {
      const next: { catalog: boolean; promise: Promise<RefreshReport> } = {
        catalog: false,
        promise: null as unknown as Promise<RefreshReport>,
      };
      next.promise = active.then(() => {
        trailing = null;
        return launch({ catalog: next.catalog });
      });
      trailing = next;
    }
    if (opts.catalog) trailing.catalog = true;
    return trailing.promise;
  };

  const engine = new SyncEngine<VtesOperation>({
    ...options.engine,
    outbox,
    transport: createVtesSyncTransport(client),
    onFlushed: async (summary) => {
      await options.engine?.onFlushed?.(summary);
      if (autoRefresh) await refresh();
    },
  });

  const enqueue = (operation: VtesOperation, enqueueOptions?: EnqueueOptions) =>
    outbox.enqueue(operation, enqueueOptions);

  const language = async (code: string) =>
    resolveLanguageCode(code, await knownLanguageCodes(db));

  const actions: VtesActions = {
    async saveStock(input) {
      return enqueue(
        stockUpsert(clock, { ...input, languageCode: await language(input.languageCode) }),
      );
    },
    async removeStock(cardId, languageCode, cardSetId) {
      return enqueue(stockDelete(clock, cardId, await language(languageCode), cardSetId));
    },
    async createDeck(input) {
      const clientRef = newUuid();
      const entry = await enqueue(deckCreate(clock, clientRef, input), { createsRef: clientRef });
      return { clientRef, key: `ref:${clientRef}`, entry };
    },
    async updateDeck(deck, patch) {
      return enqueue(deckUpdate(clock, deck, patch));
    },
    async archiveDeck(deck, archived = true) {
      return enqueue(deckUpdate(clock, deck, { archived }));
    },
    async deleteDeck(deck) {
      return enqueue(deckDelete(clock, deck));
    },
    async saveDeckCard(deck, input) {
      return enqueue(
        deckCardUpsert(clock, deck, { ...input, languageCode: await language(input.languageCode) }),
      );
    },
    async removeDeckCard(deck, cardId, languageCode, cardSetId) {
      return enqueue(deckCardDelete(clock, deck, cardId, await language(languageCode), cardSetId));
    },
    async depositBundle(bundleId, languageCode, count) {
      return enqueue(bundleDeposit(clock, bundleId, await language(languageCode), count));
    },
  };

  let onlineListener: (() => void) | null = null;

  return {
    db,
    outbox,
    engine,
    actions,
    refresh,
    start() {
      engine.start();
      if (autoRefresh && !onlineListener && typeof window !== "undefined") {
        // Retour du réseau : le rejeu part de son côté (moteur), on relit
        // ensuite ; `refresh` attend la fin du rejeu.
        onlineListener = () => void refresh();
        window.addEventListener("online", onlineListener);
      }
      if (autoRefresh) void refresh();
    },
    stop() {
      engine.stop();
      if (onlineListener && typeof window !== "undefined") {
        window.removeEventListener("online", onlineListener);
      }
      onlineListener = null;
    },
    dispose() {
      this.stop();
      outbox.close();
      db.close();
    },
  };
}
