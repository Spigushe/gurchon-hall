import type { RefBinding } from "../core/types";
import type { CardRow, DeckCardRow, DeckRow, StockRow } from "./db";
import type { CardCategory, DeckKey, DeckStatus, VtesOperation } from "./types";

/** Entrée de collection telle que l'UI la lit : instantané + opérations en file. */
export interface LocalStockEntry {
  cardId: number;
  languageCode: string;
  quantityOwned: number;
  proxyAllowed: boolean;
  notes: string | null;
  cardName: string | null;
  category: CardCategory | null;
  /** Une opération en file touche cette entrée : elle n'est pas encore au serveur. */
  pending: boolean;
}

export interface LocalDeck {
  /** Clé stable : `ref:<uuid>` pour un deck créé hors ligne, `id:<n>` sinon. */
  key: DeckKey;
  /** Identifiant serveur ; `null` tant qu'une création hors ligne n'est pas synchronisée. */
  id: number | null;
  /** Référence client d'un deck créé hors ligne, sinon `null`. */
  clientRef: string | null;
  name: string;
  /** Tiré par le serveur : `null` tant que le deck n'existe pas côté serveur. */
  discriminator: string | null;
  createdOn: string | null;
  status: DeckStatus;
  archetype: string | null;
  notes: string | null;
  archivedAt: string | null;
  pending: boolean;
}

export interface LocalDeckCard {
  cardId: number;
  languageCode: string;
  quantity: number;
  proxyQuantity: number;
  cardName: string | null;
  pending: boolean;
}

export interface Snapshot {
  stock: StockRow[];
  decks: DeckRow[];
  deckCards: DeckCardRow[];
  cards: CardRow[];
  refs: RefBinding[];
}

export interface Projection {
  stock: LocalStockEntry[];
  decks: LocalDeck[];
  /** Composition par clé de deck. */
  deckCards: Map<DeckKey, LocalDeckCard[]>;
}

const pairKey = (cardId: number, languageCode: string) => `${cardId}|${languageCode}`;

/**
 * Lecture locale = instantané du serveur **plus** opérations tranchées dont le
 * miroir n'est pas à jour **plus** opérations en file.
 *
 * Fonction pure : `operations` sont celles qui ne sont ni tranchées ni refusées
 * (`pending` / `sending`), dans l'ordre de la file. `settled` sont celles que le
 * serveur a confirmées et qu'un rafraîchissement n'a pas encore reprises (table
 * `settled`) : sans elles, une opération qui quitte la file ferait disparaître
 * son effet jusqu'à la prochaine lecture du serveur (un deck créé hors ligne
 * s'évanouirait entre son verdict et le rafraîchissement). Elles s'appliquent
 * avant la file, sans marque `pending`. Chacune est appliquée comme
 * le serveur le ferait (dernière écriture gagnante), **sans** rejouer ses
 * invariants : ils restent l'affaire du serveur, dont le verdict arrivera. Un
 * refus fait donc simplement disparaître l'effet de l'opération au prochain
 * calcul, sans état local à défaire.
 *
 * Limite : `bundle.deposit` n'est pas projeté (le contenu du produit n'est pas
 * miroité) ; le stock correspondant apparaît au rafraîchissement suivant la
 * synchronisation.
 */
