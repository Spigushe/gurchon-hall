import type { CardRow, LocalDeckCard } from "../../offline/vtes";

type CardCategory = CardRow["category"];
import { versionChanges, type VersionChanges } from "../decks/deckVersionModel";
import type { EffectiveCard } from "./effectiveList";

/**
 * Comparaison d'une liste partagée à un de mes decks (Lot 13, D5, A9), en
 * fonctions pures. La règle est celle des versions du Lot 8 : carte × quantité
 * totale, langues, extensions et proxies confondus. Le calcul des écarts est
 * `versionChanges` : le départ est la liste partagée, l'**arrivée mon deck**
 * (décision de l'utilisateur, 2026-11-21), si bien que les **entrées** sont les
 * cartes seulement dans mon deck, les **sorties** celles seulement dans la liste.
 */

/** Mon deck en carte × quantité totale (les lignes d'une même carte s'additionnent). */
export function deckQuantities(lines: readonly LocalDeckCard[]): EffectiveCard[] {
  const totals = new Map<number, number>();
  for (const line of lines) totals.set(line.cardId, (totals.get(line.cardId) ?? 0) + line.quantity);
  return [...totals].map(([cardId, quantity]) => ({ cardId, quantity })).sort((a, b) => a.cardId - b.cardId);
}

export interface SideCounts {
  crypt: number;
  library: number;
}

/** Exemplaires de crypte et de bibliothèque ; une carte à catégorie inconnue compte en bibliothèque. */
export function sideCounts(cards: readonly EffectiveCard[], categoryOf: (cardId: number) => CardCategory | null): SideCounts {
  const counts = { crypt: 0, library: 0 };
  for (const { cardId, quantity } of cards) counts[categoryOf(cardId) === "crypt" ? "crypt" : "library"] += quantity;
  return counts;
}

export interface ListComparison {
  /** `entries` : seulement dans mon deck ; `exits` : seulement dans la liste partagée ; `changed` : de sa quantité à la mienne. */
  changes: VersionChanges;
  mine: SideCounts;
  shared: SideCounts;
}

export function compareLists(
  mine: readonly EffectiveCard[],
  shared: readonly EffectiveCard[],
  nameOf: (cardId: number) => string,
  categoryOf: (cardId: number) => CardCategory | null,
): ListComparison {
  return {
    changes: versionChanges(shared, mine, nameOf),
    mine: sideCounts(mine, categoryOf),
    shared: sideCounts(shared, categoryOf),
  };
}
