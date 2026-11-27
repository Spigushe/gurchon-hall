import { useId, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import {
  ArrowClockwiseIcon,
  ClockCountdownIcon,
  PrinterIcon,
  SlidersHorizontalIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { Sheet, SheetHeader } from "../../components/Sheet";
import { Switch } from "../../components/Switch";
import { useGuardedAction } from "../../components/useGuardedAction";
import {
  useVtesOffline,
  type LocalTournament,
  type ReportVersionRow,
  type TournamentReportPatch,
  type TournamentReportRow,
} from "../../offline/vtes";
import { ShareGroup } from "./ReportShare";
import { versionDate } from "./reportModel";

/**
 * Les réglages du compte-rendu du propriétaire (handoff
 * `COMPTE-RENDU-ECRAN.md`) : au bureau un panneau en place à côté du
 * compte-rendu, au mobile une barre de version au-dessus et une feuille
 * « Réglages » qui porte le reste. `TournamentReportPage` choisit la forme par
 * `useIsDesktop()` : c'est une autre interaction, pas seulement un autre style.
 */

export type Selection = "preview" | number;

export interface ReportSettingsProps {
  tournament: LocalTournament;
  report: TournamentReportRow | null;
  selected: Selection;
  onSelect: (selection: Selection) => void;
  includeNotes: boolean;
  onIncludeNotes: (value: boolean) => void;
  includeMine: boolean;
  onIncludeMine: (value: boolean) => void;
  /** La phrase qui compare l'aperçu à la dernière version, ou `null`. */
  diffText: string | null;
  onReportRead: (report: TournamentReportRow) => void;
}

/** La demande « Mettre à jour » : ne porte que les réglages qui ont changé. */
function updateRequest(
  report: TournamentReportRow | null,
  includeNotes: boolean,
  includeMine: boolean,
): TournamentReportPatch {
  const opponents = includeNotes !== (report?.includeOpponentNotes ?? false);
  const mine = includeMine !== (report?.includeMyNotes ?? true);
  return {
    action: "update",
    ...(opponents ? { includeOpponentNotes: includeNotes } : {}),
    ...(mine ? { includeMyNotes: includeMine } : {}),
  };
}

function SelectionBar({
  versions,
  selected,
  onSelect,
}: {
  versions: readonly ReportVersionRow[] | readonly { number: number; createdAt: string }[];
  selected: Selection;
  onSelect: (selection: Selection) => void;
}) {
  return (
    <div className="chip-row report__versions" role="group" aria-label="Version affichée" data-testid="report-versions">
      {versions.map((version) => (
        <button
          key={version.number}
          type="button"
          className="chip"
          aria-pressed={selected === version.number}
          onClick={() => onSelect(version.number)}
          data-testid="report-version"
        >
          v{version.number} · {versionDate(version.createdAt)}
        </button>
      ))}
      <button
        type="button"
        className="chip"
        aria-pressed={selected === "preview"}
        onClick={() => onSelect("preview")}
        data-testid="report-version-preview"
      >
        Aperçu
      </button>
    </div>
  );
}

/** La phrase d'état : l'aperçu se modifie, une version figée se lit. */
function StatusPhrase({ selected, diffText }: { selected: Selection; diffText: string | null }) {
  if (selected !== "preview") {
    return (
      <p className="report-panel__status" data-testid="report-status">
        Version figée, en lecture seule. Passez sur l'aperçu pour modifier les notes.
      </p>
    );
  }
  return (
    <p className="report-panel__status" data-testid="report-status">
      {diffText && (
        <>
          <span data-testid="report-preview-diff">{diffText}</span>{" "}
        </>
      )}
      Les notes se modifient sur place.
    </p>
  );
}

function PendingNotice({ tournament }: { tournament: LocalTournament }) {
  if (tournament.reportRequest !== "update") return null;
  return (
    <p className="report-panel__pending" role="status" data-testid="report-pending">
      <ClockCountdownIcon size={14} aria-hidden="true" /> Mise à jour en attente : la version sera figée à la
      synchronisation.
    </p>
  );
}

/** « Mettre à jour » : la demande part dans la file, puis l'écran revient sur l'aperçu. */
function useUpdateRequest({ tournament, report, includeNotes, includeMine, onSelect }: ReportSettingsProps) {
  const { actions } = useVtesOffline();
  const update = useGuardedAction();
  const run = () =>
    update.run(async () => {
      await actions.updateTournament(tournament.key, { report: updateRequest(report, includeNotes, includeMine) });
      onSelect("preview");
    });
  return { run, pending: update.pending, error: update.error };
}

type UpdateRequest = ReturnType<typeof useUpdateRequest>;

function UpdateButton({ request, label }: { request: UpdateRequest; label: string }) {
  return (
    <button
      type="button"
      className="btn btn-primary report-panel__update"
      disabled={request.pending}
      onClick={() => void request.run()}
      data-testid="report-update"
    >
      <ArrowClockwiseIcon size={16} aria-hidden="true" /> {label}
    </button>
  );
}

function PrintButton({ onBeforePrint }: { onBeforePrint?: () => void }) {
  return (
    <button
      type="button"
      className="btn btn-secondary"
      onClick={() => {
        onBeforePrint?.();
        window.print();
      }}
      data-testid="report-print"
    >
      <PrinterIcon size={16} /> Imprimer ou enregistrer en PDF
    </button>
  );
}

function NotesOptions({
  includeNotes,
  onIncludeNotes,
  includeMine,
  onIncludeMine,
}: Pick<ReportSettingsProps, "includeNotes" | "onIncludeNotes" | "includeMine" | "onIncludeMine">) {
  const opponentsId = useId();
  const mineId = useId();
  return (
    <div className="report-panel__group report-panel__options" data-testid="report-notes-options">
      <Switch
        id={opponentsId}
        label="Inclure les notes sur les adversaires"
        hint="Prises en compte à la prochaine mise à jour. Elles se saisissent dans le formulaire de partie."
        checked={includeNotes}
        onChange={onIncludeNotes}
        data-testid="report-include-notes"
      />
      <Switch
        id={mineId}
        label="Inclure mes notes de table"
        hint="Prises en compte à la prochaine mise à jour."
        checked={includeMine}
        onChange={onIncludeMine}
        data-testid="report-include-my-notes"
      />
    </div>
  );
}

/** « Supprimer le compte-rendu… » : la confirmation reste, l'aide est montrée avant le clic. */
function DeleteGroup({ tournament, onDeleted }: { tournament: LocalTournament; onDeleted?: () => void }) {
  const { actions } = useVtesOffline();
  const remove = useGuardedAction();
  const askDelete = async () => {
    if (!window.confirm("Supprimer le compte-rendu, ses versions et son lien ? Les notes du tournoi et des parties restent.")) return;
    if (await remove.run(() => actions.updateTournament(tournament.key, { report: { action: "delete" } }))) onDeleted?.();
  };
  return (
    <div className="report-panel__group report-panel__delete">
      <button type="button" className="btn-danger-text" onClick={() => void askDelete()} disabled={remove.pending} data-testid="report-delete">
        <TrashIcon size={14} /> Supprimer le compte-rendu…
      </button>
      <p className="report-panel__hint">Les notes du tournoi et des parties restent.</p>
      {remove.error && <p className="error-text">{remove.error}</p>}
    </div>
  );
}

/** Un groupe de réglages, kicker compris. */
function Group({ kicker, testId, children }: { kicker: string; testId?: string; children: ReactNode }) {
  return (
    <section className="report-panel__group" data-testid={testId}>
      <h2 className="kicker report-panel__kicker">{kicker}</h2>
      {children}
    </section>
  );
}

/** Le panneau du bureau : version affichée, actions, options, lien public, suppression. */
export function ReportPanel(props: ReportSettingsProps) {
  const { tournament, report, selected, onSelect, diffText, onReportRead } = props;
  const request = useUpdateRequest(props);
  return (
    <aside className="report-panel" data-testid="report-panel">
      <Group kicker="Version affichée" testId="report-version-group">
        {report && report.versions.length > 0 && (
          <SelectionBar versions={report.versions} selected={selected} onSelect={onSelect} />
        )}
        <StatusPhrase selected={selected} diffText={diffText} />
      </Group>
      <div className="report-panel__group report-panel__actions-group">
        <UpdateButton request={request} label="Mettre à jour le compte-rendu" />
        <PrintButton />
        <PendingNotice tournament={tournament} />
        {request.error && <p className="error-text">{request.error}</p>}
      </div>
      <NotesOptions {...props} />
      <ShareGroup tournamentId={tournament.id} report={report} onChange={onReportRead} />
      {report && <DeleteGroup tournament={tournament} />}
    </aside>
  );
}

/** La feuille Réglages du mobile : options, impression, lien public, suppression. */
function ReportSheet({ onClose, ...props }: ReportSettingsProps & { onClose: () => void }) {
  const { tournament, report, onReportRead } = props;
  const titleId = useId();
  const titleRef = useRef<HTMLHeadingElement>(null);
  return (
    <Sheet titleId={titleId} titleRef={titleRef} onClose={onClose} className="report-sheet" data-testid="report-settings-sheet">
      <SheetHeader title="Réglages" titleId={titleId} titleRef={titleRef} onClose={onClose} />
      <NotesOptions {...props} />
      <PrintButton onBeforePrint={() => flushSync(onClose)} />
      <ShareGroup tournamentId={tournament.id} report={report} onChange={onReportRead} />
      {report && <DeleteGroup tournament={tournament} onDeleted={onClose} />}
    </Sheet>
  );
}

/** La barre de version du mobile : puces, état, « Mettre à jour » et « Réglages ». */
export function ReportVersionBar(props: ReportSettingsProps) {
  const { tournament, report, selected, onSelect, diffText } = props;
  const request = useUpdateRequest(props);
  const [open, setOpen] = useState(false);
  return (
    <div className="report-bar" data-testid="report-version-bar">
      {report && report.versions.length > 0 && (
        <div className="report-bar__chips">
          <SelectionBar versions={report.versions} selected={selected} onSelect={onSelect} />
        </div>
      )}
      <StatusPhrase selected={selected} diffText={diffText} />
      <div className="report-bar__actions">
        <UpdateButton request={request} label="Mettre à jour" />
        <button type="button" className="btn btn-secondary" onClick={() => setOpen(true)} data-testid="report-settings-open">
          <SlidersHorizontalIcon size={16} aria-hidden="true" /> Réglages
        </button>
      </div>
      <PendingNotice tournament={tournament} />
      {request.error && <p className="error-text">{request.error}</p>}
      {open && <ReportSheet {...props} onClose={() => setOpen(false)} />}
    </div>
  );
}
