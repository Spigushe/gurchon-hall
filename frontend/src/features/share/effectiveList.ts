import { applyRevision, parseRevision } from "./revisionModel";
import type { SharedDecklist } from "./usePublicDecklist";

/**
 * La liste que « Dupliquer » et « Comparer » traitent (Lot 13, D5, A10) : celle
 * du lien, retouchée par ses écarts quand l'adresse porte une `revision`. Une
 * révision se duplique et se compare comme une liste. Fonction pure ; le calcul
 * des écarts vit dans `revisionModel.ts`.
 */
export interface EffectiveCard {
  cardId: number;
  quantity: number;
}

export interface EffectiveList {
  /** Cartes de quantité positive, par identifiant croissant. */
  cards: EffectiveCard[];
  /** Écarts illisibles de l'adresse, ignorés. */
  unreadable: number;
}

export function effectiveList(list: Pick<SharedDecklist, "cards">, revision: string | null): EffectiveList {
  const original = list.cards.map(({ card, quantity }) => ({ cardId: card.id, quantity }));
  if (revision === null) return { cards: original, unreadable: 0 };
  const parsed = parseRevision(revision);
  const applied = applyRevision(original, parsed.deltas);
  const cards = applied.lines
    .filter((line) => line.quantity > 0)
    .map(({ cardId, quantity }) => ({ cardId, quantity }))
    .sort((a, b) => a.cardId - b.cardId);
  return { cards, unreadable: parsed.unreadable };
}

/** « 2 modifications illisibles ignorées », comme la page publique ; `null` si rien à dire. */
export function unreadableText(count: number): string | null {
  if (count <= 0) return null;
  return count === 1 ? "1 modification illisible ignorée" : `${count} modifications illisibles ignorées`;
}
