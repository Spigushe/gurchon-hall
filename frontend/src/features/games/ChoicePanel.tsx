import { useId, type RefObject } from "react";
import { Check, Plus } from "@phosphor-icons/react";
import { SheetHeader } from "../../components/Sheet";

export interface ChoiceOption {
  value: string;
  label: string;
  meta?: string;
}

/**
 * Sélecteur d'une valeur dans une liste (lieu, tournoi, ronde, deck, nombre de
 * joueurs), écrans 15 et suivants du handoff : en-tête « kicker + titre », champ
 * de recherche facultatif, lignes à cocher, et une ligne « Créer … » au fil de la
 * frappe quand le sélecteur sait créer.
 *
 * Ce n'est **pas** une feuille : il prend la place du formulaire à l'intérieur de
 * la même `Sheet` (`GameForm`). Deux feuilles empilées se fermeraient ensemble
 * sur `Échap`, chaque instance écoutant le clavier du document.
 */
export function ChoicePanel({
  kicker,
  title,
  titleId,
  titleRef,
  onClose,
  options,
  selected,
  onSelect,
  search,
  create,
  note,
  error,
  emptyLabel = "Aucun résultat.",
  testId,
}: {
  kicker?: string;
  title: string;
  titleId: string;
  titleRef: RefObject<HTMLHeadingElement | null>;
  /** Revient au formulaire sans rien changer. */
  onClose: () => void;
  options: ChoiceOption[];
  selected: string | null;
  onSelect: (value: string) => void;
  search?: { term: string; onChange: (term: string) => void; placeholder: string };
  /** Ligne « Créer … » : `label` est le texte complet, `disabled` pendant l'écriture. */
  create?: { label: string; onCreate: () => void; disabled?: boolean } | null;
  /** Citation discrète sous la liste. */
  note?: string;
  /** Échec d'une création (`role="alert"`). */
  error?: string | null;
  emptyLabel?: string;
  testId?: string;
}) {
  const searchId = useId();
  return (
    <div className="choice-panel" data-testid={testId}>
      <SheetHeader
        kicker={kicker}
        title={title}
        titleId={titleId}
        titleRef={titleRef}
        onClose={onClose}
        closeLabel="Revenir à la saisie"
      />
      {search && (
        <div className="field">
          <label htmlFor={searchId} className="sr-only">
            {search.placeholder}
          </label>
          <input
            id={searchId}
            type="search"
            className="underline-field"
            value={search.term}
            onChange={(event) => search.onChange(event.target.value)}
            placeholder={search.placeholder}
            autoComplete="off"
            data-testid={testId ? `${testId}-search` : undefined}
          />
        </div>
      )}
      <ul className="list" data-testid={testId ? `${testId}-options` : undefined}>
        {options.map((option) => (
          <li key={option.value}>
            <button
              type="button"
              className="choice-row"
              aria-pressed={selected === option.value}
              data-value={option.value}
              onClick={() => onSelect(option.value)}
            >
              <span>
                <span className="choice-row__label">{option.label}</span>
                {option.meta && <span className="row__meta">{option.meta}</span>}
              </span>
              {selected === option.value && <Check size={18} weight="bold" aria-hidden="true" />}
            </button>
          </li>
        ))}
        {create && (
          <li>
            <button
              type="button"
              className="choice-row choice-row--create"
              disabled={create.disabled}
              onClick={create.onCreate}
              data-testid={testId ? `${testId}-create` : undefined}
            >
              <span className="choice-row__label">{create.label}</span>
              <Plus size={18} aria-hidden="true" />
            </button>
          </li>
        )}
      </ul>
      {options.length === 0 && !create && <p className="hint">{emptyLabel}</p>}
      {error && (
        <p className="error-text" role="alert" data-testid={testId ? `${testId}-error` : undefined}>
          {error}
        </p>
      )}
      {note && <p className="quote-block">{note}</p>}
    </div>
  );
}
