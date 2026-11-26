import { useEffect, useState } from "react";
import { useApiClient } from "../../app/apiClientContext";
import { Link } from "../../app/Link";
import { useGuardedAction } from "../../components/useGuardedAction";
import type { ResourceKey } from "../../offline/vtes";
import { browserClipboard, copyText } from "../decks/export/exportFile";
import { listMyReports, reportLink, revokeReportLink, type MyTournamentReport } from "./reportApi";

type State = { kind: "loading" } | { kind: "ready"; reports: MyTournamentReport[] } | { kind: "error" };

/**
 * « Comptes-rendus partagés » de l'écran Compte (lot Compte-rendu, P8) : les
 * comptes-rendus qui ont un lien public, chacun avec « Copier » et « Purger »,
 * seul moyen de retirer le lien. En ligne seulement : la liste se lit sur le
 * serveur.
 */
export function AccountReports({ online }: { online: boolean }) {
  const client = useApiClient();
  const action = useGuardedAction();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [feedback, setFeedback] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!online) return;
    let cancelled = false;
    void listMyReports(client).then((outcome) => {
      if (!cancelled) setState(outcome.kind === "ok" ? { kind: "ready", reports: outcome.value } : { kind: "error" });
    });
    return () => {
      cancelled = true;
    };
  }, [online, client, reloadKey]);

  const shared = state.kind === "ready" ? state.reports.filter((report) => report.token !== null) : [];

  return (
    <section className="account-section" aria-labelledby="account-reports-title" data-testid="account-reports">
      <h3 id="account-reports-title" className="kicker">
        Comptes-rendus partagés
      </h3>
      {!online ? (
        <p className="hint">La liste des liens demande une connexion.</p>
      ) : state.kind === "loading" ? (
        <p className="hint">Chargement…</p>
      ) : state.kind === "error" ? (
        <p className="error-text">La liste n'a pas pu être lue.</p>
      ) : shared.length === 0 ? (
        <p className="account-text" data-testid="account-reports-empty">
          Aucun compte-rendu partagé.
        </p>
      ) : (
        <ul className="account-reports" data-testid="account-reports-list">
          {shared.map((report) => (
            <li key={report.tournament_id} className="account-reports__row" data-testid="account-report">
              <Link to={{ name: "tournamentReport", key: `id:${report.tournament_id}` as ResourceKey }}>
                {report.tournament_name}
              </Link>
              <span className="page-meta">
                {report.latest_number === null ? "sans version" : `version ${report.latest_number}`}
              </span>
              <span className="account-reports__actions">
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={async () => {
                    const outcome = await copyText(reportLink(report.token as string), browserClipboard());
                    setFeedback(outcome === "copied" ? "Lien copié." : reportLink(report.token as string));
                  }}
                  data-testid="account-report-copy"
                >
                  Copier le lien
                </button>
                <button
                  type="button"
                  className="btn-danger-text"
                  disabled={action.pending}
                  onClick={() => {
                    if (!window.confirm(`Purger le lien du compte-rendu de ${report.tournament_name} ?`)) return;
                    void action.run(async () => {
                      await revokeReportLink(client, report.tournament_id);
                      setFeedback("Lien purgé.");
                      setReloadKey((key) => key + 1);
                    });
                  }}
                  data-testid="account-report-purge"
                >
                  Purger
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {feedback && (
        <p className="feedback-text" role="status" data-testid="account-reports-feedback">
          {feedback}
        </p>
      )}
    </section>
  );
}
