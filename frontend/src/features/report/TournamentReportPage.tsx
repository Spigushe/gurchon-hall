import { useCallback, useMemo, useState } from "react";
import { ArrowLeftIcon } from "@phosphor-icons/react";
import { Link } from "../../app/Link";
import { LoadingState } from "../../components/Loading";
import { useIsDesktop } from "../../components/useIsDesktop";
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
  type ResourceKey,
  type TournamentReportRow,
} from "../../offline/vtes";
import { useDeckCardFacts } from "../decks/useDeckCardFacts";
import { NotesEditor } from "./NotesEditor";
import type { PrintState } from "./printModel";
import { ReportPanel, ReportVersionBar, type ReportSettingsProps, type Selection } from "./ReportSettings";
import { ReportPrint } from "./ReportPrint";
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
 *
 * Mise en page du handoff `COMPTE-RENDU-ECRAN.md` : au bureau, le
 * compte-rendu et un panneau de réglages côte à côte ; au mobile, une barre de
 * version et une feuille « Réglages » (`ReportSettings.tsx`).
 */

function usePreview(
  tournament: LocalTournament,
  includeOpponentNotes: boolean,
  includeMyNotes: boolean,
  myDisplayName: string | null,
) {
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
        myDisplayName,
      }),
      games: orderedGames(games),
    };
  }, [tournament, includeOpponentNotes, includeMyNotes, myDisplayName, games, players, venues, decks, deckCards, deckVersions, clans]);
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

/** Pseudo et nom à afficher du compte, lus dans la copie locale de `GET /moi` (hors ligne). */
function useAccountNames(): { username: string | null; displayName: string | null } {
  const { db } = useVtesOffline();
  const query = useCallback(() => readLocalAccount(db), [db]);
  const account = useLiveQuery(query);
  return { username: account?.username ?? null, displayName: account?.display_name ?? null };
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

/** La trame d'écran, avec les notes modifiables dans l'aperçu. */
function ReportContent({
  author,
  tournament,
  shown,
  facts,
  selected,
  versionsLoaded,
  versionLabel,
  previewGames,
}: {
  author: string | null;
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
      author={author}
      versionLabel={versionLabel}
      showVersionBadge
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
  const desktop = useIsDesktop();
  const { username, displayName } = useAccountNames();
  const [today] = useState(() => new Date().toISOString());
  const [serverReport, setServerReport] = useState<TournamentReportRow | null>(null);
  const report = serverReport ?? tournament.report;
  const [includeNotes, setIncludeNotes] = useState(report?.includeOpponentNotes ?? false);
  const [includeMine, setIncludeMine] = useState(report?.includeMyNotes ?? true);
  const preview = usePreview(tournament, includeNotes, includeMine, displayName);
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

  const settings: ReportSettingsProps = {
    tournament,
    report,
    selected,
    onSelect: setSelected,
    includeNotes,
    onIncludeNotes: setIncludeNotes,
    includeMine,
    onIncludeMine: setIncludeMine,
    diffText: previewDiffText(same, latest),
    onReportRead: setServerReport,
  };
  const content = (
    <ReportContent
      author={username}
      tournament={tournament}
      shown={shown}
      facts={facts}
      selected={selected}
      versionsLoaded={versions !== undefined}
      versionLabel={versionLabelOf(selected, report)}
      previewGames={preview?.games ?? null}
    />
  );

  return (
    <>
      {desktop ? (
        <div className="cr-screen report-layout">
          <div className="report-layout__main">{content}</div>
          <ReportPanel {...settings} />
        </div>
      ) : (
        <div className="cr-screen report-mobile">
          <ReportVersionBar {...settings} />
          {content}
        </div>
      )}
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
