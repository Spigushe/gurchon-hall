import type { LocalGame } from "../../offline/vtes";
import { illegalReason, type LegalityTagKind } from "../decks/legalityTagModel";
import type { VersionLegalityOutcome } from "./useVersionLegality";
import { roundLabel } from "./gameFormat";

/** Libellés du bloc « Decks joués » d'un tournoi (Lot 8, 1b-54, d32). */

/** « ronde 2 », « rondes 2 et 3 », « rondes 1, 2 et 3, finale », « finale ». */
export function roundsPlayedLabel(games: readonly LocalGame[]): string {
  const numbers = games
    .filter((game) => game.roundType === "preliminary" && game.roundNumber !== null)
    .map((game) => game.roundNumber as number)
    .sort((a, b) => a - b);
  const parts: string[] = [];
  if (numbers.length === 1) parts.push(`ronde ${numbers[0]}`);
  if (numbers.length > 1) parts.push(`rondes ${numbers.slice(0, -1).join(", ")} et ${numbers.at(-1)}`);
  if (games.some((game) => game.roundType === "final")) parts.push("finale");
  return parts.join(", ");
}

/** « figée à la ronde 2 », « figée à la finale » ; `null` si la partie n'est pas sur cet appareil. */
export function frozenAtLabel(game: LocalGame | undefined): string | null {
  if (!game) return null;
  const label = roundLabel(game);
  return label ? `figée à la ${label}` : null;
}

/** « 24 octobre », avec l'année quand ce n'est pas celle de `now`. */
export function legalityDayLabel(value: string, now: Date = new Date()): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  const year = Number(match[1]);
  const date = new Date(year, Number(match[2]) - 1, Number(match[3]));
  const options: Intl.DateTimeFormatOptions =
    year === now.getFullYear() ? { day: "numeric", month: "long" } : { day: "numeric", month: "long", year: "numeric" };
  return date.toLocaleDateString("fr-FR", options);
}

export interface VersionLegalityTag {
  kind: LegalityTagKind;
  label: string;
  /** Motifs en clair, pour l'infobulle ; `null` sans verdict ou pour une version légale. */
  detail: string | null;
}

/**
 * Pastille de légalité d'une version à la date du tournoi (Lot 8, P11 ; 1b-54,
 * d32) : « Légal le 24 octobre », « Illégal le 24 octobre · 1 carte bannie »,
 * « Légalité hors ligne » (1b-58), sinon un état d'attente ou d'erreur.
 */
export function versionLegalityTag(
  on: string,
  online: boolean,
  outcome: VersionLegalityOutcome | null,
  now: Date = new Date(),
): VersionLegalityTag {
  if (!online) return { kind: "unknown", label: "Légalité hors ligne", detail: null };
  if (outcome === null) return { kind: "unknown", label: "Légalité…", detail: null };
  if (outcome.kind === "error") return { kind: "unknown", label: "Légalité indisponible", detail: null };
  const day = legalityDayLabel(on, now);
  if (outcome.legality.is_legal) return { kind: "legal", label: `Légal le ${day}`, detail: null };
  const reason = illegalReason(outcome.legality);
  return {
    kind: "illegal",
    label: reason ? `Illégal le ${day} · ${reason}` : `Illégal le ${day}`,
    detail: outcome.legality.issues.join(" ") || null,
  };
}
