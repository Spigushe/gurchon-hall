import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useConnectivity, useLiveQuery } from "../../offline/react";
import { readCatalogState, useVtesOffline } from "../../offline/vtes";
import { CatalogContext, type CatalogState } from "./catalogContext";

/**
 * État du catalogue (miroir local des ~4 000 cartes) et son téléchargement.
 *
 * Le catalogue ne se charge que sur demande (`refresh({ catalog: true })`) : sans
 * lui, la saisie hors ligne ne peut pas proposer de carte. Au premier lancement
 * en ligne, s'il est vide, on le télécharge une fois ; en cas d'échec on ne
 * boucle pas, l'utilisateur relance par le bouton, et un retour du réseau
 * autorise un nouvel essai automatique.
 *
 * Lot Chercher (P11) : même relecture automatique, une fois, quand le catalogue
 * est là mais que ses détails manquent ou sont incomplets (base montée de la
 * version 5, catalogue lu sur un ancien serveur). Elle ne se répète pas si le
 * serveur ne rend toujours pas les détails : le bouton reste.
 */
export function CatalogProvider({ children }: { children: ReactNode }) {
  const { db, refresh } = useVtesOffline();
  const online = useConnectivity();
  const stateQuery = useCallback(() => readCatalogState(db), [db]);
  const mirror = useLiveQuery(stateQuery);
  const count = mirror?.cards;
  const detailsComplete = mirror?.complete;
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
    if (mirror && !mirror.complete && !attempted.current) {
      attempted.current = true;
      void update();
    }
  }, [online, mirror, update]);

  const value = useMemo(
    () => ({ count, detailsComplete, status, error, authRequired, update }),
    [count, detailsComplete, status, error, authRequired, update],
  );
  return <CatalogContext.Provider value={value}>{children}</CatalogContext.Provider>;
}
