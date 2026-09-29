import { useId } from "react";

/**
 * Bouton − / champ numérique étiqueté / bouton + (handoff Nocturne).
 *
 * `label` est l'intitulé accessible du champ (« Exemplaires possédés »,
 * « Quantité dans le deck »…) : c'est lui qui porte l'étiquette, les boutons
 * ont leurs propres `aria-label` explicites (« Retirer un exemplaire de … »).
 */
export function Stepper({
  value,
  onChange,
  label,
  decrementLabel,
  incrementLabel,
  min,
  max,
  disabled = false,
  variant = "form",
}: {
  value: number;
  onChange: (next: number) => void;
  label: string;
  decrementLabel?: string;
  incrementLabel?: string;
  min?: number;
  max?: number;
  disabled?: boolean;
  variant?: "form" | "row";
}) {
  const inputId = useId();
  const atMin = min !== undefined && value <= min;
  const atMax = max !== undefined && value >= max;

  const commit = (raw: string) => {
    if (raw.trim() === "") return;
    const next = Number(raw);
    if (Number.isNaN(next)) return;
    onChange(next);
  };

  return (
    <div className={`stepper-field`}>
      <span className="stepper-field__label" id={`${inputId}-label`}>
        {label}
      </span>
      <div className={`stepper stepper--${variant}`}>
        <button
          type="button"
          className="stepper__btn"
          aria-label={decrementLabel ?? `Retirer : ${label}`}
          disabled={disabled || atMin}
          onClick={() => onChange(value - 1)}
        >
          −
        </button>
        <input
          id={inputId}
          type="number"
          className="stepper__value"
          aria-labelledby={`${inputId}-label`}
          value={value}
          min={min}
          max={max}
          disabled={disabled}
          onChange={(event) => commit(event.target.value)}
        />
        <button
          type="button"
          className="stepper__btn stepper__btn--accent"
          aria-label={incrementLabel ?? `Ajouter : ${label}`}
          disabled={disabled || atMax}
          onClick={() => onChange(value + 1)}
        >
          +
        </button>
      </div>
    </div>
  );
}
