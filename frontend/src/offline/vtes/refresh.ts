import { foldText } from "../core/foldText";
import { lastSettledSeq, pruneSettled } from "../core/settled";
import type { components } from "../../api-client/schema.d.ts";
import type {
  CardDetailRow,
  CardRow,
  CardSetRow,
  DeckCardRow,
  DeckRow,
  DeckVersionRow,
  GameRow,
  GameTableLineRow,
  LanguageRow,
  PlayerRow,
  StockRow,
  TournamentRow,
  VenueRow,
  VtesOfflineDb,
} from "./db";
import {
  isDeckOperation,
  isGameOperation,
  isPlayerOperation,
  isStockOperation,
  isTournamentOperation,
  isVenueOperation,
} from "./families";
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

/**
 * Lot 6 : le `GET` a rendu 401 (pas de session, expirée ou révoquée). Un cas à
 * part de `RefreshError` : l'appelant (`runtime.ts`) ne doit ni l'afficher
 * comme une erreur de lecture ordinaire (rien n'est perdu, le miroir n'a pas
 * bougé : l'écriture n'a lieu qu'après avoir tout lu), ni laisser croire à une
 * perte de données — seulement signaler que l'authentification est requise.
 */
export class RefreshAuthError extends RefreshError {}

// Chaque miroir n'efface, des opérations tranchées, que la famille qu'il reflète
// (`families.ts`).

/**
 * Lot 4b : un `deck_card.upsert` qui acquiert des exemplaires touche les deux
 * miroirs (la ligne et l'entrée de stock) et ne peut sortir de `settled` qu'une
 * fois les deux à jour. Le miroir de stock, en se remplaçant, retire le champ
 * `acquired_quantity` de l'opération retenue (l'effet sur le stock est repris
 * par le miroir) ; le miroir de decks n'efface, lui, que les opérations qui ne
 * l'ont plus. Sans cela, l'un des deux effacerait l'opération pour l'autre et
 * la ligne (ou l'entrée de stock) disparaîtrait un instant.
 */
const acquires = (entry: { type: string; operation: unknown }) =>
  entry.type === "deck_card.upsert" &&
  ((entry.operation as { data?: { acquired_quantity?: number } }).data?.acquired_quantity ?? 0) > 0;

function unwrap<T>(result: { data?: T; error?: unknown; response: Response }, what: string): T {
  if (result.data === undefined) {
    if (result.response.status === 401) {
      throw new RefreshAuthError(`${what} : authentification requise`);
    }
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
    await db.settled
      .where("seq")
      .belowOrEqual(settledUpTo)
      .filter(acquires)
      .modify((entry) => {
        delete (entry.operation as { data?: { acquired_quantity?: number } }).data
          ?.acquired_quantity;
      });
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
    vdbDeckId: deck.vdb_deck_id,
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
    await pruneSettled(
      db,
      settledUpTo,
      (type, entry) => isDeckOperation(type) && !acquires(entry),
    );
  });
  return decks.length;
}

type CardSearchItem = Schemas["CardSearchItem"];

/** Découpe un prérequis joint par `", "` (aucun nom de clan ni de voie n'a de virgule). */
const splitJoined = (value: string | null): string[] =>
  value
    ? value
        .split(",")
        .map((part) => part.trim())
        .filter((part) => part !== "")
    : [];

/**
 * Un serveur d'avant le lot Chercher rend `CardListItem` sans les champs
 * nouveaux. On le reconnaît à l'absence des listes qu'un serveur à jour rend
 * toujours (champs obligatoires en sortie, §7) : on ne fabrique alors aucun
 * détail, pour que le miroir reste « incomplet » plutôt que faussement complet.
 */
const hasDetails = (card: CardSearchItem): boolean => {
  const loose = card as Partial<CardSearchItem>;
  return (
    Array.isArray(loose.translated_names) &&
    Array.isArray(loose.discipline_links) &&
    Array.isArray(loose.types) &&
    Array.isArray(loose.required_sects)
  );
};

export function cardRowOf(card: CardSearchItem): CardRow {
  return {
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
  };
}

