import { useMemo } from "react";
import { useSearchCatalog } from "../../../offline/vtes";
import { buildCardIndex, type CardIndex } from "../import";

/**
 * L'index d'appariement sur le catalogue en mémoire de Chercher, hors ligne
 * (Lot 9, A2) : `index` nul pendant la lecture, `catalogEmpty` vrai si le
 * catalogue n'est pas encore sur l'appareil.
 */
export function useImportCardIndex(): { index: CardIndex | null; catalogEmpty: boolean } {
  const catalog = useSearchCatalog();
  const index = useMemo(() => (catalog ? buildCardIndex(catalog.cards.map(({ card }) => card)) : null), [catalog]);
  return { index, catalogEmpty: catalog?.cards.length === 0 };
}
