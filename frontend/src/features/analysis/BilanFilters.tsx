import { useId, useRef, useState } from "react";
import { FunnelSimpleIcon } from "@phosphor-icons/react";
import { Pill } from "../../components/Pill";
import { Sheet, SheetHeader } from "../../components/Sheet";
import type { DeckKey, LocalDeck } from "../../offline/vtes";
import {
  DEFAULT_BILAN_FILTERS,
  filterFacts,
  gamesCount,
  PERIOD_LABELS,
  PERIOD_PRESETS,
  periodRange,
  ROUND_TYPE_LABELS,
  ROUND_TYPES,
  toggleRoundType,
  withBound,
  type BilanFilters,
  type GameFact,
} from "./bilanModel";
import { ClanMark } from "./BilanParts";

interface FilterControlsProps {
  filters: BilanFilters;
  onChange: (filters: BilanFilters) => void;
  decks: readonly LocalDeck[];
  deckClan: (key: DeckKey) => string | null;
  now: Date;
  idPrefix: string;
}

function PeriodControls({ filters, onChange, now, idPrefix }: FilterControlsProps) {
  const range = periodRange(filters, now);
  return (
    <>
      <div className="language-chips__row bilan-filter__chips" role="radiogroup" aria-label="Période">
        {PERIOD_PRESETS.map((preset) => (
          <label key={preset} className="chip">
            <input
              type="radio"
              name={`${idPrefix}-period`}
              checked={filters.period === preset}
              onChange={() => onChange({ ...filters, period: preset, from: null, to: null })}
              data-testid={`bilan-period-${preset}`}
            />
            {PERIOD_LABELS[preset]}
          </label>
        ))}
      </div>
      <div className="bilan-filter__dates">
        <label className="bilan-filter__date">
          <span>De</span>
          <input
            type="date"
            className="underline-field"
            value={range.from ?? ""}
            onChange={(event) => onChange(withBound(filters, "from", event.target.value, now))}
            data-testid="bilan-period-from"
          />
        </label>
        <label className="bilan-filter__date">
          <span>À</span>
          <input
            type="date"
            className="underline-field"
            value={range.to ?? ""}
            onChange={(event) => onChange(withBound(filters, "to", event.target.value, now))}
            data-testid="bilan-period-to"
          />
        </label>
      </div>
    </>
  );
}

function TypeControls({ filters, onChange }: FilterControlsProps) {
  return (
    <div className="language-chips__row bilan-filter__chips" role="group" aria-label="Type de partie">
      {ROUND_TYPES.map((type) => (
        <label key={type} className="chip">
          <input
            type="checkbox"
            checked={filters.roundTypes.includes(type)}
            onChange={() => onChange(toggleRoundType(filters, type))}
            data-testid={`bilan-type-${type}`}
          />
          {ROUND_TYPE_LABELS[type]}
        </label>
      ))}
    </div>
  );
}

function DeckChoice({
  name,
  label,
  clan,
  checked,
  onSelect,
  testId,
}: {
  name: string;
  label: string;
  clan: string | null;
  checked: boolean;
  onSelect: () => void;
  testId: string;
}) {
  return (
    <label className="chip bilan-filter__deck">
      <input type="radio" name={name} checked={checked} onChange={onSelect} data-testid={testId} />
      <ClanMark clan={clan} decorative />
      {label}
    </label>
  );
}

function DeckControls({ filters, onChange, decks, deckClan, idPrefix }: FilterControlsProps) {
  const name = `${idPrefix}-deck`;
  return (
    <div className="language-chips__row bilan-filter__chips bilan-filter__decks" role="radiogroup" aria-label="Deck">
      <DeckChoice
        name={name}
        label="Tous les decks"
        clan={null}
        checked={filters.deckKey === null}
        onSelect={() => onChange({ ...filters, deckKey: null })}
        testId="bilan-deck-all"
      />
      {decks.map((deck) => (
        <DeckChoice
          key={deck.key}
          name={name}
          label={deck.name}
          clan={deckClan(deck.key)}
          checked={filters.deckKey === deck.key}
          onSelect={() => onChange({ ...filters, deckKey: deck.key })}
          testId="bilan-deck-option"
        />
      ))}
    </div>
  );
}

/** Barre de filtres du bureau (d25) : période, type, deck, appliqués aussitôt. */
export function BilanFilterBar(props: Omit<FilterControlsProps, "idPrefix">) {
  const idPrefix = useId();
  const controls = { ...props, idPrefix };
  return (
    <div className="bilan-filterbar" data-testid="bilan-filterbar">
      <div className="bilan-filterbar__group">
        <span className="bilan-filterbar__label">Période</span>
        <PeriodControls {...controls} />
      </div>
      <div className="bilan-filterbar__group">
        <span className="bilan-filterbar__label">Type</span>
        <TypeControls {...controls} />
      </div>
      <div className="bilan-filterbar__group">
        <span className="bilan-filterbar__label">Deck</span>
        <DeckControls {...controls} />
      </div>
    </div>
  );
}

/** Feuille des filtres du mobile (1b-47) : brouillon appliqué par « Voir N parties ». */
export function BilanFilterSheet({
  filters,
  onApply,
  onClose,
  facts,
  decks,
  deckClan,
  now,
}: {
  filters: BilanFilters;
  onApply: (filters: BilanFilters) => void;
  onClose: () => void;
  facts: readonly GameFact[];
  decks: readonly LocalDeck[];
  deckClan: (key: DeckKey) => string | null;
  now: Date;
}) {
  const titleId = useId();
  const idPrefix = useId();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [draft, setDraft] = useState(filters);
  const count = filterFacts(facts, draft, now).length;
  const controls = { filters: draft, onChange: setDraft, decks, deckClan, now, idPrefix };
  return (
    <Sheet titleId={titleId} titleRef={titleRef} onClose={onClose} data-testid="bilan-filter-sheet">
      <SheetHeader kicker="Bilan" title="Filtres" titleId={titleId} titleRef={titleRef} onClose={onClose} />
      <div className="sheet-form bilan-filter">
        <section className="filter-section">
          <h3 className="filter-subtitle">Période</h3>
          <PeriodControls {...controls} />
        </section>
        <section className="filter-section">
          <h3 className="filter-subtitle">Type de partie</h3>
          <TypeControls {...controls} />
          <p className="filter-help">Plusieurs au choix ; aucun coché : tous les types.</p>
        </section>
        <section className="filter-section">
          <h3 className="filter-subtitle">Deck</h3>
          <DeckControls {...controls} />
        </section>
        <div className="filter-sheet__foot">
          <Pill onClick={() => onApply(draft)} data-testid="bilan-filter-apply">
            {count === 0 ? "Aucune partie" : `Voir ${gamesCount(count)}`}
          </Pill>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => setDraft(DEFAULT_BILAN_FILTERS)}
            data-testid="bilan-filter-clear"
          >
            Effacer les filtres
          </button>
        </div>
      </div>
    </Sheet>
  );
}

/** Ligne de filtres du mobile : résumé, et « Filtres » qui ouvre la feuille. */
export function BilanFilterLine({ summary, onOpen }: { summary: string; onOpen: () => void }) {
  return (
    <div className="bilan-filterline">
      <span className="bilan-filterline__summary" data-testid="bilan-filter-summary">
        {summary}
      </span>
      <button type="button" className="btn btn-secondary" onClick={onOpen} data-testid="bilan-filter-open">
        <FunnelSimpleIcon size={16} />
        Filtres
      </button>
    </div>
  );
}
