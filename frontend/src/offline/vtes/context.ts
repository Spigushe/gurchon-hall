import { createContext, useContext } from "react";
import type { VtesOfflineRuntime } from "./runtime";

export const VtesOfflineContext = createContext<VtesOfflineRuntime | null>(null);

/** Runtime VtES : écritures (`actions`), rafraîchissement, base. */
export function useVtesOffline(): VtesOfflineRuntime {
  const runtime = useContext(VtesOfflineContext);
  if (!runtime) {
    throw new Error("useVtesOffline : aucun <VtesOfflineProvider> au-dessus de ce composant.");
  }
  return runtime;
}
