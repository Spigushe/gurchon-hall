import type { ReactNode } from "react";
import {
  type CardSetRow,
  type CryptCriteria,
  type DeckKey,
  type DisciplineChoice,
  type LibraryCriteria,
  type LibraryDisciplineMode,
  type LocalDeck,
  type NumberLine,
  type SetMode,
  type TextField,
  type TextLine,
} from "../../offline/vtes";
import { cardSetLabel } from "../../labels";
import {
  AddRowButton,
  ChipSet,
  ChoiceList,
  DisciplineGrid,
  ModePill,
  NumberLineEditor,
  RemoveButton,
  type CellLevel,
} from "./FilterControls";
import { ClanGlyph, DisciplineGlyph, TypeGlyph } from "../../components/glyphs/Glyph";
import {
  DECK_FILTER_LABELS,
  GENERIC_MODE_HELP,
  LEGALITY_LABELS,
  LIBRARY_DISCIPLINE_HELP,
  OWNED_LABELS,
  cycleCryptDiscipline,
  isVirtue,
  toggleInFilter,
  toggleValue,
  valueLabel,
  type CommonFilters,
  type DeckFilter,
  type FilterKey,
  type OwnedFilter,
  type SearchState,
} from "./searchModel";
import { librarySectOptions, type SearchOptions } from "./searchOptions";

/**
 * L'éditeur d'un filtre de Chercher (D1c), le même au mobile (écran poussé de
 * la feuille de filtres) et au bureau (ligne dépliée de la colonne). Un
 * composant par filtre, rangés dans une table : pas de `switch`.
 */

export interface EditorProps {
  state: SearchState;
  onChange: (state: SearchState) => void;
  options: SearchOptions;
  cardSets: readonly CardSetRow[];
  decks: readonly LocalDeck[];
  virtues: ReadonlySet<string>;
}

const setCommon = (props: EditorProps, patch: Partial<CommonFilters>) =>
  props.onChange({ ...props.state, common: { ...props.state.common, ...patch } });
const setCrypt = (props: EditorProps, patch: Partial<CryptCriteria>) =>
  props.onChange({ ...props.state, crypt: { ...props.state.crypt, ...patch } });
const setLibrary = (props: EditorProps, patch: Partial<LibraryCriteria>) =>
  props.onChange({ ...props.state, library: { ...props.state.library, ...patch } });

const SET_MODES: SetMode[] = ["or", "and", "not"];
const clanIcon = (name: string) => <ClanGlyph name={name} decorative />;
const typeIcon = (name: string) => <TypeGlyph type={name} decorative />;
const OR_NOT: Array<"or" | "not"> = ["or", "not"];
const LIBRARY_DISCIPLINE_MODES: LibraryDisciplineMode[] = ["or", "and", "not", "only"];

// --- Communs -------------------------------------------------------------------

const TEXT_FIELDS: ReadonlyArray<{ field: TextField; label: string }> = [
  { field: "all", label: "Nom et texte" },
  { field: "name", label: "Nom" },
  { field: "text", label: "Texte" },
];

function TextLineRow({ line, onChange, onRemove, index }: { line: TextLine; onChange: (line: TextLine) => void; onRemove: () => void; index: number }) {
  return (
    <div className="text-line" data-testid="search-text-line">
      <div className="segmented segmented--small" role="radiogroup" aria-label={`Champ de la ligne ${index + 1}`}>
        {TEXT_FIELDS.map((option) => (
          <button
            key={option.field}
            type="button"
            role="radio"
            aria-checked={line.field === option.field}
            className={line.field === option.field ? "segmented__item segmented__item--on" : "segmented__item"}
            onClick={() => onChange({ ...line, field: option.field })}
          >
            {option.label}
          </button>
        ))}
      </div>
      <div className="text-line__row">
        <ModePill modes={["and", "not"] as const} mode={line.mode} onChange={(mode) => onChange({ ...line, mode })} testId="search-text-line-mode" />
        <input
          type="search"
          className="underline-field"
          value={line.value}
          onChange={(event) => onChange({ ...line, value: event.target.value })}
          aria-label={`Texte de la ligne ${index + 1}`}
          autoComplete="off"
          data-testid="search-text-line-input"
        />
        <RemoveButton label={`Retirer la ligne ${index + 1}`} onClick={onRemove} />
      </div>
    </div>
  );
}

