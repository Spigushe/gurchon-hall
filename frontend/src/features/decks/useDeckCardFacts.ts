import { useCallback, useMemo } from "react";
import { useLiveQuery } from "../../offline/react";
import { useVtesOffline } from "../../offline/vtes";
import type { DeckCardFacts } from "./deckTablesModel";

/**
 * Faits des cartes données (`cards` et `cardDetails`), lus dans le miroir
 * local pour les seules cartes d'un ou de plusieurs decks (plan du lot
 * Affichage des decks, A1) : quelques dizaines de lignes par `anyOf`, plutôt
 * que les 4 000 cartes du catalogue en mémoire de Chercher.
 *
 * `undefined` tant que la première lecture n'a pas abouti. Une carte absente
 * de `cards` n'est pas dans la table rendue ; une carte sans détails (miroir
 * incomplet) y est, avec `details: null`. Comme `useCardCategoriesById`, la
 * liste d'identifiants est réduite à une clé stable avant `useLiveQuery`, pour
 * qu'un tableau recréé à chaque rendu ne réabonne pas la lecture.
 */
export function useDeckCardFacts(cardIds: readonly number[]): Map<number, DeckCardFacts> | undefined {
  const { db } = useVtesOffline();
  const key = useMemo(
    () =>
      Array.from(new Set(cardIds))
        .sort((a, b) => a - b)
        .join(","),
    [cardIds],
  );
  const querier = useCallback(async () => {
    const facts = new Map<number, DeckCardFacts>();
    if (key === "") return facts;
    const ids = key.split(",").map(Number);
    return db.transaction("r", db.cards, db.cardDetails, async () => {
      const [cards, details] = await Promise.all([
        db.cards.where("id").anyOf(ids).toArray(),
        db.cardDetails.bulkGet(ids),
      ]);
      const detailsById = new Map(details.flatMap((row) => (row ? [[row.id, row] as const] : [])));
      for (const card of cards) facts.set(card.id, { card, details: detailsById.get(card.id) ?? null });
      return facts;
    });
  }, [db, key]);
  return useLiveQuery(querier);
}
