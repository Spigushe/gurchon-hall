import {
  DECK_ARCHETYPE_LABELS,
  type DeckArchetype,
  type DeckKey,
  type LocalGame,
  type LocalTableLine,
  type ResourceKey,
  type RoundType,
} from "../../offline/vtes";
import { seatPositions, type SeatPosition } from "./analysisModel";

/**
 * Bilan du Lot 8 (D2, A7), en fonctions pures et en tables de petites
 * fonctions, sans `switch`. Tout se calcule sur l'appareil, à partir des
 * parties du miroir (P9).
 *
 * Le modèle ne produit **aucun pourcentage**, même en interne (P8) : il rend
 * des comptes (parties, GW, VP) et le VP moyen par partie, qui n'en est pas
 * un. Les barres de l'écran se dessinent en proportions flexibles à partir de
 * ces comptes, sans jamais passer par une part sur cent.
 */

/** Le deck d'un adversaire tel que l'analyse le regroupe (P5). */
export interface OpponentDeck {
  clanName: string | null;
  archetype: DeckArchetype | null;
}

/**
 * Ce qu'il y a à une position de la table : le deck de l'adversaire assis là,
 * `null` si personne n'est saisi à ce siège (groupe « inconnu »), `"none"` si
 * la position n'existe pas à cette table (grande position à trois joueurs ou
 * moins, P8) ou que mon siège n'est pas saisi.
 */
export type PositionValue = OpponentDeck | null | "none";

/** Une partie, réduite à ce que le bilan regroupe. */
export interface GameFact {
  key: ResourceKey;
  playedAt: string;
  /** Jour local `AAAA-MM-JJ`, pour les filtres de période. */
  day: string;
  /** Mois local `AAAA-MM`. */
  month: string;
  pending: boolean;
  roundType: RoundType;
  roundNumber: number | null;
  tournamentKey: ResourceKey | null;
  tournamentName: string | null;
  venueKey: ResourceKey | null;
  deckKey: DeckKey | null;
  versionNumber: number | null;
  /** VP saisis ; une partie sans VP compte pour 0. */
  victoryPoints: number;
  gameWin: boolean;
  /** Mon siège est saisi et tient dans la table. */
  seated: boolean;
  positions: Readonly<Record<SeatPosition, PositionValue>>;
  /** Adversaires nommés de la table (P8 : mes résultats aux tables où il était). */
  opponents: ResourceKey[];
}

/** Ce que `gameFact` doit savoir hors de la partie. */
export interface GameFactContext {
  clanName(clanId: number | null): string | null;
  /** Le deck d'une ligne qui joue un de mes decks prêtés : archétype du deck, clan de sa version. */
  lentDeck(deckKey: DeckKey, versionId: number | null): OpponentDeck;
}

