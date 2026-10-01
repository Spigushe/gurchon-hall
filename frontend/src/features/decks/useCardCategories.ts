import { useCallback, useMemo } from "react";
import { useLiveQuery } from "../../offline/react";
import { useVtesOffline, type CardRow } from "../../offline/vtes";

/** Pas exportée par la couche offline (`CardRow["category"]` suffit à la retrouver). */
type CardCategory = CardRow["category"];

/**
 * Catégorie (crypte / bibliothèque) des cartes données, lue dans le miroir
 * local du catalogue (`db.cards`, alimenté par `CatalogProvider` au premier
 * lancement en ligne). Lecture strictement locale, purement indicative : une
 * carte absente du miroir (catalogue pas encore téléchargé) n'apparaît
 * simplement pas dans la table retournée, sans erreur ni blocage.
 *
 * `undefined` tant que la première lecture n'a pas abouti. Le tableau `cardIds`
 * est réduit à une clé stable (triée, dédupliquée) avant d'être passé à
 * `useLiveQuery` : sans cela, un tableau recréé à chaque rendu (cas courant,
 * `lines.map(...)`) réabonnerait la lecture en boucle.
 */
export function useCardCategoriesById(cardIds: number[]): Map<number, CardCategory> | undefined {
  const { db } = useVtesOffline();
  const key = useMemo(
    () =>
      Array.from(new Set(cardIds))
        .sort((a, b) => a - b)
        .join(","),
    [cardIds],
  );
  const querier = useCallback(async () => {
    if (key === "") return new Map<number, CardCategory>();
    const ids = key.split(",").map(Number);
    const rows = await db.cards.where("id").anyOf(ids).toArray();
    return new Map(rows.map((row) => [row.id, row.category]));
  }, [db, key]);
  return useLiveQuery(querier);
}
