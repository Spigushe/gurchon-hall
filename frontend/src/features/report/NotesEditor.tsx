import { useId, useState } from "react";
import { PencilSimpleIcon } from "@phosphor-icons/react";
import { useGuardedAction } from "../../components/useGuardedAction";
import { NotesText } from "./ReportView";

/**
 * Une note du compte-rendu, modifiable sur place dans l'aperçu (P1) : celle du
 * tournoi ou celle d'une partie. L'enregistrement passe par la file
 * (`tournament.update`, `game.update`), donc marche hors ligne. Le texte reste
 * du texte : sauts de ligne gardés, rien d'interprété (P2).
 */
export function NotesEditor({
  notes,
  label,
  emptyText,
  onSave,
  testId,
}: {
  notes: string | null;
  label: string;
  emptyText: string;
  onSave: (notes: string | null) => Promise<unknown>;
  testId: string;
}) {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const action = useGuardedAction();
  const save = async () => {
    const value = draft?.trim() === "" ? null : draft;
    if (await action.run(() => onSave(value))) setDraft(null);
  };

  if (draft === null) {
    return (
      <div className="report__notes-editor" data-testid={testId}>
        {notes && notes.trim() !== "" ? (
          <NotesText notes={notes} />
        ) : (
          <p className="page-meta report__notes-empty">{emptyText}</p>
        )}
        <button
          type="button"
          className="btn-ghost report__edit"
          onClick={() => setDraft(notes ?? "")}
          data-testid={`${testId}-edit`}
        >
          <PencilSimpleIcon size={14} aria-hidden="true" /> Modifier
        </button>
      </div>
    );
  }
  return (
    <div className="report__notes-editor" data-testid={testId}>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <textarea
        id={id}
        className="report__textarea"
        rows={6}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        data-testid={`${testId}-input`}
      />
      {action.error && <p className="form-error">{action.error}</p>}
      <div className="report__editor-actions">
        <button type="button" className="btn btn-primary" disabled={action.pending} onClick={() => void save()} data-testid={`${testId}-save`}>
          Enregistrer
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => setDraft(null)}>
          Annuler
        </button>
      </div>
    </div>
  );
}
