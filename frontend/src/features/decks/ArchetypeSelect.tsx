import { DECK_ARCHETYPE_LABELS, DECK_ARCHETYPES, type DeckArchetype } from "../../offline/vtes";

/**
 * Choix de l'archétype d'un deck parmi les six (Lot 8, P5), ou aucun.
 *
 * Forme provisoire (étape C1) : l'archétype n'accepte plus de texte libre, le
 * serveur refusant toute autre valeur. Le handoff dessine six puces (écran 7),
 * qui remplaceront cette liste à l'étape D2.
 */
export function ArchetypeSelect({
  id,
  value,
  onChange,
}: {
  id: string;
  value: DeckArchetype | null;
  onChange: (value: DeckArchetype | null) => void;
}) {
  return (
    <select
      id={id}
      className="underline-field"
      value={value ?? ""}
      onChange={(event) => onChange(event.target.value === "" ? null : (event.target.value as DeckArchetype))}
    >
      <option value="">Aucun</option>
      {DECK_ARCHETYPES.map((archetype) => (
        <option key={archetype} value={archetype}>
          {DECK_ARCHETYPE_LABELS[archetype]}
        </option>
      ))}
    </select>
  );
}
