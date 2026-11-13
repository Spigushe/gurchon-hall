import {
  findByKey,
  type DeckKey,
  type DeckVersionRow,
  type LocalGame,
  type LocalTournament,
} from "../../offline/vtes";
import { roundLabel } from "./gameFormat";

/**
 * « Figer sur la liste actuelle » (Lot 8, P3 ; écrans 1b-51 et d29). Fonctions
 * pures : le serveur seul fige une liste, le client **annonce** ce que le regel
 * va faire, et le serveur reste juge.
 *
 * Deux listes se comparent sur la carte × la quantité totale, sans langue,
 * extension ni proxy (P2), comme le gel du serveur (`freeze_decklist`) : une
 * impression changée ou un proxy converti ne coupe pas de version.
 */

/** Une liste réduite à carte × quantité totale. */
export type Decklist = ReadonlyMap<number, number>;

/** Agrège des lignes (de deck, ou d'une version) par carte, quantités additionnées. */
export function decklistOf(lines: ReadonlyArray<{ cardId: number; quantity: number }>): Decklist {
  const list = new Map<number, number>();
  for (const line of lines) {
    if (line.quantity > 0) list.set(line.cardId, (list.get(line.cardId) ?? 0) + line.quantity);
  }
  return list;
}

/** Même liste : mêmes cartes, mêmes quantités. */
export function sameDecklist(a: Decklist, b: Decklist): boolean {
  if (a.size !== b.size) return false;
  for (const [cardId, quantity] of a) {
    if (b.get(cardId) !== quantity) return false;
  }
  return true;
}

/**
 * Ce que le regel fera d'un deck, annoncé avant l'envoi :
 * - `same` : la version jouée est la dernière et la liste actuelle est la
 *   sienne, rien ne change ;
 * - `reuse` : la liste actuelle est celle d'une version plus récente, la
 *   dernière, que la partie reprendra ;
 * - `new` : elle diffère de la dernière version, une version est créée, même si
 *   elle égale une version plus ancienne (le serveur ne réutilise que la
 *   dernière). Table de cas commune avec le serveur :
 *   `backend/tests/fixtures/decklist_freeze_cases.json` ;
 * - `unknown` : rien à comparer sur cet appareil (version jamais lue, deck
 *   supprimé ou absent du miroir), le serveur tranchera.
 */
export type FreezeOutcome =
  | { kind: "same"; number: number }
  | { kind: "reuse"; number: number }
  | { kind: "new"; number: number }
  | { kind: "unknown" };

/**
 * `current` : les lignes actuelles du deck, `null` s'il n'est pas au miroir ;
 * `played` : la version jouée, `null` si elle n'est pas lue ; `versions` : les
 * versions connues du deck.
 */
export function freezeOutcome(
  current: ReadonlyArray<{ cardId: number; quantity: number }> | null,
  played: Pick<DeckVersionRow, "number" | "cards"> | null,
  versions: ReadonlyArray<Pick<DeckVersionRow, "number" | "cards">>,
): FreezeOutcome {
  if (current === null || played === null) return { kind: "unknown" };
  // Le serveur ne compare qu'à la dernière version (`freeze_decklist`) : une liste
  // revenue à la version jouée, quand une plus récente existe, en crée une nouvelle.
  const latest = versions.reduce<Pick<DeckVersionRow, "number" | "cards">>(
    (best, version) => (version.number > best.number ? version : best),
    played,
  );
  if (!sameDecklist(decklistOf(current), decklistOf(latest.cards))) {
    return { kind: "new", number: latest.number + 1 };
  }
  return latest.number === played.number
    ? { kind: "same", number: played.number }
    : { kind: "reuse", number: latest.number };
}

/**
 * La phrase de la citation (1b-51, d29) pour un deck joué en `vN`. `plural` :
 * plusieurs parties seront rattachées (tournoi).
 */
