import { useId, useState, type ReactNode } from "react";
import { CaretDownIcon, CaretRightIcon, ClockCountdownIcon } from "@phosphor-icons/react";
import { Link } from "../../app/Link";
import type { DeckKey } from "../../offline/vtes";
import {
  averageVp,
  dayLabel,
  formatAverage,
  gamesCount,
  groupMeta,
  positionAxis,
  versionLabel,
  type DeckGroup,
  type GameFact,
  type Group,
  type PositionAxis,
  type PositionGrouping,
  type VersionGroup,
} from "./bilanModel";
import { ArchetypeTag, ClanMark, StatBars } from "./BilanParts";
import type { Decorate, GroupDecoration, PositionState } from "./bilanView";

const NEAR_LABELS: Record<PositionState["near"], string> = { prey: "Ma proie", predator: "Mon prédateur" };
const FAR_LABELS: Record<PositionState["far"], string> = { grandPrey: "Grande proie", grandPredator: "Grand prédateur" };
const GROUPING_LABELS: Record<PositionGrouping, string> = { archetype: "Archétype", clan: "Clan" };

// --- Ligne d'un axe (mobile, 1b-46) -------------------------------------------

function GroupHead({ group, decoration, compact }: { group: Group; decoration: GroupDecoration; compact: boolean }) {
  return (
    <span className="bilan-row__head">
      {decoration.clan && <ClanMark clan={decoration.clan} />}
      <span className={group.unknown ? "bilan-row__name bilan-row__name--unknown" : "bilan-row__name"}>
        {group.label}
      </span>
      {decoration.archetype && <ArchetypeTag archetype={decoration.archetype} />}
      {decoration.sub && <span className="bilan-row__sub">{decoration.sub}</span>}
      <span className="bilan-row__avg">
        <strong data-testid="bilan-row-average">{formatAverage(averageVp(group.stats))}</strong>
        {!compact && <small>VP / partie</small>}
      </span>
    </span>
  );
}

export function GroupRow({
  group,
  decoration,
  compact = false,
  children,
  toggle,
}: {
  group: Group;
  decoration: GroupDecoration;
  /** « Plus loin à la table » : lignes plus basses, sans barre. */
  compact?: boolean;
  children?: ReactNode;
  toggle?: ReactNode;
}) {
  return (
    <li
      className={compact ? "bilan-row bilan-row--compact" : "bilan-row"}
      data-testid="bilan-row"
      data-group={group.key}
      data-games={group.stats.games}
      data-game-wins={group.stats.gameWins}
    >
      <div className="bilan-row__line">
        {toggle}
        <div className="bilan-row__body">
          <GroupHead group={group} decoration={decoration} compact={compact} />
          <span className="bilan-row__meta" data-testid="bilan-row-meta">
            {groupMeta(group.stats)}
          </span>
          {!compact && <StatBars stats={group.stats} />}
        </div>
      </div>
      {children}
    </li>
  );
}

export function GroupList({
  groups,
  decorate,
  compact,
  testId,
}: {
  groups: readonly Group[];
  decorate: Decorate;
  compact?: boolean;
  testId: string;
}) {
  return (
    <ul className="bilan-list" data-testid={testId}>
      {groups.map((group) => (
        <GroupRow key={group.key} group={group} decoration={decorate(group)} compact={compact} />
      ))}
    </ul>
  );
}

// --- Versions sous un deck -----------------------------------------------------

/** « v2 · depuis le 10 octobre », son bilan et « Voir la liste ». */
export function VersionLine({ deckKey, version, now }: { deckKey: DeckKey; version: VersionGroup; now: Date }) {
  const label = versionLabel(version);
  return (
    <li className="bilan-version" data-testid="bilan-version" data-version={version.key}>
      <span className="bilan-version__head">
        {version.pending && <ClockCountdownIcon size={14} className="bilan-version__pending" aria-hidden="true" />}
        <span className="bilan-version__label">{label}</span>
        {version.number !== null && (
          <span className="bilan-version__since"> · depuis le {dayLabel(version.since, now)}</span>
        )}
        {version.number !== null && (
          <Link
            to={{ name: "deckVersion", key: deckKey, number: version.number }}
            className="bilan-version__link"
            data-testid="bilan-version-link"
          >
            Voir la liste
          </Link>
        )}
      </span>
      <span className="bilan-version__meta">
        {groupMeta(version.stats)} · {formatAverage(averageVp(version.stats))} VP / partie
      </span>
    </li>
  );
}

