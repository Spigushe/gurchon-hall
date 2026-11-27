import { useId, useState } from "react";
import { CopyIcon, LinkIcon } from "@phosphor-icons/react";
import { useApiClient } from "../../app/apiClientContext";
import { Switch } from "../../components/Switch";
import { useGuardedAction } from "../../components/useGuardedAction";
import { useConnectivity } from "../../offline/react";
import type { TournamentReportRow } from "../../offline/vtes";
import { browserClipboard, copyText, type CopyOutcome } from "../decks/export/exportFile";
import { reportLink, revokeReportLink, shareReport, updateReportSettings, type TournamentReportRead } from "./reportApi";

/**
 * Le groupe « Lien public » du panneau de réglages (bureau) et de la feuille
 * Réglages (mobile). En ligne seulement : tirer le lien, le purger, régler les
 * versions antérieures (P8, P9).
 */

const toReportRow = (read: TournamentReportRead): TournamentReportRow => ({
  includeOpponentNotes: read.include_opponent_notes,
  includeMyNotes: read.include_my_notes,
  showPreviousVersions: read.show_previous_versions,
  token: read.token,
  createdAt: read.created_at,
  versions: read.versions.map((version) => ({ number: version.number, createdAt: version.created_at })),
});

type CallOutcome = { kind: string; value?: TournamentReportRead };

function LinkField({ token, onCopied }: { token: string; onCopied: (outcome: CopyOutcome) => void }) {
  const link = reportLink(token);
  return (
    <div className="report-link-field">
      <span className="report-link-field__text" title={link} data-testid="report-link">
        {link}
      </span>
      <button
        type="button"
        className="report-link-field__copy"
        aria-label="Copier le lien"
        onClick={async () => onCopied(await copyText(link, browserClipboard()))}
        data-testid="report-link-copy"
      >
        <CopyIcon size={16} aria-hidden="true" /> Copier
      </button>
    </div>
  );
}

export function ShareGroup({
  tournamentId,
  report,
  onChange,
}: {
  tournamentId: number | null;
  report: TournamentReportRow | null;
  onChange: (report: TournamentReportRow) => void;
}) {
  const client = useApiClient();
  const online = useConnectivity();
  const action = useGuardedAction();
  const previousId = useId();
  const [copied, setCopied] = useState<CopyOutcome | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const hasVersion = (report?.versions.length ?? 0) > 0;
  const blocked = !online
    ? "Le partage demande une connexion."
    : tournamentId === null || !hasVersion
      ? "Mettez le compte-rendu à jour, puis synchronisez, avant de le partager."
      : null;

  const call = (task: () => Promise<CallOutcome>) =>
    action.run(async () => {
      setFailure(null);
      const outcome = await task();
      if (outcome.kind === "ok" && outcome.value) onChange(toReportRow(outcome.value));
      else setFailure("L'opération n'a pas abouti. Réessayez.");
    });

  return (
    <section className="report-panel__group" data-testid="report-share">
      <h2 className="kicker report-panel__kicker">Lien public</h2>
      <p className="page-meta report-panel__text">
        Toujours la dernière version. Les noms des adversaires et leurs decks y sont publics.
      </p>
      {report?.token ? (
        <LinkField token={report.token} onCopied={setCopied} />
      ) : (
        <button
          type="button"
          className="btn btn-secondary"
          disabled={blocked !== null || action.pending}
          title={blocked ?? undefined}
          onClick={() => void call(() => shareReport(client, tournamentId as number))}
          data-testid="report-link-create"
        >
          <LinkIcon size={16} /> Créer le lien
        </button>
      )}
      {copied && (
        <p className="page-meta report-panel__text" role="status">
          {copied === "copied" ? "Lien copié." : "Sélectionnez le lien pour le copier."}
        </p>
      )}
      {blocked && !report?.token && <p className="page-meta report-panel__text">{blocked}</p>}
      {report && (
        <Switch
          id={previousId}
          label="Montrer les versions antérieures"
          checked={report.showPreviousVersions}
          disabled={!online || action.pending || tournamentId === null}
          onChange={(value) => void call(() => updateReportSettings(client, tournamentId as number, value))}
          data-testid="report-show-previous"
        />
      )}
      {report?.token && (
        <button
          type="button"
          className="btn-danger-text report-panel__purge"
          disabled={!online || action.pending || tournamentId === null}
          onClick={() => void call(() => revokeReportLink(client, tournamentId as number))}
          data-testid="report-link-purge"
        >
          Purger le lien
        </button>
      )}
      {failure && <p className="error-text">{failure}</p>}
    </section>
  );
}