function TextEditor(props: EditorProps) {
  const lines = props.state.common.textLines;
  const replace = (index: number, line: TextLine) => setCommon(props, { textLines: lines.map((item, i) => (i === index ? line : item)) });
  return (
    <div className="filter-editor">
      <p className="filter-help">Un mot court trouve aussi les icônes : « pre » trouve toutes les cartes à icône Presence.</p>
      {lines.map((line, index) => (
        <TextLineRow
          key={index}
          index={index}
          line={line}
          onChange={(next) => replace(index, next)}
          onRemove={() => setCommon(props, { textLines: lines.filter((_, i) => i !== index) })}
        />
      ))}
      <AddRowButton onClick={() => setCommon(props, { textLines: [...lines, { value: "", field: "all", mode: "and" }] })} testId="search-text-add">
        Ajouter une ligne
      </AddRowButton>
    </div>
  );
}

function CardSetsEditor(props: EditorProps) {
  const byId = new Map(props.cardSets.map((set) => [String(set.id), set]));
  return (
    <div className="filter-editor">
      <p className="filter-help">Carte imprimée dans l'une des extensions cochées.</p>
      <ChipSet
        legend="Extensions"
        values={props.cardSets.map((set) => String(set.id))}
        selected={props.state.common.cardSetIds.map(String)}
        onToggle={(id) => setCommon(props, { cardSetIds: toggleValue(props.state.common.cardSetIds, Number(id)) })}
        label={(id) => (byId.has(id) ? cardSetLabel(byId.get(id)!) : id)}
        testId="search-filter-card-sets"
      />
    </div>
  );
}

function LegalityEditor(props: EditorProps) {
  return (
    <div className="filter-editor">
      <ChoiceList
        legend="Légalité"
        options={[{ value: null, label: "indifférent" }, ...Object.entries(LEGALITY_LABELS).map(([value, label]) => ({ value: value as keyof typeof LEGALITY_LABELS, label }))]}
        value={props.state.common.legality}
        onChange={(legality) => setCommon(props, { legality })}
        testId="search-filter-legality"
      />
      <p className="filter-help">La légalité se lit à la date du jour (UTC).</p>
    </div>
  );
}

function OwnedEditor(props: EditorProps) {
  return (
    <div className="filter-editor">
      <ChoiceList<Exclude<OwnedFilter, null>>
        legend="Possédée"
        options={[{ value: null, label: "indifférent" }, { value: "owned", label: OWNED_LABELS.owned }, { value: "not_owned", label: OWNED_LABELS.not_owned }]}
        value={props.state.common.owned}
        onChange={(owned) => setCommon(props, { owned })}
        testId="search-filter-owned"
      />
      <p className="filter-help">Possédée dès qu'une entrée de la collection en a au moins un exemplaire.</p>
    </div>
  );
}

const deckLabel = (deck: LocalDeck) =>
  `${deck.name}${deck.discriminator ? `#${deck.discriminator}` : ""}${deck.archivedAt ? " (rangé)" : ""}`;

