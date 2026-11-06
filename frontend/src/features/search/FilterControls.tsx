import { useId, type ReactNode } from "react";
import { PlusIcon, TrashIcon, XIcon } from "@phosphor-icons/react";
import { DisciplineGlyph } from "./Glyph";
import { MODE_LABELS, nextMode, numberLineLabel, type AnyMode } from "./searchModel";
import type { Comparison, DisciplineChoice, NumberLine } from "../../offline/vtes";
import type { DisciplineOption } from "./searchOptions";

/**
 * Contrôles élémentaires des filtres de Chercher (D1c) : pastille de mode,
 * puces à choix multiple, choix unique, grille de disciplines, lignes `≤ = ≥`.
 * Sans état propre : chaque contrôle reçoit sa valeur et rend la suivante.
 */

/** Pastille unique qui cycle au toucher (OU → ET → NON → SEULEMENT selon le filtre), avec des points de position. */
export function ModePill<M extends AnyMode>({
  modes,
  mode,
  onChange,
  help,
  testId,
}: {
  modes: readonly M[];
  mode: M;
  onChange: (mode: M) => void;
  help?: string;
  testId?: string;
}) {
  const next = nextMode(modes, mode);
  return (
    <div className="mode-pill-row">
      <button
        type="button"
        className="mode-pill"
        onClick={() => onChange(next)}
        aria-label={`Mode : ${MODE_LABELS[mode]}. ${help ?? ""} Toucher pour passer à ${MODE_LABELS[next]}.`}
        data-testid={testId}
        data-mode={mode}
      >
        {MODE_LABELS[mode]}
        <span className="mode-pill__dots" aria-hidden="true">
          {modes.map((item) => (
            <span key={item} className={item === mode ? "mode-pill__dot mode-pill__dot--on" : "mode-pill__dot"} />
          ))}
        </span>
      </button>
      {help && <p className="filter-help">{help}</p>}
    </div>
  );
}

/** Puces à choix multiple (extension, clan, secte, groupe, type, titre). */
export function ChipSet({
  legend,
  values,
  selected,
  onToggle,
  label = (value) => value,
  icon,
  testId,
}: {
  legend: string;
  values: readonly string[];
  selected: readonly string[];
  onToggle: (value: string) => void;
  label?: (value: string) => string;
  icon?: (value: string) => ReactNode;
  testId?: string;
}) {
  return (
    <fieldset className="filter-chips" data-testid={testId}>
      <legend className="sr-only">{legend}</legend>
      {values.map((value) => (
        <label key={value} className="chip chip--filter">
          <input type="checkbox" checked={selected.includes(value)} onChange={() => onToggle(value)} value={value} />
          {icon?.(value)}
          {label(value)}
        </label>
      ))}
    </fieldset>
  );
}

/** Choix unique, « indifférent » compris (légalité, possédée, votes, état du deck). */
export function ChoiceList<V extends string | number>({
  legend,
  options,
  value,
  onChange,
  testId,
}: {
  legend: string;
  options: ReadonlyArray<{ value: V | null; label: string }>;
  value: V | null;
  onChange: (value: V | null) => void;
  testId?: string;
}) {
  const name = useId();
  return (
    <fieldset className="filter-chips" data-testid={testId}>
      <legend className="sr-only">{legend}</legend>
      {options.map((option) => (
        <label key={String(option.value)} className="chip chip--filter">
          <input
            type="radio"
            name={name}
            checked={value === option.value}
            onChange={() => onChange(option.value)}
            value={String(option.value)}
          />
          {option.label}
        </label>
      ))}
    </fieldset>
  );
}

/** Niveau affiché d'une case de grille : rien, inférieure, supérieure ; `on` pour la bibliothèque. */
export type CellLevel = DisciplineChoice["level"] | "on" | null;

const LEVEL_TEXT: Record<Exclude<CellLevel, null>, string> = {
  inferior: "inférieure",
  superior: "supérieure",
  on: "cochée",
};

