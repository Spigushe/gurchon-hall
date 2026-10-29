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

// --- Clés de surcouche (Lot 7) ---------------------------------------------
//
// Même patron que `DeckKey` pour les autres ressources saisies hors ligne : la
// clé ne change pas quand le serveur attribue un identifiant à une création
// (`ref:<uuid>` avant comme après), `id:<n>` pour ce qui vient du serveur. Les
// cinq alias ont la même forme, TypeScript ne les distingue donc pas : c'est la
// table où l'on cherche (joueurs, lieux, tournois, parties, decks) et le genre
// de la correspondance (`vtes/references.ts`) qui les distinguent. Ne jamais
// chercher une `PlayerKey` dans les decks, même si les chaînes se ressemblent.

/** Forme commune des clés de surcouche. */
export type ResourceKey = `id:${number}` | `ref:${string}`;
export type PlayerKey = ResourceKey;
export type VenueKey = ResourceKey;
export type TournamentKey = ResourceKey;
export type GameKey = ResourceKey;

/** Désignation d'une ressource : identifiant serveur, ou référence client d'une création hors ligne. */
export type ResourceSelector = { id: number } | { clientRef: string };

export function resourceKeyOf(selector: ResourceSelector): ResourceKey {
  return "id" in selector ? `id:${selector.id}` : `ref:${selector.clientRef}`;
}

export function parseResourceKey(key: ResourceKey): ResourceSelector {
  if (key.startsWith("ref:")) return { clientRef: key.slice(4) };
  return { id: Number(key.slice(3)) };
}

export const playerKeyOf: (selector: ResourceSelector) => PlayerKey = resourceKeyOf;
export const venueKeyOf: (selector: ResourceSelector) => VenueKey = resourceKeyOf;
export const tournamentKeyOf: (selector: ResourceSelector) => TournamentKey = resourceKeyOf;
export const gameKeyOf: (selector: ResourceSelector) => GameKey = resourceKeyOf;