function DeckEditor(props: EditorProps) {
  const { state } = props;
  const choose = (key: string) =>
    props.onChange({
      ...state,
      deckKey: key === "" ? null : (key as DeckKey),
      common: { ...state.common, inDeck: key === "" ? null : (state.common.inDeck ?? "not_in") },
    });
  return (
    <div className="filter-editor">
      <label className="field">
        <span className="field__label">Deck</span>
        <select className="underline-field" value={state.deckKey ?? ""} onChange={(event) => choose(event.target.value)} data-testid="search-filter-deck">
          <option value="">Aucun deck</option>
          {props.decks.map((deck) => (
            <option key={deck.key} value={deck.key}>
              {deckLabel(deck)}
            </option>
          ))}
        </select>
      </label>
      {state.deckKey && (
        <ChoiceList<Exclude<DeckFilter, null>>
          legend="Présence dans le deck"
          options={[{ value: null, label: "indifférent" }, { value: "in", label: DECK_FILTER_LABELS.in }, { value: "not_in", label: DECK_FILTER_LABELS.not_in }]}
          value={state.common.inDeck}
          onChange={(inDeck) => setCommon(props, { inDeck })}
          testId="search-filter-deck-state"
        />
      )}
    </div>
  );
}

// --- Crypte ----------------------------------------------------------------------

const cryptLevel = (choices: readonly DisciplineChoice[], code: string): CellLevel =>
  choices.find((choice) => choice.code === code)?.level ?? null;

function CryptDisciplinesEditor(props: EditorProps) {
  const choices = props.state.crypt.disciplines ?? [];
  const pairs = props.state.crypt.disciplinePairs ?? [];
  const name = props.options.disciplineName;
  return (
    <div className="filter-editor">
      <p className="filter-help">Toucher : rien → inférieure → supérieure. Inférieure se lit « au moins inférieure ».</p>
      <DisciplineGrid
        legend="Disciplines"
        options={props.options.cryptDisciplines}
        levelOf={(code) => cryptLevel(choices, code)}
        onCycle={(code) => setCrypt(props, { disciplines: cycleCryptDiscipline(choices, code) })}
        testId="search-filter-crypt-disciplines"
      />
      <PairsEditor
        pairs={pairs}
        options={props.options.cryptDisciplines}
        disciplineName={name}
        onChange={(disciplinePairs) => setCrypt(props, { disciplinePairs })}
      />
    </div>
  );
}

type Pair = [DisciplineChoice, DisciplineChoice];

function PairChoice({ choice, options, onChange, label }: { choice: DisciplineChoice; options: SearchOptions["cryptDisciplines"]; onChange: (choice: DisciplineChoice) => void; label: string }) {
  const name = options.find((option) => option.code === choice.code)?.name ?? choice.code;
  return (
    <span className="pair-choice">
      <DisciplineGlyph code={choice.code} name={name} superior={choice.level === "superior"} size="meta" />
      <select aria-label={`${label} : discipline`} value={choice.code} onChange={(event) => onChange({ ...choice, code: event.target.value })}>
        {options.map((option) => (
          <option key={option.code} value={option.code}>
            {option.name}
          </option>
        ))}
      </select>
      <select aria-label={`${label} : niveau`} value={choice.level} onChange={(event) => onChange({ ...choice, level: event.target.value as DisciplineChoice["level"] })}>
        <option value="inferior">inf.</option>
        <option value="superior">sup.</option>
      </select>
    </span>
  );
}

function PairsEditor({ pairs, options, onChange }: { pairs: Pair[]; options: SearchOptions["cryptDisciplines"]; disciplineName: (code: string) => string; onChange: (pairs: Pair[]) => void }) {
  if (options.length < 2) return null;
  const replace = (index: number, pair: Pair) => onChange(pairs.map((item, i) => (i === index ? pair : item)));
  const fresh: Pair = [
    { code: options[0].code, level: "inferior" },
    { code: options[1].code, level: "inferior" },
  ];
  return (
    <div className="pairs" data-testid="search-filter-pairs">
      <p className="filter-subtitle">
        Paires « OU » <span className="filter-help">OU dans la paire, ET entre paires</span>
      </p>
      {pairs.map((pair, index) => (
        <div key={index} className="pair-row" data-testid="search-pair">
          <PairChoice choice={pair[0]} options={options} label={`Paire ${index + 1}, première`} onChange={(choice) => replace(index, [choice, pair[1]])} />
          <span className="pair-row__or">OU</span>
          <PairChoice choice={pair[1]} options={options} label={`Paire ${index + 1}, seconde`} onChange={(choice) => replace(index, [pair[0], choice])} />
          <RemoveButton label={`Retirer la paire ${index + 1}`} onClick={() => onChange(pairs.filter((_, i) => i !== index))} />
        </div>
      ))}
      <AddRowButton onClick={() => onChange([...pairs, fresh])} testId="search-pair-add">
        Ajouter une paire
      </AddRowButton>
    </div>
  );
}

