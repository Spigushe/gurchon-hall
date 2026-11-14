import { cryptGroup, cryptGroupsLegal, minifyName, type CardIndex, type ImportCard } from "./cardIndex";
import type { ParsedIdLine, ParsedLine, ParsedNameLine } from "./parseDecklist";

/**
 * Appariement pur d'une decklist avec le catalogue (Lot 9, P4, A2). Conventions
 * de l'outil reprises de VDB, pas règles VEKN ; table de cas commune :
 * `tests/fixtures/vdb-import-cases.json`.
 */

/** Comment la carte a été trouvée : identifiant, nom, groupe déduit de la crypte, ou version supposée. */
export type MatchBy = "vekn_id" | "name" | "deduced" | "assumed";

export type UnmatchedReason = "unknown_vekn_id" | "unknown_name" | "no_such_version";

export interface ResolvedLine {
  line: number;
  text: string;
  quantity: number;
  card: ImportCard;
  by: MatchBy;
  /** Pour un groupe déduit ou une version supposée : les autres versions du nom (« écrire (G6) pour l'autre »). */
  alternatives: ImportCard[];
}

export interface UnmatchedLine {
  line: number;
  text: string;
  reason: UnmatchedReason;
}

export interface MatchedCard {
  card: ImportCard;
  quantity: number;
}

export interface DecklistMatch {
  /** Une entrée par ligne reconnue, dans l'ordre des lignes. */
  resolved: ResolvedLine[];
  /** Carte × quantité, les lignes d'une même carte additionnées, par identifiant VEKN croissant. */
  cards: MatchedCard[];
  /** Lignes non reconnues, dans l'ordre, avec leur motif. */
  unmatched: UnmatchedLine[];
}

/** Ligne ambiguë : un vampire réimprimé, nom seul, dont plusieurs versions restent (règle 6). */
interface AmbiguousLine {
  line: ParsedNameLine;
  key: string;
  candidates: readonly ImportCard[];
}

type LineOutcome =
  | { kind: "resolved"; card: ImportCard; by: "vekn_id" | "name" }
  | { kind: "ambiguous"; key: string; candidates: readonly ImportCard[] }
  | { kind: "unmatched"; reason: UnmatchedReason };

const unmatched = (reason: UnmatchedReason): LineOutcome => ({ kind: "unmatched", reason });

/** Règle 1 : un identifiant désigne la carte de même `vekn_id`. */
function matchId(line: ParsedIdLine, index: CardIndex): LineOutcome {
  const card = index.byVeknId.get(line.veknId);
  return card ? { kind: "resolved", card, by: "vekn_id" } : unmatched("unknown_vekn_id");
}

/** Une version reste-t-elle après les marques de la ligne (*advanced*, groupe écrit) ? */
const fitsMarks = (line: ParsedNameLine) => (card: ImportCard) =>
  card.advanced === line.advanced && (line.group === null || card.groupCode === line.group);

/** Règles 2 à 5 : nom inconnu, bibliothèque, crypte filtrée par les marques ; plusieurs restantes, ambiguë. */
function matchName(line: ParsedNameLine, index: CardIndex): LineOutcome {
  const key = minifyName(line.name);
  const versions = index.byKey.get(key);
  if (!versions || versions.length === 0) return unmatched("unknown_name");
  const remaining = versions.filter(fitsMarks(line));
  if (remaining.length === 0) return unmatched("no_such_version");
  if (remaining.length === 1) return { kind: "resolved", card: remaining[0], by: "name" };
  return { kind: "ambiguous", key, candidates: remaining };
}

const MATCHERS: { [K in ParsedLine["kind"]]: (line: Extract<ParsedLine, { kind: K }>, index: CardIndex) => LineOutcome } = {
  id: matchId,
  name: matchName,
};

const matchLine = (line: ParsedLine, index: CardIndex): LineOutcome =>
  (MATCHERS[line.kind] as (line: ParsedLine, index: CardIndex) => LineOutcome)(line, index);

/** Au-delà, on ne cherche plus de déduction : toutes les lignes ambiguës sont supposées. */
const MAX_COMBINATIONS = 4096;

/** Toutes les combinaisons d'un choix par nom ambigu (produit cartésien). */
function combinations(choices: readonly (readonly ImportCard[])[]): ImportCard[][] {
  return choices.reduce<ImportCard[][]>(
    (combos, candidates) => combos.flatMap((combo) => candidates.map((card) => [...combo, card])),
    [[]],
  );
}