/** Grille de disciplines : un clic par case, l'appelant décide du cycle. */
export function DisciplineGrid({
  legend,
  options,
  levelOf,
  onCycle,
  testId,
}: {
  legend: string;
  options: readonly DisciplineOption[];
  levelOf: (code: string) => CellLevel;
  onCycle: (code: string) => void;
  testId?: string;
}) {
  return (
    <fieldset className="discipline-grid" data-testid={testId}>
      <legend className="sr-only">{legend}</legend>
      {options.map((option) => {
        const level = levelOf(option.code);
        return (
          <button
            key={option.code}
            type="button"
            className={`discipline-cell${level ? ` discipline-cell--${level}` : ""}`}
            onClick={() => onCycle(option.code)}
            aria-pressed={level !== null}
            aria-label={`${option.name} : ${level ? LEVEL_TEXT[level] : "non cochée"}`}
            data-code={option.code}
            data-level={level ?? "none"}
            title={option.name}
          >
            <DisciplineGlyph code={option.code} name={option.name} superior={level === "superior"} size="grid" />
            <span className="discipline-cell__code" aria-hidden="true">
              {level === "superior" ? option.code.toUpperCase() : option.code}
            </span>
          </button>
        );
      })}
    </fieldset>
  );
}

const COMPARISONS: ReadonlyArray<{ op: Comparison; sign: string; label: string }> = [
  { op: "le", sign: "≤", label: "au plus" },
  { op: "eq", sign: "=", label: "exactement" },
  { op: "ge", sign: "≥", label: "au moins" },
];

/** Une ligne `≤ = ≥` suivie d'une valeur, au stepper (capacité, coûts). */
export function NumberLineEditor({
  label,
  line,
  onChange,
  onRemove,
  min,
  max,
  testId,
}: {
  label: string;
  line: NumberLine;
  onChange: (line: NumberLine) => void;
  onRemove?: () => void;
  min: number;
  max: number;
  testId?: string;
}) {
  const name = useId();
  const clamp = (value: number) => Math.min(max, Math.max(min, value));
  return (
    <div className="number-line" data-testid={testId} aria-label={`${label} ${numberLineLabel(line)}`} role="group">
      <div className="number-line__ops">
        {COMPARISONS.map((comparison) => (
          <label key={comparison.op} className="chip chip--op">
            <input
              type="radio"
              name={name}
              checked={line.op === comparison.op}
              onChange={() => onChange({ ...line, op: comparison.op })}
              aria-label={comparison.label}
            />
            {comparison.sign}
          </label>
        ))}
      </div>
      <div className="stepper stepper--row">
        <button
          type="button"
          className="stepper__btn"
          aria-label={`Diminuer : ${label}`}
          disabled={line.value <= min}
          onClick={() => onChange({ ...line, value: clamp(line.value - 1) })}
        >
          −
        </button>
        <span className="stepper__value" aria-live="polite">
          {line.value}
        </span>
        <button
          type="button"
          className="stepper__btn stepper__btn--accent"
          aria-label={`Augmenter : ${label}`}
          disabled={line.value >= max}
          onClick={() => onChange({ ...line, value: clamp(line.value + 1) })}
        >
          +
        </button>
      </div>
      {onRemove && (
        <button type="button" className="icon-btn" onClick={onRemove} aria-label={`Retirer la ligne ${numberLineLabel(line)}`}>
          <XIcon size={18} />
        </button>
      )}
    </div>
  );
}

/** Bouton « + Ajouter … » d'une liste de lignes. */
export function AddRowButton({ children, onClick, testId }: { children: ReactNode; onClick: () => void; testId?: string }) {
  return (
    <button type="button" className="add-row" onClick={onClick} data-testid={testId}>
      <PlusIcon size={18} />
      {children}
    </button>
  );
}

export function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="icon-btn" onClick={onClick} aria-label={label}>
      <TrashIcon size={18} />
    </button>
  );
}
