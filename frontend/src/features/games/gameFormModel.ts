import {
  certainGameWin,
  DECK_ARCHETYPE_LABELS,
  GAME_WIN_MINIMUM_VP,
  type ClanOption,
  type DeckArchetype,
  type DeckKey,
  type GameRoundType,
  type LocalGame,
  type ParticipationInput,
  type ResourceKey,
} from "../../offline/vtes";
import { formatVp, numberWord } from "./gameFormat";

/**
 * Brouillon de la saisie d'une partie et règles locales qui le concernent
 * (Lot 7, D1). Pur : le client **suggère**, le serveur reste seul juge.
 */

export interface OpponentDraft {
  /** Joueur du carnet ; `null` pour un adversaire non nommé (Lot 8, P6). */
  playerKey: ResourceKey | null;
  name: string;
  /**
   * Clé locale d'une ligne sans joueur, pour que React la suive quand une ligne
   * voisine est retirée (une ligne nommée se suit par son joueur).
   */
  uid?: string;
  seat: number | null;
  /** Un de mes decks prêté à cet adversaire (P4). */
  deckKey: DeckKey | null;
  /** Notes de la ligne, reportées telles quelles à la modification d'une table. */
  notes: string | null;
  /**
   * Deck adverse (Lot 8, P5) : clan principal, archétype, nom. Jamais envoyé
   * avec un deck prêté, dont le deck est déjà connu (le serveur le refuserait).
   */
  opponentDeckName?: string | null;
  opponentDeckArchetype?: DeckArchetype | null;
  opponentClanId?: number | null;
  /** Sous-bloc « Son deck » déplié (état d'écran, jamais envoyé). */
  deckOpen?: boolean;
}

export interface GameDraft {
  /** Valeur d'un `datetime-local` (heure locale). */
  playedAt: string;
  venueKey: ResourceKey | null;
  tournamentKey: ResourceKey | null;
  roundType: GameRoundType;
  roundNumber: number | null;
  playerCount: number;
  deckKey: DeckKey | null;
  seat: number | null;
  /**
   * Mes VP : 0 pour une nouvelle partie, `null` pour une partie corrigée dont ils n'étaient
   * pas saisis (jamais transformé en 0 sans action de l'utilisateur).
   */
  vp: number | null;
  /**
   * Le GW déclaré, `null` s'il n'était pas saisi. Quand le GW devient certain, il passe à
   * `true` et le reste : il ne se décoche pas de lui-même si la table change ensuite.
   */
  gameWin: boolean | null;
  opponents: OpponentDraft[];
  notes: string;
  /** Notes de ma ligne de table, reportées telles quelles. */
  meNotes: string | null;
}

export const MIN_TABLE = 2;
export const MAX_TABLE = 6;

export interface GameWinAdvice {
  /** Le GW est certain : l'interrupteur est coché d'office et ne se décoche pas. */
  locked: boolean;
  /** État affiché de l'interrupteur. */
  checked: boolean;
  /** Aide sous l'interrupteur. */
  help: string;
  /** Erreur vérifiable sur place (`role="alert"`), sinon `null`. */
  error: string | null;
}

/**
 * Aide du Game Win (écran 13). `lockAttempt` : l'utilisateur vient d'essayer de
 * décocher un GW certain, l'aide dit alors que le serveur refuserait.
 */
export function gameWinAdvice(
  playerCount: number,
  vp: number,
  declared: boolean,
  lockAttempt = false,
): GameWinAdvice {
  const certain = certainGameWin(playerCount, vp) === true;
  if (certain) {
    return {
      locked: true,
      checked: true,
      help: lockAttempt
        ? "Victoire certaine : le serveur refusera une partie sans Game Win."
        : `Coché d'office : ${formatVp(vp)} VP à ${playerCount} joueurs, vous êtes seul en tête.`,
      error: null,
    };
  }
  if (vp >= GAME_WIN_MINIMUM_VP) {
    return {
      locked: false,
      checked: declared,
      help: `À vous de le dire : ${formatVp(vp)} VP à ${playerCount} ne suffisent pas à le savoir.`,
      error: null,
    };
  }
  return {
    locked: false,
    checked: declared,
    help: `Possible à partir de ${formatVp(GAME_WIN_MINIMUM_VP)} VP.`,
    error: declared ? `Un Game Win demande au moins ${formatVp(GAME_WIN_MINIMUM_VP)} VP.` : null,
  };
}

