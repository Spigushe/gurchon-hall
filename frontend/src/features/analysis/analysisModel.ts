/**
 * Modèle d'analyse du Lot 8 (A7), en fonctions pures. D1 n'en pose que les
 * positions à la table, dont la saisie et le détail d'une partie ont besoin ;
 * D2 y ajoute les agrégats du bilan.
 *
 * Convention de siège (P7) : le jeu tourne dans l'ordre des sièges. La proie du
 * siège *n* est le siège *n* + 1 (le siège 1 pour le dernier), son prédateur le
 * siège *n* − 1 (le dernier pour le siège 1). Ce sont les positions **de
 * départ** : les évictions ne sont pas saisies. Grande proie et grand prédateur
 * (P8) sont les sièges *n* + 2 et *n* − 2, à partir de quatre joueurs
 * seulement : à trois, *n* + 2 est mon prédateur.
 */

export type SeatPosition = "prey" | "predator" | "grandPrey" | "grandPredator";

/** Ordre d'affichage : proie et prédateur d'abord, les positions éloignées ensuite (P8). */
export const SEAT_POSITIONS: readonly SeatPosition[] = ["prey", "predator", "grandPrey", "grandPredator"];

export const SEAT_POSITION_LABELS: Readonly<Record<SeatPosition, string>> = {
  prey: "proie",
  predator: "prédateur",
  grandPrey: "grande proie",
  grandPredator: "grand prédateur",
};

/** Le siège à chaque position, `null` quand la position n'existe pas à cette table. */
export type SeatPositions = Readonly<Record<SeatPosition, number | null>>;

const NONE: SeatPositions = { prey: null, predator: null, grandPrey: null, grandPredator: null };

/** Siège à `offset` places du mien, en tournant (1 à `playerCount`). */
function seatAt(seat: number, offset: number, playerCount: number): number {
  return ((((seat - 1 + offset) % playerCount) + playerCount) % playerCount) + 1;
}

/**
 * Les sièges de ma proie, de mon prédateur, de ma grande proie et de mon grand
 * prédateur. Sans siège, ou avec un siège hors de la table, aucune position.
 * À deux, proie et prédateur sont le même siège ; à quatre, grande proie et
 * grand prédateur sont le siège d'en face ; à six, le siège d'en face n'a
 * aucune position.
 */
export function seatPositions(seat: number | null, playerCount: number): SeatPositions {
  if (seat === null || playerCount < 2 || seat < 1 || seat > playerCount) return NONE;
  const far = playerCount >= 4;
  return {
    prey: seatAt(seat, 1, playerCount),
    predator: seatAt(seat, -1, playerCount),
    grandPrey: far ? seatAt(seat, 2, playerCount) : null,
    grandPredator: far ? seatAt(seat, -2, playerCount) : null,
  };
}

/** Les positions qu'occupe `otherSeat` par rapport à mon siège, dans l'ordre d'affichage. */
export function positionsOfSeat(mySeat: number | null, playerCount: number, otherSeat: number | null): SeatPosition[] {
  if (otherSeat === null || otherSeat === mySeat) return [];
  const positions = seatPositions(mySeat, playerCount);
  return SEAT_POSITIONS.filter((position) => positions[position] === otherSeat);
}

/** « proie », « grande proie et grand prédateur » ; `null` sans position. */
export function positionLabel(positions: readonly SeatPosition[]): string | null {
  if (positions.length === 0) return null;
  return positions.map((position) => SEAT_POSITION_LABELS[position]).join(" et ");
}

/** Une position proche (proie, prédateur) se montre plus fort qu'une position éloignée (P8). */
export function isNearPosition(positions: readonly SeatPosition[]): boolean {
  return positions.includes("prey") || positions.includes("predator");
}

/**
 * Aide de la saisie (1b-48) : « Votre proie : siège 3 · Votre prédateur : siège 1 »,
 * dès que mon siège est connu ; `null` sinon.
 */
export function preyPredatorHint(seat: number | null, playerCount: number): string | null {
  const { prey, predator } = seatPositions(seat, playerCount);
  if (prey === null || predator === null) return null;
  if (prey === predator) return `Votre proie et votre prédateur : siège ${prey}`;
  return `Votre proie : siège ${prey} · Votre prédateur : siège ${predator}`;
}