export function cardDetailRowOf(card: CardSearchItem): CardDetailRow {
  const translatedNames = card.translated_names.map((translation) => ({
    languageCode: translation.language_code,
    name: translation.name,
  }));
  return {
    id: card.id,
    clanId: card.clan?.id ?? null,
    sect: card.sect?.name ?? null,
    title: card.title,
    path: card.path,
    costType: card.cost_type,
    costValue: card.cost_value,
    clanRequirements: splitJoined(card.clan_requirement),
    pathRequirements: splitJoined(card.path_requirement),
    disciplineRequirement: card.discipline_requirement,
    disciplines: card.discipline_links.map((link) => ({
      code: (link.discipline.abbrev ?? link.discipline.name).toLowerCase(),
      name: link.discipline.name,
      superior: link.superior,
    })),
    types: card.types.map((type) => type.name),
    libraryRequirement: card.library_requirement,
    requiredSects: card.required_sects,
    requiredTitles: card.required_titles,
    requiresTitled: card.requires_titled,
    requiresNonTitled: card.requires_non_titled,
    otherRequirements: card.other_requirements,
    cardText: card.card_text,
    foldedText: foldText(card.card_text ?? ""),
    bannedOn: card.banned_on,
    legalFrom: card.legal_from,
    translatedNames,
    foldedTranslatedNames: translatedNames.map((translation) => foldText(translation.name)),
  };
}

/**
 * Catalogue complet (environ 4 200 cartes), pour chercher et saisir hors ligne.
 *
 * Lot Chercher : deux magasins, `cards` (la ligne courte que relit toute
 * lecture) et `cardDetails` (ce que les filtres demandent). Toutes les pages
 * sont lues avant d'écrire, puis les deux magasins sont remplacés dans **une**
 * transaction : une lecture interrompue ne touche à aucun des deux. Face à un
 * serveur qui ne rend pas les champs nouveaux, `cards` est relu comme avant et
 * `cardDetails` n'est pas écrit : le miroir reste incomplet (`readCatalogState`).
 */
export async function refreshCatalog(client: ApiClient, db: VtesOfflineDb): Promise<number> {
  const cards = await pages(async (offset) =>
    unwrap(
      await client.GET("/cartes", { params: { query: { limit: PAGE_SIZE, offset } } }),
      "GET /cartes",
    ),
  );
  const rows = cards.map(cardRowOf);
  const details = cards.length > 0 && cards.every(hasDetails) ? cards.map(cardDetailRowOf) : null;
  await db.transaction("rw", db.cards, db.cardDetails, async () => {
    await db.cards.clear();
    await db.cards.bulkPut(rows);
    if (details) {
      await db.cardDetails.clear();
      await db.cardDetails.bulkPut(details);
    }
  });
  return rows.length;
}

// --- Pratique de jeu (Lot 7) -----------------------------------------------
//
// Ordre de rafraîchissement (`runtime.ts`) : joueurs, lieux, tournois, puis
// parties. Une partie tranchée sort de `settled` quand le miroir des parties est
// remplacé, et son tournoi doit alors déjà porter son bilan à jour ; un tournoi
// ou une partie qui désigne un joueur ou un lieu le trouve déjà en place.

export async function refreshPlayers(client: ApiClient, db: VtesOfflineDb): Promise<number> {
  const settledUpTo = await lastSettledSeq(db);
  const players = unwrap(await client.GET("/joueurs"), "GET /joueurs");
  const rows: PlayerRow[] = players.map((player) => ({
    id: player.id,
    name: player.name,
    foldedName: foldText(player.name),
    isMe: player.is_me,
    gameCount: player.game_count,
  }));
  await db.transaction("rw", db.players, db.settled, async () => {
    await db.players.clear();
    await db.players.bulkPut(rows);
    await pruneSettled(db, settledUpTo, isPlayerOperation);
  });
  return rows.length;
}

export async function refreshVenues(client: ApiClient, db: VtesOfflineDb): Promise<number> {
  const settledUpTo = await lastSettledSeq(db);
  const venues = unwrap(await client.GET("/lieux"), "GET /lieux");
  const rows: VenueRow[] = venues.map((venue) => ({
    id: venue.id,
    name: venue.name,
    foldedName: foldText(venue.name),
    city: venue.city,
    notes: venue.notes,
    gameCount: venue.game_count,
    tournamentCount: venue.tournament_count,
  }));
  await db.transaction("rw", db.venues, db.settled, async () => {
    await db.venues.clear();
    await db.venues.bulkPut(rows);
    await pruneSettled(db, settledUpTo, isVenueOperation);
  });
  return rows.length;
}