function VirtuesEditor(props: EditorProps) {
  const choices = props.state.crypt.disciplines ?? [];
  const toggle = (code: string) => {
    const has = choices.some((choice) => choice.code === code);
    setCrypt(props, { disciplines: has ? choices.filter((choice) => choice.code !== code) : [...choices, { code, level: "inferior" }] });
  };
  return (
    <div className="filter-editor">
      <p className="filter-help">Vertus des imbued, toutes exigées.</p>
      <DisciplineGrid
        legend="Vertus"
        options={props.options.virtues}
        levelOf={(code) => (choices.some((choice) => choice.code === code && isVirtue(choice, props.virtues)) ? "on" : null)}
        onCycle={toggle}
        testId="search-filter-virtues"
      />
    </div>
  );
}

function ModeChips<M extends string>({
  legend,
  values,
  filter,
  modes,
  help,
  onChange,
  label,
  icon,
  testId,
}: {
  legend: string;
  values: readonly string[];
  filter: { values: string[]; mode: M } | undefined;
  modes: readonly M[];
  help: Record<string, string>;
  onChange: (filter: { values: string[]; mode: M } | undefined) => void;
  label?: (value: string) => string;
  icon?: (value: string) => ReactNode;
  testId: string;
}) {
  const mode = filter?.mode ?? modes[0];
  return (
    <div className="filter-editor">
      <ModePill
        modes={modes as unknown as readonly SetMode[]}
        mode={mode as unknown as SetMode}
        onChange={(next) => onChange({ values: filter?.values ?? [], mode: next as unknown as M })}
        help={help[mode]}
        testId={`${testId}-mode`}
      />
      <ChipSet legend={legend} values={values} selected={filter?.values ?? []} onToggle={(value) => onChange(toggleInFilter(filter, value, mode))} label={label} icon={icon} testId={testId} />
    </div>
  );
}

function CryptClansEditor(props: EditorProps) {
  return (
    <ModeChips
      legend="Clan"
      values={props.options.cryptClans}
      filter={props.state.crypt.clans}
      modes={SET_MODES}
      help={{ ...GENERIC_MODE_HELP, and: "Un clan et une voie à la fois." }}
      onChange={(clans) => setCrypt(props, { clans })}
      icon={clanIcon}
      testId="search-filter-crypt-clans"
    />
  );
}

function CryptSectsEditor(props: EditorProps) {
  return (
    <ModeChips
      legend="Secte"
      values={props.options.sects}
      filter={props.state.crypt.sects}
      modes={OR_NOT}
      help={GENERIC_MODE_HELP}
      onChange={(sects) => setCrypt(props, { sects })}
      testId="search-filter-crypt-sects"
    />
  );
}

function GroupsEditor(props: EditorProps) {
  const groups = props.state.crypt.groups ?? [];
  return (
    <div className="filter-editor">
      <ChipSet
        legend="Groupe"
        values={props.options.groups}
        selected={groups}
        onToggle={(group) => setCrypt(props, { groups: toggleValue(groups, group) })}
        label={(group) => group.replace(/^G/, "")}
        testId="search-filter-groups"
      />
      <p className="filter-help">Les cartes de groupe « Any » restent affichées avec tout groupe coché.</p>
    </div>
  );
}

