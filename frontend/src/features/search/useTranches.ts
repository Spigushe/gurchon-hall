import { useState } from "react";

/** Taille d'une tranche (handoff, écran 28). */
export const TRANCHE = 50;

/**
 * Nombre de lignes affichées : une tranche de plus à chaque fois que le bas de
 * la liste devient visible, ou au bouton « Afficher 50 de plus », qui reste là
 * pour un lecteur d'écran ou quand l'observation ne part pas. Revient à une
 * tranche quand `resetKey` change (nouveaux critères).
 */
export function useTranches(total: number, resetKey: unknown) {
  const [shown, setShown] = useState(TRANCHE);
  const [trackedKey, setTrackedKey] = useState(resetKey);
  if (trackedKey !== resetKey) {
    setTrackedKey(resetKey);
    setShown(TRANCHE);
  }
  const more = () => setShown((count) => Math.min(total, count + TRANCHE));
  return { shown: Math.min(shown, total), more, hasMore: shown < total };
}
