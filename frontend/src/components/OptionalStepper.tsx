import { useId } from "react";

/**
 * `Stepper` dont la valeur peut rester vide (Lot 7, D2) : rondes prévues et nombre de
 * joueurs d'un tournoi, souvent inconnus à l'arrivée. Vide par défaut ; `+` part de
 * `min`, `−` au minimum revient à vide, et effacer le champ aussi. Mêmes classes que
 * `Stepper`, pour le même rendu.
 */
export function OptionalStepper({
  value,
  onChange,
  label,
  min = 1,
  hint,
  "data-testid": testId,
}: {
  value: number | null;
  onChange: (next: number | null) => void;
  label: string;
  min?: number;
  hint?: string;
  "data-testid"?: string;
}) {
  const inputId = useId();

  const commit = (raw: string) => {
    if (raw.trim() === "") {
      onChange(null);
      return;
    }
    const next = Math.round(Number(raw));
    if (Number.isNaN(next)) return;
    onChange(Math.max(min, next));
  };

  return (
    <div className="stepper-field" data-testid={testId}>
      <span className="stepper-field__label" id={`${inputId}-label`}>
        {label}
      </span>
      <div className="stepper stepper--form">
        <button
          type="button"
          className="stepper__btn"
          aria-label={`Retirer : ${label}`}
          disabled={value === null}
          onClick={() => onChange(value === null || value <= min ? null : value - 1)}
        >
          −
        </button>
        <input
          id={inputId}
          type="number"
          className="stepper__value"
          aria-labelledby={`${inputId}-label`}
          aria-describedby={hint ? `${inputId}-hint` : undefined}
          value={value ?? ""}
          min={min}
          step={1}
          placeholder="—"
          onChange={(event) => commit(event.target.value)}
        />
        <button
          type="button"
          className="stepper__btn stepper__btn--accent"
          aria-label={`Ajouter : ${label}`}
          onClick={() => onChange(value === null ? min : value + 1)}
        >
          +
        </button>
      </div>
      {hint && (
        <p className="hint" id={`${inputId}-hint`}>
          {hint}
        </p>
      )}
    </div>
  );
}