/** Le GW qui part : le GW certain s'impose, sinon la déclaration (`null` : rien n'était saisi). */
export function effectiveGameWin(draft: Pick<GameDraft, "playerCount" | "vp" | "gameWin">): boolean | null {
  return certainGameWin(draft.playerCount, draft.vp) === true ? true : draft.gameWin;
}

/**
 * Applique des changements au brouillon et mémorise le GW certain : dès que les VP rendent
 * le GW certain, `gameWin` passe à `true` et y reste (point 8 de la relecture QA).
 */
export function applyDraftChanges(current: GameDraft, changes: Partial<GameDraft>): GameDraft {
  const next = { ...current, ...changes };
  return certainGameWin(next.playerCount, next.vp) === true ? { ...next, gameWin: true } : next;
}

export type FormErrorId = "gw" | "vp" | "table" | "unnamed";

export interface FormError {
  /** Identifiant stable, repris par `data-form-error` pour poser le focus. */
  id: FormErrorId;
  message: string;
}

/** Les erreurs vérifiables sur place de la saisie ; tant qu'il y en a, l'envoi est refusé. */
export function formErrors(draft: GameDraft): FormError[] {
  const errors: FormError[] = [];
  const gw = gameWinAdvice(draft.playerCount, draft.vp ?? 0, draft.gameWin === true);
  if (gw.error) errors.push({ id: "gw", message: gw.error });
  const over = vpOverTable(draft.playerCount, draft.vp ?? 0);
  if (over) errors.push({ id: "vp", message: over });
  const overflow = tableOverflow(draft);
  if (overflow) errors.push({ id: "table", message: overflow });
  if (draft.opponents.some(isEmptyUnnamed)) {
    errors.push({ id: "unnamed", message: "Une ligne sans nom doit porter un siège ou un deck pour être enregistrée." });
  }
  return errors;
}

/** Le deck adverse est-il saisi (au moins un des trois champs) ? */
export function hasOpponentDeck(
  line: Pick<OpponentDraft, "opponentDeckName" | "opponentDeckArchetype" | "opponentClanId">,
): boolean {
  return (
    (line.opponentDeckName ?? "").trim() !== "" || line.opponentDeckArchetype != null || line.opponentClanId != null
  );
}

/**
 * Une ligne sans joueur qui ne dit rien (précision 2 de B1) : ni siège, ni deck
 * prêté, ni deck adverse. Des notes seules ne suffisent pas, le serveur la refuserait.
 */
export function isEmptyUnnamed(line: OpponentDraft): boolean {
  return line.playerKey === null && line.seat === null && line.deckKey === null && !hasOpponentDeck(line);
}


/** Trop d'adversaires pour la table, sinon `null`. */
export function tableOverflow(draft: Pick<GameDraft, "opponents" | "playerCount">): string | null {
  return draft.opponents.length + 1 > draft.playerCount
    ? `La table compte au plus ${draft.playerCount} joueurs : retirez un adversaire.`
    : null;
}

/** Aide sous le choix du deck d'une finale multi-deck, avec le pluriel si plusieurs decks sont admis. */
export function finalDeckNote(rule: "best_performing" | "free_choice" | null, count: number): string {
  if (rule === "best_performing") {
    return count === 1
      ? "Seul deck admis par la règle « meilleur deck » de ce tournoi."
      : "Decks à égalité de meilleure ronde, tous admis par la règle « meilleur deck » de ce tournoi.";
  }
  return "Decks joués en préliminaires.";
}

/** « Au plus 4 VP à quatre joueurs. » quand mes VP dépassent la table, sinon `null`. */
export function vpOverTable(playerCount: number, vp: number): string | null {
  if (vp <= playerCount) return null;
  return `Au plus ${formatVp(playerCount)} VP à ${numberWord(playerCount)} joueurs.`;
}

