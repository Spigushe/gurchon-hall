import { foldText } from "../../offline/core";
import {
  findByKey,
  type LocalGame,
  type LocalPlayer,
  type LocalTournament,
  type LocalVenue,
} from "../../offline/vtes";

/**
 * Règles du Carnet (Lot 7, D2) : ce qui empêche de supprimer un adversaire ou un lieu, et la
 * façon de le dire. Pures, testées sans interface. Les compteurs du serveur (`gameCount`,
 * `tournamentCount`) ne suivent pas la file : on retient le plus grand entre eux et ce que
 * montrent les parties et tournois lus sur l'appareil, pour ne jamais sous-estimer l'usage.
 */

function plural(count: number, one: string, many: string = `${one}s`): string {
  return `${count} ${count > 1 ? many : one}`;
}

/** Nombre de tables où figure l'adversaire (ma ligne exclue). */
export function playerTableCount(player: LocalPlayer, games: readonly LocalGame[]): number {
  const local = games.filter((game) =>
    game.table?.some((line) => !line.isMe && findByKey([player], line.playerKey) !== undefined),
  ).length;
  return Math.max(player.gameCount, local);
}

export interface VenueUsage {
  games: number;
  tournaments: number;
}

export function venueUsage(
  venue: LocalVenue,
  games: readonly LocalGame[],
  tournaments: readonly LocalTournament[],
): VenueUsage {
  const localGames = games.filter((game) => game.venueKey !== null && findByKey([venue], game.venueKey)).length;
  const localTournaments = tournaments.filter(
    (tournament) => tournament.venueKey !== null && findByKey([venue], tournament.venueKey),
  ).length;
  return {
    games: Math.max(venue.gameCount, localGames),
    tournaments: Math.max(venue.tournamentCount, localTournaments),
  };
}

/** « à 4 tables », « à 1 table », « à aucune table ». */
export function tablesLabel(count: number): string {
  return count === 0 ? "à aucune table" : `à ${plural(count, "table")}`;
}

/** « 7 parties · 1 tournoi », « 5 parties », « aucune partie ». */
export function venueUsageLabel(usage: VenueUsage): string {
  const parts: string[] = [];
  if (usage.games > 0) parts.push(plural(usage.games, "partie"));
  if (usage.tournaments > 0) parts.push(plural(usage.tournaments, "tournoi"));
  return parts.length > 0 ? parts.join(" · ") : "aucune partie";
}

/** Motif de refus de la suppression d'un adversaire, `null` s'il n'est à aucune table. */
export function playerDeleteRefusal(name: string, tables: number): string | null {
  if (tables === 0) return null;
  return `${name} figure à ${plural(tables, "table")} : retirez-le d'abord de ${tables > 1 ? "ces parties" : "cette partie"} pour le supprimer.`;
}

/** Motif de refus de la suppression d'un lieu, `null` s'il ne sert à rien. */
export function venueDeleteRefusal(name: string, usage: VenueUsage): string | null {
  if (usage.games === 0 && usage.tournaments === 0) return null;
  const parts: string[] = [];
  if (usage.games > 0) parts.push(plural(usage.games, "partie"));
  if (usage.tournaments > 0) parts.push(plural(usage.tournaments, "tournoi"));
  return `${name} sert à ${parts.join(" et ")} : impossible de le supprimer.`;
}

/**
 * Le nom replié (casse et accents ignorés, comme `fold_text` côté serveur, P5) est-il déjà
 * porté par une autre ressource ? Le renommage refuse un doublon, y compris celui du « Moi ».
 */
export function duplicateName(
  name: string,
  others: ReadonlyArray<{ key: string; name: string }>,
  selfKey: string,
): boolean {
  const folded = foldText(name.trim());
  return others.some((other) => other.key !== selfKey && foldText(other.name.trim()) === folded);
}