export function freezeSentence(outcome: FreezeOutcome, playedNumber: number, plural: boolean): string {
  if (outcome.kind === "same") {
    return `La liste actuelle est celle de la v${playedNumber} : ${plural ? "les parties ne changent" : "la partie ne change"} pas.`;
  }
  if (outcome.kind === "reuse") {
    return `La liste actuelle est celle de la v${outcome.number} : ${plural ? "les parties passeront" : "la partie passera"} de la v${playedNumber} à la v${outcome.number}.`;
  }
  if (outcome.kind === "new") {
    return `La liste actuelle diffère de la v${playedNumber} : elle deviendra la v${outcome.number}.`;
  }
  return `La v${playedNumber} n'a pas été lue sur cet appareil : le serveur dira si la liste a changé.`;
}

/** Les decks joués à la table d'une partie (ma ligne, puis les decks prêtés), sans doublon. */
export function decksOfGame(game: Pick<LocalGame, "me" | "table">): DeckKey[] {
  const keys = game.table === null ? [game.me.deckKey] : game.table.map((line) => line.deckKey);
  return [...new Set(keys.filter((key): key is DeckKey => key !== null))];
}

/** Version jouée d'un deck : identifiant et numéro, nuls ensemble tant que la liste n'est pas figée. */
export interface PlayedDeckVersion {
  id: number | null;
  number: number | null;
}

/** Version jouée de chaque deck de la table, ma ligne d'abord (la première ligne qui le joue et porte une version). */
export function playedVersionsOf(game: Pick<LocalGame, "me" | "table">): Map<DeckKey, PlayedDeckVersion> {
  const versions = new Map<DeckKey, PlayedDeckVersion>();
  const mine = { deckKey: game.me.deckKey, deckVersionId: game.me.deckVersionId, deckVersionNumber: game.me.deckVersionNumber };
  for (const line of [mine, ...(game.table ?? [])]) {
    if (line.deckKey === null) continue;
    if (versions.get(line.deckKey)?.id == null) {
      versions.set(line.deckKey, { id: line.deckVersionId, number: line.deckVersionNumber });
    }
  }
  return versions;
}

/**
 * La note sous « Mon deck » (1b-50, d28) : « liste du tournoi, figée à cette
 * ronde », « … figée à la ronde 2 », « liste figée à la synchronisation » pour
 * une partie en file, « liste non figée » pour une partie d'avant le gel ;
 * `null` en amicale figée ou sans deck.
 */
export function versionNote(
  game: LocalGame,
  tournaments: readonly LocalTournament[],
  games: readonly LocalGame[],
): { text: string; pending: boolean } | null {
  const deckKey = game.me.deckKey;
  if (deckKey === null) return null;
  if (game.me.deckVersionId === null) {
    return game.pending
      ? { text: "liste figée à la synchronisation", pending: true }
      : { text: "liste non figée", pending: false };
  }
  const tournament = game.tournamentKey ? findByKey(tournaments, game.tournamentKey) : undefined;
  if (!tournament) return null;
  const frozen = tournament.deckVersions.find((item) => item.deckKey === deckKey);
  if (!frozen) return { text: "liste du tournoi", pending: false };
  if (game.key === frozen.frozenByGameKey || game.aliases.includes(frozen.frozenByGameKey)) {
    return { text: `liste du tournoi, figée à cette ${game.roundType === "final" ? "finale" : "ronde"}`, pending: false };
  }
  const by = findByKey(games, frozen.frozenByGameKey);
  const round = by ? roundLabel(by) : null;
  return { text: round ? `liste du tournoi, figée à la ${round}` : "liste du tournoi", pending: false };
}

/**
 * « ronde 2 », « rondes 2 et 3 », « rondes 1, 2 et 3, finale », « finale » :
 * les rondes de parties de tournoi, préliminaires par numéro puis la finale.
 */
