import type { Client } from "openapi-fetch";
import type { components, paths } from "../../api-client/schema.d.ts";

/** Client HTTP typé généré depuis le contrat (cf. `src/api-client`). */
export type ApiClient = Client<paths>;

type Schemas = components["schemas"];

/** Une opération du contrat `POST /sync`, union discriminée par `type`. */
export type VtesOperation = Schemas["SyncRequest"]["operations"][number];
export type VtesOperationType = VtesOperation["type"];
export type OperationOf<T extends VtesOperationType> = Extract<VtesOperation, { type: T }>;

export type DeckStatus = Schemas["DeckStatus"];
export type CardCategory = Schemas["CardCategory"];

/** Désignation d'un deck : identifiant serveur, ou référence client d'une création hors ligne. */
export type DeckSelector = { deckId: number } | { clientRef: string };

/**
 * Clé stable d'un deck côté UI : `ref:<uuid>` pour un deck créé hors ligne (la
 * clé ne change pas quand le serveur lui attribue un identifiant), `id:<n>`
 * pour un deck venu du serveur.
 */
export type DeckKey = `id:${number}` | `ref:${string}`;

export function deckKeyOf(selector: DeckSelector): DeckKey {
  return "deckId" in selector ? `id:${selector.deckId}` : `ref:${selector.clientRef}`;
}

export function parseDeckKey(key: DeckKey): DeckSelector {
  if (key.startsWith("ref:")) return { clientRef: key.slice(4) };
  return { deckId: Number(key.slice(3)) };
}

export function toDeckRef(target: DeckSelector | DeckKey): Schemas["DeckRef"] {
  const selector = typeof target === "string" ? parseDeckKey(target) : target;
  return "deckId" in selector
    ? { deck_id: selector.deckId }
    : { client_ref: selector.clientRef };
}
