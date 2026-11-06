import { useId, useRef, useState, type RefObject } from "react";
import { CaretDownIcon, CaretRightIcon, CaretUpIcon } from "@phosphor-icons/react";
import { BackRow, Sheet, SheetHeader } from "../../components/Sheet";
import { FilterEditor, type EditorProps } from "./FilterEditor";
import {
  FILTER_LABELS,
  MODE_LABELS,
  SECTION_LABELS,
  clearFilter,
  filterMode,
  filterSummary,
  resetFilters,
  visibleSections,
  type CategoryTab,
  type FilterKey,
  type SummaryContext,
} from "./searchModel";

/**
 * Les filtres de Chercher (D1c) : feuille plein écran au mobile (liste, puis
 * un écran par filtre, style réglages), colonne à gauche au bureau (lignes qui
 * se déplient). Les deux lisent et écrivent le même état, sans brouillon :
 * chaque changement s'applique aussitôt, et « Voir N résultats » ferme la
 * feuille.
 */

export interface PanelProps extends EditorProps {
  summary: SummaryContext;
  resultCount: number;
  /** Change de catégorie (« Filtres de crypte : passer en Crypte »). */
  onCategory: (category: CategoryTab) => void;
}

const CATEGORY_SWITCHES: Array<{ category: CategoryTab; label: string }> = [
  { category: "crypt", label: "Filtres de crypte : passer en Crypte" },
  { category: "library", label: "Filtres de bibliothèque : passer en Bibliothèque" },
];

function CategorySwitches({ props }: { props: PanelProps }) {
  if (props.state.category !== "all") return null;
  return (
    <div className="filter-switches">
      {CATEGORY_SWITCHES.map((item) => (
        <button key={item.category} type="button" className="btn-text" onClick={() => props.onCategory(item.category)} data-testid={`search-filters-to-${item.category}`}>
          {item.label}
        </button>
      ))}
    </div>
  );
}

function RowValue({ props, filterKey }: { props: PanelProps; filterKey: FilterKey }) {
  const summary = filterSummary(props.state, filterKey, props.summary);
  return <span className={summary ? "filter-line__value filter-line__value--on" : "filter-line__value"}>{summary ?? "indifférent"}</span>;
}

function RowMode({ props, filterKey }: { props: PanelProps; filterKey: FilterKey }) {
  const mode = filterMode(props.state, filterKey, props.virtues);
  return mode ? <span className="mode-badge">{MODE_LABELS[mode]}</span> : null;
}

// --- Mobile -------------------------------------------------------------------

export function FilterSheet({ onClose, ...props }: PanelProps & { onClose: () => void }) {
  const titleId = useId();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [open, setOpen] = useState<FilterKey | null>(null);
  const kicker = `${props.state.category === "all" ? "Toutes" : SECTION_LABELS[props.state.category]} · ${props.resultCount} résultat${props.resultCount > 1 ? "s" : ""}`;
  return (
    <Sheet titleId={titleId} titleRef={titleRef} onClose={onClose} className="filter-sheet" data-testid="search-filters-sheet">
      {open === null ? (
        <>
          <SheetHeader kicker={kicker} title="Filtres" titleId={titleId} titleRef={titleRef} onClose={onClose} />
          {visibleSections(props.state.category).map((section) => (
            <section key={section.id} className="filter-section">
              <h3 className="kicker">{SECTION_LABELS[section.id]}</h3>
              <ul className="filter-list">
                {section.keys.map((key) => (
                  <li key={key}>
                    <button type="button" className="filter-line" onClick={() => setOpen(key)} data-testid={`search-filter-${key}-open`}>
                      <span className="filter-line__label">
                        {FILTER_LABELS[key]} <RowMode props={props} filterKey={key} />
                      </span>
                      <RowValue props={props} filterKey={key} />
                      <CaretRightIcon size={16} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          <CategorySwitches props={props} />
          <SheetFoot
            props={props}
            onClose={onClose}
            secondary="Réinitialiser"
            onSecondary={() => props.onChange(resetFilters(props.state, props.virtues))}
            secondaryTestId="search-filters-reset"
          />
        </>
      ) : (
        <>
          <BackRow label="Filtres" onClick={() => setOpen(null)} data-testid="search-filter-back" />
          <h2 id={titleId} ref={titleRef} tabIndex={-1} className="sheet__title">
            {FILTER_LABELS[open]}
          </h2>
          <FilterEditor filterKey={open} {...props} />
          <SheetFoot
            props={props}
            onClose={onClose}
            secondary="Effacer"
            onSecondary={() => props.onChange(clearFilter(props.state, open, props.virtues))}
            secondaryTestId="search-filter-clear"
          />
        </>
      )}
    </Sheet>
  );
}

function SheetFoot({
  props,
  onClose,
  secondary,
  onSecondary,
  secondaryTestId,
}: {
  props: PanelProps;
  onClose: () => void;
  secondary: string;
  onSecondary: () => void;
  secondaryTestId: string;
}) {
  return (
    <div className="filter-sheet__foot">
      <button type="button" className="btn-text" onClick={onSecondary} data-testid={secondaryTestId}>
        {secondary}
      </button>
      <button type="button" className="pill pill--compact" onClick={onClose} data-testid="search-filters-done">
        Voir {props.resultCount} résultat{props.resultCount > 1 ? "s" : ""}
      </button>
    </div>
  );
}

// --- Bureau -------------------------------------------------------------------

/** Filtres dépliés au départ : les grilles de disciplines, visibles d'emblée comme au handoff (d17, d18). */
const OPEN_BY_DEFAULT: FilterKey[] = ["cryptDisciplines", "libraryDisciplines"];

export function FilterColumn({ props, total, columnRef }: { props: PanelProps; total: number; columnRef: RefObject<HTMLElement | null> }) {
  const [open, setOpen] = useState<ReadonlySet<FilterKey>>(() => new Set(OPEN_BY_DEFAULT));
  const toggle = (key: FilterKey) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  return (
    <aside className="filter-column" ref={columnRef} tabIndex={-1} aria-label="Filtres" data-testid="search-filters-column">
      <div className="filter-column__head">
        <h2 className="filter-column__title">
          Filtres{total > 0 && <span data-testid="search-filters-count"> · {total}</span>}
        </h2>
        <button type="button" className="btn-text" onClick={() => props.onChange(resetFilters(props.state, props.virtues))} data-testid="search-filters-reset">
          Réinitialiser
        </button>
      </div>
      {visibleSections(props.state.category).map((section) => (
        <section key={section.id} className="filter-section">
          <h3 className="kicker">{SECTION_LABELS[section.id]}</h3>
          {section.keys.map((key) => {
            const expanded = open.has(key);
            const Caret = expanded ? CaretUpIcon : CaretDownIcon;
            return (
              <div key={key} className="filter-block">
                <button type="button" className="filter-line filter-line--compact" aria-expanded={expanded} onClick={() => toggle(key)} data-testid={`search-filter-${key}-open`}>
                  <span className="filter-line__label">
                    {FILTER_LABELS[key]} <RowMode props={props} filterKey={key} />
                  </span>
                  <RowValue props={props} filterKey={key} />
                  <Caret size={14} aria-hidden="true" />
                </button>
                {expanded && <FilterEditor filterKey={key} {...props} />}
              </div>
            );
          })}
        </section>
      ))}
      <CategorySwitches props={props} />
    </aside>
  );
}
