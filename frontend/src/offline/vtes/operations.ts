import type { components } from "../../api-client/schema.d.ts";
import { newUuid, toLocalIso } from "../core/ids";
import {
  toDeckRef,
  toGameRef,
  toParticipantRef,
  toPlayerRef,
  toTournamentRef,
  toVenueRef,
  type DeckKey,
  type DeckPolicy,
  type DeckSelector,
  type EventTier,
  type FinalDeckRule,
  type OperationOf,
  type ParticipantTarget,
  type ResourceTarget,
  type RoundType,
  type TournamentFormat,
} from "./types";

/**
 * Constructeurs des opérations du contrat `POST /sync`.
 *
 * Purs et synchrones : ils tirent la clé d'idempotence (`operation_id`) et
 * l'instant (`recorded_at`) **au moment de la saisie**, et rendent l'opération
 * exactement telle qu'elle partira. Les champs non fournis sont **omis** (pas
 * `undefined`, pas `null`) : le serveur empreinte les seuls champs fournis, et
 * `null` explicite (effacer une note) diffère de « ne pas y toucher ».
 */

type Schemas = components["schemas"];

export interface OperationClock {
  newId: () => string;
  now: () => string;
}

export const systemClock: OperationClock = {
  newId: newUuid,
  now: () => toLocalIso(),
};

type DeckTarget = DeckSelector | DeckKey;

/** Ne garde que les champs définis (jamais `undefined` dans une charge utile). */
function defined<T extends object>(fields: T): T {
  return Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined),
  ) as T;
}

export interface StockInput {
  cardId: number;
  languageCode: string;
  /**
   * Extension de l'impression (`GET /extensions`), obligatoire depuis le
   * Lot 4 : le couple carte × extension doit être une impression du
   * catalogue, sinon 404 (`not_found` par `/sync`).
   */
  cardSetId: number;
  quantityOwned?: number;
  notes?: string | null;
}

export function stockUpsert(
  clock: OperationClock,
  input: StockInput,
): OperationOf<"stock.upsert"> {
  return {
    type: "stock.upsert",
    operation_id: clock.newId(),
    recorded_at: clock.now(),
    data: defined({
      card_id: input.cardId,
      language_code: input.languageCode,
      card_set_id: input.cardSetId,
      quantity_owned: input.quantityOwned,
      notes: input.notes,
    }),
  };
}

export function stockDelete(
  clock: OperationClock,
  cardId: number,
  languageCode: string,
  cardSetId: number,
): OperationOf<"stock.delete"> {
  return {
    type: "stock.delete",
    operation_id: clock.newId(),
    recorded_at: clock.now(),
    card_id: cardId,
    language_code: languageCode,
    card_set_id: cardSetId,
  };
}

export interface DeckInput {
  name: string;
  createdOn?: string | null;
  status?: Schemas["DeckStatus"];
  archetype?: string | null;
  notes?: string | null;
  /**
   * Autorise les proxies dans ce deck (Lot 4) : ce n'est plus une propriété
   * de l'entrée de collection. Interdit par défaut si omis.
   */
  proxyAllowed?: boolean;
}

export function deckCreate(
  clock: OperationClock,
  clientRef: string,
  input: DeckInput,
): OperationOf<"deck.create"> {
  return {
    type: "deck.create",
    operation_id: clock.newId(),
    recorded_at: clock.now(),
    client_ref: clientRef,
    data: defined({
      name: input.name,
      created_on: input.createdOn,
      status: input.status,
      archetype: input.archetype,
      notes: input.notes,
      proxy_allowed: input.proxyAllowed,
    }),
  };
}

export interface DeckPatch {
  name?: string;
  createdOn?: string | null;
  status?: Schemas["DeckStatus"];
  archetype?: string | null;
  notes?: string | null;
  /** Autorise (`true`) ou interdit (`false`) les proxies dans ce deck (Lot 4). */
  proxyAllowed?: boolean;
  /** `true` range le deck, `false` le sort de l'archive. */
  archived?: boolean;
}

