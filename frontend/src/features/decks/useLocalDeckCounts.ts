import { useMemo } from "react";
import type { LocalDeckCard } from "../../offline/vtes";
import { useCardCategoriesById } from "./useCardCategories";

export interface LocalDeckCounts {
  crypt: number;
  library: number;
}

/**
 * Comptes crypte / bibliothèque d'un deck, purement locaux : la composition
 * (`lines`) croisée avec la catégorie du miroir catalogue. Aucun réseau, donc
 * lisibles hors ligne — contrairement au verdict de légalité, calculé par le
 * serveur. `null` tant que la composition ou le miroir n'ont pas répondu ; une
 * carte absente du miroir n'est comptée nulle part.
 *
 * Factorisé depuis `DeckLegalitySummary` (Lot 5c, étape 5) pour que la liste
 * « En cours » mobile de l'Atelier affiche les mêmes chiffres, sans les recalculer
 * autrement.
 */
export function useLocalDeckCounts(lines: LocalDeckCard[] | undefined): LocalDeckCounts | null {
  const cardIds = useMemo(() => (lines ?? []).map((line) => line.cardId), [lines]);
  const categories = useCardCategoriesById(cardIds);
  return useMemo(() => {
    if (lines === undefined || categories === undefined) return null;
    let crypt = 0;
    let library = 0;
    for (const line of lines) {
      const category = categories.get(line.cardId);
      if (category === "crypt") crypt += line.quantity;
      else if (category === "library") library += line.quantity;
    }
    return { crypt, library };
  }, [lines, categories]);
}
