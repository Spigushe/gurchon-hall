/**
 * Familles d'opérations, par préfixe du type : chaque miroir ne retire de
 * `settled` que la famille qu'il reflète (`refresh.ts`). Écrit sur le texte du
 * type, pas sur l'union générée, pour exister avant l'entrée des opérations du
 * Lot 7 au contrat.
 *
 * Une opération qui écrit dans deux miroirs (`deck_card.upsert` qui acquiert,
 * Lot 4b) reste un cas à part, traité par `refresh.ts`. Une partie ne touche
 * que le miroir des parties : son bilan de tournoi est calculé par le serveur
 * (miroir des tournois) ou recalculé localement à la projection, jamais lu dans
 * une opération tranchée d'une autre famille.
 */

export type OperationFamily = "stock" | "deck" | "player" | "venue" | "tournament" | "game";

const PREFIXES: ReadonlyArray<readonly [string, OperationFamily]> = [
  ["stock.", "stock"],
  ["bundle.", "stock"],
  ["deck_card.", "deck"],
  ["deck.", "deck"],
  ["player.", "player"],
  ["venue.", "venue"],
  ["tournament.", "tournament"],
  ["game.", "game"],
];

/** Famille d'un type d'opération, `null` pour un type inconnu. */
export function operationFamily(type: string): OperationFamily | null {
  return PREFIXES.find(([prefix]) => type.startsWith(prefix))?.[1] ?? null;
}

const inFamily = (family: OperationFamily) => (type: string) => operationFamily(type) === family;

export const isStockOperation = inFamily("stock");
export const isDeckOperation = inFamily("deck");
export const isPlayerOperation = inFamily("player");
export const isVenueOperation = inFamily("venue");
export const isTournamentOperation = inFamily("tournament");
export const isGameOperation = inFamily("game");
