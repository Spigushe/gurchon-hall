import { useId } from "react";
import { CaretDown } from "@phosphor-icons/react";
import type { LanguageOption } from "../features/stock/useLanguageOptions";

const MAIN_CODES = ["EN", "FR", "ES"];

/**
 * Puces de langue (EN, FR, ES) puis « Autre ⌄ » qui révèle un `<select>` avec
 * le reste de `useLanguageOptions` (handoff Nocturne, écran « Modifier une
 * entrée »).
 */
export function LanguageChips({
  legend,
  value,
  onChange,
  options,
  disabled = false,
}: {
  legend: string;
  value: string;
  onChange: (code: string) => void;
  options: LanguageOption[];
  disabled?: boolean;
}) {
  const groupName = useId();
  const selectId = useId();
  const mainOptions = MAIN_CODES.map((code) => options.find((option) => option.code === code)).filter(
    (option): option is LanguageOption => option !== undefined,
  );
  const otherOptions = options.filter((option) => !MAIN_CODES.includes(option.code));
  const isOther = !MAIN_CODES.includes(value);

  return (
    <fieldset className="language-chips" disabled={disabled}>
      <legend>{legend}</legend>
      <div className="language-chips__row">
        {mainOptions.map((option) => (
          <label key={option.code} className="chip">
            <input
              type="radio"
              name={groupName}
              value={option.code}
              checked={value === option.code}
              onChange={() => onChange(option.code)}
              disabled={disabled}
            />
            {option.code}
          </label>
        ))}
        <label className="chip">
          <input
            type="radio"
            name={groupName}
            checked={isOther}
            onChange={() => {
              const fallback = otherOptions.find((option) => option.code === value) ?? otherOptions[0];
              if (fallback) onChange(fallback.code);
            }}
            disabled={disabled || otherOptions.length === 0}
          />
          Autre <CaretDown size={12} />
        </label>
      </div>
      {isOther && (
        <select
          id={selectId}
          aria-label="Autre langue"
          className="underline-field"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
        >
          {otherOptions.length === 0 && <option value={value}>{value}</option>}
          {otherOptions.map((option) => (
            <option key={option.code} value={option.code}>
              {option.label} ({option.code})
            </option>
          ))}
        </select>
      )}
    </fieldset>
  );
}
