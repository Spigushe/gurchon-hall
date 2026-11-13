import { DECK_ARCHETYPE_LABELS, DECK_ARCHETYPES, type DeckArchetype } from "../../offline/vtes";

/**
 * Archétype d'un deck en six puces (Lot 8, P5 ; écran 7, 1b-55 et d33) : un
 * seul choix, facultatif, un second toucher le retire. Remplace la liste
 * déroulante provisoire de C1.
 */
export function ArchetypeChips({
  legend,
  value,
  onChange,
  testIdPrefix,
}: {
  legend: string;
  value: DeckArchetype | null;
  onChange: (value: DeckArchetype | null) => void;
  testIdPrefix: string;
}) {
  return (
    <fieldset className="language-chips archetype-chips deck-archetype-chips">
      <legend>{legend}</legend>
      <div className="language-chips__row">
        {DECK_ARCHETYPES.map((archetype) => (
          <label key={archetype} className="chip">
            <input
              type="checkbox"
              checked={value === archetype}
              onChange={() => onChange(value === archetype ? null : archetype)}
              data-testid={`${testIdPrefix}-${archetype}`}
            />
            {DECK_ARCHETYPE_LABELS[archetype]}
          </label>
        ))}
      </div>
      <p className="filter-help">Un seul ; touchez-le de nouveau pour le retirer.</p>
    </fieldset>
  );
}
