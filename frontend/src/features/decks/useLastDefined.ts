import { useState } from "react";

/**
 * Garde la dernière valeur définie d'une lecture locale pendant qu'elle se
 * relance : quand une carte entre dans le deck, la clé de `useDeckCardFacts`
 * change et sa lecture repart de `undefined`. Sans ce relais, les tableaux
 * repasseraient par le squelette de chargement à chaque ajout, et la page
 * sauterait. État dérivé ajusté pendant le rendu (motif documenté par React),
 * comme `useRecentIncreases`, sans `ref` lu au rendu.
 */
export function useLastDefined<T>(value: T | undefined): T | undefined {
  const [last, setLast] = useState(value);
  if (value !== undefined && value !== last) setLast(value);
  return value ?? last;
}
