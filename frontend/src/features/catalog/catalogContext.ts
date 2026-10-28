import { createContext, useContext } from "react";

export interface CatalogState {
  /** Nombre de cartes du miroir local ; `undefined` tant que la première lecture n'a pas abouti. */
  count: number | undefined;
  /** `loading` : téléchargement en cours ; `error` : le dernier essai a échoué. */
  status: "idle" | "loading" | "error";
  error: string | null;
  /**
   * Lot 6 : le dernier essai a rendu 401 (`RefreshReport.authRequired`), pas
   * une panne ordinaire. `status` reste `"idle"` dans ce cas (rien à afficher
   * comme une erreur alarmante) ; c'est ce drapeau qui dit à `CatalogPanel`
   * de proposer une reconnexion plutôt qu'un nouvel essai muet.
   */
  authRequired: boolean;
  /** Télécharge le catalogue complet (en ligne seulement). */
  update: () => Promise<void>;
}

export const CatalogContext = createContext<CatalogState | null>(null);

export function useCatalog(): CatalogState {
  const state = useContext(CatalogContext);
  if (!state) throw new Error("useCatalog : aucun <CatalogProvider> au-dessus de ce composant.");
  return state;
}
