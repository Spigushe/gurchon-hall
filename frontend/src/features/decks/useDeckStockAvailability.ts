import { useCallback, useMemo } from "react";
import { useLiveQuery } from "../../offline/react";
import { availableStock, readProjection, useVtesOffline } from "../../offline/vtes";
import type { StockAvailability } from "./deckTablesModel";

/**
 * Exemplaires encore libres de chaque entrée de collection des cartes données
 * (P3 : le `+` d'une ligne de deck prend au stock identique, ou fait choisir
 * entre les autres langues et extensions). Libres = possédés moins ce que
 * tous les decks vivants allouent, ce deck compris : c'est ce qu'un `+` peut
 * encore prendre. Même comptabilité que le serveur (`availableStock`).
 */
export function useDeckStockAvailability(
  cardIds: readonly number[],
): Map<number, StockAvailability[]> | undefined {
  const { db } = useVtesOffline();
  const key = useMemo(
    () =>
      Array.from(new Set(cardIds))
        .sort((a, b) => a - b)
        .join(","),
    [cardIds],
  );
  const querier = useCallback(async () => {
    const byCard = new Map<number, StockAvailability[]>();
    if (key === "") return byCard;
    const ids = new Set(key.split(",").map(Number));
    const projection = await readProjection(db);
    for (const entry of projection.stock) {
      if (!ids.has(entry.cardId)) continue;
      const list = byCard.get(entry.cardId) ?? [];
      list.push({
        languageCode: entry.languageCode,
        cardSetId: entry.cardSetId,
        available: availableStock(projection, entry),
      });
      byCard.set(entry.cardId, list);
    }
    return byCard;
  }, [db, key]);
  return useLiveQuery(querier);
}
