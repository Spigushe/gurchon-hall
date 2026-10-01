import { useCallback, useMemo } from "react";
import { useLiveQuery } from "../../offline/react";
import { useVtesOffline, type CardRow } from "../../offline/vtes";

/**
 * Cartes du catalogue (miroir local `db.cards`), par identifiant — variante de
 * `useCardCategoriesById` (`features/decks/useCardCategories.ts`) qui renvoie
 * la ligne entière plutôt que la seule catégorie : la vue tableau bureau de la
 * Collection (Lot 5bis, étape 8, `docs/design-handoff/DESKTOP.md` « d02 »)
 * affiche aussi le clan, la capacité et l'image KRCG d'une carte. Les
 * disciplines, le type de bibliothèque et le coût restent hors périmètre
 * (`docs/lot5bis-plan-design.md`, « Ce que ce lot ne touche pas ») : absents du
 * miroir, ils ne sont pas reconstruits côté client.
 *
 * Lecture strictement locale, purement indicative : une carte absente du
 * miroir (catalogue pas encore téléchargé) n'apparaît simplement pas dans la
 * table renvoyée, sans erreur ni blocage. `undefined` tant que la première
 * lecture n'a pas abouti.
 */
export function useCardsById(cardIds: number[]): Map<number, CardRow> | undefined {
  const { db } = useVtesOffline();
  const key = useMemo(
    () =>
      Array.from(new Set(cardIds))
        .sort((a, b) => a - b)
        .join(","),
    [cardIds],
  );
  const querier = useCallback(async () => {
    if (key === "") return new Map<number, CardRow>();
    const ids = key.split(",").map(Number);
    const rows = await db.cards.where("id").anyOf(ids).toArray();
    return new Map(rows.map((row) => [row.id, row]));
  }, [db, key]);
  return useLiveQuery(querier);
}
