import type { components } from "../../api-client/schema.d.ts";
import {
  DECK_ARCHETYPE_LABELS,
  findByKey,
  type ClanOption,
  type DeckKey,
  type DeckVersionRow,
  type LocalDeck,
  type LocalDeckCard,
  type LocalGame,
  type LocalPlayer,
  type LocalTableLine,
  type LocalTournament,
  type LocalVenue,
  type ResourceKey,
} from "../../offline/vtes";
import { seatPositions } from "../analysis/analysisModel";
import { formatVp } from "../games/gameFormat";
import { FORMAT_LABELS, POLICY_LABELS, TIER_LABELS } from "../games/tournamentModel";

/**
 * Compte-rendu de tournoi (lot Compte-rendu, `docs/lot-compte-rendu-plan.md`),
 * en fonctions pures.
 *
 * Une version est un **instantané** que le serveur fige (P5, P6). Hors ligne,
 * l'écran montre en plus un **aperçu** : le même instantané, construit ici
 * depuis le miroir (`buildPreview`), pour voir ce que « Mettre à jour »
 * figera. Une partie encore en file n'a pas de liste figée : l'aperçu prend
 * alors la liste courante du deck, et le serveur tranchera à la
 * synchronisation.
 */

export type ReportSnapshot = components["schemas"]["ReportSnapshot"];
export type ReportRound = components["schemas"]["ReportRound"];
export type ReportSeat = components["schemas"]["ReportSeat"];
export type ReportDeck = components["schemas"]["ReportDeck"];

export const REPORT_FORMAT_VERSION = 1;

// --------------------------------------------------------------------------
// Aperçu depuis le miroir
// --------------------------------------------------------------------------

export interface PreviewInput {
  tournament: LocalTournament;
  venue: LocalVenue | null;
  /** Les parties du tournoi, dans n'importe quel ordre. */
  games: readonly LocalGame[];
  players: readonly LocalPlayer[];
  decks: readonly LocalDeck[];
  deckVersions: readonly DeckVersionRow[];
  /** Lignes courantes par deck : la liste d'une partie encore en file. */
  deckCards: ReadonlyMap<DeckKey, readonly LocalDeckCard[]>;
  clans: readonly ClanOption[];
  includeOpponentNotes: boolean;
}

/** Un instant ISO dans la forme du serveur (`…Z`, sans millisecondes). */
export function normalizeInstant(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toISOString().replace(".000Z", "Z");
}

/** Préliminaires par ronde, puis la finale, comme le serveur. */
export function gameOrder(a: LocalGame, b: LocalGame): number {
  const final = Number(a.roundType === "final") - Number(b.roundType === "final");
  if (final !== 0) return final;
  const round = (a.roundNumber ?? 0) - (b.roundNumber ?? 0);
  if (round !== 0) return round;
  return a.playedAt.localeCompare(b.playedAt);
}

function seatOrder(a: LocalTableLine, b: LocalTableLine): number {
  if (a.seat === null || b.seat === null) return Number(a.seat === null) - Number(b.seat === null);
  return a.seat - b.seat;
}

/** Identifiant d'un deck dans l'aperçu : le sien, ou un négatif pour un deck créé hors ligne. */
function previewDeckIds(decks: readonly LocalDeck[]): Map<DeckKey, number> {
  return new Map(decks.map((deck, index) => [deck.key, deck.id ?? -(index + 1)]));
}

function tableOf(game: LocalGame): LocalTableLine[] {
  if (game.table !== null) return [...game.table].sort(seatOrder);
  return [
    {
      playerKey: null,
      isMe: true,
      deckKey: game.me.deckKey,
      seat: game.me.seat,
      victoryPoints: game.me.victoryPoints,
      gameWin: game.me.gameWin,
      opponentDeckName: null,
      opponentDeckArchetype: null,
      opponentClanId: null,
      notes: null,
      deckVersionId: game.me.deckVersionId,
      deckVersionNumber: game.me.deckVersionNumber,
    },
  ];
}

