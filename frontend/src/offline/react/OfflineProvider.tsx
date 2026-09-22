import { useEffect, type ReactNode } from "react";
import { OfflineContext, type OfflineRuntime } from "./context";

/**
 * Fournit le runtime offline à l'arbre et pilote son cycle de vie : démarrage
 * au montage (reprise de la file), arrêt au démontage. `start()` et `stop()`
 * sont idempotents et redémarrables, donc sans danger sous
 * React.StrictMode qui monte deux fois en développement.
 */
export function OfflineProvider({
  runtime,
  children,
}: {
  runtime: OfflineRuntime;
  children: ReactNode;
}) {
  useEffect(() => {
    runtime.start();
    return () => runtime.stop();
  }, [runtime]);

  return <OfflineContext.Provider value={runtime}>{children}</OfflineContext.Provider>;
}