export function project(
  snapshot: Snapshot,
  operations: readonly VtesOperation[],
  settled: readonly VtesOperation[] = [],
): Projection {
  const cardsById = new Map(snapshot.cards.map((card) => [card.id, card]));
  const refByDeckId = new Map(snapshot.refs.map((binding) => [binding.id, binding.ref]));
  const deckIdByRef = new Map(snapshot.refs.map((binding) => [binding.ref, binding.id]));

  // --- Instantané ---
  const stock = new Map<string, LocalStockEntry>();
  for (const row of snapshot.stock) {
    stock.set(pairKey(row.cardId, row.languageCode), {
      cardId: row.cardId,
      languageCode: row.languageCode,
      quantityOwned: row.quantityOwned,
      proxyAllowed: row.proxyAllowed,
      notes: row.notes,
      cardName: row.cardName ?? cardsById.get(row.cardId)?.name ?? null,
      category: row.category ?? cardsById.get(row.cardId)?.category ?? null,
      pending: false,
    });
  }

  const decks = new Map<DeckKey, LocalDeck>();
  const keyByDeckId = new Map<number, DeckKey>();
  const keyByRef = new Map<string, DeckKey>();
  for (const row of snapshot.decks) {
    const ref = refByDeckId.get(row.id) ?? null;
    const key: DeckKey = ref ? `ref:${ref}` : `id:${row.id}`;
    decks.set(key, {
      key,
      id: row.id,
      clientRef: ref,
      name: row.name,
      discriminator: row.discriminator,
      createdOn: row.createdOn,
      status: row.status,
      archetype: row.archetype,
      notes: row.notes,
      archivedAt: row.archivedAt,
      pending: false,
    });
    keyByDeckId.set(row.id, key);
    if (ref) keyByRef.set(ref, key);
  }

  const deckCards = new Map<DeckKey, Map<string, LocalDeckCard>>();
  for (const row of snapshot.deckCards) {
    const key = keyByDeckId.get(row.deckId);
    if (!key) continue;
    const cards = deckCards.get(key) ?? new Map<string, LocalDeckCard>();
    cards.set(pairKey(row.cardId, row.languageCode), {
      cardId: row.cardId,
      languageCode: row.languageCode,
      quantity: row.quantity,
      proxyQuantity: row.proxyQuantity,
      cardName: row.cardName ?? cardsById.get(row.cardId)?.name ?? null,
      pending: false,
    });
    deckCards.set(key, cards);
  }

  const resolveDeck = (ref: { deck_id?: number | null; client_ref?: string | null }) => {
    if (ref.deck_id != null) return keyByDeckId.get(ref.deck_id);
    if (ref.client_ref != null) {
      const direct = keyByRef.get(ref.client_ref);
      if (direct) return direct;
      const id = deckIdByRef.get(ref.client_ref);
      return id === undefined ? undefined : keyByDeckId.get(id);
    }
    return undefined;
  };

  // `pending` : l'opération est encore dans la file (le serveur ne l'a pas
  // confirmée) ; sinon elle est tranchée, seul le miroir n'est pas à jour.
  const apply = (operation: VtesOperation, pending: boolean) => {
    switch (operation.type) {
      case "stock.upsert": {
        const { card_id: cardId, language_code: languageCode, ...rest } = operation.data;
        const card = cardsById.get(cardId);
        stock.set(pairKey(cardId, languageCode), {
          cardId,
          languageCode,
          // État complet voulu : ce qui n'est pas fourni prend la valeur par défaut.
          quantityOwned: rest.quantity_owned ?? 0,
          proxyAllowed: rest.proxy_allowed ?? false,
          notes: rest.notes ?? null,
          cardName: card?.name ?? stock.get(pairKey(cardId, languageCode))?.cardName ?? null,
          category: card?.category ?? stock.get(pairKey(cardId, languageCode))?.category ?? null,
          pending,
        });
        break;
      }
      case "stock.delete":
        stock.delete(pairKey(operation.card_id, operation.language_code));
        break;
      case "deck.create": {
        const key: DeckKey = `ref:${operation.client_ref}`;
        // Le miroir a déjà ce deck (rafraîchi après le verdict, avant l'effacement
        // de l'opération tranchée) : il fait foi, on ne le réécrit pas.
        if (decks.has(key)) break;
        const data = operation.data;
        // Une création tranchée a sa correspondance : l'identifiant serveur est connu.
        const id = deckIdByRef.get(operation.client_ref) ?? null;
        decks.set(key, {
          key,
          id,
          clientRef: operation.client_ref,
          name: data.name,
          discriminator: null,
          createdOn: data.created_on ?? null,
          status: data.status ?? "draft",
          archetype: data.archetype ?? null,
          notes: data.notes ?? null,
          archivedAt: null,
          pending,
        });
        keyByRef.set(operation.client_ref, key);
        if (id !== null) keyByDeckId.set(id, key);
        deckCards.set(key, new Map());
        break;
      }
      case "deck.update": {
        const key = resolveDeck(operation.deck);
        const deck = key && decks.get(key);
        if (!key || !deck) break;
        const data = operation.data;
        decks.set(key, {
          ...deck,
          name: data.name ?? deck.name,
          createdOn: data.created_on !== undefined ? data.created_on : deck.createdOn,
          status: data.status ?? deck.status,
          archetype: data.archetype !== undefined ? data.archetype : deck.archetype,
          notes: data.notes !== undefined ? data.notes : deck.notes,
          archivedAt:
            data.archived === undefined
              ? deck.archivedAt
              : data.archived
                ? (deck.archivedAt ?? operation.recorded_at)
                : null,
          pending: deck.pending || pending,
        });
        break;
      }
      case "deck.delete": {
        const key = resolveDeck(operation.deck);
        if (!key) break;
        decks.delete(key);
        deckCards.delete(key);
        break;
      }
      case "deck_card.upsert": {
        const key = resolveDeck(operation.deck);
        const deck = key && decks.get(key);
        if (!key || !deck) break;
        const { card_id: cardId, language_code: languageCode, quantity, proxy_quantity } =
          operation.data;
        const cards = deckCards.get(key) ?? new Map<string, LocalDeckCard>();
        cards.set(pairKey(cardId, languageCode), {
          cardId,
          languageCode,
          quantity,
          proxyQuantity: proxy_quantity ?? 0,
          cardName:
            cardsById.get(cardId)?.name ?? cards.get(pairKey(cardId, languageCode))?.cardName ?? null,
          pending,
        });
        deckCards.set(key, cards);
        decks.set(key, { ...deck, pending: deck.pending || pending });
        break;
      }
      case "deck_card.delete": {
        const key = resolveDeck(operation.deck);
        const deck = key && decks.get(key);
        if (!key || !deck) break;
        deckCards.get(key)?.delete(pairKey(operation.card_id, operation.language_code));
        decks.set(key, { ...deck, pending: deck.pending || pending });
        break;
      }
      case "bundle.deposit":
        break; // non projeté, cf. la documentation de la fonction
    }
  };

  // --- Tranchées d'abord (plus anciennes), puis la file, chacune dans son ordre ---
  for (const operation of settled) apply(operation, false);
  for (const operation of operations) apply(operation, true);

  return {
    stock: [...stock.values()],
    decks: [...decks.values()],
    deckCards: new Map(
      [...deckCards].map(([key, cards]) => [key, [...cards.values()]] as const),
    ),
  };
}
