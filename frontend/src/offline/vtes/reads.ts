import { foldText } from "../core/foldText";
import type { CardRow, CardSetRow, VtesOfflineDb } from "./db";
import {
  findByKey,
  project,
  type LocalDeck,
  type LocalDeckCard,
  type LocalGame,
  type LocalPlayer,
  type LocalStockEntry,
  type LocalTournament,
  type LocalVenue,
  type Projection,
  type Snapshot,
} from "./overlay";
import type { CardCategory, DeckKey, ResourceKey, VtesOperation } from "./types";

/**
 * Lectures locales : ce que l'UI affiche, en ligne comme hors ligne, sans
 * jamais toucher au réseau. Chaque lecture est une seule transaction de
 * lecture (instantané cohérent) et peut s'envelopper dans `liveQuery`
 * (Dexie) pour se remettre à jour toute seule.
 *
 * Les recherches `q` replient casse et accents comme le serveur
 * (`foldText`, parité testée) : « elan » trouve « Élan vital » dans les deux
 * mondes, « oe » ne trouve pas « Œuvre » dans aucun.
 */

export async function readProjection(db: VtesOfflineDb): Promise<Projection> {
  return db.transaction(
    "r",
    [
      db.stock,
      db.decks,
      db.deckCards,
      db.cards,
      db.players,
      db.venues,
      db.tournaments,
      db.games,
      db.refs,
      db.outbox,
      db.settled,
    ],
    async () => {
      const [stock, decks, deckCards, cards, players, venues, tournaments, games, refs, queued, settled] =
        await Promise.all([
          db.stock.toArray(),
          db.decks.toArray(),
          db.deckCards.toArray(),
          db.cards.toArray(),
          db.players.toArray(),
          db.venues.toArray(),
          db.tournaments.toArray(),
          db.games.toArray(),
          db.refs.toArray(),
          db.outbox.orderBy("rank").toArray(),
          db.settled.orderBy("seq").toArray(),
        ]);
      const snapshot: Snapshot = {
        stock,
        decks,
        deckCards,
        cards,
        refs,
        players,
        venues,
        tournaments,
        games,
      };
      // Les refusées n'ont aucun effet (le serveur n'a rien écrit) ; les
      // `pending` et `sending` sont ce que l'utilisateur a saisi et attend de voir.
      const operations = queued
        .filter((entry) => entry.state !== "rejected")
        .map((entry) => entry.operation as VtesOperation);
      return project(
        snapshot,
        operations,
        settled.map((entry) => entry.operation as VtesOperation),
      );
    },
  );
}

/** Comparaison par unités de code, comme le tri binaire par défaut de SQLite pour le BMP. */
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export interface StockQuery {
  /** Texte cherché dans le nom de la carte (casse et accents ignorés). */
  q?: string;
  languageCode?: string;
  /** Extension de l'impression (Lot 4), comme le filtre `card_set_id` de `GET /stock`. */
  cardSetId?: number;
  category?: CardCategory;
}

export async function readStock(
  db: VtesOfflineDb,
  query: StockQuery = {},
): Promise<LocalStockEntry[]> {
  const { stock } = await readProjection(db);
  const needle = query.q ? foldText(query.q) : "";
  const language = query.languageCode?.trim().toUpperCase();
  return stock
    .filter(
      (entry) =>
        (!needle || (foldText(entry.cardName) ?? "").includes(needle)) &&
        (!language || entry.languageCode === language) &&
        (query.cardSetId === undefined || entry.cardSetId === query.cardSetId) &&
        (!query.category || entry.category === query.category),
    )
    .sort(
      (a, b) =>
        compare(a.cardName ?? "", b.cardName ?? "") ||
        compare(a.languageCode, b.languageCode) ||
        a.cardId - b.cardId ||
        a.cardSetId - b.cardSetId,
    );
}

export type DeckListState = "active" | "archived" | "all";

export interface DeckQuery {
  q?: string;
  /** Comme `GET /decks` : `active` (défaut), `archived` ou `all`. */
  state?: DeckListState;
  status?: "draft" | "active";
}