/**
 * Tournois, détail compris : le bilan et les decks admis en finale ne se lisent
 * que sur `GET /tournois/{id}`, et les decks admis changent quand une **partie**
 * change (sans que `updated_at` du tournoi bouge) : on relit donc le détail de
 * chaque tournoi à chaque rafraîchissement, comme les decks. Un tournoi supprimé
 * entre la liste et le détail (404) est simplement omis.
 */
export async function refreshTournaments(client: ApiClient, db: VtesOfflineDb): Promise<number> {
  const settledUpTo = await lastSettledSeq(db);
  const listed = unwrap(await client.GET("/tournois"), "GET /tournois");
  const rows: TournamentRow[] = [];
  for (const tournament of listed) {
    const result = await client.GET("/tournois/{tournament_id}", {
      params: { path: { tournament_id: tournament.id } },
    });
    if (result.data === undefined && result.response.status === 404) continue;
    const detail = unwrap(result, `GET /tournois/${tournament.id}`);
    rows.push({
      id: detail.id,
      name: detail.name,
      startDate: detail.start_date,
      endDate: detail.end_date,
      venueId: detail.venue_id,
      deckPolicy: detail.deck_policy,
      format: detail.format,
      eventTier: detail.event_tier,
      finalDeckRule: detail.final_deck_rule,
      roundCount: detail.round_count,
      playerCount: detail.player_count,
      myRanking: detail.my_ranking,
      summary: {
        preliminaryGameWins: detail.my_summary.preliminary_game_wins,
        preliminaryVictoryPoints: detail.my_summary.preliminary_victory_points,
        roundsPlayed: detail.my_summary.rounds_played,
        finalVictoryPoints: detail.my_summary.final_victory_points,
        finalGameWin: detail.my_summary.final_game_win,
      },
      admissibleFinalDecks: detail.admissible_final_decks,
      deckVersions: detail.deck_versions.map((version) => ({
        deckId: version.deck_id,
        deckVersionId: version.deck_version_id,
        deckVersionNumber: version.deck_version_number,
        frozenByGameId: version.frozen_by_game_id,
      })),
      notes: detail.notes,
      updatedAt: detail.updated_at,
    });
  }
  await db.transaction("rw", db.tournaments, db.settled, async () => {
    await db.tournaments.clear();
    await db.tournaments.bulkPut(rows);
    await pruneSettled(db, settledUpTo, isTournamentOperation);
  });
  return rows.length;
}

function gameRow(game: Schemas["GameRead"], table: GameTableLineRow[] | null): GameRow {
  return {
    id: game.id,
    playedAt: game.played_at,
    venueId: game.venue_id,
    tournamentId: game.tournament_id,
    tournamentName: game.tournament_name,
    roundNumber: game.round_number,
    roundType: game.round_type,
    playerCount: game.player_count,
    me: {
      deckId: game.me.deck_id,
      deckVersionId: game.me.deck_version_id,
      deckVersionNumber: game.me.deck_version_number,
      seat: game.me.seat,
      victoryPoints: game.me.victory_points,
      gameWin: game.me.game_win,
    },
    notes: game.notes,
    updatedAt: game.updated_at,
    table,
  };
}

function tableLine(line: Schemas["ParticipationRead"]): GameTableLineRow {
  return {
    playerId: line.player_id,
    isMe: line.is_me,
    deckId: line.deck_id,
    deckVersionId: line.deck_version_id,
    deckVersionNumber: line.deck_version_number,
    seat: line.seat,
    victoryPoints: line.victory_points,
    gameWin: line.game_win,
    opponentDeckName: line.opponent_deck_name,
    opponentDeckArchetype: line.opponent_deck_archetype,
    opponentClanId: line.opponent_clan_id,
    notes: line.notes,
  };
}

/**
 * Parties, tables comprises, **de façon incrémentale** (choix validé le
 * 2026-10-29, `docs/lot7-plan-parties.md`) : la liste ne rend que mon résumé, la
 * table d'une partie se lit par `GET /parties/{id}`. Une partie déjà connue avec sa
 * table, dont `updated_at` n'a pas changé, n'est pas relue (le serveur pose
 * `updated_at` aussi quand seule la table change). Une partie disparue entre la
 * liste et le détail (404) est omise. Toute autre erreur annule le
 * rafraîchissement, l'ancien miroir restant intact.
 */