export function deckUpdate(
  clock: OperationClock,
  deck: DeckTarget,
  patch: DeckPatch,
): OperationOf<"deck.update"> {
  return {
    type: "deck.update",
    operation_id: clock.newId(),
    recorded_at: clock.now(),
    deck: toDeckRef(deck),
    data: defined({
      name: patch.name,
      created_on: patch.createdOn,
      status: patch.status,
      archetype: patch.archetype,
      notes: patch.notes,
      proxy_allowed: patch.proxyAllowed,
      archived: patch.archived,
    }),
  };
}

export function deckDelete(clock: OperationClock, deck: DeckTarget): OperationOf<"deck.delete"> {
  return {
    type: "deck.delete",
    operation_id: clock.newId(),
    recorded_at: clock.now(),
    deck: toDeckRef(deck),
  };
}

export interface DeckCardInput {
  cardId: number;
  languageCode: string;
  /**
   * Extension de l'impression allouée (`GET /extensions`), obligatoire depuis
   * le Lot 4 : le couple carte × extension doit être une impression du
   * catalogue, sinon 404 (`not_found` par `/sync`).
   */
  cardSetId: number;
  quantity: number;
  proxyQuantity?: number;
  /**
   * Lot 4b : exemplaires physiques ajoutés à la collection (carte × langue ×
   * extension) par cette écriture, et consommés aussitôt par la ligne. Un
   * delta, borné par les exemplaires réels que l'écriture ajoute à la ligne
   * (`invalid` au-delà). Omis de la charge utile s'il vaut 0 ou n'est pas fourni.
   */
  acquiredQuantity?: number;
}

export function deckCardUpsert(
  clock: OperationClock,
  deck: DeckTarget,
  input: DeckCardInput,
): OperationOf<"deck_card.upsert"> {
  return {
    type: "deck_card.upsert",
    operation_id: clock.newId(),
    recorded_at: clock.now(),
    deck: toDeckRef(deck),
    data: defined({
      card_id: input.cardId,
      language_code: input.languageCode,
      card_set_id: input.cardSetId,
      quantity: input.quantity,
      proxy_quantity: input.proxyQuantity,
      acquired_quantity: input.acquiredQuantity || undefined,
    }),
  };
}

export function deckCardDelete(
  clock: OperationClock,
  deck: DeckTarget,
  cardId: number,
  languageCode: string,
  cardSetId: number,
): OperationOf<"deck_card.delete"> {
  return {
    type: "deck_card.delete",
    operation_id: clock.newId(),
    recorded_at: clock.now(),
    deck: toDeckRef(deck),
    card_id: cardId,
    language_code: languageCode,
    card_set_id: cardSetId,
  };
}

export function bundleDeposit(
  clock: OperationClock,
  bundleId: number,
  languageCode: string,
  count?: number,
): OperationOf<"bundle.deposit"> {
  return {
    type: "bundle.deposit",
    operation_id: clock.newId(),
    recorded_at: clock.now(),
    bundle_id: bundleId,
    data: defined({ language_code: languageCode, count }),
  };
}

// --- Pratique de jeu (Lot 7) -----------------------------------------------
//
// Mêmes règles que ci-dessus : champs non fournis omis, `null` explicite
// conservé (remettre à zéro une note, un lieu, une règle de finale). Une
// création prend sa `client_ref` en paramètre : l'appelant en tire une neuve
// par création (`newUuid()`), jamais deux fois la même dans un lot.

/** `null` reste `null` (effacer), `undefined` reste omis, sinon la désignation du contrat. */
function refField<T, R>(
  target: T | null | undefined,
  toRef: (value: T) => R,
): R | null | undefined {
  if (target === undefined) return undefined;
  return target === null ? null : toRef(target);
}

export interface PlayerInput {
  name: string;
}

/**
 * Le serveur traite une création de joueur en **upsert par nom** : un nom connu
 * (casse et accents ignorés) rend le joueur existant, `applied`, et la
 * `client_ref` se lie à lui. Un `applied` ne veut donc pas dire « créé ».
 */
export function playerCreate(
  clock: OperationClock,
  clientRef: string,
  input: PlayerInput,
): OperationOf<"player.create"> {
  return {
    type: "player.create",
    operation_id: clock.newId(),
    recorded_at: clock.now(),
    client_ref: clientRef,
    data: { name: input.name },
  };
}

export interface PlayerPatch {
  name?: string;
}

