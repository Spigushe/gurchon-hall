import { useState } from "react";
import type { AppUpdateStore } from "../../offline/core/appUpdate";
import { useAppUpdate } from "../../offline/react";
import { appUpdateHints, appUpdateTitle } from "./appUpdateCopy";

/**
 * Bandeau « nouvelle version » (Lot 12, P5 ; handoff 1b-72 à 1b-76, d47, d48),
 * dans la coquille, sous le bandeau de reconnexion. Toute la logique est dans
 * `useAppUpdate` : la version qui attend, croisée avec la file. Tant que des
 * saisies attendent leur envoi, pas de « Mettre à jour » ; le bandeau le
 * propose de lui-même quand la file se vide. Des saisies refusées ne bloquent
 * pas et sont dites conservées. « Plus tard » le masque jusqu'au prochain
 * démarrage.
 *
 * Pas de `role="status"`, unique dans la coquille (`NetworkStatus`, dont les
 * e2e dépendent) : une région nommée, annoncée poliment.
 */
export function AppUpdateBanner({ store }: { store?: AppUpdateStore } = {}) {
  // Sans `store`, celui de l'application, qu'alimente `registerServiceWorker`.
  const { view, apply, dismiss } = useAppUpdate(store);
  const [failed, setFailed] = useState(false);
  if (view.kind === "hidden") return null;

  const install = async () => {
    setFailed(false);
    try {
      await apply();
    } catch {
      // Le store a rendu le bandeau à son état d'avant : on peut réessayer.
      setFailed(true);
    }
  };

  return (
    <section
      className="sync-alert app-update-banner"
      aria-label="Nouvelle version"
      aria-live="polite"
      data-testid="app-update-banner"
      data-state={view.kind}
    >
      <p className="sync-alert__title">{appUpdateTitle(view)}</p>
      {appUpdateHints(view).map((hint) => (
        <p key={hint} className="hint" data-testid="app-update-hint">
          {hint}
        </p>
      ))}
      {failed && (
        <p className="error-text" role="alert" data-testid="app-update-error">
          La nouvelle version n'a pas pu s'installer. Réessayez.
        </p>
      )}
      <div className="app-update-banner__actions">
        {view.kind === "ready" && (
          <button
            type="button"
            className="btn-ghost"
            disabled={view.applying}
            data-testid="app-update-apply"
            onClick={() => void install()}
          >
            {view.applying ? "Mise à jour…" : "Mettre à jour"}
          </button>
        )}
        <button type="button" className="btn-ghost" data-testid="app-update-later" onClick={dismiss}>
          Plus tard
        </button>
      </div>
    </section>
  );
}