function CapacityEditor(props: EditorProps) {
  const capacity = props.state.crypt.capacity;
  const lines = capacity?.lines ?? [];
  const mode = capacity?.mode ?? "or";
  const write = (next: NumberLine[], nextMode = mode) => setCrypt(props, { capacity: { lines: next, mode: nextMode } });
  return (
    <div className="filter-editor">
      <ModePill modes={OR_NOT} mode={mode} onChange={(next) => write(lines, next)} help={mode === "or" ? "Au moins une des lignes." : "Aucune des lignes : une plage 4 à 7 s'écrit NON ≤ 3, ≥ 8."} testId="search-filter-capacity-mode" />
      {lines.map((line, index) => (
        <NumberLineEditor
          key={index}
          label={`Capacité, ligne ${index + 1}`}
          line={line}
          min={1}
          max={11}
          onChange={(next) => write(lines.map((item, i) => (i === index ? next : item)))}
          onRemove={() => write(lines.filter((_, i) => i !== index))}
          testId="search-filter-capacity-line"
        />
      ))}
      <AddRowButton onClick={() => write([...lines, { op: "ge", value: 8 }])} testId="search-filter-capacity-add">
        Ajouter une ligne
      </AddRowButton>
      <p className="filter-help">La capacité range aussi la vie des imbued.</p>
    </div>
  );
}

function CryptTitlesEditor(props: EditorProps) {
  const titles = props.state.crypt.titles ?? [];
  return (
    <div className="filter-editor">
      <p className="filter-help">Au moins un des titres cochés. Le titre d'un advanced est celui de sa face.</p>
      <ChipSet
        legend="Titre"
        values={props.options.cryptTitles}
        selected={titles}
        onToggle={(title) => setCrypt(props, { titles: toggleValue(titles, title) })}
        label={valueLabel}
        testId="search-filter-crypt-titles"
      />
    </div>
  );
}

const VOTE_OPTIONS: ReadonlyArray<{ value: "none" | 1 | 2 | 3 | 4 | null; label: string }> = [
  { value: null, label: "indifférent" },
  { value: "none", label: "aucun" },
  { value: 1, label: "1 et plus" },
  { value: 2, label: "2 et plus" },
  { value: 3, label: "3 et plus" },
  { value: 4, label: "4 et plus" },
];

function VotesEditor(props: EditorProps) {
  return (
    <div className="filter-editor">
      <ChoiceList
        legend="Votes"
        options={VOTE_OPTIONS}
        value={props.state.crypt.votes ?? null}
        onChange={(votes) => setCrypt(props, { votes: votes ?? undefined })}
        testId="search-filter-votes"
      />
      <p className="filter-help">Barème de VDB : prince 2, justicar 3, inner circle 4, baron 2…</p>
    </div>
  );
}

// --- Bibliothèque ------------------------------------------------------------------

function TypesEditor(props: EditorProps) {
  return (
    <ModeChips
      legend="Type"
      values={props.options.types}
      filter={props.state.library.types}
      modes={SET_MODES}
      help={{ ...GENERIC_MODE_HELP, and: "Tous les types cochés, sur la même carte." }}
      onChange={(types) => setLibrary(props, { types })}
      icon={typeIcon}
      testId="search-filter-types"
    />
  );
}

function LibraryDisciplinesEditor(props: EditorProps) {
  const filter = props.state.library.disciplines;
  const notRequired = filter?.mode === "not_required";
  const values = filter && filter.mode !== "not_required" ? filter.values : [];
  const mode: LibraryDisciplineMode = filter && filter.mode !== "not_required" ? filter.mode : "or";
  // Un mode choisi avant toute discipline est gardé : le filtre reste inactif tant qu'il est vide.
  const write = (next: string[], nextMode: LibraryDisciplineMode) => setLibrary(props, { disciplines: { values: next, mode: nextMode } });
  return (
    <div className="filter-editor">
      <ModePill modes={LIBRARY_DISCIPLINE_MODES} mode={mode} onChange={(next) => write(values, next)} help={LIBRARY_DISCIPLINE_HELP[mode]} testId="search-filter-library-disciplines-mode" />
      <DisciplineGrid
        legend="Disciplines"
        options={props.options.libraryDisciplines}
        levelOf={(code) => (values.includes(code) ? "on" : null)}
        onCycle={(code) => write(toggleValue(values, code), mode)}
        testId="search-filter-library-disciplines"
      />
      <label className="switch-line">
        <input
          type="checkbox"
          checked={notRequired}
          onChange={() => setLibrary(props, { disciplines: notRequired ? undefined : { mode: "not_required" } })}
          data-testid="search-filter-library-disciplines-none"
        />
        Non requise (cartes sans discipline)
      </label>
    </div>
  );
}

