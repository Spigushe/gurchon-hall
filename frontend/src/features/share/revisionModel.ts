import { plural } from "../../labels";

/**
 * Écarts d'une révision de liste partagée (Lot 13, P8, A10), fonctions pures.
 *
 * La forme est celle de la revue de VDB : `identifiant=écart` séparés par `;`,
 * triés par identifiant, où l'écart est **signé et relatif** à la liste d'origine
 * (`100845=1;102366=-1;201436=-1`). Un écart nul n'est pas écrit, et le retrait
 * total d'une carte vaut l'opposé de sa quantité d'origine.
 *
 * Décision de lecture (doublon) : un identifiant répété voit ses écarts
 * **sommés**, pas signalés ; la somme nulle disparaît comme un écart nul.
 * Rien ici ne devine : une partie illisible est comptée et ignorée.
 */

export interface RevisionDelta {
  cardId: number;
  delta: number;
}

export interface ParsedRevision {
  deltas: RevisionDelta[];
  /** Parties de l'adresse ignorées faute d'être lisibles (tronquées, non numériques, hors bornes). */
  unreadable: number;
}

const MAX_CARD_ID = 2147483647;
/** Un écart plus grand ne correspond à aucune liste réelle : adresse abîmée. */
const MAX_DELTA = 999;

const PART_PATTERN = /^(\d{1,10})=([+-]?\d{1,4})$/;

/** `null` si la partie n'est pas un écart lisible. */
function parsePart(part: string): RevisionDelta | null {
  const match = PART_PATTERN.exec(part);
  if (!match) return null;
  const cardId = Number(match[1]);
  const delta = Number(match[2]);
  if (cardId < 1 || cardId > MAX_CARD_ID || Math.abs(delta) > MAX_DELTA) return null;
  return { cardId, delta };
}

/** Somme les écarts d'un même identifiant, retire les nuls, trie par identifiant. */
export function normalizeDeltas(deltas: readonly RevisionDelta[]): RevisionDelta[] {
  const sums = new Map<number, number>();
  for (const { cardId, delta } of deltas) sums.set(cardId, (sums.get(cardId) ?? 0) + delta);
  return [...sums]
    .filter(([, delta]) => delta !== 0)
    .sort(([a], [b]) => a - b)
    .map(([cardId, delta]) => ({ cardId, delta }));
}

function decoded(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/** Lit la valeur brute du paramètre `revision` ; `null` ou vide : aucune modification. */
export function parseRevision(raw: string | null): ParsedRevision {
  if (!raw) return { deltas: [], unreadable: 0 };
  const parts = decoded(raw)
    .split(";")
    .filter((part) => part !== "");
  const read = parts.map(parsePart);
  return {
    deltas: normalizeDeltas(read.filter((delta): delta is RevisionDelta => delta !== null)),
    unreadable: read.filter((delta) => delta === null).length,
  };
}

/** Écrit les écarts pour l'adresse ; `null` quand il n'y en a plus. */
export function encodeRevision(deltas: readonly RevisionDelta[]): string | null {
  const kept = normalizeDeltas(deltas);
  return kept.length === 0 ? null : kept.map(({ cardId, delta }) => `${cardId}=${delta}`).join(";");
}

/** `quantity` 0 : carte retirée. `originalQuantity` 0 : carte ajoutée. */
export interface RevisedLine {
  cardId: number;
  quantity: number;
  originalQuantity: number;
}

export interface AppliedRevision {
  /** Une ligne par carte d'origine ou ajoutée, par identifiant croissant. */
  lines: RevisedLine[];
  /** Écarts qui auraient fait passer une quantité sous zéro, ramenés à zéro. */
  clamped: number;
}

export function applyRevision(
  original: readonly { cardId: number; quantity: number }[],
  deltas: readonly RevisionDelta[],
): AppliedRevision {
  const originals = new Map(original.map(({ cardId, quantity }) => [cardId, quantity] as const));
  const changes = new Map(normalizeDeltas(deltas).map(({ cardId, delta }) => [cardId, delta] as const));
  let clamped = 0;
  const lines: RevisedLine[] = [];
  const ids = [...new Set([...originals.keys(), ...changes.keys()])].sort((a, b) => a - b);
  for (const cardId of ids) {
    const originalQuantity = originals.get(cardId) ?? 0;
    const wanted = originalQuantity + (changes.get(cardId) ?? 0);
    if (wanted < 0) clamped += 1;
    const quantity = Math.max(0, wanted);
    if (originalQuantity > 0 || quantity > 0) lines.push({ cardId, quantity, originalQuantity });
  }
  return { lines, clamped };
}

/**
 * Remplace la quantité voulue d'une carte : l'écart devient `quantity -
 * originalQuantity`, sans toucher aux autres. C'est ce que font `+` et `−`.
 */
export function withQuantity(
  deltas: readonly RevisionDelta[],
  cardId: number,
  originalQuantity: number,
  quantity: number,
): RevisionDelta[] {
  const others = deltas.filter((entry) => entry.cardId !== cardId);
  return normalizeDeltas([...others, { cardId, delta: Math.max(0, quantity) - originalQuantity }]);
}

/** Sépare les écarts dont la carte est connue de ceux dont elle ne l'est pas. */
export function splitKnown(
  deltas: readonly RevisionDelta[],
  known: ReadonlySet<number>,
): { kept: RevisionDelta[]; unknown: number } {
  const kept = deltas.filter(({ cardId }) => known.has(cardId));
  return { kept, unknown: deltas.length - kept.length };
}

/** « +1 », « −2 » (vrai signe moins) pour l'affichage d'un écart. */
export const formatDelta = (delta: number): string => (delta > 0 ? `+${delta}` : `−${Math.abs(delta)}`);

/** Classe d'une ligne qui s'écarte de la liste de départ (liseré à gauche), pour la révision comme pour la comparaison. */
export function revisionRowClass(quantity: number, originalQuantity: number): string | undefined {
  if (quantity === originalQuantity) return undefined;
  if (quantity === 0) return "revision-row--changed revision-row--removed";
  return originalQuantity === 0 ? "revision-row--added" : "revision-row--changed";
}

export interface RevisionNoticeCounts {
  unreadable: number;
  unknown: number;
  clamped: number;
  /** Les cartes ajoutées n'ont pas pu être lues (réseau, 429, 5xx). */
  lookupFailed: boolean;
}

/** Une phrase par sorte d'écart écarté : jamais deviné, toujours dit. */
export function noticeMessages({ unreadable, unknown, clamped, lookupFailed }: RevisionNoticeCounts): string[] {
  const messages: string[] = [];
  if (unreadable > 0) messages.push(`${plural(unreadable, "modification illisible ignorée", "modifications illisibles ignorées")}`);
  if (unknown > 0) {
    messages.push(
      lookupFailed
        ? `${plural(unknown, "carte ajoutée n'a pas pu être lue (réseau) et est ignorée", "cartes ajoutées n'ont pas pu être lues (réseau) et sont ignorées")}`
        : `${plural(unknown, "carte inconnue ignorée", "cartes inconnues ignorées")}`,
    );
  }
  if (clamped > 0) messages.push(`${plural(clamped, "retrait supérieur à la quantité ramené à zéro", "retraits supérieurs à la quantité ramenés à zéro")}`);
  return messages;
}