function previewSeat(line: LocalTableLine, input: PreviewInput, ids: Map<DeckKey, number>): ReportSeat {
  const deck = line.deckKey === null ? undefined : input.decks.find((item) => item.key === line.deckKey);
  const player = line.playerKey === null ? undefined : findByKey(input.players, line.playerKey);
  const clan = input.clans.find((item) => item.id === line.opponentClanId);
  return {
    seat: line.seat,
    is_me: line.isMe,
    player_name: line.isMe ? null : (player?.name ?? null),
    deck_id: line.isMe && deck ? (ids.get(deck.key) ?? null) : null,
    deck_name: deck ? deck.name : line.opponentDeckName,
    deck_archetype: deck ? deck.archetype : line.opponentDeckArchetype,
    clan_name: deck ? null : (clan?.name ?? null),
    victory_points: line.isMe ? line.victoryPoints : null,
    game_win: line.isMe ? line.gameWin : null,
    notes: line.isMe || input.includeOpponentNotes ? line.notes : null,
  };
}

function cardsOfList(lines: readonly LocalDeckCard[]): ReportDeck["cards"] {
  const totals = new Map<number, number>();
  for (const line of lines) totals.set(line.cardId, (totals.get(line.cardId) ?? 0) + line.quantity);
  return [...totals].sort(([a], [b]) => a - b).map(([card_id, quantity]) => ({ card_id, quantity }));
}

function previewDecks(input: PreviewInput, games: readonly LocalGame[], ids: Map<DeckKey, number>): ReportDeck[] {
  const order: DeckKey[] = [];
  for (const game of games) {
    for (const line of tableOf(game)) {
      if (line.isMe && line.deckKey !== null && !order.includes(line.deckKey)) order.push(line.deckKey);
    }
  }
  return order.flatMap((key) => {
    const deck = input.decks.find((item) => item.key === key);
    if (!deck) return [];
    const frozen = input.tournament.deckVersions.find((item) => item.deckKey === key);
    const version = frozen && input.deckVersions.find((item) => item.id === frozen.deckVersionId);
    return [
      {
        deck_id: ids.get(key) ?? 0,
        name: deck.name,
        archetype: deck.archetype,
        version_number: version ? version.number : null,
        cards: version
          ? version.cards.map((card) => ({ card_id: card.cardId, quantity: card.quantity }))
          : cardsOfList(input.deckCards.get(key) ?? []),
      },
    ];
  });
}

export function buildPreview(input: PreviewInput): ReportSnapshot {
  const { tournament, venue } = input;
  const ids = previewDeckIds(input.decks);
  const games = [...input.games].sort(gameOrder);
  return {
    format_version: REPORT_FORMAT_VERSION,
    tournament: {
      name: tournament.name,
      start_date: tournament.startDate,
      end_date: tournament.endDate,
      venue: venue ? { name: venue.name, city: venue.city } : null,
      deck_policy: tournament.deckPolicy,
      format: tournament.format,
      event_tier: tournament.eventTier,
      final_deck_rule: tournament.finalDeckRule,
      round_count: tournament.roundCount,
      player_count: tournament.playerCount,
      my_ranking: tournament.myRanking,
      notes: tournament.notes,
    },
    summary: {
      preliminary_game_wins: tournament.summary.preliminaryGameWins,
      preliminary_victory_points: tournament.summary.preliminaryVictoryPoints,
      rounds_played: tournament.summary.roundsPlayed,
      final_victory_points: tournament.summary.finalVictoryPoints,
      final_game_win: tournament.summary.finalGameWin,
    },
    decks: previewDecks(input, games, ids),
    rounds: games.map((game) => ({
      round_type: game.roundType,
      round_number: game.roundNumber,
      played_at: normalizeInstant(game.playedAt),
      player_count: game.playerCount,
      notes: game.notes,
      seats: tableOf(game).map((line) => previewSeat(line, input, ids)),
    })),
  };
}

