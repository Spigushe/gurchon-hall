import { createContext, useContext } from "react";
import type { UserRead } from "./authApi";

export interface AuthActions {
  /**
   * Déconnexion complète (D3) : `POST /deconnexion`, puis `runtime.purge()`,
   * puis l'oubli du compte actif. Gère elle-même l'ordre imposé par le Lot 6 ;
   * l'appelant n'a qu'à avoir déjà obtenu la confirmation si la file n'était
   * pas vide.
   */
  logout(): Promise<void>;
  /**
   * Une connexion a réussi ailleurs que sur l'écran de connexion plein (donc
   * depuis le bandeau de reconnexion) : relie le compte reçu au runtime actif,
   * sous le même compte ou un autre (§ P3 : « une base IndexedDB par compte »).
   */
  reconnect(user: UserRead): Promise<void>;
}

/**
 * Valeur par défaut non bloquante (comme `ApiClientContext`) : un composant de
 * la coquille (`App`, `AccountMenu`…) rendu sans `<AuthGate>` au-dessus (bancs
 * d'essai existants, `tests/unit/ui/harness.tsx`, qui montent `<App/>`
 * directement) ne doit pas lever — il n'a simplement rien à faire.
 */
const NOOP_ACTIONS: AuthActions = {
  async logout() {},
  async reconnect() {},
};

export const AuthActionsContext = createContext<AuthActions>(NOOP_ACTIONS);

export function useAuthActions(): AuthActions {
  return useContext(AuthActionsContext);
}
