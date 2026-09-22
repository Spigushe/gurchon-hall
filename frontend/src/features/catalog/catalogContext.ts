import { createContext, useContext } from "react";

export interface CatalogState {
  /** Nombre de cartes du miroir local ; `undefined` tant que la première lecture n'a pas abouti. */
  count: number | undefined;
  /** `loading` : téléchargement en cours ; `error` : le dernier essai a échoué. */
  status: "idle" | "loading" | "error";
  error: string | null;
  /** Télécharge le catalogue complet (en ligne seulement). */
  update: () => Promise<void>;
}

export const CatalogContext = createContext<CatalogState | null>(null);

export function useCatalog(): CatalogState {
  const state = useContext(CatalogContext);
  if (!state) throw new Error("useCatalog : aucun <CatalogProvider> au-dessus de ce composant.");
  return state;
}
