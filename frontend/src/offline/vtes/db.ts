import type { Table } from "dexie";
import type { components } from "../../api-client/schema.d.ts";
import { CORE_STORES_V1, CORE_STORES_V2, OfflineCoreDb } from "../core/db";
import type { CardCategory, DeckStatus } from "./types";

type DeckArchetypeCode = components["schemas"]["DeckArchetype"];

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
  /** Un des six archétypes (Lot 8, P5), ou rien. */
  archetype: DeckArchetypeCode | null;
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
// Les unions de texte viennent du contrat généré (`components["schemas"]`) :
// le contrat fait foi. Les lignes du miroir, elles, sont en camelCase comme les
// autres miroirs ; `refresh.ts` les construit depuis les types générés, si bien
// qu'un champ qui bouge au contrat fait échouer `tsc` à cet endroit.

type Schemas = components["schemas"];

/** `RoundType` du contrat. */
export type GameRoundType = Schemas["RoundType"];
/** `DeckPolicy` du contrat. */
export type TournamentDeckPolicy = Schemas["DeckPolicy"];
/** `TournamentFormat` du contrat (`constructed`, `draft`, `other`). */
export type TournamentFormatName = Schemas["TournamentFormat"];
/** `EventTier` du contrat. */
export type TournamentEventTier = Schemas["EventTier"];
/** `FinalDeckRule` du contrat. */
export type TournamentFinalDeckRule = Schemas["FinalDeckRule"];
/** `DeckArchetype` du contrat (Lot 8, P5) : six codes fermés, pour mes decks et ceux des adversaires. */
export type DeckArchetype = Schemas["DeckArchetype"];

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

/** Version d'un deck dans un tournoi (`TournamentDeckVersionRead`, Lot 8, A9). */
export interface TournamentDeckVersionRow {
  deckId: number;
  deckVersionId: number;
  deckVersionNumber: number;
  /** Partie à laquelle la liste est rattachée (« figée à la ronde 2 »). */
  frozenByGameId: number;
}

/** Tournoi (miroir de `GET /tournois/{id}` : le bilan et les decks admis ne viennent que du détail). */
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
  /**
   * Version de chaque deck joué dans le tournoi, et la partie qui l'a figée
   * (Lot 8, A9), par deck croissant. Absent d'une ligne écrite avant la
   * version 7 de la base : la lecture le tient pour vide.
   */
  deckVersions?: TournamentDeckVersionRow[];
  /** Decks admis en finale (A11), lus par le détail à chaque rafraîchissement ; `null` quand rien n'est contrôlable. */
  admissibleFinalDecks: number[] | null;
  notes: string | null;
  updatedAt: string;
}

/**
 * Ligne de la table d'une partie, rangée dans la ligne de la partie (A3).
 *
 * Lot 8 : `playerId` est nul pour un adversaire non nommé (P6) ; la version
 * figée du deck joué et la description du deck adverse (P5) s'ajoutent. Les
 * champs marqués facultatifs manquent sur une ligne écrite avant la version 7
 * de la base : la lecture les tient pour nuls.
 */
export interface GameTableLineRow {
  playerId: number | null;
  isMe: boolean;
  deckId: number | null;
  /** Version figée par le serveur (`GET /decks/{id}/versions`) ; nulle sans deck. */
  deckVersionId?: number | null;
  deckVersionNumber?: number | null;
  seat: number | null;
  /** Renseignés sur ma seule ligne (A13). */
  victoryPoints: number | null;
  gameWin: boolean | null;
  /** Deck d'un adversaire qui ne joue pas un de mes decks (P5). */
  opponentDeckName?: string | null;
  opponentDeckArchetype?: DeckArchetypeCode | null;
  opponentClanId?: number | null;
  notes: string | null;
}