const pad2 = (n: number) => String(n).padStart(2, "0");
const localDay = (date: Date) => `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;

/** Jour local `AAAA-MM-JJ` d'un instant ; le début de la chaîne s'il est illisible. */
export function localDayOf(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso.slice(0, 10) : localDay(date);
}

function lineDeck(line: LocalTableLine, context: GameFactContext): OpponentDeck {
  if (line.deckKey !== null) return context.lentDeck(line.deckKey, line.deckVersionId);
  return { clanName: context.clanName(line.opponentClanId), archetype: line.opponentDeckArchetype };
}

function positionValue(game: LocalGame, seat: number | null, context: GameFactContext): PositionValue {
  if (seat === null) return "none";
  const line = game.table?.find((candidate) => !candidate.isMe && candidate.seat === seat);
  return line ? lineDeck(line, context) : null;
}

const namedOpponents = (game: LocalGame): ResourceKey[] =>
  (game.table ?? []).flatMap((line) => (line.isMe || line.playerKey === null ? [] : [line.playerKey]));

/** Une partie du miroir, réduite à ce que le bilan regroupe (A7). */
export function gameFact(game: LocalGame, context: GameFactContext): GameFact {
  const seats = seatPositions(game.me.seat, game.playerCount);
  const day = localDayOf(game.playedAt);
  return {
    key: game.key,
    playedAt: game.playedAt,
    day,
    month: day.slice(0, 7),
    pending: game.pending,
    roundType: game.roundType,
    roundNumber: game.roundNumber,
    tournamentKey: game.tournamentKey,
    tournamentName: game.tournamentName,
    venueKey: game.venueKey,
    deckKey: game.me.deckKey,
    versionNumber: game.me.deckVersionNumber,
    victoryPoints: game.me.victoryPoints ?? 0,
    gameWin: game.me.gameWin === true,
    seated: seats.prey !== null,
    positions: {
      prey: positionValue(game, seats.prey, context),
      predator: positionValue(game, seats.predator, context),
      grandPrey: positionValue(game, seats.grandPrey, context),
      grandPredator: positionValue(game, seats.grandPredator, context),
    },
    opponents: namedOpponents(game),
  };
}

// --- Filtres ----------------------------------------------------------------

export type PeriodPreset = "year" | "12m" | "all" | "custom";

export interface BilanFilters {
  period: PeriodPreset;
  /** Bornes `AAAA-MM-JJ` d'une période choisie à la main (`custom`), incluses. */
  from: string | null;
  to: string | null;
  /** Types de partie retenus ; vide : tous (1b-47). */
  roundTypes: RoundType[];
  /** Un seul deck, ou tous. */
  deckKey: DeckKey | null;
}

export const DEFAULT_BILAN_FILTERS: BilanFilters = {
  period: "12m",
  from: null,
  to: null,
  roundTypes: [],
  deckKey: null,
};

export const PERIOD_PRESETS: readonly Exclude<PeriodPreset, "custom">[] = ["year", "12m", "all"];

export const PERIOD_LABELS: Readonly<Record<PeriodPreset, string>> = {
  year: "Cette année",
  "12m": "12 derniers mois",
  all: "Tout",
  custom: "Période choisie",
};

export const ROUND_TYPES: readonly RoundType[] = ["casual", "preliminary", "final"];

export const ROUND_TYPE_LABELS: Readonly<Record<RoundType, string>> = {
  casual: "Amicale",
  preliminary: "Préliminaire",
  final: "Finale",
};

type Range = { from: string | null; to: string | null };

const PERIOD_RANGES: Readonly<Record<PeriodPreset, (filters: BilanFilters, now: Date) => Range>> = {
  year: (_filters, now) => ({ from: `${now.getFullYear()}-01-01`, to: null }),
  "12m": (_filters, now) => ({
    from: localDay(new Date(now.getFullYear() - 1, now.getMonth(), now.getDate() + 1)),
    to: null,
  }),
  all: () => ({ from: null, to: null }),
  custom: (filters) => ({ from: filters.from, to: filters.to }),
};

/** Bornes de la période, incluses ; `null` : pas de borne. */
export function periodRange(filters: BilanFilters, now: Date): Range {
  return PERIOD_RANGES[filters.period](filters, now);
}

const inRange = (day: string, { from, to }: Range) => (from === null || day >= from) && (to === null || day <= to);

/** Les parties retenues par les filtres. */
export function filterFacts(facts: readonly GameFact[], filters: BilanFilters, now: Date): GameFact[] {
  const range = periodRange(filters, now);
  return facts.filter(
    (fact) =>
      inRange(fact.day, range) &&
      (filters.roundTypes.length === 0 || filters.roundTypes.includes(fact.roundType)) &&
      (filters.deckKey === null || fact.deckKey === filters.deckKey),
  );
}

/** Un filtre s'écarte du défaut (pour « Effacer les filtres »). */
export function filtersChanged(filters: BilanFilters): boolean {
  return filters.period !== DEFAULT_BILAN_FILTERS.period || filters.roundTypes.length > 0 || filters.deckKey !== null;
}

/** Coche ou décoche un type de partie. */
export function toggleRoundType(filters: BilanFilters, type: RoundType): BilanFilters {
  const roundTypes = filters.roundTypes.includes(type)
    ? filters.roundTypes.filter((candidate) => candidate !== type)
    : ROUND_TYPES.filter((candidate) => candidate === type || filters.roundTypes.includes(candidate));
  return { ...filters, roundTypes };
}

/** Une borne saisie à la main fait passer la période en `custom`, en partant des bornes affichées. */
export function withBound(filters: BilanFilters, bound: "from" | "to", value: string, now: Date): BilanFilters {
  const range = periodRange(filters, now);
  return { ...filters, ...range, period: "custom", [bound]: value === "" ? null : value };
}

// --- Agrégats ---------------------------------------------------------------

export interface Stats {
  games: number;
  gameWins: number;
  victoryPoints: number;
}

export function statsOf(facts: readonly GameFact[]): Stats {
  return {
    games: facts.length,
    gameWins: facts.filter((fact) => fact.gameWin).length,
    victoryPoints: facts.reduce((sum, fact) => sum + fact.victoryPoints, 0),
  };
}

/** VP moyen par partie ; `null` sans partie. Ce n'est pas un pourcentage. */
export function averageVp(stats: Stats): number | null {
  return stats.games === 0 ? null : stats.victoryPoints / stats.games;
}

/** Un groupe d'un axe : son libellé, son bilan et ses parties. */
export interface Group {
  key: string;
  label: string;
  /** Le groupe « inconnu », toujours en dernier. */
  unknown: boolean;
  stats: Stats;
  facts: GameFact[];
}

export const UNKNOWN_GROUP = "__unknown";
export const UNKNOWN_LABEL = "inconnu";

const compareLabels = (a: string, b: string) => a.localeCompare(b, "fr", { sensitivity: "base" });

/** Groupe « inconnu » en dernier, le reste par libellé (ordre des lignes du handoff). */
function compareGroups(a: Group, b: Group): number {
  if (a.unknown !== b.unknown) return a.unknown ? 1 : -1;
  return compareLabels(a.label, b.label);
}

function bucketsOf(
  facts: readonly GameFact[],
  keysOf: (fact: GameFact) => ReadonlyArray<string | null>,
): Map<string, GameFact[]> {
  const buckets = new Map<string, GameFact[]>();
  for (const fact of facts) {
    for (const key of keysOf(fact)) {
      const bucket = key ?? UNKNOWN_GROUP;
      const members = buckets.get(bucket);
      if (members) members.push(fact);
      else buckets.set(bucket, [fact]);
    }
  }
  return buckets;
}

/**
 * Regroupe des parties par une ou plusieurs clés (un adversaire nommé met la
 * partie dans plusieurs groupes) ; une clé `null` va au groupe « inconnu ».
 */
function groupFacts(
  facts: readonly GameFact[],
  keysOf: (fact: GameFact) => ReadonlyArray<string | null>,
  labelOf: (key: string) => string,
): Group[] {
  return [...bucketsOf(facts, keysOf)].map(([key, members]) => ({
    key,
    label: key === UNKNOWN_GROUP ? UNKNOWN_LABEL : labelOf(key),
    unknown: key === UNKNOWN_GROUP,
    stats: statsOf(members),
    facts: members,
  }));
}

/** Une version d'un deck : « v2 · depuis le 10 octobre ». */
export interface VersionGroup {
  /** `v2`, `pending` (liste figée à la synchronisation) ou `unfrozen` (partie d'avant le gel). */
  key: string;
  number: number | null;
  /** Parties en attente de synchronisation : liste figée au rejeu. */
  pending: boolean;
  /** Jour local de la première partie de la version. */
  since: string;
  stats: Stats;
  facts: GameFact[];
}

export interface DeckGroup extends Group {
  /** Par numéro croissant, les parties sans version en dernier. */
  versions: VersionGroup[];
}

function versionKeyOf(fact: GameFact): string {
  if (fact.versionNumber !== null) return `v${fact.versionNumber}`;
  return fact.pending ? "pending" : "unfrozen";
}

const versionRank = (group: VersionGroup) => group.number ?? Number.MAX_SAFE_INTEGER;
const firstDay = (facts: readonly GameFact[]) => facts.reduce((first, fact) => (fact.day < first ? fact.day : first), facts[0].day);

/** Les versions jouées dans ces parties (1b-46, 1b-53, d31). */
export function versionGroups(facts: readonly GameFact[]): VersionGroup[] {
  return [...bucketsOf(facts, (fact) => [versionKeyOf(fact)])]
    .map(([key, members]) => ({
      key,
      number: members[0].versionNumber,
      pending: key === "pending",
      since: firstDay(members),
      stats: statsOf(members),
      facts: members,
    }))
    .sort((a, b) => versionRank(a) - versionRank(b) || a.key.localeCompare(b.key));
}

/** Axe Deck, puis version de ce deck (P8). */
export function deckAxis(facts: readonly GameFact[], deckName: (key: DeckKey) => string): DeckGroup[] {
  return groupFacts(facts, (fact) => [fact.deckKey], (key) => deckName(key as DeckKey))
    .sort(compareGroups)
    .map((group) => ({ ...group, versions: versionGroups(group.facts) }));
}

/** Axe Lieu ; une partie sans lieu va au groupe « inconnu ». */
export function venueAxis(facts: readonly GameFact[], venueName: (key: ResourceKey) => string): Group[] {
  return groupFacts(facts, (fact) => [fact.venueKey], (key) => venueName(key as ResourceKey)).sort(compareGroups);
}

const MONTH_NAMES = [
  "Janvier",
  "Février",
  "Mars",
  "Avril",
  "Mai",
  "Juin",
  "Juillet",
  "Août",
  "Septembre",
  "Octobre",
  "Novembre",
  "Décembre",
];

/** « Octobre 2026 » pour `2026-10`. */
export function monthLabel(month: string): string {
  const name = MONTH_NAMES[Number(month.slice(5, 7)) - 1];
  return name ? `${name} ${month.slice(0, 4)}` : month;
}

/** Axe Mois, le plus récent en haut (seule exception à l'ordre alphabétique). */
export function monthAxis(facts: readonly GameFact[]): Group[] {
  return groupFacts(facts, (fact) => [fact.month], monthLabel).sort((a, b) => b.key.localeCompare(a.key));
}

/** Axe Adversaires : une partie compte pour chaque adversaire nommé de sa table ; « Joueur non nommé » n'y figure pas. */
export function opponentAxis(facts: readonly GameFact[], playerName: (key: ResourceKey) => string): Group[] {
  return groupFacts(
    facts.filter((fact) => fact.opponents.length > 0),
    (fact) => [...new Set(fact.opponents)],
    (key) => playerName(key as ResourceKey),
  ).sort(compareGroups);
}

export type PositionGrouping = "archetype" | "clan";

export interface PositionAxis {
  groups: Group[];
  /** Parties sans mon siège, sorties de l'axe (P7). */
  unseated: number;
  /** Parties avec mon siège mais sans cette position (trois joueurs ou moins pour une grande position, P8). */
  withoutPosition: number;
}

const POSITION_KEYS: Readonly<Record<PositionGrouping, (deck: OpponentDeck) => string | null>> = {
  archetype: (deck) => deck.archetype,
  clan: (deck) => deck.clanName,
};

const POSITION_LABELS: Readonly<Record<PositionGrouping, (key: string) => string>> = {
  archetype: (key) => DECK_ARCHETYPE_LABELS[key as DeckArchetype] ?? key,
  clan: (key) => key,
};

/**
 * Axe par position (P7, P8) : le deck de l'adversaire assis à cette position,
 * regroupé par archétype ou par clan. Un siège sans ligne saisie, ou une ligne
 * sans ce renseignement, va au groupe « inconnu ».
 */
export function positionAxis(facts: readonly GameFact[], position: SeatPosition, grouping: PositionGrouping): PositionAxis {
  const seated = facts.filter((fact) => fact.seated);
  const eligible = seated.filter((fact) => fact.positions[position] !== "none");
  const keyOf = POSITION_KEYS[grouping];
  const groups = groupFacts(
    eligible,
    (fact) => {
      const value = fact.positions[position] as OpponentDeck | null;
      return [value === null ? null : keyOf(value)];
    },
    POSITION_LABELS[grouping],
  ).sort(compareGroups);
  return { groups, unseated: facts.length - seated.length, withoutPosition: seated.length - eligible.length };
}

/** Résumé du bilan (1b-46) : parties, GW, VP, tournois joués, finales atteintes. */
export interface BilanSummary extends Stats {
  tournaments: number;
  finals: number;
}

export function bilanSummary(facts: readonly GameFact[]): BilanSummary {
  return {
    ...statsOf(facts),
    tournaments: new Set(facts.flatMap((fact) => (fact.tournamentKey ? [fact.tournamentKey] : []))).size,
    finals: facts.filter((fact) => fact.roundType === "final").length,
  };
}

// --- Tri des tableaux du bureau (d25) ----------------------------------------

export type GroupColumn = "label" | "games" | "gameWins" | "victoryPoints" | "average";

export interface GroupSort {
  column: GroupColumn;
  descending: boolean;
}

const COLUMN_VALUES: Readonly<Record<Exclude<GroupColumn, "label">, (group: Group) => number>> = {
  games: (group) => group.stats.games,
  gameWins: (group) => group.stats.gameWins,
  victoryPoints: (group) => group.stats.victoryPoints,
  average: (group) => averageVp(group.stats) ?? 0,
};

function compareByColumn(column: GroupColumn, a: Group, b: Group): number {
  if (column === "label") return compareLabels(a.label, b.label);
  return COLUMN_VALUES[column](a) - COLUMN_VALUES[column](b);
}

/** Tri au clic d'en-tête ; « inconnu » reste en dernier dans les deux sens. `null` : ordre d'origine. */
export function sortGroups<G extends Group>(groups: readonly G[], sort: GroupSort | null): G[] {
  if (sort === null) return [...groups];
  const direction = sort.descending ? -1 : 1;
  return [...groups].sort((a, b) => {
    if (a.unknown !== b.unknown) return a.unknown ? 1 : -1;
    return direction * compareByColumn(sort.column, a, b) || compareLabels(a.label, b.label);
  });
}

/** Clic sur un en-tête : premier clic dans le sens naturel de la colonne, second clic inversé. */
export function nextSort(current: GroupSort | null, column: GroupColumn): GroupSort {
  if (current?.column === column) return { column, descending: !current.descending };
  return { column, descending: column !== "label" };
}

// --- Clan principal de mes decks (P5) ----------------------------------------

const beats = (entry: [string, number], best: [string, number] | null) =>
  best === null || entry[1] > best[1] || (entry[1] === best[1] && compareLabels(entry[0], best[0]) < 0);

/**
 * Clan le plus représenté d'une crypte, en exemplaires ; égalité départagée
 * par le nom. `null` sans carte de clan connu.
 */
export function mainClan(
  cards: ReadonlyArray<{ cardId: number; quantity: number }>,
  cryptClanOf: (cardId: number) => string | null,
): string | null {
  const counts = new Map<string, number>();
  for (const { cardId, quantity } of cards) {
    const clan = cryptClanOf(cardId);
    if (clan) counts.set(clan, (counts.get(clan) ?? 0) + quantity);
  }
  let best: [string, number] | null = null;
  for (const entry of counts) if (beats(entry, best)) best = entry;
  return best?.[0] ?? null;
}

// --- Libellés (jamais de pourcentage) ---------------------------------------

/** « 2,3 », une décimale à la virgule ; « — » sans partie. */
export function formatAverage(value: number | null): string {
  return value === null ? "—" : value.toFixed(1).replace(".", ",");
}

/** « 26,5 » : les VP vont par demi-points. */
export function formatPoints(value: number): string {
  return String(value).replace(".", ",");
}

/** « 1 partie », « 14 parties ». */
export function gamesCount(n: number): string {
  return `${n} ${n > 1 ? "parties" : "partie"}`;
}

/** « 6 GW sur 14 parties ». */
export function gameWinsLine(stats: Stats): string {
  return `${stats.gameWins} GW sur ${gamesCount(stats.games)}`;
}

/** « 5 GW sur 9 parties · 20,5 VP ». */
export function groupMeta(stats: Stats): string {
  return `${gameWinsLine(stats)} · ${formatPoints(stats.victoryPoints)} VP`;
}

/** « 26,5 VP, 1,9 VP par partie ». */
export function pointsLine(stats: Stats): string {
  return `${formatPoints(stats.victoryPoints)} VP, ${formatAverage(averageVp(stats))} VP par partie`;
}

/** « 2 tournois joués · 1 finale atteinte ». */
export function tournamentsLine(summary: BilanSummary): string {
  const tournaments = `${summary.tournaments} ${summary.tournaments > 1 ? "tournois joués" : "tournoi joué"}`;
  const finals = `${summary.finals} ${summary.finals > 1 ? "finales atteintes" : "finale atteinte"}`;
  return `${tournaments} · ${finals}`;
}

/** « 10 octobre » dans l'année de `now`, « 10 octobre 2025 » sinon. */
export function dayLabel(day: string, now: Date): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return day;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const options: Intl.DateTimeFormatOptions =
    date.getFullYear() === now.getFullYear()
      ? { day: "numeric", month: "long" }
      : { day: "numeric", month: "long", year: "numeric" };
  return date.toLocaleDateString("fr-FR", options);
}

/** Ligne d'une version : « v2 », « liste figée à la synchronisation », « liste non figée ». */
export function versionLabel(version: Pick<VersionGroup, "number" | "pending">): string {
  if (version.number !== null) return `v${version.number}`;
  return version.pending ? "liste figée à la synchronisation" : "liste non figée";
}