export async function readDecks(db: VtesOfflineDb, query: DeckQuery = {}): Promise<LocalDeck[]> {
  const { decks } = await readProjection(db);
  const needle = query.q ? foldText(query.q) : "";
  const state = query.state ?? "active";
  return decks
    .filter(
      (deck) =>
        (!needle || foldText(deck.name).includes(needle)) &&
        (state === "all" || (state === "archived") === (deck.archivedAt !== null)) &&
        (!query.status || deck.status === query.status),
    )
    .sort((a, b) => compare(a.name, b.name) || compare(a.discriminator ?? "", b.discriminator ?? ""));
}

/** Un deck par sa clé, quel que soit son état ; `undefined` s'il n'existe pas (ou plus). */
export async function readDeck(db: VtesOfflineDb, key: DeckKey): Promise<LocalDeck | undefined> {
  const { decks } = await readProjection(db);
  return decks.find((deck) => deck.key === key);
}

export async function readDeckCards(db: VtesOfflineDb, key: DeckKey): Promise<LocalDeckCard[]> {
  const { deckCards } = await readProjection(db);
  return (deckCards.get(key) ?? []).sort(
    (a, b) =>
      compare(a.cardName ?? "", b.cardName ?? "") ||
      compare(a.languageCode, b.languageCode) ||
      a.cardId - b.cardId ||
      a.cardSetId - b.cardSetId,
  );
}

export interface CardQuery {
  q?: string;
  category?: CardCategory;
  limit?: number;
}

/** Recherche dans le miroir du catalogue (pour saisir une carte hors ligne). */
export async function searchCards(db: VtesOfflineDb, query: CardQuery = {}): Promise<CardRow[]> {
  const needle = query.q ? foldText(query.q) : "";
  const found = await db.cards
    .filter(
      (card) =>
        (!needle || card.foldedName.includes(needle)) &&
        (!query.category || card.category === query.category),
    )
    .toArray();
  found.sort((a, b) => compare(a.name, b.name) || a.id - b.id);
  return found.slice(0, query.limit ?? 50);
}

/**
 * Nombre de decks (tous états, decks vivants seulement — un deck supprimé ne
 * figure déjà plus dans la projection) utilisant chaque carte, tous langue et
 * extension confondues. Calcul strictement local (Lot 5bis, étape 8, colonne
 * « Decks » de la vue tableau de la Collection, `docs/design-handoff/DESKTOP.md`
 * « d02 ») : lu sur la même projection que le reste de l'UI (instantané plus
 * file), donc une carte tout juste ajoutée à un deck hors ligne compte
 * immédiatement, sans attendre la synchronisation.
 */
export async function readDeckCountByCard(db: VtesOfflineDb): Promise<Map<number, number>> {
  const { deckCards } = await readProjection(db);
  const decksByCard = new Map<number, Set<DeckKey>>();
  for (const [deckKey, lines] of deckCards) {
    for (const line of lines) {
      const decks = decksByCard.get(line.cardId) ?? new Set<DeckKey>();
      decks.add(deckKey);
      decksByCard.set(line.cardId, decks);
    }
  }
  return new Map([...decksByCard].map(([cardId, decks]) => [cardId, decks.size]));
}

/** Ce que les filtres de statut de Chercher lisent dans la projection (P4). */
export interface CardSearchStatus {
  /** Cartes dont une entrée de collection a au moins un exemplaire. */
  ownedCardIds: Set<number>;
  /** Cartes du deck choisi, file comprise ; vide sans deck. */
  deckCardIds: Set<number>;
  /** Exemplaires possédés par carte, toutes langues et extensions (« 3 en collection »). */
  ownedCounts: Map<number, number>;
  /** Exemplaires par carte dans le deck choisi, proxies compris (« dans ce deck ×2 ») ; vide sans deck. */
  deckQuantities: Map<number, number>;
}

const sumBy = <T>(items: readonly T[], key: (item: T) => number, value: (item: T) => number) => {
  const totals = new Map<number, number>();
  for (const item of items) totals.set(key(item), (totals.get(key(item)) ?? 0) + value(item));
  return totals;
};

