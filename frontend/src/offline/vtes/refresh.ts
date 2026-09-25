import { foldText } from "../core/foldText";
import { lastSettledSeq, pruneSettled } from "../core/settled";
import type { components } from "../../api-client/schema.d.ts";
import type {
  CardRow,
  CardSetRow,
  DeckCardRow,
  DeckRow,
  LanguageRow,
  StockRow,
  VtesOfflineDb,
} from "./db";
import type { ApiClient } from "./types";

type Schemas = components["schemas"];

/**
 * Rafraîchissement des miroirs de lecture depuis les `GET` existants.
 *
 * `/sync` ne fait descendre que des verdicts : c'est ici, en ligne, que
 * l'instantané se met à jour (docs/lot3-sync-contrat.md). Chaque fonction lit
 * **tout** ce qu'elle doit lire avant d'écrire, puis remplace la table en une
 * transaction : un réseau qui coupe à mi-course laisse l'ancien instantané
 * intact plutôt qu'à moitié remplacé. Elles lèvent en cas d'échec ; `refresh`
 * (dans `runtime.ts`) les enveloppe.
 *
 * Les miroirs de stock et de decks reprennent aussi ce que le verdict du
 * serveur a déjà tranché : le curseur `lastSettledSeq` est relevé **avant** la
 * lecture, et les opérations tranchées jusqu'à lui sont effacées dans la
 * transaction qui remplace le miroir (cf. `core/settled.ts`). Une opération
 * tranchée pendant la lecture reste, et continue d'être projetée.
 */

const PAGE_SIZE = 200; // plafond `le=200` des listes paginées du contrat

class RefreshError extends Error {}

// Chaque miroir n'efface, des opérations tranchées, que la famille qu'il reflète.
const isStockOperation = (type: string) => type.startsWith("stock.") || type.startsWith("bundle.");
const isDeckOperation = (type: string) => type.startsWith("deck.") || type.startsWith("deck_card.");

function unwrap<T>(result: { data?: T; error?: unknown; response: Response }, what: string): T {
  if (result.data === undefined) {
    throw new RefreshError(`${what} : HTTP ${result.response.status}`);
  }
  return result.data;
}

async function pages<T>(
  fetchPage: (offset: number) => Promise<T[]>,
): Promise<T[]> {
  const all: T[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const page = await fetchPage(offset);
    all.push(...page);
    if (page.length < PAGE_SIZE) return all;
  }
}

export async function refreshLanguages(client: ApiClient, db: VtesOfflineDb): Promise<number> {
  const languages = unwrap(await client.GET("/langues"), "GET /langues");
  const rows: LanguageRow[] = languages.map((language) => ({
    code: language.code,
    label: language.label,
    sortOrder: language.sort_order,
  }));
  await db.transaction("rw", db.languages, async () => {
    await db.languages.clear();
    await db.languages.bulkPut(rows);
  });
  return rows.length;
}

/** Extensions du catalogue (miroir de `GET /extensions`, Lot 4). */
export async function refreshCardSets(client: ApiClient, db: VtesOfflineDb): Promise<number> {
  const cardSets = unwrap(await client.GET("/extensions"), "GET /extensions");
  const rows: CardSetRow[] = cardSets.map((cardSet) => ({
    id: cardSet.id,
    abbrev: cardSet.abbrev,
    fullName: cardSet.full_name,
    releaseDate: cardSet.release_date,
    company: cardSet.company,
    isPlaceholder: cardSet.is_placeholder,
  }));
  await db.transaction("rw", db.cardSets, async () => {
    await db.cardSets.clear();
    await db.cardSets.bulkPut(rows);
  });
  return rows.length;
}

export async function refreshStock(client: ApiClient, db: VtesOfflineDb): Promise<number> {
  const settledUpTo = await lastSettledSeq(db);
  const entries = await pages(async (offset) =>
    unwrap(
      await client.GET("/stock", { params: { query: { limit: PAGE_SIZE, offset } } }),
      "GET /stock",
    ),
  );
  const rows: StockRow[] = entries.map((entry) => ({
    cardId: entry.card_id,
    languageCode: entry.language_code,
    cardSetId: entry.card_set_id,
    quantityOwned: entry.quantity_owned,
    notes: entry.notes,
    cardName: entry.card?.name ?? null,
    foldedName: foldText(entry.card?.name ?? ""),
    category: entry.card?.category ?? null,
  }));
  await db.transaction("rw", db.stock, db.settled, async () => {
    await db.stock.clear();
    await db.stock.bulkPut(rows);
    await pruneSettled(db, settledUpTo, isStockOperation);
  });
  return rows.length;
}

export async function refreshDecks(client: ApiClient, db: VtesOfflineDb): Promise<number> {
  const settledUpTo = await lastSettledSeq(db);
  const listed = unwrap(
    await client.GET("/decks", { params: { query: { state: "all" } } }),
    "GET /decks",
  );
  // La composition n'est servie que par le détail d'un deck.
  const details: Schemas["DeckDetailRead"][] = [];
  for (const deck of listed) {
    details.push(
      unwrap(
        await client.GET("/decks/{deck_id}", { params: { path: { deck_id: deck.id } } }),
        `GET /decks/${deck.id}`,
      ),
    );
  }
  const decks: DeckRow[] = details.map((deck) => ({
    id: deck.id,
    name: deck.name,
    foldedName: foldText(deck.name),
    discriminator: deck.discriminator,
    createdOn: deck.created_on,
    status: deck.status,
    archetype: deck.archetype,
    notes: deck.notes,
    proxyAllowed: deck.proxy_allowed,
    archivedAt: deck.archived_at,
  }));
  const deckCards: DeckCardRow[] = details.flatMap((deck) =>
    deck.cards.map((line) => ({
      deckId: deck.id,
      cardId: line.card_id,
      languageCode: line.language_code,
      cardSetId: line.card_set_id,
      quantity: line.quantity,
      proxyQuantity: line.proxy_quantity,
      cardName: line.card?.name ?? null,
    })),
  );
  await db.transaction("rw", db.decks, db.deckCards, db.settled, async () => {
    await db.decks.clear();
    await db.deckCards.clear();
    await db.decks.bulkPut(decks);
    await db.deckCards.bulkPut(deckCards);
    await pruneSettled(db, settledUpTo, isDeckOperation);
  });
  return decks.length;
}

/** Catalogue complet (environ 4 000 cartes), pour chercher et saisir hors ligne. */
export async function refreshCatalog(client: ApiClient, db: VtesOfflineDb): Promise<number> {
  const cards = await pages(async (offset) =>
    unwrap(
      await client.GET("/cartes", { params: { query: { limit: PAGE_SIZE, offset } } }),
      "GET /cartes",
    ),
  );
  const rows: CardRow[] = cards.map((card) => ({
    id: card.id,
    veknId: card.vekn_id,
    name: card.name,
    foldedName: foldText(card.name),
    category: card.category,
    clanName: card.clan?.name ?? null,
    capacity: card.capacity,
    groupCode: card.group_code,
    advanced: card.advanced,
    imageUrl: card.image_url,
    cardSetIds: card.card_set_ids,
    latestCardSetId: card.latest_card_set_id,
  }));
  await db.transaction("rw", db.cards, async () => {
    await db.cards.clear();
    await db.cards.bulkPut(rows);
  });
  return rows.length;
}