const groupsOf = (cards: readonly ImportCard[]): number[] =>
  cards.map((card) => cryptGroup(card.groupCode)).filter((group): group is number => group !== null);

export interface ReprintChoice {
  card: ImportCard;
  by: "deduced" | "assumed";
}

/**
 * Règle 6 : la version d'un vampire réimprimé écrit sans groupe. On énumère les
 * choix, un par nom (les lignes d'un même nom partagent le leur), qui rendent la
 * crypte légale avec les vampires déjà déterminés (`known`) ; si toutes ces
 * combinaisons donnent la même version à un nom, elle est **déduite** ; sinon
 * (aucune combinaison légale, ou plusieurs qui se contredisent), la version
 * d'origine, au plus petit identifiant VEKN, est **supposée**, comme chez VDB.
 * La décision se prend nom par nom.
 */
export function resolveReprintedVampires(
  known: readonly ImportCard[],
  ambiguous: ReadonlyMap<string, readonly ImportCard[]>,
): Map<string, ReprintChoice> {
  const keys = [...ambiguous.keys()];
  const candidates = keys.map((key) => ambiguous.get(key) ?? []);
  const size = candidates.reduce((product, list) => product * list.length, 1);
  const knownGroups = groupsOf(known);
  const legal =
    size > MAX_COMBINATIONS
      ? []
      : combinations(candidates).filter((combo) => cryptGroupsLegal([...knownGroups, ...groupsOf(combo)]));

  const choices = new Map<string, ReprintChoice>();
  keys.forEach((key, position) => {
    const picked = new Set(legal.map((combo) => combo[position].veknId));
    const deduced = picked.size === 1 ? legal[0][position] : null;
    choices.set(key, deduced ? { card: deduced, by: "deduced" } : { card: candidates[position][0], by: "assumed" });
  });
  return choices;
}

function sumCards(resolved: readonly ResolvedLine[]): MatchedCard[] {
  const byVekn = new Map<number, MatchedCard>();
  for (const { card, quantity } of resolved) {
    const current = byVekn.get(card.veknId);
    byVekn.set(card.veknId, { card, quantity: (current?.quantity ?? 0) + quantity });
  }
  return [...byVekn.values()].sort((a, b) => a.card.veknId - b.card.veknId);
}

/**
 * Apparie des lignes lues avec le catalogue (`buildCardIndex(cards)`). Seules les
 * lignes de crypte déterminées entrent dans la déduction : les lignes non
 * reconnues et la bibliothèque n'y jouent pas.
 */
export function matchDecklist(lines: readonly ParsedLine[], index: CardIndex): DecklistMatch {
  const slots: Array<ResolvedLine | AmbiguousLine | null> = [];
  const missing: UnmatchedLine[] = [];
  const ambiguous = new Map<string, readonly ImportCard[]>();
  const known: ImportCard[] = [];

  for (const line of lines) {
    const outcome = matchLine(line, index);
    if (outcome.kind === "unmatched") {
      missing.push({ line: line.line, text: line.text, reason: outcome.reason });
      slots.push(null);
    } else if (outcome.kind === "ambiguous") {
      ambiguous.set(outcome.key, outcome.candidates);
      slots.push({ line: line as ParsedNameLine, key: outcome.key, candidates: outcome.candidates });
    } else {
      if (outcome.card.category === "crypt") known.push(outcome.card);
      slots.push({ ...base(line), card: outcome.card, by: outcome.by, alternatives: [] });
    }
  }

  const choices = resolveReprintedVampires(known, ambiguous);
  const resolved = slots
    .filter((slot): slot is ResolvedLine | AmbiguousLine => slot !== null)
    .map((slot) => ("key" in slot ? fromChoice(slot, choices) : slot));
  return { resolved, cards: sumCards(resolved), unmatched: missing };
}

const base = (line: ParsedLine) => ({ line: line.line, text: line.text, quantity: line.quantity });

function fromChoice(slot: AmbiguousLine, choices: ReadonlyMap<string, ReprintChoice>): ResolvedLine {
  const choice = choices.get(slot.key) as ReprintChoice;
  return {
    ...base(slot.line),
    card: choice.card,
    by: choice.by,
    alternatives: slot.candidates.filter((card) => card.veknId !== choice.card.veknId),
  };
}
