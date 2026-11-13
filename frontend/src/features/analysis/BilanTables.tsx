import { useState, type ReactNode } from "react";
import { CaretDownIcon, CaretRightIcon, ClockCountdownIcon, XIcon } from "@phosphor-icons/react";
import { Link } from "../../app/Link";
import type { DeckKey } from "../../offline/vtes";
import {
  averageVp,
  dayLabel,
  formatAverage,
  formatPoints,
  gameWinsLine,
  nextSort,
  pointsLine,
  sortGroups,
  versionLabel,
  type DeckGroup,
  type GameFact,
  type Group,
  type GroupColumn,
  type GroupSort,
} from "./bilanModel";
import type { Decorate } from "./bilanView";
import { ArchetypeTag, ClanMark, FactLine, StatBars } from "./BilanParts";

/** Ligne sélectionnée du bureau : l'axe et le groupe, que le panneau de droite détaille. */
export interface Selection {
  axis: string;
  title: string;
  group: Group;
}

const COLUMNS: ReadonlyArray<{ column: GroupColumn; label: string }> = [
  { column: "label", label: "Groupe" },
  { column: "games", label: "Parties" },
  { column: "gameWins", label: "GW" },
  { column: "victoryPoints", label: "VP total" },
  { column: "average", label: "VP moyen" },
];

const ariaSort = (sort: GroupSort | null, column: GroupColumn) => {
  if (sort?.column !== column) return "none";
  return sort.descending ? "descending" : "ascending";
};

function HeaderRow({ sort, onSort }: { sort: GroupSort | null; onSort: (column: GroupColumn) => void }) {
  return (
    <div className="bilan-table__row bilan-table__row--head" role="row">
      {COLUMNS.map(({ column, label }) => (
        <span key={column} role="columnheader" aria-sort={ariaSort(sort, column)} className="bilan-table__th">
          <button type="button" onClick={() => onSort(column)} data-testid={`bilan-sort-${column}`}>
            {label}
          </button>
        </span>
      ))}
    </div>
  );
}

function NameCell({ group, decorate, toggle }: { group: Group; decorate: Decorate; toggle?: ReactNode }) {
  const decoration = decorate(group);
  return (
    <span role="cell" className="bilan-table__name">
      {toggle}
      {decoration.clan && <ClanMark clan={decoration.clan} />}
      <span className={group.unknown ? "bilan-row__name--unknown" : undefined}>{group.label}</span>
      {decoration.archetype && <ArchetypeTag archetype={decoration.archetype} />}
      {decoration.sub && <span className="bilan-row__sub">{decoration.sub}</span>}
    </span>
  );
}

function NumberCells({ stats, bars }: { stats: Group["stats"]; bars: boolean }) {
  return (
    <>
      <span role="cell" className="bilan-table__num">
        {stats.games}
      </span>
      <span role="cell" className="bilan-table__num">
        {stats.gameWins}
        {bars && <StatBars stats={stats} />}
      </span>
      <span role="cell" className="bilan-table__num">
        {formatPoints(stats.victoryPoints)}
      </span>
      <span role="cell" className="bilan-table__num bilan-table__num--strong">
        {formatAverage(averageVp(stats))}
      </span>
    </>
  );
}

function GroupTableRow({
  group,
  decorate,
  selected,
  onSelect,
  compact,
  toggle,
}: {
  group: Group;
  decorate: Decorate;
  selected: boolean;
  onSelect: () => void;
  compact: boolean;
  toggle?: ReactNode;
}) {
  return (
    <div
      className={`bilan-table__row${compact ? " bilan-table__row--compact" : ""}`}
      role="row"
      aria-selected={selected}
      data-testid="bilan-table-row"
      data-group={group.key}
      data-games={group.stats.games}
      onClick={onSelect}
    >
      <NameCell group={group} decorate={decorate} toggle={toggle} />
      <NumberCells stats={group.stats} bars={!compact} />
      <button
        type="button"
        className="bilan-table__select"
        aria-label={`Voir les parties : ${group.label}`}
        onClick={(event) => {
          event.stopPropagation();
          onSelect();
        }}
        data-testid="bilan-table-select"
      />
    </div>
  );
}

