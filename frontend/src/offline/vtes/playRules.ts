/**
 * Règles de la pratique de jeu portées côté client (Lot 7, A4 et A14).
 *
 * Fonctions pures, sans dépendance au contrat. Le client **suggère**, il ne
 * refuse rien : le serveur reste seul juge (`backend/app/services/vtes_rules.py`,
 * dont chaque fonction ci-dessous reprend la lecture).
 */

/** Seuil du Game Win (VEKN 3.7.1), à toute table : au moins 2 VP. */
export const GAME_WIN_MINIMUM_VP = 2;

/** Tous les VP sont des multiples de 0,5 (VEKN 3.7.2), comme `VP_STEP` côté serveur. */
export const VP_STEP = 0.5;

/**
 * `true` quand mon Game Win est certain, `null` quand rien ne le dit (jamais
 * `false` : moins de 2 VP interdit le GW, mais le serveur le dit, ce n'est pas
 * une déduction). Avec plus de la moitié des VP que la table peut encore
 * distribuer on est seul en tête ; avec au moins `minimum` VP en plus, on a le
 * GW (2 VP à deux et à trois, 2,5 VP à quatre et à cinq, 3,5 VP à six).
 *
 * Règle **déduite** du barème VEKN 3.7.2, qui ne l'écrit pas (correction du
 * 2026-11-02) : une table de n joueurs distribue au plus n VP, et une demi-VP
 * (fin au temps à deux survivants au moins, ou retrait) ôte au moins 0,5 VP à
 * ce total. Des VP non entières bornent donc le total à n − 0,5. Détail dans
 * la docstring de `certain_game_win`, dont cette fonction est le miroir,
 * vérifié sur la même table de cas
 * (`backend/tests/fixtures/certain_game_win_cases.json`).
 */
export function certainGameWin(
  playerCount: number,
  vp: number | null | undefined,
  minimum: number = GAME_WIN_MINIMUM_VP,
): true | null {
  if (vp === null || vp === undefined || vp < minimum) return null;
  const tableTotal = vp % 1 === VP_STEP ? playerCount - VP_STEP : playerCount;
  return vp > tableTotal - vp ? true : null;
}

/** Ma participation à une ronde, réduite à ce que le bilan regarde (`RoundResult`). */
export interface RoundResult {
  deckId: number | null;
  victoryPoints: number | null;
  gameWin: boolean | null;
}

/**
 * Mon bilan d'un tournoi (`TournamentTally`, A12) : GW et VP des préliminaires,
 * rondes jouées, puis la finale. `final*` sont nuls sans finale.
 */
export interface TournamentTally {
  preliminaryGameWins: number;
  preliminaryVictoryPoints: number;
  roundsPlayed: number;
  finalVictoryPoints: number | null;
  finalGameWin: boolean | null;
}

/**
 * Bilan **provisoire** d'un tournoi (A14), pour une saisie pas encore
 * synchronisée : même calcul que `tournament_summary` du serveur, qui reste
 * l'autorité (son bilan remplace celui-ci au rafraîchissement). Des VP non
 * saisis comptent pour 0.
 */
export function tournamentSummary(
  preliminaries: Iterable<RoundResult>,
  final: RoundResult | null,
): TournamentTally {
  const rounds = [...preliminaries];
  return {
    preliminaryGameWins: rounds.filter((round) => round.gameWin === true).length,
    preliminaryVictoryPoints: rounds.reduce((sum, round) => sum + (round.victoryPoints ?? 0), 0),
    roundsPlayed: rounds.length,
    finalVictoryPoints: final === null ? null : (final.victoryPoints ?? 0),
    finalGameWin: final === null ? null : final.gameWin === true,
  };
}

/**
 * Ronde préliminaire à proposer : `max(round_number) + 1`, et non le nombre de
 * rondes jouées (une ronde sautée ou supprimée laisserait un trou, et on
 * proposerait un numéro déjà pris). 1 quand rien n'est saisi.
 */
export function nextRoundNumber(roundNumbers: Iterable<number | null | undefined>): number {
  let highest = 0;
  for (const round of roundNumbers) {
    if (typeof round === "number" && round > highest) highest = round;
  }
  return highest + 1;
}