export function playerUpdate(
  clock: OperationClock,
  player: ResourceTarget,
  patch: PlayerPatch,
): OperationOf<"player.update"> {
  return {
    type: "player.update",
    operation_id: clock.newId(),
    recorded_at: clock.now(),
    player: toPlayerRef(player),
    data: defined({ name: patch.name }),
  };
}

export function playerDelete(
  clock: OperationClock,
  player: ResourceTarget,
): OperationOf<"player.delete"> {
  return {
    type: "player.delete",
    operation_id: clock.newId(),
    recorded_at: clock.now(),
    player: toPlayerRef(player),
  };
}

export interface VenueInput {
  name: string;
  city?: string | null;
  notes?: string | null;
}

/** Upsert par nom, comme un joueur : un lieu connu garde sa ville et ses notes. */
export function venueCreate(
  clock: OperationClock,
  clientRef: string,
  input: VenueInput,
): OperationOf<"venue.create"> {
  return {
    type: "venue.create",
    operation_id: clock.newId(),
    recorded_at: clock.now(),
    client_ref: clientRef,
    data: defined({ name: input.name, city: input.city, notes: input.notes }),
  };
}

export interface VenuePatch {
  name?: string;
  city?: string | null;
  notes?: string | null;
}

export function venueUpdate(
  clock: OperationClock,
  venue: ResourceTarget,
  patch: VenuePatch,
): OperationOf<"venue.update"> {
  return {
    type: "venue.update",
    operation_id: clock.newId(),
    recorded_at: clock.now(),
    venue: toVenueRef(venue),
    data: defined({ name: patch.name, city: patch.city, notes: patch.notes }),
  };
}

export function venueDelete(
  clock: OperationClock,
  venue: ResourceTarget,
): OperationOf<"venue.delete"> {
  return {
    type: "venue.delete",
    operation_id: clock.newId(),
    recorded_at: clock.now(),
    venue: toVenueRef(venue),
  };
}

export interface TournamentInput {
  name: string;
  /** Date locale `AAAA-MM-JJ`. */
  startDate: string;
  endDate?: string | null;
  venue?: ResourceTarget | null;
  deckPolicy?: DeckPolicy;
  format?: TournamentFormat;
  eventTier?: EventTier;
  finalDeckRule?: FinalDeckRule | null;
  roundCount?: number | null;
  playerCount?: number | null;
  myRanking?: number | null;
  notes?: string | null;
}

export function tournamentCreate(
  clock: OperationClock,
  clientRef: string,
  input: TournamentInput,
): OperationOf<"tournament.create"> {
  return {
    type: "tournament.create",
    operation_id: clock.newId(),
    recorded_at: clock.now(),
    client_ref: clientRef,
    data: defined({
      name: input.name,
      start_date: input.startDate,
      end_date: input.endDate,
      venue: refField(input.venue, toVenueRef),
      deck_policy: input.deckPolicy,
      format: input.format,
      event_tier: input.eventTier,
      final_deck_rule: input.finalDeckRule,
      round_count: input.roundCount,
      player_count: input.playerCount,
      my_ranking: input.myRanking,
      notes: input.notes,
    }),
  };
}

export type TournamentPatch = Partial<TournamentInput>;

/**
 * Passer un tournoi à `mono` sans dire ce que devient la règle de finale est un
 * refus du serveur (`invalid`) : elle n'a pas de sens en mono-deck et il ne
 * l'efface pas de lui-même. Le constructeur envoie donc `final_deck_rule: null`
 * en même temps, sauf si l'appelant a fourni une valeur (que le serveur jugera).
 */
export function tournamentUpdate(
  clock: OperationClock,
  tournament: ResourceTarget,
  patch: TournamentPatch,
): OperationOf<"tournament.update"> {
  const finalDeckRule =
    patch.deckPolicy === "mono" && patch.finalDeckRule === undefined ? null : patch.finalDeckRule;
  return {
    type: "tournament.update",
    operation_id: clock.newId(),
    recorded_at: clock.now(),
    tournament: toTournamentRef(tournament),
    data: defined({
      name: patch.name,
      start_date: patch.startDate,
      end_date: patch.endDate,
      venue: refField(patch.venue, toVenueRef),
      deck_policy: patch.deckPolicy,
      format: patch.format,
      event_tier: patch.eventTier,
      final_deck_rule: finalDeckRule,
      round_count: patch.roundCount,
      player_count: patch.playerCount,
      my_ranking: patch.myRanking,
      notes: patch.notes,
    }),
  };
}