/** Les parties de l'aperçu, dans l'ordre de ses rondes : pour en modifier les notes. */
export function orderedGames(games: readonly LocalGame[]): LocalGame[] {
  return [...games].sort(gameOrder);
}

// --------------------------------------------------------------------------
// Comparaison
// --------------------------------------------------------------------------

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, canonical((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

/** Les rondes sans les instants, comparés à la seconde près. */
function comparable(snapshot: ReportSnapshot): unknown {
  return canonical({
    ...snapshot,
    rounds: snapshot.rounds.map((round) => ({ ...round, played_at: normalizeInstant(round.played_at) })),
  });
}

/**
 * Deux instantanés montrent-ils la même chose ? C'est la règle du serveur
 * (égalité de JSON canonique), à ceci près que l'aperçu ne connaît pas les
 * listes des parties en file : la réponse n'est alors qu'une estimation.
 */
export function sameSnapshot(a: ReportSnapshot, b: ReportSnapshot): boolean {
  return JSON.stringify(comparable(a)) === JSON.stringify(comparable(b));
}

// --------------------------------------------------------------------------
// Mise en forme de la trame
// --------------------------------------------------------------------------

const MONTH_YEAR = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" });
const MONTH = new Intl.DateTimeFormat("fr-FR", { month: "long", timeZone: "UTC" });
const WEEKDAY = new Intl.DateTimeFormat("fr-FR", { weekday: "long", timeZone: "UTC" });

function dateOf(day: string): Date | null {
  const date = new Date(`${day}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Le jour du mois, « 1er » pour le premier (handoff `COMPTE-RENDU.md`, « Dates »). */
const dayOfMonth = (date: Date) => (date.getUTCDate() === 1 ? "1er" : String(date.getUTCDate()));
const fullDay = (date: Date) => `${dayOfMonth(date)} ${MONTH_YEAR.format(date)}`;
const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * « Samedi 14 novembre 2026 » ; « Du 5 au 6 décembre 2026 » ; « Du 30 novembre
 * au 1er décembre 2026 » ; « Du 31 décembre 2026 au 1er janvier 2027 ».
 */
export function tournamentDates(start: string, end: string | null): string {
  const from = dateOf(start);
  if (from === null) return start;
  const to = end === null || end === start ? null : dateOf(end);
  if (to === null) return capitalize(`${WEEKDAY.format(from)} ${fullDay(from)}`);
  const sameYear = from.getUTCFullYear() === to.getUTCFullYear();
  const sameMonth = sameYear && from.getUTCMonth() === to.getUTCMonth();
  const head = sameMonth
    ? dayOfMonth(from)
    : sameYear
      ? `${dayOfMonth(from)} ${MONTH.format(from)}`
      : fullDay(from);
  return `Du ${head} au ${fullDay(to)}`;
}

const DAY = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

/** « 24 novembre 2026 », « 1er décembre 2026 », pour la date d'une version. */
export function versionDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.getUTCDate() === 1 ? fullDay(date) : DAY.format(date);
}

/** La ligne de faits de l'en-tête : lieu, niveau, format, politique, joueurs, rondes. */
export function headerFacts(tournament: ReportSnapshot["tournament"]): string[] {
  const venue = tournament.venue
    ? [tournament.venue.name, tournament.venue.city].filter(Boolean).join(", ")
    : null;
  return [
    venue,
    TIER_LABELS[tournament.event_tier],
    FORMAT_LABELS[tournament.format],
    POLICY_LABELS[tournament.deck_policy],
    tournament.player_count === null ? null : `${tournament.player_count} joueurs`,
    tournament.round_count === null ? null : `${tournament.round_count} rondes`,
  ].filter((item): item is string => item !== null && item !== "");
}

/** « Guns and shit (Rush) » : nom et archétype d'un deck. */
export function deckTitle(deck: Pick<ReportDeck, "name" | "archetype">): string {
  return deck.archetype ? `${deck.name} (${DECK_ARCHETYPE_LABELS[deck.archetype]})` : deck.name;
}

/** « 3e sur 22 », « 1er », ou `null` sans classement. */
export function rankingLabel(ranking: number | null, players: number | null): string | null {
  if (ranking === null) return null;
  const place = ranking === 1 ? "1er" : `${ranking}e`;
  return players === null ? place : `${place} sur ${players}`;
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** « 2 GW · 6,5 VP » ; jamais de pourcentage (P8 du Lot 8). */
export function preliminaryScore(summary: ReportSnapshot["summary"]): string {
  return `${summary.preliminary_game_wins} GW · ${formatVp(summary.preliminary_victory_points)} VP`;
}

/** « en 3 rondes », « en 1 ronde ». */
export function roundsPlayedLabel(summary: ReportSnapshot["summary"]): string {
  return `en ${plural(summary.rounds_played, "ronde", "rondes")}`;
}

/** « 2 GW · 6,5 VP en 3 rondes ». */
export function preliminaryLabel(summary: ReportSnapshot["summary"]): string {
  return `${preliminaryScore(summary)} ${roundsPlayedLabel(summary)}`;
}

/** « 3 VP · GW », « 1 VP », « GW » ; jamais « pas de GW » (handoff). `null` sans rien. */
export function scoreLabel(victoryPoints: number | null, gameWin: boolean | null): string | null {
  const parts = [victoryPoints === null ? null : `${formatVp(victoryPoints)} VP`, gameWin ? "GW" : null].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

/** Ma finale (« 1 VP », « 3 VP · GW »), ou `null` sans finale. */
export function finalLabel(summary: ReportSnapshot["summary"]): string | null {
  return scoreLabel(summary.final_victory_points, summary.final_game_win);
}

/** « Ronde 2 » ou « Finale ». */
export function roundTitle(round: Pick<ReportRound, "round_type" | "round_number">): string {
  if (round.round_type === "final") return "Finale";
  return round.round_number === null ? "Ronde" : `Ronde ${round.round_number}`;
}

/** Mon score d'une ronde : « 3 VP · GW », « 0 VP », ou `null`. */
export function myScore(round: ReportRound): string | null {
  const me = round.seats.find((seat) => seat.is_me);
  return me ? scoreLabel(me.victory_points, me.game_win) : null;
}

/** Le deck d'une ligne : « Ventrue · Vote · Princes de Paris ». */
export function seatDeck(seat: ReportSeat): string | null {
  const parts = [
    seat.clan_name,
    seat.deck_archetype ? DECK_ARCHETYPE_LABELS[seat.deck_archetype] : null,
    seat.deck_name,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

/** Le nom d'une ligne : « Moi », le joueur, ou « Joueur non nommé ». */
export function seatName(seat: ReportSeat, author: string | null): string {
  if (seat.is_me) return author ? `Moi (@${author})` : "Moi";
  return seat.player_name ?? "Joueur non nommé";
}

/** Ma proie et mon prédateur au départ, par leur nom, quand mon siège est saisi. */
export function myPositions(round: ReportRound): { prey: string | null; predator: string | null } {
  const me = round.seats.find((seat) => seat.is_me);
  const { prey, predator } = seatPositions(me?.seat ?? null, round.player_count);
  const nameAt = (seat: number | null) => {
    if (seat === null) return null;
    const line = round.seats.find((item) => item.seat === seat);
    return line ? seatName(line, null) : `siège ${seat}`;
  };
  return { prey: nameAt(prey), predator: nameAt(predator) };
}

/** Clé de surcouche d'une partie de l'aperçu, pour modifier ses notes. */
export type RoundGameKey = ResourceKey;
