import { useCallback, useMemo, useState } from "react";
import { ArrowLeftIcon, ClockCountdownIcon, LinkIcon, PrinterIcon, TrashIcon } from "@phosphor-icons/react";
import { useApiClient } from "../../app/apiClientContext";
import { Link } from "../../app/Link";
import { LoadingState } from "../../components/Loading";
import { useGuardedAction } from "../../components/useGuardedAction";
import { useConnectivity } from "../../offline/react";
import { useLiveQuery } from "../../offline/react/useLiveQuery";
import {
  findByKey,
  readLocalAccount,
  useLocalAllDeckVersions,
  useLocalClans,
  useLocalDeckCardsByDeck,
  useLocalDecks,
  useLocalGames,
  useLocalPlayers,
  useLocalReportVersions,
  useLocalTournament,
  useLocalVenues,
  useVtesOffline,
  type LocalTournament,
  type ReportVersionRow,
  type ResourceKey,
  type TournamentReportPatch,
  type TournamentReportRow,
} from "../../offline/vtes";
import { browserClipboard, copyText, type CopyOutcome } from "../decks/export/exportFile";
import { useDeckCardFacts } from "../decks/useDeckCardFacts";
import { NotesEditor } from "./NotesEditor";
import type { PrintState } from "./printModel";
import { ReportPrint } from "./ReportPrint";
import { reportLink, revokeReportLink, shareReport, updateReportSettings, type TournamentReportRead } from "./reportApi";
import { buildPreview, orderedGames, sameSnapshot, versionDate, type ReportSnapshot } from "./reportModel";
import { ReportView } from "./ReportView";

/**
 * Le compte-rendu d'un tournoi dans l'application (lot Compte-rendu,
 * `#/tournois/<clé>/compte-rendu`). Hors ligne : lire les versions du miroir,
 * voir l'**aperçu** de la prochaine, modifier les notes du tournoi et des
 * parties sur place, demander « Mettre à jour le compte-rendu » et régler les
 * notes sur les adversaires (P4, P7) ; tout passe par la file. En ligne
 * seulement : le lien public et le réglage des versions antérieures (P8, P9).
 * Le PDF est l'impression de la page (P11).
 */

type Selection = "preview" | number;

const toReportRow = (read: TournamentReportRead): TournamentReportRow => ({
  includeOpponentNotes: read.include_opponent_notes,
  includeMyNotes: read.include_my_notes,
  showPreviousVersions: read.show_previous_versions,
  token: read.token,
  createdAt: read.created_at,
  versions: read.versions.map((version) => ({ number: version.number, createdAt: version.created_at })),
});