export function DeckList({ groups, decorate, now }: { groups: readonly DeckGroup[]; decorate: Decorate; now: Date }) {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const toggle = (key: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  return (
    <ul className="bilan-list" data-testid="bilan-axis-deck">
      {groups.map((group) => {
        const expanded = open.has(group.key);
        const canExpand = !group.unknown;
        return (
          <GroupRow
            key={group.key}
            group={group}
            decoration={decorate(group)}
            toggle={
              canExpand ? (
                <button
                  type="button"
                  className="bilan-row__toggle"
                  aria-expanded={expanded}
                  aria-label={`Versions de ${group.label}`}
                  onClick={() => toggle(group.key)}
                  data-testid="bilan-deck-toggle"
                >
                  {expanded ? <CaretDownIcon size={16} /> : <CaretRightIcon size={16} />}
                </button>
              ) : (
                <span className="bilan-row__toggle-space" />
              )
            }
          >
            {expanded && (
              <ul className="bilan-versions">
                {group.versions.map((version) => (
                  <VersionLine key={version.key} deckKey={group.key as DeckKey} version={version} now={now} />
                ))}
              </ul>
            )}
          </GroupRow>
        );
      })}
    </ul>
  );
}

// --- Axe Position (P7, P8) -----------------------------------------------------

function Segmented<T extends string>({
  legend,
  options,
  labels,
  value,
  onChange,
  testId,
}: {
  legend: string;
  options: readonly T[];
  labels: Record<T, string>;
  value: T;
  onChange: (value: T) => void;
  testId: string;
}) {
  const name = useId();
  return (
    <fieldset className="seg" aria-label={legend} data-testid={testId}>
      {options.map((option) => (
        <label key={option} className="seg__option">
          <input
            type="radio"
            name={name}
            checked={value === option}
            onChange={() => onChange(option)}
            data-testid={`${testId}-${option}`}
          />
          {labels[option]}
        </label>
      ))}
    </fieldset>
  );
}

function UnderlineTabs<T extends string>({
  legend,
  options,
  labels,
  value,
  onChange,
  testId,
  className = "",
}: {
  legend: string;
  options: readonly T[];
  labels: Record<T, string>;
  value: T;
  onChange: (value: T) => void;
  testId: string;
  className?: string;
}) {
  const name = useId();
  return (
    <fieldset className={`tabs tabs--fieldset ${className}`} aria-label={legend} data-testid={testId}>
      {options.map((option) => (
        <label key={option} className="tab-option">
          <input
            type="radio"
            name={name}
            checked={value === option}
            onChange={() => onChange(option)}
            data-testid={`${testId}-${option}`}
          />
          <span className="tab-option__label">{labels[option]}</span>
        </label>
      ))}
    </fieldset>
  );
}

export { UnderlineTabs };

const NEAR_OPTIONS = ["prey", "predator"] as const;
const FAR_OPTIONS = ["grandPrey", "grandPredator"] as const;
const GROUPING_OPTIONS = ["archetype", "clan"] as const;

/** Sélecteurs de l'axe Position : « Ma proie | Mon prédateur », puis « Regrouper par Archétype | Clan ». */
export function PositionControls({
  state,
  onChange,
}: {
  state: PositionState;
  onChange: (state: PositionState) => void;
}) {
  return (
    <div className="bilan-position__controls">
      <Segmented
        legend="Position"
        options={NEAR_OPTIONS}
        labels={NEAR_LABELS}
        value={state.near}
        onChange={(near) => onChange({ ...state, near })}
        testId="bilan-position"
      />
      <div className="bilan-position__grouping">
        <span className="bilan-position__grouping-label">Regrouper par</span>
        <UnderlineTabs
          legend="Regrouper par"
          options={GROUPING_OPTIONS}
          labels={GROUPING_LABELS}
          value={state.grouping}
          onChange={(grouping) => onChange({ ...state, grouping })}
          testId="bilan-grouping"
        />
      </div>
    </div>
  );
}

const unseatedNote = (count: number) =>
  `${gamesCount(count)} sans siège ${count > 1 ? "ne sont pas comptées" : "n'est pas comptée"} ici.`;

const withoutGrandNote = (count: number) =>
  `${gamesCount(count)} à trois joueurs ou moins : les parties à trois joueurs ou moins n'ont pas de grande position.`;

/**
 * Corps de l'axe Position : groupes de la position proche, note des parties
 * sans siège, puis « Plus loin à la table », replié par défaut et atténué
 * (P8). `renderGroups` dessine les groupes à la manière de la disposition
 * (liste au mobile, tableau au bureau).
 */
export function PositionBody({
  facts,
  state,
  onChange,
  renderGroups,
}: {
  facts: readonly GameFact[];
  state: PositionState;
  onChange: (state: PositionState) => void;
  renderGroups: (axis: PositionAxis, far: boolean) => ReactNode;
}) {
  const near = positionAxis(facts, state.near, state.grouping);
  const far = positionAxis(facts, state.far, state.grouping);
  const noSeat = near.unseated === facts.length;
  return (
    <div className="bilan-position" data-testid="bilan-axis-position">
      {noSeat ? (
        <p className="empty-state__body" data-testid="bilan-position-no-seat">
          Aucune de ces parties ne porte votre siège : notez-le à la saisie pour savoir qui était votre proie.
        </p>
      ) : (
        renderGroups(near, false)
      )}
      {near.unseated > 0 && (
        <p className="bilan-note" data-testid="bilan-position-unseated">
          {unseatedNote(near.unseated)}
        </p>
      )}
      <div className="bilan-far">
        <button
          type="button"
          className="bilan-far__toggle"
          aria-expanded={state.farOpen}
          onClick={() => onChange({ ...state, farOpen: !state.farOpen })}
          data-testid="bilan-far-toggle"
        >
          {state.farOpen ? <CaretDownIcon size={16} /> : <CaretRightIcon size={16} />}
          <span>Plus loin à la table</span>
          <span className="bilan-far__hint">· Grande proie, grand prédateur</span>
        </button>
        {state.farOpen && (
          <div className="bilan-far__body" data-testid="bilan-far">
            <UnderlineTabs
              legend="Position éloignée"
              options={FAR_OPTIONS}
              labels={FAR_LABELS}
              value={state.far}
              onChange={(value) => onChange({ ...state, far: value })}
              testId="bilan-far-position"
              className="tabs--quiet"
            />
            {far.groups.length === 0 ? (
              <p className="bilan-note" data-testid="bilan-far-empty">
                Aucune partie à quatre joueurs ou plus avec votre siège.
              </p>
            ) : (
              renderGroups(far, true)
            )}
            {far.withoutPosition > 0 && (
              <p className="bilan-note" data-testid="bilan-far-without">
                {withoutGrandNote(far.withoutPosition)}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
