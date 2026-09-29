import { useConnectivity } from "../../offline/react";
import { plural } from "../../labels";
import { useCatalog } from "./catalogContext";

/**
 * Où en est le catalogue, et le moyen de le mettre à jour.
 *
 * En forme compacte (pied de l'Atelier, handoff Nocturne) : une ligne de texte
 * 12px avec un lien de mise à jour, gardé sous forme compacte plutôt que
 * retiré (CLAUDE.md/plan du Lot 5 : retirer l'action serait un changement de
 * comportement). En forme pleine (Collection, catalogue absent) : bloc
 * complet avec le même contenu, plus visible.
 */
export function CatalogPanel({ compact = false }: { compact?: boolean }) {
  const { count, status, error, update } = useCatalog();
  const online = useConnectivity();
  const missing = count === 0;
  const loading = status === "loading";

  const stateText =
    count === undefined
      ? "Lecture du catalogue local…"
      : missing
        ? "Le catalogue n'est pas encore téléchargé sur cet appareil."
        : `Catalogue à jour — ${plural(count, "carte")}`;

  if (compact) {
    return (
      <div data-testid="catalog-panel">
        <p className="row__meta" data-testid="catalog-state" data-count={count ?? ""}>
          {stateText}
          {!missing && count !== undefined && (
            <>
              {" · "}
              <button
                type="button"
                className="btn-text"
                onClick={() => void update()}
                disabled={!online || loading}
                data-testid="catalog-update"
              >
                {loading ? "Téléchargement en cours…" : "Mettre à jour"}
              </button>
            </>
          )}
        </p>
        {missing && (
          <p className="row__meta">
            {!online && (
              <span data-testid="catalog-offline-hint">
                Hors ligne : connectez-vous une première fois pour le télécharger.{" "}
              </span>
            )}
            <button
              type="button"
              className="btn-text"
              onClick={() => void update()}
              disabled={!online || loading}
              data-testid="catalog-update"
            >
              {loading ? "Téléchargement en cours…" : "Télécharger le catalogue"}
            </button>
          </p>
        )}
        {status === "error" && (
          <p className="error-text" role="alert" data-testid="catalog-error">
            Téléchargement impossible : {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <section aria-labelledby="catalog-title" data-testid="catalog-panel">
      <h2 id="catalog-title" className="kicker">
        Catalogue des cartes
      </h2>
      <p data-testid="catalog-state" data-count={count ?? ""} aria-live="polite">
        {stateText}
      </p>
      {missing && !online && (
        <p className="hint" data-testid="catalog-offline-hint">
          Vous êtes hors ligne : sans le catalogue, impossible de chercher une carte à saisir.
          Connectez-vous une première fois pour le télécharger (environ 4 000 cartes).
        </p>
      )}
      {status === "error" && (
        <p className="error-text" role="alert" data-testid="catalog-error">
          Téléchargement impossible : {error}
        </p>
      )}
      <button
        type="button"
        className="btn btn-secondary"
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
