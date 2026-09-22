import { useCallback, useRef, useState } from "react";

/**
 * Exécute une action asynchrone **une seule fois à la fois**.
 *
 * Un double-clic sur « Enregistrer » créerait deux opérations en file, donc deux
 * clés d'idempotence distinctes et deux écritures. Le verrou est un `ref`, pas
 * l'état : un second clic dans le même tour (avant le nouveau rendu) est ignoré
 * lui aussi. `pending` sert à désactiver les boutons.
 */
export function useGuardedAction() {
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Renvoie `true` si l'action a abouti, `false` si elle a échoué ou a été ignorée. */
  const run = useCallback(async (task: () => Promise<unknown>): Promise<boolean> => {
    if (inFlight.current) return false;
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      await task();
      return true;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      return false;
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }, []);

  return { run, pending, error };
}