/** La table du brouillon, ma ligne en tête, telle que `createGame` / `updateGame` l'attendent. */
export function buildParticipations(draft: GameDraft): ParticipationInput[] {
  // Un `null` n'est jamais envoyé : une valeur non saisie le reste (même forme que `participationsOf`).
  const me: ParticipationInput = { player: "me" };
  if (draft.vp !== null) me.victoryPoints = draft.vp;
  const gameWin = effectiveGameWin(draft);
  if (gameWin !== null) me.gameWin = gameWin;
  if (draft.deckKey !== null) me.deck = draft.deckKey;
  if (draft.seat !== null) me.seat = draft.seat;
  if (draft.meNotes !== null) me.notes = draft.meNotes;
  const others = draft.opponents.map((opponent): ParticipationInput => {
    const line: ParticipationInput = { player: opponent.playerKey };
    if (opponent.deckKey !== null) line.deck = opponent.deckKey;
    if (opponent.seat !== null) line.seat = opponent.seat;
    if (opponent.deckKey === null) copyOpponentDeck(opponent, line);
    if (opponent.notes !== null) line.notes = opponent.notes;
    return line;
  });
  return [me, ...others];
}

/** La table connue d'une partie, dans la même forme que `buildParticipations` (comparaison à la modification). */
export function participationsOf(game: LocalGame): ParticipationInput[] | null {
  if (game.table === null) return null;
  const mine = game.table.filter((line) => line.isMe);
  const others = game.table.filter((line) => !line.isMe);
  return [...mine, ...others].map((line): ParticipationInput => {
    const out: ParticipationInput = { player: line.isMe ? "me" : line.playerKey };
    if (line.isMe) {
      if (line.victoryPoints !== null) out.victoryPoints = line.victoryPoints;
      if (line.gameWin !== null) out.gameWin = line.gameWin;
    }
    if (line.deckKey !== null) out.deck = line.deckKey;
    if (line.seat !== null) out.seat = line.seat;
    if (!line.isMe && line.deckKey === null) copyOpponentDeck(line, out);
    if (line.notes !== null) out.notes = line.notes;
    return out;
  });
}

/** Les trois champs du deck adverse (Lot 8, P5), recopiés seulement s'ils sont saisis (même forme des deux côtés). */
function copyOpponentDeck(
  from: Pick<OpponentDraft, "opponentDeckName" | "opponentDeckArchetype" | "opponentClanId">,
  to: ParticipationInput,
): void {
  // Le nom se saisit tel quel et part rogné ; vide, il ne part pas.
  const name = from.opponentDeckName?.trim();
  if (name) to.opponentDeckName = name;
  if (from.opponentDeckArchetype != null) to.opponentDeckArchetype = from.opponentDeckArchetype;
  if (from.opponentClanId != null) to.opponentClanId = from.opponentClanId;
}

/** « [glyphe] Brujah · Rush » replié, ou « Facultatif » quand rien n'est saisi. */
export function opponentDeckSummary(
  line: Pick<OpponentDraft, "opponentDeckName" | "opponentDeckArchetype" | "opponentClanId">,
  clans: readonly ClanOption[],
): { clan: string | null; text: string } {
  const clan = line.opponentClanId == null ? null : (clans.find((item) => item.id === line.opponentClanId)?.name ?? "Clan inconnu");
  const parts = [
    clan,
    line.opponentDeckArchetype ? DECK_ARCHETYPE_LABELS[line.opponentDeckArchetype] : null,
    (line.opponentDeckName ?? "").trim() || null,
  ].filter((part): part is string => part !== null);
  return { clan, text: parts.length === 0 ? "Facultatif" : parts.join(" · ") };
}

/** Les trois derniers clans saisis pour un adversaire, du plus récent au plus ancien (1b-49). */
export function recentClanIds(games: readonly LocalGame[], limit = 3): number[] {
  const recent: number[] = [];
  for (const game of games) {
    for (const line of game.table ?? []) {
      const id = line.opponentClanId;
      if (id != null && !recent.includes(id)) recent.push(id);
      if (recent.length >= limit) return recent;
    }
  }
  return recent;
}