function usePreview(tournament: LocalTournament, includeOpponentNotes: boolean, includeMyNotes: boolean) {
  const games = useLocalGames({ tournamentKey: tournament.key });
  const players = useLocalPlayers();
  const venues = useLocalVenues();
  const decks = useLocalDecks({ state: "all" });
  const deckCards = useLocalDeckCardsByDeck();
  const deckVersions = useLocalAllDeckVersions();
  const clans = useLocalClans();
  return useMemo(() => {
    if (!games || !players || !venues || !decks || !deckCards || !deckVersions || !clans) return null;
    const venue = tournament.venueKey === null ? null : (findByKey(venues, tournament.venueKey) ?? null);
    return {
      snapshot: buildPreview({
        tournament,
        venue,
        games,
        players,
        decks,
        deckVersions,
        deckCards,
        clans,
        includeOpponentNotes,
        includeMyNotes,
      }),
      games: orderedGames(games),
    };
  }, [tournament, includeOpponentNotes, includeMyNotes, games, players, venues, decks, deckCards, deckVersions, clans]);
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

function ShareBlock({
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
  const [copied, setCopied] = useState<CopyOutcome | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const hasVersion = (report?.versions.length ?? 0) > 0;
  const blocked = !online
    ? "Le partage demande une connexion."
    : tournamentId === null || !hasVersion
      ? "Mettez le compte-rendu à jour, puis synchronisez, avant de le partager."
      : null;

  const call = (task: () => Promise<{ kind: string; value?: TournamentReportRead }>) =>
    action.run(async () => {
      setFailure(null);
      const outcome = await task();
      if (outcome.kind === "ok" && outcome.value) onChange(toReportRow(outcome.value));
      else setFailure("L'opération n'a pas abouti. Réessayez.");
    });

  return (
    <section className="report-panel__block" data-testid="report-share">
      <h2 className="report-panel__title">Lien public</h2>
      <p className="page-meta">
        Toujours la dernière version. Les noms des adversaires et leurs decks y sont publics.
      </p>
      {report?.token ? (
        <>
          <p className="report-panel__link" data-testid="report-link">
            {reportLink(report.token)}
          </p>
          <div className="report-panel__actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={async () => setCopied(await copyText(reportLink(report.token as string), browserClipboard()))}
              data-testid="report-link-copy"
            >
              <LinkIcon size={16} /> Copier le lien
            </button>
            <button
              type="button"
              className="btn-danger-text"
              disabled={!online || action.pending || tournamentId === null}
              onClick={() => void call(() => revokeReportLink(client, tournamentId as number))}
              data-testid="report-link-purge"
            >
              Purger le lien
            </button>
          </div>
          {copied && <p className="page-meta" role="status">{copied === "copied" ? "Lien copié." : "Sélectionnez le lien pour le copier."}</p>}
        </>
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
      {blocked && !report?.token && <p className="page-meta">{blocked}</p>}
      {report && (
        <label className="switch-row">
          <input
            type="checkbox"
            checked={report.showPreviousVersions}
            disabled={!online || action.pending || tournamentId === null}
            onChange={(event) => {
              const value = event.target.checked;
              void call(() => updateReportSettings(client, tournamentId as number, value));
            }}
            data-testid="report-show-previous"
          />
          Montrer les versions antérieures par le lien
        </label>
      )}
      {failure && <p className="error-text">{failure}</p>}
    </section>
  );
}

/** Ce que l'impression marque : version, version antérieure ou aperçu (handoff, « États »). */
function printStateOf(selected: Selection, report: TournamentReportRow | null, today: string): PrintState {
  const versions = report?.versions ?? [];
  const latest = versions.at(-1);
  const chosen = selected === "preview" ? undefined : versions.find((version) => version.number === selected);
  if (!chosen || !latest) return { kind: "preview", date: today };
  if (chosen.number === latest.number) return { kind: "version", number: chosen.number, createdAt: chosen.createdAt };
  return {
    kind: "older",
    number: chosen.number,
    createdAt: chosen.createdAt,
    latestNumber: latest.number,
    latestCreatedAt: latest.createdAt,
  };
}

function useUsername(): string | null {
  const { db } = useVtesOffline();
  const query = useCallback(() => readLocalAccount(db), [db]);
  return useLiveQuery(query)?.username ?? null;
}

/** La phrase qui compare l'aperçu à la dernière version, ou rien. */
function previewDiffText(same: boolean | null, latest: number | null): string | null {
  if (same === null) return null;
  return same
    ? `L'aperçu ne diffère pas de la version ${latest} : « Mettre à jour » ne créerait pas de version.`
    : `L'aperçu diffère de la version ${latest}.`;
}

function versionLabelOf(selected: Selection, report: TournamentReportRow | null): string {
  if (selected === "preview") return "Aperçu, non synchronisé";
  const createdAt = report?.versions.find((version) => version.number === selected)?.createdAt ?? "";
  return `Version ${selected} du ${versionDate(createdAt)}`;
}

/** L'en-tête d'actions : mise à jour, impression, état, option, versions, lien, suppression. */
function ReportControls({
  tournament,
  report,
  selected,
  onSelect,
  includeNotes,
  onIncludeNotes,
  includeMine,
  onIncludeMine,
  diffText,
  onReportRead,
}: {
  tournament: LocalTournament;
  report: TournamentReportRow | null;
  selected: Selection;
  onSelect: (selection: Selection) => void;
  includeNotes: boolean;
  onIncludeNotes: (value: boolean) => void;
  includeMine: boolean;
  onIncludeMine: (value: boolean) => void;
  diffText: string | null;
  onReportRead: (report: TournamentReportRow) => void;
}) {
  const { actions } = useVtesOffline();
  const update = useGuardedAction();
  const remove = useGuardedAction();
  const askUpdate = () =>
    update.run(async () => {
      await actions.updateTournament(tournament.key, {
        report: updateRequest(report, includeNotes, includeMine),
      });
      onSelect("preview");
    });
  const askDelete = () => {
    if (!window.confirm("Supprimer le compte-rendu, ses versions et son lien ? Les notes du tournoi et des parties restent.")) return;
    void remove.run(() => actions.updateTournament(tournament.key, { report: { action: "delete" } }));
  };
  const error = update.error ?? remove.error;
  return (
    <div className="report-panel" data-testid="report-panel">
      <div className="report-panel__actions">
        <button type="button" className="btn btn-primary" disabled={update.pending} onClick={() => void askUpdate()} data-testid="report-update">
          Mettre à jour le compte-rendu
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => window.print()} data-testid="report-print">
          <PrinterIcon size={16} /> Imprimer ou enregistrer en PDF
        </button>
      </div>
      {tournament.reportRequest === "update" && (
        <p className="report-panel__pending" role="status" data-testid="report-pending">
          <ClockCountdownIcon size={14} aria-hidden="true" /> Mise à jour en attente : la version sera figée à la
          synchronisation.
        </p>
      )}
      {selected === "preview" && diffText && (
        <p className="page-meta" data-testid="report-preview-diff">
          {diffText}
        </p>
      )}
      <label className="switch-row">
        <input
          type="checkbox"
          checked={includeNotes}
          onChange={(event) => onIncludeNotes(event.target.checked)}
          data-testid="report-include-notes"
        />
        Inclure les notes sur les adversaires
      </label>
      <p className="page-meta">Les notes sur les adversaires se saisissent dans le formulaire de partie, sur chaque ligne de la table.</p>
      <label className="switch-row">
        <input
          type="checkbox"
          checked={includeMine}
          onChange={(event) => onIncludeMine(event.target.checked)}
          data-testid="report-include-my-notes"
        />
        Inclure mes notes de table
      </label>
      <p className="page-meta">Ma note de table (mon tirage de départ, ce qui ne concerne que moi) se saisit aussi dans le formulaire de partie.</p>
      {report && report.versions.length > 0 && <SelectionBar versions={report.versions} selected={selected} onSelect={onSelect} />}
      <ShareBlock tournamentId={tournament.id} report={report} onChange={onReportRead} />
      {report && (
        <button type="button" className="btn-danger-text" onClick={askDelete} disabled={remove.pending} data-testid="report-delete">
          <TrashIcon size={14} /> Supprimer le compte-rendu
        </button>
      )}
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}

/** La trame d'écran, avec les notes modifiables dans l'aperçu. */
function ReportContent({
  tournament,
  shown,
  facts,
  selected,
  versionsLoaded,
  versionLabel,
  previewGames,
}: {
  tournament: LocalTournament;
  shown: ReportSnapshot | null;
  facts: ReturnType<typeof useDeckCardFacts>;
  selected: Selection;
  versionsLoaded: boolean;
  versionLabel: string;
  previewGames: readonly { key: ResourceKey }[] | null;
}) {
  const { actions } = useVtesOffline();
  if (shown === null || facts === undefined) {
    return selected !== "preview" && versionsLoaded ? (
      <p className="page-meta" data-testid="report-version-missing">
        Cette version n'est pas encore chargée sur cet appareil.
      </p>
    ) : (
      <LoadingState groups={2} caption="Chargement du compte-rendu…" />
    );
  }
  const editing = selected === "preview";
  return (
    <ReportView
      snapshot={shown}
      facts={facts}
      author={null}
      versionLabel={versionLabel}
      renderTournamentNotes={
        editing
          ? (notes) => (
              <NotesEditor
                notes={notes}
                label="Notes du tournoi"
                emptyText="Pas encore de notes sur le tournoi."
                onSave={(value) => actions.updateTournament(tournament.key, { notes: value })}
                testId="report-tournament-notes-editor"
              />
            )
          : undefined
      }
      renderRoundNotes={
        editing && previewGames
          ? (index, notes) => (
              <NotesEditor
                notes={notes}
                label="Notes de la partie"
                emptyText="Pas de notes sur cette partie."
                onSave={(value) => actions.updateGame(previewGames[index].key, { fields: { notes: value } })}
                testId="report-round-notes-editor"
              />
            )
          : undefined
      }
    />
  );
}

function ReportBody({ tournament }: { tournament: LocalTournament }) {
  const username = useUsername();
  const [today] = useState(() => new Date().toISOString());
  const [serverReport, setServerReport] = useState<TournamentReportRow | null>(null);
  const report = serverReport ?? tournament.report;
  const [includeNotes, setIncludeNotes] = useState(report?.includeOpponentNotes ?? false);
  const [includeMine, setIncludeMine] = useState(report?.includeMyNotes ?? true);
  const preview = usePreview(tournament, includeNotes, includeMine);
  const versions = useLocalReportVersions(tournament.id);
  const latest = report?.versions.at(-1)?.number ?? null;
  const [selected, setSelected] = useState<Selection>(() =>
    latest !== null && tournament.reportRequest === null ? latest : "preview",
  );

  const snapshotOf = (number: number | null) =>
    number === null ? null : (versions?.find((version) => version.number === number)?.snapshot ?? null);
  const shown = selected === "preview" ? (preview?.snapshot ?? null) : snapshotOf(selected);
  const latestSnapshot = snapshotOf(latest);
  const cardIds = useMemo(() => shown?.decks.flatMap((deck) => deck.cards.map((card) => card.card_id)) ?? [], [shown]);
  const facts = useDeckCardFacts(cardIds);
  const same = preview && latestSnapshot ? sameSnapshot(preview.snapshot, latestSnapshot) : null;

  return (
    <>
      <div className="cr-screen">
        <ReportControls
          tournament={tournament}
          report={report}
          selected={selected}
          onSelect={setSelected}
          includeNotes={includeNotes}
          onIncludeNotes={setIncludeNotes}
          includeMine={includeMine}
          onIncludeMine={setIncludeMine}
          diffText={previewDiffText(same, latest)}
          onReportRead={setServerReport}
        />
        <ReportContent
          tournament={tournament}
          shown={shown}
          facts={facts}
          selected={selected}
          versionsLoaded={versions !== undefined}
          versionLabel={versionLabelOf(selected, report)}
          previewGames={preview?.games ?? null}
        />
      </div>
      {shown !== null && facts !== undefined && (
        <ReportPrint snapshot={shown} facts={facts} author={username} state={printStateOf(selected, report, today)} />
      )}
    </>
  );
}

export function TournamentReportPage({ tournamentKey }: { tournamentKey: ResourceKey }) {
  const tournament = useLocalTournament(tournamentKey);
  if (tournament === undefined) return <LoadingState groups={2} caption="Chargement du compte-rendu…" />;
  if (tournament === null) {
    return (
      <section className="page" data-testid="report-not-found">
        <h1 className="page-title">Tournoi introuvable</h1>
        <Link to={{ name: "tournaments" }}>Retour aux tournois</Link>
      </section>
    );
  }
  return (
    <section className="page report-page" data-testid="report-page">
      <div className="report-page__top cr-screen">
        <Link to={{ name: "tournament", key: tournament.key }} className="back-link" data-testid="report-back">
          <ArrowLeftIcon size={16} aria-hidden="true" /> {tournament.name}
        </Link>
      </div>
      <ReportBody key={tournament.key} tournament={tournament} />
    </section>
  );
}
