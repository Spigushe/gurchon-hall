import type { components } from "../../api-client/schema.d.ts";
import { newUuid, toLocalIso } from "../core/ids";
import {
  toDeckRef,
  type DeckKey,
  type DeckSelector,
  type OperationOf,
} from "./types";

/**
 * Constructeurs des opérations du contrat `POST /sync`.
 *
 * Purs et synchrones : ils tirent la clé d'idempotence (`operation_id`) et
 * l'instant (`recorded_at`) **au moment de la saisie**, et rendent l'opération
 * exactement telle qu'elle partira. Les champs non fournis sont **omis** (pas
 * `undefined`, pas `null`) : le serveur empreinte les seuls champs fournis, et
 * `null` explicite (effacer une note) diffère de « ne pas y toucher ».
 */

type Schemas = components["schemas"];

export interface OperationClock {
  newId: () => string;
  now: () => string;
}

export const systemClock: OperationClock = {
  newId: newUuid,
  now: () => toLocalIso(),
};

type DeckTarget = DeckSelector | DeckKey;

/** Ne garde que les champs définis (jamais `undefined` dans une charge utile). */
function defined<T extends object>(fields: T): T {
  return Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined),
  ) as T;
}

export interface StockInput {
  cardId: number;
  languageCode: string;
  /**
   * Extension de l'impression (`GET /extensions`), obligatoire depuis le
   * Lot 4 : le couple carte × extension doit être une impression du
   * catalogue, sinon 404 (`not_found` par `/sync`).
   */
  cardSetId: number;
  quantityOwned?: number;
  notes?: string | null;
}

export function stockUpsert(
  clock: OperationClock,
  input: StockInput,
): OperationOf<"stock.upsert"> {
  return {
    type: "stock.upsert",
    operation_id: clock.newId(),
    recorded_at: clock.now(),
    data: defined({
      card_id: input.cardId,
      language_code: input.languageCode,
      card_set_id: input.cardSetId,
      quantity_owned: input.quantityOwned,
      notes: input.notes,
    }),
  };
}

export function stockDelete(
  clock: OperationClock,
  cardId: number,
  languageCode: string,
  cardSetId: number,
): OperationOf<"stock.delete"> {
  return {
    type: "stock.delete",
    operation_id: clock.newId(),
    recorded_at: clock.now(),
    card_id: cardId,
    language_code: languageCode,
    card_set_id: cardSetId,
  };
}

export interface DeckInput {
  name: string;
  createdOn?: string | null;
  status?: Schemas["DeckStatus"];
  archetype?: string | null;
  notes?: string | null;
  /**
   * Autorise les proxies dans ce deck (Lot 4) : ce n'est plus une propriété
   * de l'entrée de collection. Interdit par défaut si omis.
   */
  proxyAllowed?: boolean;
}

export function deckCreate(
  clock: OperationClock,
  clientRef: string,
  input: DeckInput,
): OperationOf<"deck.create"> {
  return {
    type: "deck.create",
    operation_id: clock.newId(),
    recorded_at: clock.now(),
    client_ref: clientRef,
    data: defined({
      name: input.name,
      created_on: input.createdOn,
      status: input.status,
      archetype: input.archetype,
      notes: input.notes,
      proxy_allowed: input.proxyAllowed,
    }),
  };
}

export interface DeckPatch {
  name?: string;
  createdOn?: string | null;
  status?: Schemas["DeckStatus"];
  archetype?: string | null;
  notes?: string | null;
  /** Autorise (`true`) ou interdit (`false`) les proxies dans ce deck (Lot 4). */
  proxyAllowed?: boolean;
  /** `true` range le deck, `false` le sort de l'archive. */
  archived?: boolean;
}

export function deckUpdate(
  clock: OperationClock,
  deck: DeckTarget,
  patch: DeckPatch,
): OperationOf<"deck.update"> {
  return {
    type: "deck.update",
    operation_id: clock.newId(),
    recorded_at: clock.now(),
    deck: toDeckRef(deck),
    data: defined({
      name: patch.name,
      created_on: patch.createdOn,
      status: patch.status,
      archetype: patch.archetype,
      notes: patch.notes,
      proxy_allowed: patch.proxyAllowed,
      archived: patch.archived,
    }),
  };
}

export function deckDelete(clock: OperationClock, deck: DeckTarget): OperationOf<"deck.delete"> {
  return {
    type: "deck.delete",
    operation_id: clock.newId(),
    recorded_at: clock.now(),
    deck: toDeckRef(deck),
  };
}

export interface DeckCardInput {
  cardId: number;
  languageCode: string;
  /**
   * Extension de l'impression allouée (`GET /extensions`), obligatoire depuis
   * le Lot 4 : le couple carte × extension doit être une impression du
   * catalogue, sinon 404 (`not_found` par `/sync`).
   */
  cardSetId: number;
  quantity: number;
  proxyQuantity?: number;
}

export function deckCardUpsert(
  clock: OperationClock,
  deck: DeckTarget,
  input: DeckCardInput,
): OperationOf<"deck_card.upsert"> {
  return {
    type: "deck_card.upsert",
    operation_id: clock.newId(),
    recorded_at: clock.now(),
    deck: toDeckRef(deck),
    data: defined({
      card_id: input.cardId,
      language_code: input.languageCode,
      card_set_id: input.cardSetId,
      quantity: input.quantity,
      proxy_quantity: input.proxyQuantity,
    }),
  };
}

export function deckCardDelete(
  clock: OperationClock,
  deck: DeckTarget,
  cardId: number,
  languageCode: string,
  cardSetId: number,
): OperationOf<"deck_card.delete"> {
  return {
    type: "deck_card.delete",
    operation_id: clock.newId(),
    recorded_at: clock.now(),
    deck: toDeckRef(deck),
    card_id: cardId,
    language_code: languageCode,
    card_set_id: cardSetId,
  };
}

export function bundleDeposit(
  clock: OperationClock,
  bundleId: number,
  languageCode: string,
  count?: number,
): OperationOf<"bundle.deposit"> {
  return {
    type: "bundle.deposit",
    operation_id: clock.newId(),
    recorded_at: clock.now(),
    bundle_id: bundleId,
    data: defined({ language_code: languageCode, count }),
  };
}