function VersionRow({ deckKey, version, now }: { deckKey: DeckKey; version: DeckGroup["versions"][number]; now: Date }) {
  return (
    <div className="bilan-table__row bilan-table__row--version" role="row" data-testid="bilan-version" data-version={version.key}>
      <span role="cell" className="bilan-table__name">
        {version.pending && <ClockCountdownIcon size={14} className="bilan-version__pending" aria-hidden="true" />}
        <span>{versionLabel(version)}</span>
        {version.number !== null && <span className="bilan-row__sub">depuis le {dayLabel(version.since, now)}</span>}
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
      <NumberCells stats={version.stats} bars={false} />
    </div>
  );
}

/**
 * Tableau d'un axe au bureau (d25) : `Groupe · Parties · GW · VP total · VP
 * moyen`, tri au clic d'en-tête (« inconnu » reste en dernier), une ligne qui
 * ouvre le panneau des parties. Pour l'axe Deck, les versions se déplient sous
 * leur deck.
 */
export function AxisTable({
  axis,
  title,
  groups,
  decorate,
  selection,
  onSelect,
  compact = false,
  now,
  headerExtra,
  testId,
}: {
  axis: string;
  title: string;
  groups: readonly Group[];
  decorate: Decorate;
  selection: Selection | null;
  onSelect: (selection: Selection) => void;
  compact?: boolean;
  now: Date;
  headerExtra?: ReactNode;
  testId: string;
}) {
  const [sort, setSort] = useState<GroupSort | null>(null);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const toggle = (key: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  const rows = sortGroups(groups, sort);
  return (
    <section className="bilan-section" data-testid={testId}>
      <header className="bilan-section__head">
        <h3 className="bilan-section__title">{title}</h3>
        {headerExtra}
      </header>
      <div role="table" aria-label={title} className="bilan-table">
        <HeaderRow sort={sort} onSort={(column) => setSort(nextSort(sort, column))} />
        {rows.map((group) => {
          const versions = (group as DeckGroup).versions;
          const expandable = versions !== undefined && !group.unknown;
          const expanded = expandable && open.has(group.key);
          return (
            <div key={group.key} role="rowgroup">
              <GroupTableRow
                group={group}
                decorate={decorate}
                compact={compact}
                selected={selection?.axis === axis && selection.group.key === group.key}
                onSelect={() => onSelect({ axis, title, group })}
                toggle={
                  expandable ? (
                    <button
                      type="button"
                      className="bilan-row__toggle"
                      aria-expanded={expanded}
                      aria-label={`Versions de ${group.label}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        toggle(group.key);
                      }}
                      data-testid="bilan-deck-toggle"
                    >
                      {expanded ? <CaretDownIcon size={14} /> : <CaretRightIcon size={14} />}
                    </button>
                  ) : undefined
                }
              />
              {expanded &&
                versions.map((version) => (
                  <VersionRow key={version.key} deckKey={group.key as DeckKey} version={version} now={now} />
                ))}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** Panneau de droite (360 px, patron d10) : le groupe, son bilan et ses parties. */
export function SelectionPanel({
  selection,
  onClose,
  deckName,
}: {
  selection: Selection;
  onClose: () => void;
  deckName: (fact: GameFact) => string | null;
}) {
  const { group, title } = selection;
  const facts = [...group.facts].sort((a, b) => b.playedAt.localeCompare(a.playedAt));
  return (
    <aside className="bilan-panel" aria-label={`Parties : ${group.label}`} data-testid="bilan-panel">
      <div className="bilan-panel__head">
        <div>
          <p className="kicker">{title}</p>
          <h3 className="bilan-panel__title" data-testid="bilan-panel-title">
            {group.label}
          </h3>
        </div>
        <button type="button" className="sheet__close" aria-label="Fermer le panneau" onClick={onClose}>
          <XIcon size={20} />
        </button>
      </div>
      <p className="bilan-summary__headline">{gameWinsLine(group.stats)}</p>
      <p className="bilan-summary__line">{pointsLine(group.stats)}</p>
      <StatBars stats={group.stats} />
      <ul className="bilan-facts">
        {facts.map((fact) => (
          <FactLine key={fact.key} fact={fact} deckName={deckName(fact)} />
        ))}
      </ul>
    </aside>
  );
}
