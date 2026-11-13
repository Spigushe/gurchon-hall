import type { DeckArchetype, DeckKey } from "../../offline/vtes";
import type { SeatPosition } from "./analysisModel";
import {
  PERIOD_LABELS,
  ROUND_TYPE_LABELS,
  type BilanFilters,
  type GameFact,
  type Group,
  type PositionGrouping,
} from "./bilanModel";

/**
 * Ce que les composants du bilan partagent sans être des composants
 * (décorations des lignes, état de l'axe Position, libellés) : un fichier à
 * part, pour que le rafraîchissement à chaud de Vite reste possible.
 */

/** Ce qu'une ligne montre devant et sous son nom, selon l'axe. */
export interface GroupDecoration {
  clan?: string | null;
  archetype?: DeckArchetype | null;
  sub?: string | null;
}

export type Decorate = (group: Group) => GroupDecoration;

export const noDecoration: Decorate = () => ({});

/** État des sélecteurs de l'axe Position, commun au mobile et au bureau. */
export interface PositionState {
  near: Extract<SeatPosition, "prey" | "predator">;
  far: Extract<SeatPosition, "grandPrey" | "grandPredator">;
  grouping: PositionGrouping;
  farOpen: boolean;
}

export const DEFAULT_POSITION_STATE: PositionState = {
  near: "prey",
  far: "grandPrey",
  grouping: "archetype",
  farOpen: false,
};

/** Décoration d'une ligne de l'axe Position : le glyphe du clan quand on regroupe par clan. */
export function positionDecoration(grouping: PositionGrouping): Decorate {
  return (group) => (grouping === "clan" && !group.unknown ? { clan: group.label } : {});
}

/** « 12 derniers mois · Tous types · Tous les decks » (1b-46). */
export function filtersSummary(filters: BilanFilters, deckName: (key: DeckKey) => string): string {
  const types =
    filters.roundTypes.length === 0
      ? "Tous types"
      : filters.roundTypes.map((type) => ROUND_TYPE_LABELS[type]).join(", ");
  const deck = filters.deckKey === null ? "Tous les decks" : deckName(filters.deckKey);
  return [PERIOD_LABELS[filters.period], types, deck].join(" · ");
}

/** « Amicale », « Open de Lyon · ronde 2 », « Open de Lyon · finale ». */
export function gameContext(fact: GameFact): string {
  if (fact.roundType === "casual") return "Amicale";
  const round = fact.roundType === "final" ? "finale" : `ronde ${fact.roundNumber ?? "?"}`;
  return `${fact.tournamentName ?? "Tournoi"} · ${round}`;
}

