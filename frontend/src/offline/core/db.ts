import Dexie, { type Table } from "dexie";
import type { OperationEnvelope, OutboxEntry, RefBinding, SettledEntry } from "./types";

/** Ligne de la table `meta` : petites valeurs clé/valeur de la couche offline. */
export interface MetaRow {
  key: string;
  value: unknown;
}

/**
 * Tables du cœur, version 1 du schéma IndexedDB.
 *
 * - `outbox` : clé primaire `operationId` ; `&rank` (index unique) porte
 *   l'ordre de la file ; `state` et `clientRef` servent aux lectures ciblées ;
 * - `refs` : `ref` -> `id` (référence client -> identifiant serveur) ;
 * - `meta` : réglages divers (dates de rafraîchissement, etc.).
 *
 * **Versionnage** : une base IndexedDB porte un seul numéro de version pour
 * toutes ses tables. Le cœur et l'adaptateur les déclarent ensemble
 * (`this.version(n).stores({...CORE_STORES_V1, ...ADAPTER_STORES})`). Pour
 * faire évoluer le schéma, on **ajoute** un `this.version(n + 1)` avec les
 * seules tables modifiées (et un `.upgrade()` si des données doivent migrer) ;
 * on ne réécrit jamais une version déjà livrée : des navigateurs en ont déjà
 * ouvert la base. Une table supprimée se déclare `null`.
 */
export const CORE_STORES_V1 = {
  outbox: "operationId, &rank, state, clientRef",
  refs: "ref",
  meta: "key",
} as const;

/**
 * Version 2 : `settled`, les opérations tranchées dont le miroir n'a pas encore
 * été relu (cf. `SettledEntry`). Une base d'application la déclare à la suite de
 * sa version 1 : `this.version(2).stores({ ...CORE_STORES_V2 })`. Une base qui
 * n'active pas `retainSettled` sur sa file peut l'ignorer.
 */
export const CORE_STORES_V2 = {
  settled: "++seq, operationId",
} as const;

/**
 * Base Dexie de base : la file d'attente, la table de correspondance et les
 * métadonnées. Une base d'application l'étend, déclare ses tables (miroirs de
 * lecture) et ses versions dans son constructeur.
 */
export class OfflineCoreDb extends Dexie {
  // `declare` : Dexie crée ces propriétés à l'ouverture, un champ de classe
  // initialisé (useDefineForClassFields) les écraserait par `undefined`.
  declare outbox: Table<OutboxEntry<OperationEnvelope>, string>;
  declare refs: Table<RefBinding, string>;
  declare meta: Table<MetaRow, string>;
  /** Présente seulement si la base déclare `CORE_STORES_V2`. */
  declare settled: Table<SettledEntry<OperationEnvelope>, number>;

  constructor(name: string) {
    super(name);
  }
}
