import { useConnectivity } from "../../offline/react";
import { plural } from "../../labels";
import { useCatalog } from "./catalogContext";

/**
 * Où en est le catalogue, et le moyen de le mettre à jour. Dit clairement ce
 * qu'on ne peut pas faire tant qu'il manque (chercher une carte à saisir).
 */
export function CatalogPanel({ compact = false }: { compact?: boolean }) {
  const { count, status, error, update } = useCatalog();
  const online = useConnectivity();
  const missing = count === 0;
  const loading = status === "loading";

  return (
    <section className="panel" aria-labelledby="catalog-title" data-testid="catalog-panel">
      <h2 id="catalog-title" className={compact ? "panel__title panel__title--small" : "panel__title"}>
        Catalogue des cartes
      </h2>
      <p data-testid="catalog-state" data-count={count ?? ""} aria-live="polite">
        {count === undefined
          ? "Lecture du catalogue local…"
          : missing
            ? "Le catalogue n'est pas encore téléchargé sur cet appareil."
            : `${plural(count, "carte")} disponible${count > 1 ? "s" : ""} hors ligne.`}
      </p>
      {missing && !online && (
        <p className="hint" data-testid="catalog-offline-hint">
          Vous êtes hors ligne : sans le catalogue, impossible de chercher une carte à saisir.
          Connectez-vous une première fois pour le télécharger (environ 4 000 cartes).
        </p>
      )}
      {status === "error" && (
        <p className="error" role="alert" data-testid="catalog-error">
          Téléchargement impossible : {error}
        </p>
      )}
      <button
        type="button"
        onClick={() => void update()}
        disabled={!online || loading}
        data-testid="catalog-update"
      >
        {loading ? "Téléchargement en cours…" : "Mettre à jour le catalogue"}
      </button>
      {!online && !missing && <p className="hint">La mise à jour demande une connexion.</p>}
    </section>
  );
}
