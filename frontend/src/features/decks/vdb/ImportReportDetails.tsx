import type { DecklistFormat, ImportReport } from "../import";
import { lineWord, reportEntries, reportSummary } from "../import/importLabels";

/**
 * Rapport replié de l'aperçu (Lot 9, écran 3) : lignes non reconnues, groupes
 * déduits et versions supposées, chacune avec son numéro de ligne. Rien n'est
 * affiché quand tout a été reconnu sans convention.
 */
export function ImportReportDetails({ report, format }: { report: ImportReport; format: DecklistFormat }) {
  const summary = reportSummary(report);
  if (summary === null) {
    return (
      <p className="hint" data-testid="deck-import-report-empty">
        Toutes les lignes ont été reconnues.
      </p>
    );
  }
  const word = lineWord(format);
  return (
    <details className="deck-import__report" data-testid="deck-import-report">
      <summary data-testid="deck-import-report-summary">Rapport : {summary}</summary>
      <ul className="deck-import__report-list">
        {reportEntries(report).map((entry) => (
          <li
            key={`${entry.kind}-${entry.line}`}
            className={`deck-import__report-item deck-import__report-item--${entry.kind}`}
            data-testid="deck-import-report-line"
            data-kind={entry.kind}
          >
            <span className="deck-import__report-where">
              {word} {entry.line}
            </span>{" "}
            <code className="deck-import__report-text">{entry.text}</code>
            <span className="deck-import__report-message"> — {entry.message}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}
