import type { Table } from "dexie";
import { CORE_STORES_V1, CORE_STORES_V2, OfflineCoreDb } from "../core/db";
import type { CardCategory, DeckStatus } from "./types";

/** Langue connue du serveur (miroir de `GET /langues`). */
export interface LanguageRow {
  code: string;
  label: string;
  sortOrder: number;
}

/** Extension du catalogue (miroir de `GET /extensions`, Lot 4). */
export interface CardSetRow {
  id: number;
  abbrev: string;
  fullName: string | null;
  releaseDate: string | null;
  company: string | null;
  /** Extension tampon de l'import (carte publiée sans impression). */
  isPlaceholder: boolean;
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
  /** Extensions où la carte a été imprimée (`GET /extensions`), triées par identifiant. */
  cardSetIds: number[];
  /** Extension de la dernière version de la carte (D2a), calculée par le serveur. */
  latestCardSetId: number;
}

/** Entrée de collection (miroir de `GET /stock`) : carte × langue × extension (Lot 4). */
export interface StockRow {
  cardId: number;
  languageCode: string;
  cardSetId: number;
  quantityOwned: number;
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
  /** Autorisation de proxy du deck (Lot 4) : ce n'est plus une propriété de l'entrée de collection. */
  proxyAllowed: boolean;
  archivedAt: string | null;
}

export interface DeckCardRow {
  deckId: number;
  cardId: number;
  languageCode: string;
  /** Extension de l'entrée de collection allouée (Lot 4). */
  cardSetId: number;
  quantity: number;
  proxyQuantity: number;
  cardName: string | null;
}

/**
 * Tables propres à VtES, version 1. Les miroirs sont des **instantanés du
 * serveur** ; ce que l'utilisateur voit est l'instantané **plus** les
 * opérations encore en file (cf. `overlay.ts`), jamais un instantané modifié en
 * place. C'est ce qui rend un refus ou un abandon sans effet de bord local.
 *
 * Ne jamais modifier ce bloc (déjà livré) : voir le commentaire sur `stock` et
 * `deckCards` plus bas pour son évolution au Lot 4.
 */
export const VTES_STORES_V1 = {
  languages: "code",
  cards: "id, foldedName, category",
  stock: "[cardId+languageCode], cardId, foldedName",
  decks: "id, foldedName, archivedAt",
  deckCards: "[deckId+cardId+languageCode], deckId",
} as const;

/**
 * Lot 4, premier cran (déclaré en version 3 de la base, à la suite de
 * `CORE_STORES_V2`) : nouveau miroir `cardSets`, et suppression de `stock` et
 * `deckCards` dans leur forme du Lot 1-3.
 *
 * IndexedDB ne permet pas de changer la clé primaire d'un magasin existant :
 * Dexie lève `Not yet support for changing primary key` si on redéclare
 * `stock`/`deckCards` avec une clé composée différente dans le **même** cran de
 * version. Le chemin documenté par Dexie est de supprimer le magasin
 * (`null`) dans un cran, puis de le recréer avec sa nouvelle clé dans le
 * suivant (`VTES_STORES_V3`) : les deux se jouent dans la **même** transaction
 * de mise à niveau pour un navigateur qui ouvre la base pour la première fois,
 * et à la suite l'un de l'autre pour un navigateur déjà à la version 2.
 *
 * Écart avec le plan de lot (« version 3 de la base Dexie ») : la contrainte
 * ci-dessus oblige à deux crans (3 et 4) pour une seule évolution de schéma.
 */
export const VTES_STORES_V2 = {
  stock: null,
  deckCards: null,
  cardSets: "id",
} as const;

/**
 * Lot 4, second cran (déclaré en version 4 de la base) : `stock` et
 * `deckCards` recréés avec l'extension dans leur clé primaire.
 */
export const VTES_STORES_V3 = {
  stock: "[cardId+languageCode+cardSetId], cardId, foldedName",
  deckCards: "[deckId+cardId+languageCode+cardSetId], deckId",
} as const;

// --- Pratique de jeu (Lot 7) -----------------------------------------------
//
// **Types provisoires**, écrits à la main en C1a pour que le schéma Dexie et le
// miroir puissent exister avant l'entrée des schémas de partie au contrat
// (B1 à B3). En C1b, les unions de texte ci-dessous et les formes des lignes se
// réalignent sur les types générés (`components["schemas"]`) : le contrat fait
// foi, pas ce bloc. Les noms des champs suivent déjà les lectures de
// `backend/app/schemas/play.py` et `reference.py`.

/** Provisoire : `RoundType` du contrat. */
export type GameRoundType = "casual" | "preliminary" | "final";
/** Provisoire : `DeckPolicy` du contrat. */
export type TournamentDeckPolicy = "mono" | "multi";
/** Provisoire : `TournamentFormat` du contrat. */
export type TournamentFormatName = "constructed" | "draft";
/** Provisoire : `EventTier` du contrat. */
export type TournamentEventTier =
  | "standard"
  | "national_championship"
  | "grand_prix"
  | "continental_championship";
/** Provisoire : `FinalDeckRule` du contrat. */
export type TournamentFinalDeckRule = "best_performing" | "free_choice";

/** Joueur (miroir de `GET /joueurs`) : le « Moi » du compte ou un adversaire nommé. */
export interface PlayerRow {
  id: number;
  name: string;
  /** `foldText(name)`, calculé à l'écriture, comme les autres miroirs. */
  foldedName: string;
  isMe: boolean;
  gameCount: number;
}

/** Lieu (miroir de `GET /lieux`), privé au compte. */
export interface VenueRow {
  id: number;
  name: string;
  foldedName: string;
  city: string | null;
  notes: string | null;
  gameCount: number;
  tournamentCount: number;
}

