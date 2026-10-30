import { useCallback } from "react";
import { useLiveQuery } from "../react/useLiveQuery";
import { useVtesOffline } from "./context";
import type { CardRow, CardSetRow } from "./db";
import type {
  LocalDeck,
  LocalDeckCard,
  LocalGame,
  LocalPlayer,
  LocalStockEntry,
  LocalTournament,
  LocalVenue,
} from "./overlay";
import {
  readCardSets,
  readDeck,
  readDeckCards,
  readDeckCountByCard,
  readDecks,
  readGame,
  readGames,
  readPlayer,
  readPlayers,
  readStock,
  readTournament,
  readTournaments,
  readVenue,
  readVenues,
  searchCards,
  type CardQuery,
  type DeckQuery,
  type GameQuery,
  type PlayerQuery,
  type StockQuery,
  type TournamentQuery,
} from "./reads";
import type { DeckKey, ResourceKey } from "./types";

// Lectures. `undefined` tant que la première lecture n'a pas abouti ; ensuite
// la valeur se remet à jour toute seule dès que la base ou la file change.
// (`useLocalDeck` distingue en plus « introuvable » : `null`.)
// Les paramètres sont passés en champs simples pour garder un `useCallback` stable.

export function useLocalStock(query: StockQuery = {}): LocalStockEntry[] | undefined {
  const { db } = useVtesOffline();
  const { q, languageCode, cardSetId, category } = query;
  const querier = useCallback(
    () => readStock(db, { q, languageCode, cardSetId, category }),
    [db, q, languageCode, cardSetId, category],
  );
  return useLiveQuery(querier);
}

export function useLocalDecks(query: DeckQuery = {}): LocalDeck[] | undefined {
  const { db } = useVtesOffline();
  const { q, state, status } = query;
  const querier = useCallback(() => readDecks(db, { q, state, status }), [db, q, state, status]);
  return useLiveQuery(querier);
}

/**
 * Un deck par sa clé, tous états confondus (actif, archivé).
 *
 * - `undefined` : pas encore lu (premier rendu, ou clé qui vient de changer) ;
 * - `null` : lu, et il n'existe pas (ou plus) sur cet appareil ;
 * - un `LocalDeck` sinon.
 *
 * Une clé qui change repasse par `undefined` : on ne rend jamais le deck de la
 * clé précédente.
 */
export function useLocalDeck(key: DeckKey): LocalDeck | null | undefined {
  const { db } = useVtesOffline();
  const querier = useCallback(
    async () => ({ key, deck: (await readDeck(db, key)) ?? null }),
    [db, key],
  );
  const result = useLiveQuery(querier);
  return result?.key === key ? result.deck : undefined;
}

export function useLocalDeckCards(key: DeckKey): LocalDeckCard[] | undefined {
  const { db } = useVtesOffline();
  const querier = useCallback(() => readDeckCards(db, key), [db, key]);
  return useLiveQuery(querier);
}

export function useLocalCardSearch(query: CardQuery = {}): CardRow[] | undefined {
  const { db } = useVtesOffline();
  const { q, category, limit } = query;
  const querier = useCallback(() => searchCards(db, { q, category, limit }), [db, q, category, limit]);
  return useLiveQuery(querier);
}

/** Extensions du catalogue (miroir de `GET /extensions`, Lot 4), pour choisir une impression. */
export function useLocalCardSets(): CardSetRow[] | undefined {
  const { db } = useVtesOffline();
  const querier = useCallback(() => readCardSets(db), [db]);
  return useLiveQuery(querier);
}

/**
 * Nombre de decks (tous états) utilisant chaque carte, calcul local (Lot 5bis,
 * étape 8 : colonne « Decks » de la vue tableau bureau de la Collection).
 * Voir `readDeckCountByCard`.
 */
export function useDeckCountByCardId(): Map<number, number> | undefined {
  const { db } = useVtesOffline();
  const querier = useCallback(() => readDeckCountByCard(db), [db]);
  return useLiveQuery(querier);
}

// --- Pratique de jeu (Lot 7) -----------------------------------------------
//
// `undefined` : pas encore lu. Les hooks « une ressource par sa clé » distinguent
// en plus `null` (lu, introuvable sur cet appareil) ; une clé qui change repasse
// par `undefined`. La clé peut être canonique (`ref:<uuid>`) ou un alias
// (`id:<n>`) : voir `LocalResource.aliases`.

export function useLocalPlayers(query: PlayerQuery = {}): LocalPlayer[] | undefined {
  const { db } = useVtesOffline();
  const { q } = query;
  const querier = useCallback(() => readPlayers(db, { q }), [db, q]);
  return useLiveQuery(querier);
}

export function useLocalVenues(query: PlayerQuery = {}): LocalVenue[] | undefined {
  const { db } = useVtesOffline();
  const { q } = query;
  const querier = useCallback(() => readVenues(db, { q }), [db, q]);
  return useLiveQuery(querier);
}

export function useLocalTournaments(query: TournamentQuery = {}): LocalTournament[] | undefined {
  const { db } = useVtesOffline();
  const { q, from, to } = query;
  const querier = useCallback(() => readTournaments(db, { q, from, to }), [db, q, from, to]);
  return useLiveQuery(querier);
}

export function useLocalGames(query: GameQuery = {}): LocalGame[] | undefined {
  const { db } = useVtesOffline();
  const { tournamentKey, casual, deckKey, venueKey, from, to } = query;
  const querier = useCallback(
    () => readGames(db, { tournamentKey, casual, deckKey, venueKey, from, to }),
    [db, tournamentKey, casual, deckKey, venueKey, from, to],
  );
  return useLiveQuery(querier);
}

/** Lecture d'une ressource par clé, avec la distinction `undefined` / `null` des decks. */
function useByKey<T>(
  read: (key: ResourceKey) => Promise<T | undefined>,
  key: ResourceKey,
): T | null | undefined {
  const querier = useCallback(async () => ({ key, found: (await read(key)) ?? null }), [read, key]);
  const result = useLiveQuery(querier);
  return result?.key === key ? result.found : undefined;
}

export function useLocalPlayer(key: ResourceKey): LocalPlayer | null | undefined {
  const { db } = useVtesOffline();
  const read = useCallback((k: ResourceKey) => readPlayer(db, k), [db]);
  return useByKey(read, key);
}

export function useLocalVenue(key: ResourceKey): LocalVenue | null | undefined {
  const { db } = useVtesOffline();
  const read = useCallback((k: ResourceKey) => readVenue(db, k), [db]);
  return useByKey(read, key);
}

export function useLocalTournament(key: ResourceKey): LocalTournament | null | undefined {
  const { db } = useVtesOffline();
  const read = useCallback((k: ResourceKey) => readTournament(db, k), [db]);
  return useByKey(read, key);
}

export function useLocalGame(key: ResourceKey): LocalGame | null | undefined {
  const { db } = useVtesOffline();
  const read = useCallback((k: ResourceKey) => readGame(db, k), [db]);
  return useByKey(read, key);
}
