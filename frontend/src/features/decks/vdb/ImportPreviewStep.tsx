import { useId, useMemo, useState } from "react";
import { navigate } from "../../../app/routes";
import { LanguageChips } from "../../../components/LanguageChips";
import { LoadingState } from "../../../components/Loading";
import { useGuardedAction } from "../../../components/useGuardedAction";
import { useVtesOffline, type DeckArchetype, type DeckKey } from "../../../offline/vtes";
import { ArchetypeChips } from "../ArchetypeChips";
import { DeckTables } from "../DeckTables";
import { buildDeckTables } from "../deckTablesModel";
import { useDeckCardFacts } from "../useDeckCardFacts";
import {
  DEFAULT_IMPORT_LANGUAGE,
  importNotes,
  importedDeckName,
  matchDecklist,
  planDeckImport,
  type CardIndex,
  type DeckImportPlan,
} from "../import";
import { FORMAT_LABELS, localDay } from "../import/importLabels";
import { useLanguageOptions } from "../../stock/useLanguageOptions";
import { ImportReportDetails } from "./ImportReportDetails";
import { importEffectText, previewLines, type ImportSelection } from "./importSheetModel";

function PreviewTables({ plan }: { plan: DeckImportPlan }) {
  const lines = useMemo(() => previewLines(plan), [plan]);
  const ids = useMemo(() => lines.map((line) => line.cardId), [lines]);
  const facts = useDeckCardFacts(ids);
  if (!facts) return <LoadingState groups={2} caption="Lecture de la composition — aucun appel réseau." />;
  return <DeckTables tables={buildDeckTables(lines, facts)} showProxies={false} />;
}

/**
 * Étape 2 de la feuille d'import (Lot 9, écran 3) : nom, archétype, langue des
 * proxies et notes, l'effet écrit, la composition en lecture seule et le
 * rapport replié. « Créer le deck » range le deck et ses lignes en une
 * transaction de la file (A4), puis ouvre le deckbuilder.
 */
export function ImportPreviewStep({
  selection,
  index,
  onBack,
}: {
  selection: ImportSelection;
  index: CardIndex;
  onBack: () => void;
}) {
  const id = useId();
  const { actions } = useVtesOffline();
  const action = useGuardedAction();
  const languages = useLanguageOptions();
  const { decklist, vdbDeckId } = selection;
  const [importedOn] = useState(() => localDay(new Date()));
  const [name, setName] = useState(() => importedDeckName(decklist.header));
  const [archetype, setArchetype] = useState<DeckArchetype | null>(null);
  const [languageCode, setLanguageCode] = useState(DEFAULT_IMPORT_LANGUAGE);
  const [notes, setNotes] = useState(() => importNotes(decklist.header, vdbDeckId !== null, importedOn) ?? "");
  const match = useMemo(() => matchDecklist(decklist.lines, index), [decklist, index]);

  const plan = useMemo(() => {
    const planned = planDeckImport(
      { header: decklist.header, unreadable: decklist.unreadable, match },
      { name, archetype, languageCode, vdbDeckId, importedOn },
    );
    return { ...planned, deck: { ...planned.deck, notes: notes.trim() || null } };
  }, [decklist, match, name, archetype, languageCode, vdbDeckId, importedOn, notes]);

  const create = async () => {
    const created: { key: DeckKey | null } = { key: null };
    const done = await action.run(async () => {
      created.key = (await actions.importDeck({ deck: plan.deck, lines: plan.lines })).key;
    });
    if (done && created.key) navigate({ name: "deck", key: created.key });
  };

  return (
    <div className="sheet-form deck-import" data-testid="deck-import-preview">
      <p className="hint" data-testid="deck-import-source">
        {FORMAT_LABELS[decklist.format]}
        {vdbDeckId && ` · le deck restera lié à VDB (${vdbDeckId}) pour se mettre à jour`}
        {" · "}
        <button type="button" className="btn-text" data-testid="deck-import-back" onClick={onBack}>
          changer la liste
        </button>
      </p>
      <div className="field">
        <label htmlFor={`${id}-name`}>Nom du deck</label>
        <input
          id={`${id}-name`}
          className="underline-field"
          value={name}
          onChange={(event) => setName(event.target.value)}
          autoComplete="off"
          data-testid="deck-import-name"
        />
      </div>
      <ArchetypeChips legend="Archétype (facultatif)" value={archetype} onChange={setArchetype} testIdPrefix="deck-import-archetype" />
      <LanguageChips legend="Langue des proxies" value={languageCode} onChange={setLanguageCode} options={languages} />
      <div className="field">
        <label htmlFor={`${id}-notes`}>Notes</label>
        <textarea
          id={`${id}-notes`}
          className="underline-field"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          rows={4}
          data-testid="deck-import-notes"
        />
      </div>
      <p className="quote-block" data-testid="deck-import-effect">
        {importEffectText(plan)}
      </p>
      <ImportReportDetails report={plan.report} format={decklist.format} />
      {plan.lines.length > 0 && <PreviewTables plan={plan} />}
      {action.error && (
        <p className="error-text" role="alert" data-testid="deck-import-create-error">
          {action.error}
        </p>
      )}
      <div className="sheet-form__footer deck-import__footer">
        <button
          type="button"
          className="btn btn-primary"
          disabled={action.pending || plan.lines.length === 0}
          data-testid="deck-import-create"
          onClick={() => void create()}
        >
          Créer le deck
        </button>
        <p className="floating-hint">Créé sur cet appareil, envoyé au prochain réseau</p>
      </div>
    </div>
  );
}
