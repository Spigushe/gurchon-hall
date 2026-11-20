import { createContext, useContext } from "react";

export interface CatalogState {
  /** Nombre de cartes du miroir local ; `undefined` tant que la première lecture n'a pas abouti. */
  count: number | undefined;
  /**
   * Lot Chercher : les détails du catalogue (secte, texte, disciplines…) sont
   * présents pour toutes les cartes. `undefined` tant que la première lecture
   * n'a pas abouti ; `false` pour un catalogue absent ou incomplet (montée de
   * la base, ancien serveur) : les filtres de Chercher attendent alors une mise
   * à jour, en ligne.
   */
  detailsComplete: boolean | undefined;
  /**
   * Lot 12 (A8) : le catalogue local n'est pas encore utilisable (absent ou
   * incomplet) et une lecture est en cours, ou la première lecture du miroir
   * n'a pas abouti. La liste et l'aperçu des decks affichent alors
   * « Catalogue en cours de chargement » au lieu de « 0 / 0 » et de « Hors
   * catalogue local ». Faux pour la mise à jour d'un catalogue déjà complet.
   */
  loading: boolean;
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

/**
 * Lot 12 (A8, D2) : `loading` du catalogue, faux sans `<CatalogProvider>`
 * au-dessus (composant rendu seul dans un test). Les écrans qui ne font
 * qu'afficher l'état passent par ici plutôt que par `useCatalog`, qui lève.
 */
export function useCatalogLoading(): boolean {
  return useContext(CatalogContext)?.loading ?? false;
}
