import { createContext, useContext } from "react";
import { apiClient } from "../api-client/client";
import type { ApiClient } from "../offline/vtes";

/**
 * Client typé pour les lectures qui n'ont pas de miroir local (verdict de
 * légalité, liste des produits). Jamais utilisé pour écrire : toute écriture
 * passe par `useVtesOffline().actions`. Injectable pour les tests.
 */
export const ApiClientContext = createContext<ApiClient>(apiClient);

export function useApiClient(): ApiClient {
  return useContext(ApiClientContext);
}