export async function refreshGames(client: ApiClient, db: VtesOfflineDb): Promise<number> {
  const settledUpTo = await lastSettledSeq(db);
  const listed = unwrap(await client.GET("/parties"), "GET /parties");
  const known = new Map((await db.games.toArray()).map((row) => [row.id, row]));
  const rows: GameRow[] = [];
  for (const game of listed) {
    const previous = known.get(game.id);
    if (previous && previous.table !== null && previous.updatedAt === game.updated_at) {
      rows.push(gameRow(game, previous.table));
      continue;
    }
    const result = await client.GET("/parties/{game_id}", {
      params: { path: { game_id: game.id } },
    });
    if (result.data === undefined && result.response.status === 404) continue;
    const detail = unwrap(result, `GET /parties/${game.id}`);
    rows.push(gameRow(detail, detail.participations.map(tableLine)));
  }
  await db.transaction("rw", db.games, db.settled, async () => {
    await db.games.clear();
    await db.games.bulkPut(rows);
    await pruneSettled(db, settledUpTo, isGameOperation);
  });
  return rows.length;
}

// --- Versions de deck jouées (Lot 8) ----------------------------------------

/** Versions que le miroir des parties et des tournois désigne, par deck. */
async function referencedVersions(db: VtesOfflineDb): Promise<Map<number, Set<number>>> {
  const byDeck = new Map<number, Set<number>>();
  const note = (deckId: number | null, versionId: number | null | undefined) => {
    if (deckId === null) return;
    const versions = byDeck.get(deckId) ?? new Set<number>();
    if (versionId != null) versions.add(versionId);
    byDeck.set(deckId, versions);
  };
  const [games, tournaments] = await Promise.all([db.games.toArray(), db.tournaments.toArray()]);
  for (const game of games) {
    note(game.me.deckId, game.me.deckVersionId);
    for (const line of game.table ?? []) note(line.deckId, line.deckVersionId);
  }
  for (const tournament of tournaments) {
    for (const version of tournament.deckVersions ?? []) note(version.deckId, version.deckVersionId);
  }
  return byDeck;
}

function deckVersionRow(version: Schemas["DeckVersionRead"]): DeckVersionRow {
  return {
    id: version.id,
    deckId: version.deck_id,
    number: version.number,
    createdAt: version.created_at,
    cryptCount: version.crypt_count,
    libraryCount: version.library_count,
    cards: version.cards.map((card) => ({ cardId: card.card_id, quantity: card.quantity })),
  };
}

/**
 * Versions des decks joués (A6), lues par `GET /decks/{id}/versions` pour les
 * seuls decks que désignent les parties ou les tournois du miroir : à appeler
 * **après** eux (`runtime.ts`). Une version ne change jamais : un deck dont
 * toutes les versions désignées sont déjà au miroir n'est pas relu. Un deck
 * qui n'est plus joué sort du magasin. Un deck introuvable (404) est omis,
 * comme une partie disparue entre la liste et le détail ; toute autre erreur
 * annule le rafraîchissement, l'ancien miroir restant intact.
 */
export async function refreshDeckVersions(client: ApiClient, db: VtesOfflineDb): Promise<number> {
  const referenced = await referencedVersions(db);
  const known = await db.deckVersions.toArray();
  const knownIds = new Set(known.map((row) => row.id));
  const rows: DeckVersionRow[] = [];
  for (const [deckId, versionIds] of referenced) {
    // Une ligne sans version (partie d'avant le gel) n'oblige pas à relire le deck.
    const upToDate = [...versionIds].every((id) => knownIds.has(id));
    if (upToDate) {
      rows.push(...known.filter((row) => row.deckId === deckId));
      continue;
    }
    const result = await client.GET("/decks/{deck_id}/versions", {
      params: { path: { deck_id: deckId } },
    });
    if (result.data === undefined && result.response.status === 404) continue;
    rows.push(...unwrap(result, `GET /decks/${deckId}/versions`).map(deckVersionRow));
  }
  await db.transaction("rw", db.deckVersions, async () => {
    await db.deckVersions.clear();
    await db.deckVersions.bulkPut(rows);
  });
  return rows.length;
}