/** Mon bilan d'un tournoi (`TournamentSummary`, A12). */
export interface TournamentSummaryRow {
  preliminaryGameWins: number;
  preliminaryVictoryPoints: number;
  roundsPlayed: number;
  finalVictoryPoints: number | null;
  finalGameWin: boolean | null;
}

/** Tournoi (miroir de `GET /tournois`, détail compris pour `admissibleFinalDecks`). */
export interface TournamentRow {
  id: number;
  name: string;
  /** Date locale `YYYY-MM-DD` : indexée, elle trie la liste. */
  startDate: string;
  endDate: string | null;
  venueId: number | null;
  deckPolicy: TournamentDeckPolicy;
  format: TournamentFormatName;
  eventTier: TournamentEventTier;
  finalDeckRule: TournamentFinalDeckRule | null;
  roundCount: number | null;
  playerCount: number | null;
  myRanking: number | null;
  /** Bilan calculé par le serveur ; le bilan provisoire d'une saisie en file est recalculé localement. */
  summary: TournamentSummaryRow;
  /** Decks admis en finale (A11), connus par le détail ; `null` quand rien n'est contrôlable ou pas encore lu. */
  admissibleFinalDecks: number[] | null;
  notes: string | null;
  updatedAt: string;
}

/** Ligne de la table d'une partie, rangée dans la ligne de la partie (A3). */
export interface GameTableLineRow {
  playerId: number;
  isMe: boolean;
  deckId: number | null;
  seat: number | null;
  /** Renseignés sur ma seule ligne (A13). */
  victoryPoints: number | null;
  gameWin: boolean | null;
  notes: string | null;
}

/** Ma ligne d'une partie en résumé (`ParticipationSummary`), ce que la liste affiche. */
export interface GameMeRow {
  deckId: number | null;
  seat: number | null;
  victoryPoints: number | null;
  gameWin: boolean | null;
}

/**
 * Partie (miroir de `GET /parties`). La table (`table`) se remplace d'un bloc
 * (A3), elle vit donc dans la ligne de la partie : `null` tant que le détail
 * n'a pas été lu, `GameTableLineRow[]` sinon. L'édition de la table n'est offerte
 * que pour une table connue (cf. `docs/lot7-plan-parties.md`, « Livré à
 * l'étape C1a ») : remplacer une table qu'on ignore effacerait les adversaires.
 */
export interface GameRow {
  id: number;
  /** Instant UTC (« …Z »), indexé. */
  playedAt: string;
  venueId: number | null;
  tournamentId: number | null;
  tournamentName: string | null;
  roundNumber: number | null;
  roundType: GameRoundType;
  playerCount: number;
  me: GameMeRow;
  notes: string | null;
  /** `updated_at` du serveur : le détail n'est relu que pour les parties qui ont changé. */
  updatedAt: string;
  table: GameTableLineRow[] | null;
}

/**
 * Lot 7, cran unique (déclaré en version 5 de la base) : les quatre miroirs de
 * la pratique de jeu. Ajout de magasins seulement, aucune clé existante ne
 * change : aucune donnée perdue, aucun `upgrade`.
 */
export const VTES_STORES_V4 = {
  players: "id, foldedName",
  venues: "id, foldedName",
  tournaments: "id, startDate",
  games: "id, tournamentId, playedAt",
} as const;

export const DEFAULT_DB_NAME = "gurchon-hall-offline";

export class VtesOfflineDb extends OfflineCoreDb {
  declare languages: Table<LanguageRow, string>;
  declare cards: Table<CardRow, number>;
  declare cardSets: Table<CardSetRow, number>;
  declare stock: Table<StockRow, [number, string, number]>;
  declare decks: Table<DeckRow, number>;
  declare deckCards: Table<DeckCardRow, [number, number, string, number]>;
  declare players: Table<PlayerRow, number>;
  declare venues: Table<VenueRow, number>;
  declare tournaments: Table<TournamentRow, number>;
  declare games: Table<GameRow, number>;

  constructor(name: string = DEFAULT_DB_NAME) {
    super(name);
    // Version 1 : cœur + miroirs VtES. Ne jamais la modifier (cf. commentaire
    // de `CORE_STORES_V1`) : toute évolution s'ajoute en version suivante.
    this.version(1).stores({ ...CORE_STORES_V1, ...VTES_STORES_V1 });
    // Version 2 : les opérations tranchées en attente de rafraîchissement.
    this.version(2).stores({ ...CORE_STORES_V2 });
    // Version 3 (Lot 4, 1er cran) : ajoute `cardSets`, supprime `stock` et
    // `deckCards` dans leur forme d'avant le Lot 4 (cf. `VTES_STORES_V2`).
    this.version(3).stores({ ...VTES_STORES_V2 });
    // Version 4 (Lot 4, 2e cran) : recrée `stock` et `deckCards` avec
    // l'extension dans leur clé (`VTES_STORES_V3`). `cards` et `decks` gagnent
    // des champs obligatoires (`cardSetIds`/`latestCardSetId`,
    // `proxyAllowed`) sans changer de clé : comme les autres miroirs, on les
    // vide plutôt que de laisser des lignes incomplètes, le prochain
    // rafraîchissement les recharge dans la forme du contrat Lot 4.
    this.version(4)
      .stores({ ...VTES_STORES_V3 })
      .upgrade(async (tx) => {
        await tx.table("cards").clear();
        await tx.table("decks").clear();
      });
    // Version 5 (Lot 7) : les miroirs joueurs, lieux, tournois et parties
    // (`VTES_STORES_V4`). Ajout de magasins seulement.
    this.version(5).stores({ ...VTES_STORES_V4 });
  }
}
