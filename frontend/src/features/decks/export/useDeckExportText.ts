import { useCallback, useMemo } from "react";
import { useLiveQuery } from "../../../offline/react";
import { useVtesOffline, type CardRow, type LocalDeckCard } from "../../../offline/vtes";
import type { DeckCardFacts } from "../deckTablesModel";
import { exportVdbText, reprintedCardIds } from "./exportVdbText";

interface ExportFacts {
  /** Les identifiants lus : une lecture d'une liste précédente n'est jamais prise pour celle-ci. */
  key: string;
  facts: Map<number, DeckCardFacts>;
  /** Toutes les versions des noms de crypte du deck, pour marquer `(G<n>)` un vampire réimprimé. */
  versions: CardRow[];
}

/**
 * Faits des cartes et versions de leurs noms, en une lecture du miroir local
 * (hors ligne comme en ligne). `undefined` tant que la lecture **de ces
 * identifiants** n'a pas abouti.
 */
function useExportFacts(cardIds: readonly number[]): ExportFacts | undefined {
  const { db } = useVtesOffline();
  const key = useMemo(
    () =>
      [...new Set(cardIds)]
        .sort((a, b) => a - b)
        .join(","),
    [cardIds],
  );
  const querier = useCallback(async (): Promise<ExportFacts> => {
    const ids = key === "" ? [] : key.split(",").map(Number);
    return db.transaction("r", db.cards, db.cardDetails, async () => {
      const [cards, details] = await Promise.all([db.cards.where("id").anyOf(ids).toArray(), db.cardDetails.bulkGet(ids)]);
      const detailsById = new Map(details.flatMap((row) => (row ? [[row.id, row] as const] : [])));
      const facts = new Map(cards.map((card) => [card.id, { card, details: detailsById.get(card.id) ?? null }]));
      const names = cards.filter((card) => card.category === "crypt" && !card.advanced).map((card) => card.foldedName);
      const versions = names.length === 0 ? [] : await db.cards.where("foldedName").anyOf(names).toArray();
      return { key, facts, versions };
    });
  }, [db, key]);
  const result = useLiveQuery(querier);
  return result?.key === key ? result : undefined;
}

/**
 * Le texte `TEXT` de VDB d'une liste (deck vivant ou version jouée), lu dans le
 * miroir local : `undefined` tant que les lignes ou les faits des cartes ne
 * sont pas lus.
 */
export function useDeckExportText(
  name: string,
  description: string | null,
  lines: readonly LocalDeckCard[] | undefined,
): string | undefined {
  const ids = useMemo(() => (lines ?? []).map((line) => line.cardId), [lines]);
  const read = useExportFacts(ids);
  return useMemo(() => {
    if (!lines || !read) return undefined;
    const reprinted = reprintedCardIds(
      [...read.facts.values()].map(({ card }) => card),
      read.versions,
    );
    return exportVdbText({ name, description, lines, facts: read.facts, reprinted });
  }, [name, description, lines, read]);
}
