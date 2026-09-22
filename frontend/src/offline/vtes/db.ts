import type { Table } from "dexie";
import { CORE_STORES_V1, CORE_STORES_V2, OfflineCoreDb } from "../core/db";
import type { CardCategory, DeckStatus } from "./types";

/** Langue connue du serveur (miroir de `GET /langues`). */
export interface LanguageRow {
  code: string;
  label: string;
  sortOrder: number;
}

/** Carte du catalogue (miroir de `GET /cartes`), pour chercher et saisir hors ligne. */
export interface CardRow {
  id: number;
  veknId: number;
  name: string;
  /** `foldText(name)`, calculé à l'écriture : la recherche compare des textes repliés. */
  foldedName: string;
  category: CardCategory;
  clanName: string | null;
  capacity: number | null;
  groupCode: string | null;
  advanced: boolean;
  imageUrl: string | null;
}

/** Entrée de collection (miroir de `GET /stock`). */
export interface StockRow {
  cardId: number;
  languageCode: string;
  quantityOwned: number;
  proxyAllowed: boolean;
  notes: string | null;
  /** Dénormalisés pour l'affichage et la recherche sans jointure. */
  cardName: string | null;
  foldedName: string;
  category: CardCategory | null;
}

/** Deck du serveur, sans composition (miroir de `GET /decks?state=all`). */
export interface DeckRow {
  id: number;
  name: string;
  foldedName: string;
  discriminator: string;
  createdOn: string | null;
  status: DeckStatus;
  archetype: string | null;
  notes: string | null;
  archivedAt: string | null;
}

export interface DeckCardRow {
  deckId: number;
  cardId: number;
  languageCode: string;
  quantity: number;
  proxyQuantity: number;
  cardName: string | null;
}

/**
 * Tables propres à VtES, version 1. Les miroirs sont des **instantanés du
 * serveur** ; ce que l'utilisateur voit est l'instantané **plus** les
 * opérations encore en file (cf. `overlay.ts`), jamais un instantané modifié en
 * place. C'est ce qui rend un refus ou un abandon sans effet de bord local.
 */
export const VTES_STORES_V1 = {
  languages: "code",
  cards: "id, foldedName, category",
  stock: "[cardId+languageCode], cardId, foldedName",
  decks: "id, foldedName, archivedAt",
  deckCards: "[deckId+cardId+languageCode], deckId",
} as const;

export const DEFAULT_DB_NAME = "gurchon-hall-offline";

export class VtesOfflineDb extends OfflineCoreDb {
  declare languages: Table<LanguageRow, string>;
  declare cards: Table<CardRow, number>;
  declare stock: Table<StockRow, [number, string]>;
  declare decks: Table<DeckRow, number>;
  declare deckCards: Table<DeckCardRow, [number, number, string]>;

  constructor(name: string = DEFAULT_DB_NAME) {
    super(name);
    // Version 1 : cœur + miroirs VtES. Ne jamais la modifier (cf. commentaire
    // de `CORE_STORES_V1`) : toute évolution s'ajoute en version suivante.
    this.version(1).stores({ ...CORE_STORES_V1, ...VTES_STORES_V1 });
    // Version 2 : les opérations tranchées en attente de rafraîchissement.
    this.version(2).stores({ ...CORE_STORES_V2 });
  }
}
