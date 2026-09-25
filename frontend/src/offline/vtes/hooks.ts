import { useCallback } from "react";
import { useLiveQuery } from "../react/useLiveQuery";
import { useVtesOffline } from "./context";
import type { CardRow, CardSetRow } from "./db";
import type { LocalDeck, LocalDeckCard, LocalStockEntry } from "./overlay";
import {
  readCardSets,
  readDeck,
  readDeckCards,
  readDecks,
  readStock,
  searchCards,
  type CardQuery,
  type DeckQuery,
  type StockQuery,
} from "./reads";
import type { DeckKey } from "./types";

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
