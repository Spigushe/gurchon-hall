import { useEffect, useMemo, useState } from "react";
import { PrinterIcon } from "@phosphor-icons/react";
import { LoadingState } from "../../components/Loading";
import { cardDetailRowOf, cardRowOf } from "../../offline/vtes/refresh";
import type { DeckCardFacts } from "../decks/deckTablesModel";
import { parsePublicReportHash } from "./publicReportRoute";
import { usePublicReport, type PublicTournamentReport } from "./reportApi";
import { versionDate } from "./reportModel";
import { ReportPrint } from "./ReportPrint";
import { ReportView } from "./ReportView";

/**
 * Page publique d'un compte-rendu (lot Compte-rendu, P8, P9), montée par `Root`
 * sans `AuthGate`, comme une liste partagée du Lot 13 : ni session, ni base
 * IndexedDB, ni moteur de sync. Tout vient de `GET /comptes-rendus/{token}`.
 *
 * Une version antérieure se choisit dans la page, quand l'auteur les montre ;
 * elle ne passe **jamais** dans l'adresse (P9), qui reste
 * `#/compte-rendu/<jeton>` et rouvre toujours la dernière version.
 */

function useNoIndex(title: string | null) {
  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex";
    document.head.appendChild(meta);
    return () => meta.remove();
  }, []);
  useEffect(() => {
    if (title === null) return;
    const previous = document.title;
    document.title = title;
    return () => {
      document.title = previous;
    };
  }, [title]);
}

/** Le cadre de la page : l'écran (`.cr-screen`), et la page imprimée à côté quand elle existe. */
function Frame({ title, children, print }: { title: string | null; children: React.ReactNode; print?: React.ReactNode }) {
  useNoIndex(title);
  return (
    <main className="public-list public-report" data-testid="public-report">
      <div className="cr-screen">
        <p className="kicker public-list__brand">Gurchon Hall</p>
        {children}
        <footer className="public-list__footer page-meta">
          Compte-rendu partagé depuis Gurchon Hall. <a href="/">Ouvrir l'application</a>
        </footer>
      </div>
      {print}
    </main>
  );
}

function printStateOf(report: PublicTournamentReport) {
  if (report.number === report.latest_number) {
    return { kind: "version" as const, number: report.number, createdAt: report.created_at };
  }
  const latest = report.versions.find((version) => version.number === report.latest_number);
  return {
    kind: "older" as const,
    number: report.number,
    createdAt: report.created_at,
    latestNumber: report.latest_number,
    latestCreatedAt: latest?.created_at ?? report.created_at,
  };
}

function PrintedReport({ report }: { report: PublicTournamentReport }) {
  const facts = useMemo(() => factsOf(report), [report]);
  return <ReportPrint snapshot={report.snapshot} facts={facts} author={report.author} state={printStateOf(report)} />;
}

function Message({ title, text, testId }: { title: string; text: string; testId: string }) {
  return (
    <section className="public-list__message">
      <h1 className="page-title" data-testid={testId}>
        {title}
      </h1>
      <p className="page-meta">{text}</p>
    </section>
  );
}

function factsOf(report: PublicTournamentReport): Map<number, DeckCardFacts> {
  return new Map(report.cards.map((card) => [card.id, { card: cardRowOf(card), details: cardDetailRowOf(card) }] as const));
}

function ReadyReport({
  report,
  onSelect,
}: {
  report: PublicTournamentReport;
  onSelect: (number: number | null) => void;
}) {
  const facts = useMemo(() => factsOf(report), [report]);
  const label =
    report.number === report.latest_number
      ? `version ${report.number} du ${versionDate(report.created_at)}`
      : `version ${report.number} sur ${report.latest_number}, du ${versionDate(report.created_at)}`;
  return (
    <>
      <div className="public-report__actions report-panel__actions">
        <button type="button" className="btn btn-secondary" onClick={() => window.print()} data-testid="public-report-print">
          <PrinterIcon size={16} /> Imprimer ou enregistrer en PDF
        </button>
      </div>
      {report.versions.length > 1 && (
        <div className="chip-row report__versions" role="group" aria-label="Version affichée" data-testid="public-report-versions">
          {report.versions.map((version) => (
            <button
              key={version.number}
              type="button"
              className="chip"
              aria-pressed={version.number === report.number}
              onClick={() => onSelect(version.number === report.latest_number ? null : version.number)}
              data-testid="public-report-version"
            >
              v{version.number} · {versionDate(version.created_at)}
            </button>
          ))}
        </div>
      )}
      {report.number !== report.latest_number && (
        <p className="report-panel__pending" role="status" data-testid="public-report-older">
          Version antérieure : la dernière est la version {report.latest_number}.
        </p>
      )}
      <ReportView snapshot={report.snapshot} facts={facts} author={report.author} versionLabel={label} />
    </>
  );
}

function LoadedReport({ token }: { token: string }) {
  const [number, setNumber] = useState<number | null>(null);
  const state = usePublicReport(token, number);
  switch (state.kind) {
    case "loading":
      return (
        <Frame title={null}>
          <LoadingState groups={2} caption="Chargement du compte-rendu…" />
        </Frame>
      );
    case "ready":
      return (
        <Frame
          title={`Compte-rendu · ${state.report.snapshot.tournament.name}`}
          print={<PrintedReport report={state.report} />}
        >
          <ReadyReport report={state.report} onSelect={setNumber} />
        </Frame>
      );
    case "not-found":
      return (
        <Frame title="Compte-rendu introuvable">
          <Message title="Compte-rendu introuvable." text="Le lien a peut-être été retiré par son auteur." testId="public-report-not-found" />
        </Frame>
      );
    case "offline":
      return (
        <Frame title={null}>
          <Message title="Ce compte-rendu demande une connexion au réseau." text="Réessayez une fois connecté." testId="public-report-offline" />
        </Frame>
      );
    case "rate-limited":
      return (
        <Frame title={null}>
          <Message
            title={state.retryAfter === null ? "Trop de demandes, réessayez dans un moment." : `Trop de demandes, réessayez dans ${state.retryAfter} s`}
            text="La page limite les lectures répétées."
            testId="public-report-rate-limited"
          />
        </Frame>
      );
    case "error":
      return (
        <Frame title={null}>
          <Message title="Le compte-rendu n'a pas pu être lu." text="Réessayez dans un moment." testId="public-report-error" />
        </Frame>
      );
  }
}

export function PublicReportPage({ hash }: { hash: string }) {
  const route = parsePublicReportHash(hash);
  if (route.kind !== "report") {
    return (
      <Frame title={null}>
        <Message title="Lien invalide." text="Vérifiez l'adresse du compte-rendu." testId="public-report-invalid" />
      </Frame>
    );
  }
  return <LoadedReport key={route.token} token={route.token} />;
}
