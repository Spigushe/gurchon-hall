/** Interrupteur 46×28 (handoff Nocturne) : `<input type="checkbox" role="switch">` stylé. */
export function Switch({
  id,
  checked,
  onChange,
  label,
  hint,
  disabled = false,
  "data-testid": testId,
}: {
  id: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
  "data-testid"?: string;
}) {
  return (
    <label className="switch-row" htmlFor={id}>
      <span className="switch-row__text">
        <span className="switch-row__label">{label}</span>
        {hint && <span className="switch-row__hint">{hint}</span>}
      </span>
      <input
        id={id}
        type="checkbox"
        role="switch"
        className="switch"
        checked={checked}
        disabled={disabled}
        data-testid={testId}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}
