import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useConnectivity, useLiveQuery } from "../../offline/react";
import { useVtesOffline } from "../../offline/vtes";
import { CatalogContext, type CatalogState } from "./catalogContext";

/**
 * État du catalogue (miroir local des ~4 000 cartes) et son téléchargement.
 *
 * Le catalogue ne se charge que sur demande (`refresh({ catalog: true })`) : sans
 * lui, la saisie hors ligne ne peut pas proposer de carte. Au premier lancement
 * en ligne, s'il est vide, on le télécharge une fois ; en cas d'échec on ne
 * boucle pas, l'utilisateur relance par le bouton, et un retour du réseau
 * autorise un nouvel essai automatique.
 */
export function CatalogProvider({ children }: { children: ReactNode }) {
  const { db, refresh } = useVtesOffline();
  const online = useConnectivity();
  const countQuery = useCallback(() => db.cards.count(), [db]);
  const count = useLiveQuery(countQuery);
  const [status, setStatus] = useState<CatalogState["status"]>("idle");
  const [error, setError] = useState<string | null>(null);
  const [authRequired, setAuthRequired] = useState(false);
  const running = useRef(false);

  const update = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setStatus("loading");
    setError(null);
    try {
      // `refresh` réunit les options : le catalogue demandé pendant une lecture
      // en cours est lu par la suivante.
      const report = await refresh({ catalog: true });
      if (report.refreshed.includes("catalog")) {
        setStatus("idle");
        setAuthRequired(false);
      } else if (report.authRequired) {
        // Lot 6 : un 401, pas une panne. Rien n'a bougé (le miroir n'a pas été
        // vidé avant d'avoir tout relu, `runtime.ts`) : ce n'est pas une
        // erreur à afficher en rouge, juste une reconnexion à proposer
        // (`CatalogPanel`).
        setStatus("idle");
        setAuthRequired(true);
      } else {
        setStatus("error");
        setAuthRequired(false);
        setError(report.errors.join(" ; ") || "Le catalogue n'a pas pu être téléchargé.");
      }
    } catch (failure) {
      setStatus("error");
      setAuthRequired(false);
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      running.current = false;
    }
  }, [refresh]);

  const attempted = useRef(false);
  useEffect(() => {
    if (!online) {
      attempted.current = false;
      return;
    }
    if (count === 0 && !attempted.current) {
      attempted.current = true;
      void update();
    }
  }, [online, count, update]);

  const value = useMemo(
    () => ({ count, status, error, authRequired, update }),
    [count, status, error, authRequired, update],
  );
  return <CatalogContext.Provider value={value}>{children}</CatalogContext.Provider>;
}