function LibraryClansEditor(props: EditorProps) {
  return (
    <ModeChips
      legend="Clan requis"
      values={props.options.libraryClans}
      filter={props.state.library.clans}
      modes={OR_NOT}
      help={GENERIC_MODE_HELP}
      onChange={(clans) => setLibrary(props, { clans })}
      label={valueLabel}
      icon={clanIcon}
      testId="search-filter-library-clans"
    />
  );
}

function LibrarySectsEditor(props: EditorProps) {
  return (
    <ModeChips
      legend="Secte requise"
      values={librarySectOptions(props.options)}
      filter={props.state.library.sects}
      modes={OR_NOT}
      help={{ ...GENERIC_MODE_HELP, or: "Au moins une des sectes cochées. Un titre exigé implique sa secte." }}
      onChange={(sects) => setLibrary(props, { sects })}
      label={valueLabel}
      testId="search-filter-library-sects"
    />
  );
}

function LibraryTitlesEditor(props: EditorProps) {
  return (
    <ModeChips
      legend="Titre requis"
      values={props.options.libraryTitles}
      filter={props.state.library.titles}
      modes={OR_NOT}
      help={GENERIC_MODE_HELP}
      onChange={(titles) => setLibrary(props, { titles })}
      label={valueLabel}
      testId="search-filter-library-titles"
    />
  );
}

function costEditor(key: "bloodCost" | "poolCost", label: string, max: number) {
  return function CostEditor(props: EditorProps) {
    const line = props.state.library[key];
    return (
      <div className="filter-editor">
        {line ? (
          <NumberLineEditor label={label} line={line} min={0} max={max} onChange={(next) => setLibrary(props, { [key]: next })} onRemove={() => setLibrary(props, { [key]: undefined })} testId={`search-filter-${key}`} />
        ) : (
          <AddRowButton onClick={() => setLibrary(props, { [key]: { op: "le", value: Math.min(2, max) } })} testId={`search-filter-${key}-add`}>
            Ajouter une condition
          </AddRowButton>
        )}
        <p className="filter-help">Un coût absent vaut 0 ; un coût « X » passe toujours.</p>
      </div>
    );
  };
}

const FILTER_EDITORS: Record<FilterKey, (props: EditorProps) => ReactNode> = {
  text: TextEditor,
  cardSets: CardSetsEditor,
  legality: LegalityEditor,
  owned: OwnedEditor,
  deck: DeckEditor,
  cryptDisciplines: CryptDisciplinesEditor,
  virtues: VirtuesEditor,
  cryptClans: CryptClansEditor,
  cryptSects: CryptSectsEditor,
  groups: GroupsEditor,
  capacity: CapacityEditor,
  cryptTitles: CryptTitlesEditor,
  votes: VotesEditor,
  types: TypesEditor,
  libraryDisciplines: LibraryDisciplinesEditor,
  libraryClans: LibraryClansEditor,
  librarySects: LibrarySectsEditor,
  libraryTitles: LibraryTitlesEditor,
  bloodCost: costEditor("bloodCost", "Coût en sang", 4),
  poolCost: costEditor("poolCost", "Coût en pool", 6),
};

export function FilterEditor({ filterKey, ...props }: EditorProps & { filterKey: FilterKey }) {
  const Editor = FILTER_EDITORS[filterKey];
  return <Editor {...props} />;
}
