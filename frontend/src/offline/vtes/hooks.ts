import { useCallback, useMemo, useSyncExternalStore } from "react";
import { useLiveQuery } from "../react/useLiveQuery";
import { useVtesOffline } from "./context";
import { todayUtc } from "./cardLegality";
import {
  filterCards,
  nameMatchesFirst,
  sortCards,
  type CardSort,
  type SearchableCard,
  type SearchCatalog,
  type SearchCriteria,
} from "./cardSearch";
import type { CardRow, CardSetRow, DeckVersionRow } from "./db";
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
  readCardSearchStatus,
  readCardUsage,
  readCardSets,
  readClans,
  readDeck,
  readDeckCards,
  readDeckCardsByDeck,
  readDeckCountByCard,
  readAllDeckVersions,
  readDeckVersion,
  readDeckVersions,
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
  type CardSearchStatus,
  type CardUsage,
  type ClanOption,
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

/** Lignes de tous les decks vivants, par deck (`readDeckCardsByDeck`). */
export function useLocalDeckCardsByDeck(): Map<DeckKey, LocalDeckCard[]> | undefined {
  const { db } = useVtesOffline();
  const querier = useCallback(() => readDeckCardsByDeck(db), [db]);
  return useLiveQuery(querier);
}

export function useLocalCardSearch(query: CardQuery = {}): CardRow[] | undefined {
  const { db } = useVtesOffline();
  const { q, category, limit } = query;
  const querier = useCallback(() => searchCards(db, { q, category, limit }), [db, q, category, limit]);
  return useLiveQuery(querier);
}

/**
 * Le catalogue joint et indexé en mémoire (lot Chercher), partagé par tous les
 * composants d'un même runtime : `undefined` avant la première lecture.
 */
export function useSearchCatalog(): SearchCatalog | undefined {
  const { catalog } = useVtesOffline();
  const subscribe = useCallback((listener: () => void) => catalog.subscribe(listener), [catalog]);
  return useSyncExternalStore(subscribe, () => catalog.snapshot());
}

/** Cartes possédées et cartes du deck choisi, pour les filtres de statut (P4). */
export function useCardSearchStatus(deckKey?: DeckKey | null): CardSearchStatus | undefined {
  const { db } = useVtesOffline();
  const querier = useCallback(() => readCardSearchStatus(db, deckKey), [db, deckKey]);
  return useLiveQuery(querier);
}

/** Exemplaires possédés et decks qui jouent une carte (fiche de Chercher). `null` : aucune carte. */
export function useCardUsage(cardId: number | null): CardUsage | undefined {
  const { db } = useVtesOffline();
  const querier = useCallback(
    async () => (cardId === null ? { copies: [], decks: [] } : readCardUsage(db, cardId)),
    [db, cardId],
  );
  return useLiveQuery(querier);
}

export interface CardSearchOptions {
  /** Deck cible du filtre « dans ce deck » (P4, P12). */
  deckKey?: DeckKey | null;
  sort?: CardSort;
  /** Date d'évaluation de la légalité ; la date UTC du jour par défaut. */
  on?: string;
  /** Proposition de P1 (à valider en D1c) : sous le tri par nom, les correspondances par le nom d'abord. */
  nameMatchesFirst?: boolean;
}

export interface CardSearchResult {
  /** Résultats filtrés et triés ; `undefined` tant que le catalogue ou la projection n'est pas lu. */
  cards: SearchableCard[] | undefined;
  /** Nombre de résultats trouvés par leur nom (champ principal), quand `nameMatchesFirst`. */
  byName: number | undefined;
  /** Détails du catalogue complets : les filtres avancés sont utilisables. */
  complete: boolean;
}

/**
 * Recherche de Chercher : catalogue en mémoire, filtres purs, aucun parcours de
 * la base par frappe. Le filtre est recalculé quand les critères, le catalogue
 * ou la projection changent ; les critères doivent donc être un objet stable
 * (mémoïsé par l'appelant).
 */
export function useCardSearch(criteria: SearchCriteria, options: CardSearchOptions = {}): CardSearchResult {
  const catalog = useSearchCatalog();
  const status = useCardSearchStatus(options.deckKey);
  const on = options.on ?? todayUtc();
  const { sort, nameMatchesFirst: grouped } = options;
  return useMemo(
    () => runCardSearch(catalog, status, criteria, { on, sort, grouped }),
    [catalog, status, criteria, on, sort, grouped],
  );
}

/** Le calcul de `useCardSearch`, hors React (testé à part). */
export function runCardSearch(
  catalog: SearchCatalog | undefined,
  status: CardSearchStatus | undefined,
  criteria: SearchCriteria,
  options: { on: string; sort?: CardSort; grouped?: boolean },
): CardSearchResult {
  const complete = catalog?.complete ?? false;
  if (!catalog || !status) return { cards: undefined, byName: undefined, complete };
  const sorted = sortCards(filterCards(catalog.cards, criteria, { ...status, on: options.on }), options.sort);
  if (!options.grouped || (options.sort && options.sort.key !== "name")) {
    return { cards: sorted, byName: undefined, complete };
  }
  const { cards, byName } = nameMatchesFirst(sorted, criteria.query ?? "");
  return { cards, byName, complete };
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

// --- Versions de deck jouées et clans (Lot 8) -------------------------------

/** Versions jouées d'un deck, par numéro croissant (`readDeckVersions`). */
export function useLocalDeckVersions(key: DeckKey | null): DeckVersionRow[] | undefined {
  const { db } = useVtesOffline();
  const querier = useCallback(async () => (key === null ? [] : readDeckVersions(db, key)), [db, key]);
  return useLiveQuery(querier);
}

/**
 * Une version par son identifiant : `null` si la partie n'est pas encore figée
 * (identifiant nul) ou que le miroir ne l'a pas lue, `undefined` avant la
 * première lecture.
 */
export function useLocalDeckVersion(id: number | null): DeckVersionRow | null | undefined {
  const { db } = useVtesOffline();
  const querier = useCallback(
    async () => (id === null ? null : ((await readDeckVersion(db, id)) ?? null)),
    [db, id],
  );
  return useLiveQuery(querier);
}

/** Toutes les versions jouées du miroir (`readAllDeckVersions`), pour le bilan. */
export function useLocalAllDeckVersions(): DeckVersionRow[] | undefined {
  const { db } = useVtesOffline();
  const querier = useCallback(() => readAllDeckVersions(db), [db]);
  return useLiveQuery(querier);
}

/** Clans du catalogue, pour le clan principal d'un adversaire (`readClans`). */
export function useLocalClans(): ClanOption[] | undefined {
  const { db } = useVtesOffline();
  const querier = useCallback(() => readClans(db), [db]);
  return useLiveQuery(querier);
}
