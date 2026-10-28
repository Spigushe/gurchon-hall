import { useState } from "react";
import { useGuardedAction } from "../../components/useGuardedAction";
import { adoptLegacyDatabase } from "../../offline/vtes";

/**
 * Proposition d'adoption de la base d'avant les comptes (Lot 6, § P3), montrée
 * une fois juste après une connexion ou une inscription qui ouvre une base
 * neuve. Confirmation explicite requise (rien n'est recopié tout seul) ; sans
 * confirmation, la base historique reste intacte et la question peut
 * revenir à la prochaine connexion.
 */
export function LegacyAdoptionBanner({
  targetDbName,
  accountLabel,
  onDone,
}: {
  targetDbName: string;
  accountLabel: string;
  onDone: () => void;
}) {
  const action = useGuardedAction();
  const [declined, setDeclined] = useState(false);

  if (declined) return null;

  return (
    <div className="sync-alert floating-banner" role="alert" data-testid="legacy-adoption-banner">
      <p className="sync-alert__title">
        Des saisies faites avant les comptes attendent sur cet appareil. Les rattacher à {accountLabel} ?
      </p>
      {action.error && (
        <p className="error-text" role="alert">
          {action.error}
        </p>
      )}
      <div className="confirm-row" role="group" aria-label="Adopter les saisies précédentes">
        <button
          type="button"
          className="chip-action chip-action--accent"
          disabled={action.pending}
          data-testid="legacy-adoption-confirm"
          onClick={() =>
            void action.run(async () => {
              await adoptLegacyDatabase(targetDbName);
              onDone();
            })
          }
        >
          Les rattacher
        </button>
        <button
          type="button"
          className="chip-action chip-action--neutral"
          disabled={action.pending}
          data-testid="legacy-adoption-dismiss"
          onClick={() => setDeclined(true)}
        >
          Pas maintenant
        </button>
      </div>
    </div>
  );
}
