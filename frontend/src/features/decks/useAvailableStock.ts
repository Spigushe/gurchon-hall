import { useCallback } from "react";
import { useLiveQuery } from "../../offline/react";
import { availableStock, readProjection, useVtesOffline, type DeckKey } from "../../offline/vtes";

/**
 * Exemplaires réels encore disponibles pour une carte × langue × extension,
 * compte tenu des allocations des autres decks vivants (Lot 5, picker fusionné
 * du deck). Lecture locale dérivée, purement indicative : `undefined` tant que
 * non lue, `0` sans carte ni extension choisies. La borne qui compte reste
 * celle du serveur, appliquée côté client par `saveDeckCard`
 * (`AcquisitionBoundError`).
 */
export function useAvailableStock(
  cardId: number | null,
  languageCode: string,
  cardSetId: number | null,
  excludeDeckKey?: DeckKey,
): number | undefined {
  const { db } = useVtesOffline();
  const querier = useCallback(async () => {
    if (cardId === null || cardSetId === null) return 0;
    const projection = await readProjection(db);
    return availableStock(projection, { cardId, languageCode, cardSetId }, excludeDeckKey);
  }, [db, cardId, languageCode, cardSetId, excludeDeckKey]);
  return useLiveQuery(querier);
}
