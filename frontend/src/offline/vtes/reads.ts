import { foldText } from "../core/foldText";
import type { CardRow, VtesOfflineDb } from "./db";
import {
  project,
  type LocalDeck,
  type LocalDeckCard,
  type LocalStockEntry,
  type Projection,
  type Snapshot,
} from "./overlay";
import type { CardCategory, DeckKey, VtesOperation } from "./types";

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
    [db.stock, db.decks, db.deckCards, db.cards, db.refs, db.outbox, db.settled],
    async () => {
      const [stock, decks, deckCards, cards, refs, queued, settled] = await Promise.all([
        db.stock.toArray(),
        db.decks.toArray(),
        db.deckCards.toArray(),
        db.cards.toArray(),
        db.refs.toArray(),
        db.outbox.orderBy("rank").toArray(),
        db.settled.orderBy("seq").toArray(),
      ]);
      const snapshot: Snapshot = { stock, decks, deckCards, cards, refs };
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
        (!query.category || entry.category === query.category),
    )
    .sort(
      (a, b) =>
        compare(a.cardName ?? "", b.cardName ?? "") ||
        compare(a.languageCode, b.languageCode) ||
        a.cardId - b.cardId,
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
      a.cardId - b.cardId,
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
