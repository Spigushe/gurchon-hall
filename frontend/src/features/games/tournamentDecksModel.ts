import type { LocalGame } from "../../offline/vtes";
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
