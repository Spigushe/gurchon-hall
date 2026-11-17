import type {
  DeckCardInput,
  DeckCardKey,
  DeckPatch,
  DeckRefreshInput,
  LocalDeck,
  LocalDeckCard,
} from "../../../offline/vtes";
import { cardLabel, plural } from "../../../labels";
import { lowerLine } from "../deckTablesModel";
import type { ImportCard } from "./cardIndex";
import { DEFAULT_IMPORT_LANGUAGE } from "./deckImportPlan";
import type { MatchedCard } from "./matchDecklist";

/**
 * Plan pur d'une mise à jour depuis VDB (Lot 9, P7, A3) : la liste vivante du
 * deck comparée, carte par carte, à celle de VDB. Chaque cas est une fonction
 * d'une table :
 *
 * - **ajoutée** chez VDB : une ligne en proxy, langue choisie, dernière extension ;
 * - **augmentée**, sur une seule ligne : la hausse s'ajoute en proxies sur cette ligne ;
 * - **diminuée**, sur une seule ligne : la ligne baisse comme au `−` du
 *   deckbuilder (`lowerLine`, exemplaires réels rendus d'abord) ;
 * - **refaite** : la quantité change alors que le deck joue la carte sur
 *   plusieurs lignes (conflit) ; ses lignes sont retirées et refaites en une
 *   ligne de proxies, avec un message ;
 * - **retirée** chez VDB : ses lignes sont retirées ;
 * - **inchangée** : rien, quelle que soit la répartition.
 *
 * Nom, notes et archétype ne bougent pas. Le deck repasse en brouillon s'il y a
 * quelque chose à écrire. Le plan se recalcule à « Appliquer », sur la liste du
 * deck à cet instant.
 */

export type CardChangeKind = "added" | "increased" | "decreased" | "remade" | "removed";

export interface CardChange {
  kind: CardChangeKind;
  cardId: number;
  /** « Theo Bell (G2) », le nom seul en bibliothèque. */
  label: string;
  /** Exemplaires dans le deck avant, et après. */
  before: number;
  after: number;
  /** Message d'une carte refaite en proxy (conflit), sinon `null`. */
  message: string | null;
}

export interface DeckRefreshPlan extends DeckRefreshInput {
  deck: DeckPatch;
  removed: DeckCardKey[];
  saved: DeckCardInput[];
  changes: CardChange[];
  /** Cartes que les deux listes ont en même quantité. */
  unchanged: number;
  /** Le deck repasse en brouillon. */
  toDraft: boolean;
  /** Le deck n'autorisait plus les proxies et les autorise de nouveau (des lignes écrites en portent). */
  allowsProxies: boolean;
  /** Rien à mettre à jour : les listes sont identiques. */
  empty: boolean;
}

export interface DeckRefreshChoices {
  /** Statut actuel du deck. */
  status: LocalDeck["status"];
  /**
   * Autorisation de proxy actuelle du deck. Un deck importé l'a, mais elle a pu
   * être retirée depuis (tous les proxies convertis) : si la mise à jour écrit
   * des proxies, le patch la rend, sans quoi le serveur refuserait les lignes.
   */
  proxyAllowed: boolean;
  /** Langue d'une ligne nouvelle ou refaite (EN par défaut, P6). */
  languageCode?: string;
  /**
   * Carte du catalogue par identifiant, pour libeller une carte que VDB a
   * retirée (les autres viennent de la liste de VDB). À défaut, le nom de la
   * ligne de deck.
   */
  cardOf?: (cardId: number) => ImportCard | undefined;
}

/** Ce qu'une carte devient : la carte, ses lignes dans le deck, sa quantité chez VDB (0 si retirée). */
interface CardState {
  cardId: number;
  card: ImportCard | undefined;
  lines: LocalDeckCard[];
  total: number;
  target: number;
}

interface CardWrites {
  removed: DeckCardKey[];
  saved: DeckCardInput[];
  message: string | null;
}

const keyOf = (line: LocalDeckCard): DeckCardKey => ({
  cardId: line.cardId,
  languageCode: line.languageCode,
  cardSetId: line.cardSetId,
});

const NO_WRITES: CardWrites = { removed: [], saved: [], message: null };

/** Une ligne neuve tout en proxy, sous la dernière extension de la carte (P6). */
function proxyLine(state: CardState, languageCode: string): DeckCardInput {
  return {
    cardId: state.cardId,
    languageCode,
    cardSetId: (state.card as ImportCard).latestCardSetId,
    quantity: state.target,
    proxyQuantity: state.target,
  };
}

