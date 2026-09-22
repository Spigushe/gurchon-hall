import { liveQuery } from "dexie";
import { useEffect, useState } from "react";

/**
 * Résultat d'une lecture IndexedDB, rejouée à chaque changement des tables
 * lues (y compris depuis un autre onglet). `undefined` tant que la première
 * lecture n'a pas abouti.
 *
 * `querier` doit être stable (`useCallback`) : sa identité pilote
 * l'abonnement.
 */
export function useLiveQuery<T>(querier: () => Promise<T> | T): T | undefined {
  const [value, setValue] = useState<T | undefined>(undefined);

  useEffect(() => {
    const subscription = liveQuery(querier).subscribe({
      next: (next) => setValue(next),
      error: (error) => console.error("[offline] lecture locale en échec", error),
    });
    return () => subscription.unsubscribe();
  }, [querier]);

  return value;
}