/** Ma ligne d'une partie en résumé (`ParticipationSummary`), ce que la liste affiche. */
export interface GameMeRow {
  deckId: number | null;
  /** Version figée de mon deck (Lot 8) ; facultative comme sur `GameTableLineRow`. */
  deckVersionId?: number | null;
  deckVersionNumber?: number | null;
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

// --- Détails du catalogue (lot Chercher) ----------------------------------
//
// `cards` reste la ligne courte que `readProjection` relit à chaque lecture de
// l'application : tout ce que les filtres de Chercher demandent vit à part,
// dans `cardDetails`, à clé identique (`id`). Un miroir qu'on enrichit se double
// ainsi d'un magasin de détails, ajouté sans migration ni vidage (patron proposé
// à Barrin, `frontend/src/offline/README.md`).

/** `CostType` du contrat. */
export type CardCostType = Schemas["CostType"];
/** `DisciplineRequirement` du contrat (`mono`, `choice`, `combo`). */
export type CardDisciplineRequirement = Schemas["DisciplineRequirement"];

/** Discipline d'une carte, avec son niveau (supérieur en crypte). */
export interface CardDisciplineDetail {
  /** Abréviation krcg en minuscules (`dom`, `obf`, `def`…), le nom quand elle manque. */
  code: string;
  name: string;
  superior: boolean;
}

/** Nom d'une carte dans une autre langue que l'anglais (FR et ES aujourd'hui). */
export interface CardTranslatedNameDetail {
  languageCode: string;
  name: string;
}

/**
 * Détails d'une carte du catalogue (lot Chercher, version 6 de la base), ce que
 * les filtres demandent et que `cards` ne porte pas. Même clé que `cards`.
 * Les sectes et titres exigés arrivent déjà lus par le serveur (A3) : le client
 * ne réécrit pas la règle « un titre implique sa secte ».
 */
export interface CardDetailRow {
  id: number;
  /**
   * Identifiant du clan d'une carte de crypte (Lot 8) : la liste des clans du
   * formulaire de partie (clan principal d'un adversaire, P5) s'en déduit, le
   * contrat n'ayant pas de route des clans. Nul en bibliothèque.
   */
  clanId: number | null;
  /** Secte d'une carte de crypte (nom de la table `sect`), nulle en bibliothèque. */
  sect: string | null;
  title: string | null;
  path: string | null;
  costType: CardCostType | null;
  /** Chaîne : un nombre, ou « X ». */
  costValue: string | null;
  /** Prérequis de clan découpés (le contrat les joint par `", "`). */
  clanRequirements: string[];
  /** Prérequis de voie découpés, comme les clans. */
  pathRequirements: string[];
  disciplineRequirement: CardDisciplineRequirement | null;
  /** Disciplines, triées par abréviation comme le serveur. */
  disciplines: CardDisciplineDetail[];
  /** Noms des types, triés comme le serveur. */
  types: string[];
  /** Exigence brute de `vteslibmeta.csv`, pour l'affichage. */
  libraryRequirement: string | null;
  requiredSects: string[];
  requiredTitles: string[];
  requiresTitled: boolean;
  requiresNonTitled: boolean;
  otherRequirements: string[];
  cardText: string | null;
  /** `foldText(cardText)`, calculé à l'écriture (A4) ; chaîne vide sans texte. */
  foldedText: string;
  /** Dates locales `YYYY-MM-DD`. */
  bannedOn: string | null;
  legalFrom: string | null;
  translatedNames: CardTranslatedNameDetail[];
  /** Noms traduits repliés, dans l'ordre de `translatedNames`. */
  foldedTranslatedNames: string[];
}

/**
 * Lot Chercher, cran unique (déclaré en version 6 de la base) : le magasin des
 * détails du catalogue. Ajout d'un magasin seulement, aucune clé ne change,
 * aucun `upgrade` : un téléphone qui exécute ce code pour la première fois hors
 * ligne garde son catalogue, son picker et ses libellés ; le miroir est
 * seulement « incomplet » tant que `cardDetails` est plus court que `cards`.
 */
export const VTES_STORES_V5 = {
  cardDetails: "id",
} as const;

// --- Versions de deck jouées (Lot 8) --------------------------------------

/** Une carte d'une version figée : carte × quantité, sans langue, extension ni proxy (P2). */
export interface DeckVersionCardRow {
  cardId: number;
  quantity: number;
}

/**
 * Une liste d'un deck telle qu'elle a été jouée (miroir de
 * `GET /decks/{id}/versions`, Lot 8, P1). Coupée par le serveur, jamais
 * modifiée ensuite : le client ne fabrique jamais de version.
 */
export interface DeckVersionRow {
  id: number;
  deckId: number;
  /** Numéro dans le deck, à partir de 1 (« v3 »). */
  number: number;
  /** Instant UTC (« …Z »). */
  createdAt: string;
  cryptCount: number;
  libraryCount: number;
  /** Par identifiant de carte croissant ; vide pour un deck joué sans ligne. */
  cards: DeckVersionCardRow[];
}

/**
 * Lot 8, cran unique (déclaré en version 7 de la base) : le magasin des
 * versions de deck. Ajout d'un magasin, aucune clé ne change. L'`upgrade` de la
 * version 7 vide seulement `cardDetails`, qui gagne `clanId` : le catalogue est
 * alors « incomplet » et se relit une fois au retour du réseau (P11 du lot
 * Chercher), sans toucher à `cards` ni au picker hors ligne.
 */
export const VTES_STORES_V6 = {
  deckVersions: "id, deckId",
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
  declare cardDetails: Table<CardDetailRow, number>;
  declare deckVersions: Table<DeckVersionRow, number>;

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
    // Version 6 (lot Chercher) : les détails du catalogue (`VTES_STORES_V5`).
    // Ajout d'un magasin seulement, comme la version 5.
    this.version(6).stores({ ...VTES_STORES_V5 });
    // Version 7 (Lot 8) : les versions de deck jouées (`VTES_STORES_V6`), et
    // `cardDetails` vidé pour qu'il se relise avec `clanId`.
    this.version(7)
      .stores({ ...VTES_STORES_V6 })
      .upgrade(async (tx) => {
        await tx.table("cardDetails").clear();
      });
  }
}