function remadeMessage(state: CardState, label: string): string {
  const real = state.lines.reduce((sum, line) => sum + line.quantity - line.proxyQuantity, 0);
  const head = `${label} : ${plural(state.lines.length, "ligne remplacée", "lignes remplacées")} par ${plural(state.target, "proxy", "proxies")}`;
  return real > 0 ? `${head}, les exemplaires réels ont été rendus à la collection.` : `${head}.`;
}

type Classifier = [CardChangeKind | "unchanged", (state: CardState) => boolean];

/** Règles essayées dans l'ordre : la première qui répond donne le cas. */
const CLASSIFIERS: readonly Classifier[] = [
  ["unchanged", (state) => state.total === state.target],
  ["added", (state) => state.lines.length === 0],
  ["removed", (state) => state.target === 0],
  ["remade", (state) => state.lines.length > 1],
  ["increased", (state) => state.target > state.total],
  ["decreased", () => true],
];

const WRITERS: Record<CardChangeKind, (state: CardState, languageCode: string, label: string) => CardWrites> = {
  added: (state, languageCode) => ({ ...NO_WRITES, saved: [proxyLine(state, languageCode)] }),
  removed: (state) => ({ ...NO_WRITES, removed: state.lines.map(keyOf) }),
  remade: (state, languageCode, label) => ({
    removed: state.lines.map(keyOf),
    saved: [proxyLine(state, languageCode)],
    message: remadeMessage(state, label),
  }),
  increased: (state) => {
    const [line] = state.lines;
    const added = state.target - line.quantity;
    return { ...NO_WRITES, saved: [{ ...keyOf(line), quantity: state.target, proxyQuantity: line.proxyQuantity + added }] };
  },
  decreased: (state) => {
    const [line] = state.lines;
    const lowered = lowerLine(line, state.target) as { quantity: number; proxyQuantity: number };
    return { ...NO_WRITES, saved: [{ ...keyOf(line), ...lowered }] };
  },
};

const classify = (state: CardState) =>
  (CLASSIFIERS.find(([, applies]) => applies(state)) ?? CLASSIFIERS[CLASSIFIERS.length - 1])[0];

function labelOf(state: CardState): string {
  if (state.card) return cardLabel(state.card);
  return state.lines[0]?.cardName ?? `Carte ${state.cardId}`;
}

function cardStates(
  deckLines: readonly LocalDeckCard[],
  vdbCards: readonly MatchedCard[],
  cardOf: DeckRefreshChoices["cardOf"],
): CardState[] {
  const states = new Map<number, CardState>();
  const stateOf = (cardId: number): CardState => {
    const known = states.get(cardId);
    if (known) return known;
    const created: CardState = { cardId, card: cardOf?.(cardId), lines: [], total: 0, target: 0 };
    states.set(cardId, created);
    return created;
  };
  for (const line of deckLines) {
    const state = stateOf(line.cardId);
    state.lines.push(line);
    state.total += line.quantity;
  }
  for (const { card, quantity } of vdbCards) {
    const state = stateOf(card.id);
    state.card = card;
    state.target += quantity;
  }
  return [...states.values()];
}

/** Ordre d'affichage des changements : ajoutées, augmentées, diminuées, refaites, retirées ; puis par libellé. */
const KIND_ORDER: readonly CardChangeKind[] = ["added", "increased", "decreased", "remade", "removed"];

export function planDeckRefresh(
  deckLines: readonly LocalDeckCard[],
  vdbCards: readonly MatchedCard[],
  choices: DeckRefreshChoices,
): DeckRefreshPlan {
  const languageCode = choices.languageCode ?? DEFAULT_IMPORT_LANGUAGE;
  const removed: DeckCardKey[] = [];
  const saved: DeckCardInput[] = [];
  const changes: CardChange[] = [];
  let unchanged = 0;

  for (const state of cardStates(deckLines, vdbCards, choices.cardOf)) {
    const kind = classify(state);
    if (kind === "unchanged") {
      unchanged++;
      continue;
    }
    const label = labelOf(state);
    const writes = WRITERS[kind](state, languageCode, label);
    removed.push(...writes.removed);
    saved.push(...writes.saved);
    changes.push({ kind, cardId: state.cardId, label, before: state.total, after: state.target, message: writes.message });
  }

  changes.sort(
    (a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0),
  );
  const empty = changes.length === 0;
  const toDraft = !empty && choices.status !== "draft";
  const allowsProxies = !choices.proxyAllowed && saved.some((line) => (line.proxyQuantity ?? 0) > 0);
  const deck: DeckPatch = {
    ...(toDraft ? { status: "draft" as const } : {}),
    ...(allowsProxies ? { proxyAllowed: true } : {}),
  };
  return { deck, removed, saved, changes, unchanged, toDraft, allowsProxies, empty };
}