export function tournamentDelete(
  clock: OperationClock,
  tournament: ResourceTarget,
): OperationOf<"tournament.delete"> {
  return {
    type: "tournament.delete",
    operation_id: clock.newId(),
    recorded_at: clock.now(),
    tournament: toTournamentRef(tournament),
  };
}

/** Une ligne de la table d'une partie. Les adversaires n'ont ni VP ni GW (A13). */
export interface ParticipationInput {
  /** `"me"` pour ma ligne, sinon le joueur désigné par sa clé ou son sélecteur. */
  player: ParticipantTarget;
  deck?: DeckTarget | null;
  seat?: number | null;
  victoryPoints?: number | null;
  gameWin?: boolean | null;
  notes?: string | null;
}

function participation(input: ParticipationInput): Schemas["ParticipationCreate"] {
  return defined({
    player: toParticipantRef(input.player),
    deck: refField(input.deck, toDeckRef),
    seat: input.seat,
    victory_points: input.victoryPoints,
    game_win: input.gameWin,
    notes: input.notes,
  });
}

export interface GameInput {
  /** Instant ISO 8601 **avec fuseau** ; maintenant (heure locale) si omis. */
  playedAt?: string;
  venue?: ResourceTarget | null;
  tournament?: ResourceTarget | null;
  roundNumber?: number | null;
  roundType?: RoundType;
  playerCount: number;
  notes?: string | null;
  /** La table complète, avec ma ligne. */
  participations: readonly ParticipationInput[];
}

export function gameCreate(
  clock: OperationClock,
  clientRef: string,
  input: GameInput,
): OperationOf<"game.create"> {
  return {
    type: "game.create",
    operation_id: clock.newId(),
    recorded_at: clock.now(),
    client_ref: clientRef,
    data: defined({
      played_at: input.playedAt ?? clock.now(),
      venue: refField(input.venue, toVenueRef),
      tournament: refField(input.tournament, toTournamentRef),
      round_number: input.roundNumber,
      round_type: input.roundType,
      player_count: input.playerCount,
      notes: input.notes,
      participations: input.participations.map(participation),
    }),
  };
}

export interface GamePatch {
  playedAt?: string;
  venue?: ResourceTarget | null;
  tournament?: ResourceTarget | null;
  roundNumber?: number | null;
  roundType?: RoundType;
  playerCount?: number;
  notes?: string | null;
}

export interface GameUpdate {
  /** Champs de la partie. Omis : `data` est omis de l'opération (pas `{}`). */
  fields?: GamePatch;
  /**
   * La table **complète** voulue, jamais une partie de table : le serveur la
   * remplace d'un bloc. À ne fournir que pour une table connue.
   */
  table?: readonly ParticipationInput[];
}

/**
 * `data` n'est écrit que si `fields` est fourni, `table` que s'il l'est : la file
 * garde le corps exact, et `data: {}` et `data` omis ont deux empreintes.
 */
export function gameUpdate(
  clock: OperationClock,
  game: ResourceTarget,
  update: GameUpdate,
): OperationOf<"game.update"> {
  const { fields, table } = update;
  return {
    type: "game.update",
    operation_id: clock.newId(),
    recorded_at: clock.now(),
    game: toGameRef(game),
    ...(fields === undefined
      ? {}
      : {
          data: defined({
            played_at: fields.playedAt,
            venue: refField(fields.venue, toVenueRef),
            tournament: refField(fields.tournament, toTournamentRef),
            round_number: fields.roundNumber,
            round_type: fields.roundType,
            player_count: fields.playerCount,
            notes: fields.notes,
          }),
        }),
    ...(table === undefined ? {} : { table: { participations: table.map(participation) } }),
  };
}

export function gameDelete(clock: OperationClock, game: ResourceTarget): OperationOf<"game.delete"> {
  return {
    type: "game.delete",
    operation_id: clock.newId(),
    recorded_at: clock.now(),
    game: toGameRef(game),
  };
}