export async function readCardSearchStatus(db: VtesOfflineDb, deckKey?: DeckKey | null): Promise<CardSearchStatus> {
  const { stock, deckCards } = await readProjection(db);
  const lines = deckKey ? (deckCards.get(deckKey) ?? []) : [];
  const owned = stock.filter((entry) => entry.quantityOwned > 0);
  return {
    ownedCardIds: new Set(owned.map((entry) => entry.cardId)),
    deckCardIds: new Set(lines.map((line) => line.cardId)),
    ownedCounts: sumBy(owned, (entry) => entry.cardId, (entry) => entry.quantityOwned),
    deckQuantities: sumBy(lines, (line) => line.cardId, (line) => line.quantity),
  };
}

/** Ce que la fiche d'une carte montre de la collection et des decks (Chercher, D1c). */
export interface CardUsage {
  /** Entrées de collection de la carte qui ont au moins un exemplaire, langue puis extension. */
  copies: LocalStockEntry[];
  /** Decks vivants qui jouent la carte, avec leurs exemplaires (proxies compris), par nom. */
  decks: Array<{ deck: LocalDeck; quantity: number }>;
}

export async function readCardUsage(db: VtesOfflineDb, cardId: number): Promise<CardUsage> {
  const { stock, decks, deckCards } = await readProjection(db);
  const copies = stock
    .filter((entry) => entry.cardId === cardId && entry.quantityOwned > 0)
    .sort((a, b) => compare(a.languageCode, b.languageCode) || a.cardSetId - b.cardSetId);
  const playing = decks
    .map((deck) => ({
      deck,
      quantity: (deckCards.get(deck.key) ?? [])
        .filter((line) => line.cardId === cardId)
        .reduce((total, line) => total + line.quantity, 0),
    }))
    .filter((usage) => usage.quantity > 0)
    .sort((a, b) => compare(foldText(a.deck.name), foldText(b.deck.name)));
  return { copies, decks: playing };
}

/** Où en est le miroir du catalogue (lot Chercher). */
export interface CatalogMirrorState {
  /** Lignes de `cards`. */
  cards: number;
  /** Lignes de `cardDetails`. */
  details: number;
  /**
   * Détails présents pour tout le catalogue. « Incomplet » se lit sans
   * marqueur : `cardDetails` vide ou plus court que `cards` (montée de la
   * version 5, ancien serveur, catalogue jamais relu depuis le lot Chercher).
   * Un catalogue vide n'est pas complet.
   */
  complete: boolean;
}

export async function readCatalogState(db: VtesOfflineDb): Promise<CatalogMirrorState> {
  return db.transaction("r", db.cards, db.cardDetails, async () => {
    const [cards, details] = await Promise.all([db.cards.count(), db.cardDetails.count()]);
    return { cards, details, complete: cards > 0 && details >= cards };
  });
}

/**
 * Extensions du catalogue (miroir de `GET /extensions`), triées comme le
 * serveur : date de sortie, les extensions sans date en dernier, puis
 * abréviation (CLAUDE.md §7, Lot 4).
 */
export async function readCardSets(db: VtesOfflineDb): Promise<CardSetRow[]> {
  const found = await db.cardSets.toArray();
  found.sort((a, b) => {
    if (a.releaseDate !== b.releaseDate) {
      if (a.releaseDate === null) return 1;
      if (b.releaseDate === null) return -1;
      return compare(a.releaseDate, b.releaseDate);
    }
    return compare(a.abbrev, b.abbrev);
  });
  return found;
}

// --- Pratique de jeu (Lot 7) -----------------------------------------------
//
// Mêmes lectures locales que les decks : instantané, opérations tranchées pas
// encore reprises, puis file. Une ressource se retrouve par sa clé canonique ou
// par l'un de ses alias (`id:<n>` ou `ref:<uuid>`).

export interface PlayerQuery {
  /** Texte cherché dans le nom (casse et accents ignorés). */
  q?: string;
}