export function roundsPhrase(games: ReadonlyArray<Pick<LocalGame, "roundType" | "roundNumber">>): string {
  const numbers = [
    ...new Set(
      games.filter((game) => game.roundType === "preliminary" && game.roundNumber !== null).map((game) => game.roundNumber as number),
    ),
  ].sort((a, b) => a - b);
  const parts: string[] = [];
  if (numbers.length === 1) parts.push(`ronde ${numbers[0]}`);
  if (numbers.length > 1) parts.push(`rondes ${numbers.slice(0, -1).join(", ")} et ${numbers[numbers.length - 1]}`);
  if (games.some((game) => game.roundType === "final")) parts.push("finale");
  return parts.join(", ");
}

/** Les parties que le regel touche, et les autres parties du même tournoi. */
export interface FreezeScope {
  /** Parties rattachées à la liste actuelle (la partie seule en amicale). */
  affected: LocalGame[];
  /** Parties du tournoi qui ne jouent aucun des decks regelés (vide en amicale). */
  untouched: LocalGame[];
}

/**
 * Portée du regel (P3, précision 6 de B1) : en amicale, la partie seule ; en
 * tournoi, toutes les parties du tournoi qui jouent un des decks de la table,
 * la partie comprise.
 */
export function freezeScope(
  game: LocalGame,
  games: readonly LocalGame[],
  tournaments: readonly LocalTournament[],
): FreezeScope {
  const tournament = game.tournamentKey ? findByKey(tournaments, game.tournamentKey) : undefined;
  if (!tournament) return { affected: [game], untouched: [] };
  const decks = new Set(decksOfGame(game));
  const inTournament = games.filter(
    (candidate) =>
      candidate.key !== game.key &&
      candidate.tournamentKey !== null &&
      findByKey(tournaments, candidate.tournamentKey)?.key === tournament.key,
  );
  const plays = (candidate: LocalGame) => decksOfGame(candidate).some((key) => decks.has(key));
  return {
    affected: [game, ...inTournament.filter(plays)],
    untouched: inTournament.filter((candidate) => !plays(candidate)),
  };
}

/** « Banu Princes », « Banu Princes et Toreador Mass Vote », « A, B et C ». */
export function namesPhrase(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} et ${names[names.length - 1]}`;
}

/** Le texte principal de la confirmation (1b-51 en tournoi, d29 en amicale). */
export function freezeBody(
  game: Pick<LocalGame, "tournamentName">,
  scope: FreezeScope,
  deckNames: readonly string[],
): string {
  const decks = namesPhrase(deckNames);
  const their = deckNames.length > 1 ? "leur" : "sa";
  if (game.tournamentName === null) {
    const modified = deckNames.length > 1 ? "les decks" : "le deck";
    return `La partie sera rattachée à la liste actuelle de ${decks}. Utile si vous avez saisi la partie après avoir modifié ${modified}.`;
  }
  const count = scope.affected.length;
  const rounds = roundsPhrase(scope.affected);
  const where = `du tournoi « ${game.tournamentName} »`;
  const which = rounds ? ` (${rounds})` : "";
  return count === 1
    ? `La partie ${where} jouée avec ${decks}${which} sera rattachée à ${their} liste actuelle.`
    : `Les ${count} parties ${where} jouées avec ${decks}${which} seront rattachées à ${their} liste actuelle.`;
}

/**
 * Les parties du tournoi que le regel ne touche pas (1b-51) : « La ronde 1,
 * jouée avec Toreador Mass Vote, ne change pas. » ; `null` s'il n'y en a pas.
 */
export function untouchedSentence(scope: FreezeScope, deckNameOf: (key: DeckKey | null) => string | null): string | null {
  const { untouched } = scope;
  if (untouched.length === 0) return null;
  if (untouched.length > 1) {
    return `Les ${untouched.length} autres parties du tournoi, jouées avec d'autres decks, ne changent pas.`;
  }
  const other = untouched[0];
  const round = roundLabel(other) ?? "partie";
  const deck = deckNameOf(other.me.deckKey);
  return `La ${round}, jouée ${deck ? `avec ${deck}` : "sans deck"}, ne change pas.`;
}
