import { Pill } from "../../../components/Pill";
import { useIsDesktop } from "../../../components/useIsDesktop";

/**
 * Pied des deux étapes de l'import, sur le patron de « Nouveau deck » : au
 * mobile, une pilule et sa légende ; au bureau, « Annuler » et l'action
 * principale alignés à droite (`.sheet__footer`).
 */
export function ImportFooter({
  label,
  disabled,
  busy = false,
  onClick,
  onCancel,
  hint,
  testId,
}: {
  label: string;
  disabled: boolean;
  busy?: boolean;
  onClick: () => void;
  onCancel: () => void;
  hint?: string;
  testId: string;
}) {
  const isDesktop = useIsDesktop();
  if (isDesktop) {
    return (
      <div className="sheet__footer">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>
          Annuler
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={disabled}
          aria-busy={busy}
          data-testid={testId}
          onClick={onClick}
        >
          {label}
        </button>
      </div>
    );
  }
  return (
    <div className="sheet-form__footer">
      <Pill disabled={disabled} data-testid={testId} onClick={onClick}>
        {label}
      </Pill>
      {hint && <p className="floating-hint">{hint}</p>}
    </div>
  );
}