/** Le « Moi » en tête, puis l'ordre alphabétique des noms. */
export async function readPlayers(db: VtesOfflineDb, query: PlayerQuery = {}): Promise<LocalPlayer[]> {
  const { players } = await readProjection(db);
  const needle = query.q ? foldText(query.q) : "";
  return players
    .filter((player) => !needle || foldText(player.name).includes(needle))
    .sort((a, b) => Number(b.isMe) - Number(a.isMe) || compare(a.name, b.name));
}

export async function readPlayer(db: VtesOfflineDb, key: ResourceKey): Promise<LocalPlayer | undefined> {
  const { players } = await readProjection(db);
  return findByKey(players, key);
}

export async function readVenues(db: VtesOfflineDb, query: PlayerQuery = {}): Promise<LocalVenue[]> {
  const { venues } = await readProjection(db);
  const needle = query.q ? foldText(query.q) : "";
  return venues
    .filter((venue) => !needle || foldText(venue.name).includes(needle))
    .sort((a, b) => compare(a.name, b.name));
}

export async function readVenue(db: VtesOfflineDb, key: ResourceKey): Promise<LocalVenue | undefined> {
  const { venues } = await readProjection(db);
  return findByKey(venues, key);
}

export interface TournamentQuery {
  q?: string;
  /** Dates locales `AAAA-MM-JJ`, bornes incluses, sur la date de début (comme `GET /tournois`). */
  from?: string;
  to?: string;
}

/** Du plus récent au plus ancien. */
export async function readTournaments(
  db: VtesOfflineDb,
  query: TournamentQuery = {},
): Promise<LocalTournament[]> {
  const { tournaments } = await readProjection(db);
  const needle = query.q ? foldText(query.q) : "";
  return tournaments
    .filter(
      (tournament) =>
        (!needle || foldText(tournament.name).includes(needle)) &&
        (!query.from || tournament.startDate >= query.from) &&
        (!query.to || tournament.startDate <= query.to),
    )
    .sort((a, b) => compare(b.startDate, a.startDate) || compare(a.name, b.name));
}

export async function readTournament(
  db: VtesOfflineDb,
  key: ResourceKey,
): Promise<LocalTournament | undefined> {
  const { tournaments } = await readProjection(db);
  return findByKey(tournaments, key);
}

export interface GameQuery {
  /** Les parties d'un tournoi (clé canonique ou alias). */
  tournamentKey?: ResourceKey;
  /** Vrai : les seules amicales ; faux : les seules parties de tournoi. */
  casual?: boolean;
  /** Le deck que j'ai joué (clé canonique ou alias). */
  deckKey?: DeckKey;
  venueKey?: ResourceKey;
  /** Instants ISO avec fuseau, bornes incluses. */
  from?: string;
  to?: string;
}

/**
 * Du plus récent au plus ancien. Les filtres par ressource liée se comparent à
 * sa clé canonique, quel que soit l'alias demandé.
 */
export async function readGames(db: VtesOfflineDb, query: GameQuery = {}): Promise<LocalGame[]> {
  const projection = await readProjection(db);
  const tournament =
    query.tournamentKey && (findByKey(projection.tournaments, query.tournamentKey)?.key ?? query.tournamentKey);
  const venue = query.venueKey && (findByKey(projection.venues, query.venueKey)?.key ?? query.venueKey);
  const deck =
    query.deckKey && (projection.decks.find((item) => item.key === query.deckKey)?.key ?? query.deckKey);
  const from = query.from ? Date.parse(query.from) : null;
  const to = query.to ? Date.parse(query.to) : null;
  return projection.games
    .filter((game) => {
      const at = Date.parse(game.playedAt);
      return (
        (!tournament || game.tournamentKey === tournament) &&
        (query.casual === undefined || (game.tournamentKey === null) === query.casual) &&
        (!deck || game.me.deckKey === deck) &&
        (!venue || game.venueKey === venue) &&
        (from === null || at >= from) &&
        (to === null || at <= to)
      );
    })
    .sort((a, b) => Date.parse(b.playedAt) - Date.parse(a.playedAt) || compare(b.key, a.key));
}

export async function readGame(db: VtesOfflineDb, key: ResourceKey): Promise<LocalGame | undefined> {
  const { games } = await readProjection(db);
  return findByKey(games, key);
}
