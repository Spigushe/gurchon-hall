import { useMemo, useState } from "react";
import { AddressBookIcon, PlusIcon } from "@phosphor-icons/react";
import { Link } from "../../app/Link";
import { LoadingState } from "../../components/Loading";
import { useIsDesktop } from "../../components/useIsDesktop";
import type { DeckKey, ResourceKey } from "../../offline/vtes";
import { PlaySwitcher } from "../games/PlaySwitcher";
import {
  bilanSummary,
  deckAxis,
  DEFAULT_BILAN_FILTERS,
  filterFacts,
  gameWinsLine,
  monthAxis,
  opponentAxis,
  pointsLine,
  tournamentsLine,
  venueAxis,
  type BilanFilters,
  type GameFact,
  type Group,
} from "./bilanModel";
import { DeckList, GroupList, PositionBody, PositionControls, UnderlineTabs } from "./BilanAxes";
import { BilanFilterBar, BilanFilterLine, BilanFilterSheet } from "./BilanFilters";
import {
  DEFAULT_POSITION_STATE,
  filtersSummary,
  noDecoration,
  positionDecoration,
  type Decorate,
  type PositionState,
} from "./bilanView";
import { BarsLegend } from "./BilanParts";
import { AxisTable, SelectionPanel, type Selection } from "./BilanTables";
import { useBilanData, type BilanData } from "./useBilanData";

type AxisKey = "deck" | "venue" | "month" | "position" | "opponents";
const AXES: readonly AxisKey[] = ["deck", "venue", "month", "position", "opponents"];
const AXIS_LABELS: Record<AxisKey, string> = {
  deck: "Deck",
  venue: "Lieu",
  month: "Mois",
  position: "Position",
  opponents: "Adversaires",
};

/** Les axes calculés sur les parties filtrées, et la décoration de leurs lignes. */
function useAxes(data: BilanData, facts: readonly GameFact[]) {
  return useMemo(() => {
    const deckDecoration: Decorate = (group) =>
      group.unknown
        ? {}
        : {
            clan: data.deckClan(group.key as DeckKey),
            archetype: data.deckOf(group.key as DeckKey)?.archetype ?? null,
          };
    const venueDecoration: Decorate = (group) =>
      group.unknown ? {} : { sub: data.venueOf(group.key as ResourceKey)?.city ?? null };
    return {
      deck: deckAxis(facts, data.deckName),
      venue: venueAxis(facts, data.venueName),
      month: monthAxis(facts),
      opponents: opponentAxis(facts, data.playerName),
      deckDecoration,
      venueDecoration,
    };
  }, [data, facts]);
}

function Summary({ facts }: { facts: readonly GameFact[] }) {
  const summary = bilanSummary(facts);
  return (
    <div className="bilan-summary" data-testid="bilan-summary">
      <div>
        <p className="bilan-summary__headline" data-testid="bilan-summary-games">
          {gameWinsLine(summary)}
        </p>
        <p className="bilan-summary__line" data-testid="bilan-summary-points">
          {pointsLine(summary)}
        </p>
        <p className="bilan-summary__line" data-testid="bilan-summary-tournaments">
          {tournamentsLine(summary)}
        </p>
      </div>
      <BarsLegend />
    </div>
  );
}

function NoGames() {
  return (
    <div className="empty-state" data-testid="bilan-empty">
      <h3 className="empty-state__title">Rien à analyser pour l'instant</h3>
      <p className="empty-state__body">Le bilan se remplit dès votre première partie : votre deck et vos VP suffisent.</p>
      <div className="empty-state__actions">
        <Link to={{ name: "games", intent: "new" }} className="btn btn-primary btn--pill" data-testid="bilan-empty-new">
          <PlusIcon size={18} />
          Nouvelle partie
        </Link>
      </div>
    </div>
  );
}

function NoMatch({ onClear }: { onClear: () => void }) {
  return (
    <div className="empty-state" data-testid="bilan-no-match">
      <p className="empty-state__body">Aucune partie ne correspond à ces filtres.</p>
      <div className="empty-state__actions">
        <button type="button" className="btn btn-secondary" onClick={onClear} data-testid="bilan-no-match-clear">
          Effacer les filtres
        </button>
      </div>
    </div>
  );
}

interface AxesProps {
  data: BilanData;
  facts: readonly GameFact[];
  position: PositionState;
  onPosition: (state: PositionState) => void;
  now: Date;
}

/** Mobile (1b-46) : un axe à la fois, sous des onglets soulignés défilants. */
function MobileAxes({ data, facts, position, onPosition, now }: AxesProps) {
  const [axis, setAxis] = useState<AxisKey>("deck");
  const axes = useAxes(data, facts);
  const lists: Record<Exclude<AxisKey, "deck" | "position">, { groups: Group[]; decorate: Decorate }> = {
    venue: { groups: axes.venue, decorate: axes.venueDecoration },
    month: { groups: axes.month, decorate: noDecoration },
    opponents: { groups: axes.opponents, decorate: noDecoration },
  };
  return (
    <div className="bilan-axes">
      <UnderlineTabs
        legend="Axe du bilan"
        options={AXES}
        labels={AXIS_LABELS}
        value={axis}
        onChange={setAxis}
        testId="bilan-axis-tab"
        className="bilan-axis-tabs"
      />
      {axis === "deck" && <DeckList groups={axes.deck} decorate={axes.deckDecoration} now={now} />}
      {axis === "position" && (
        <>
          <PositionControls state={position} onChange={onPosition} />
          <PositionBody
            facts={facts}
            state={position}
            onChange={onPosition}
            renderGroups={(result, far) => (
              <GroupList
                groups={result.groups}
                decorate={positionDecoration(position.grouping)}
                compact={far}
                testId={far ? "bilan-far-list" : "bilan-position-list"}
              />
            )}
          />
        </>
      )}
      {axis === "opponents" && <p className="bilan-note">Mes résultats aux tables où il était.</p>}
      {axis !== "deck" && axis !== "position" && (
        <GroupList groups={lists[axis].groups} decorate={lists[axis].decorate} testId={`bilan-axis-${axis}`} />
      )}
    </div>
  );
}

/** Bureau (d25) : axes en grille, la position sur toute la largeur, une ligne ouvre le panneau des parties. */
function DesktopAxes({
  data,
  facts,
  position,
  onPosition,
  now,
  selection,
  onSelect,
}: AxesProps & { selection: Selection | null; onSelect: (selection: Selection) => void }) {
  const axes = useAxes(data, facts);
  const common = { selection, onSelect, now };
  return (
    <div className="bilan-grid">
      <AxisTable
        axis="deck"
        title="Deck"
        groups={axes.deck}
        decorate={axes.deckDecoration}
        testId="bilan-axis-deck"
        {...common}
      />
      <AxisTable
        axis="venue"
        title="Lieu"
        groups={axes.venue}
        decorate={axes.venueDecoration}
        testId="bilan-axis-venue"
        {...common}
      />
      <AxisTable axis="month" title="Mois" groups={axes.month} decorate={noDecoration} testId="bilan-axis-month" {...common} />
      <AxisTable
        axis="opponents"
        title="Adversaires"
        groups={axes.opponents}
        decorate={noDecoration}
        testId="bilan-axis-opponents"
        headerExtra={<span className="bilan-section__hint">Mes résultats aux tables où il était</span>}
        {...common}
      />
      <section className="bilan-section bilan-section--wide">
        <header className="bilan-section__head">
          <h3 className="bilan-section__title">Position</h3>
          <PositionControls state={position} onChange={onPosition} />
        </header>
        <PositionBody
          facts={facts}
          state={position}
          onChange={onPosition}
          renderGroups={(result, far) => (
            <AxisTable
              axis={far ? `far-${position.far}-${position.grouping}` : `near-${position.near}-${position.grouping}`}
              title={far ? (position.far === "grandPrey" ? "Grande proie" : "Grand prédateur") : position.near === "prey" ? "Ma proie" : "Mon prédateur"}
              groups={result.groups}
              decorate={positionDecoration(position.grouping)}
              compact={far}
              testId={far ? "bilan-far-list" : "bilan-position-list"}
              {...common}
            />
          )}
        />
      </section>
    </div>
  );
}

/**
 * Bilan (Lot 8, D2 ; 1b-46 à 1b-58, d25, d34), troisième segment de l'onglet
 * Parties (`#/bilan`). Calculé sur l'appareil à partir du miroir (P9), hors
 * ligne comme le reste ; jamais de pourcentage (P8). `initialDeck` vient de
 * « Voir dans le bilan » (`#/bilan?deck=<clé>`).
 */
export function BilanPage({ initialDeck }: { initialDeck: DeckKey | null }) {
  const isDesktop = useIsDesktop();
  const data = useBilanData();
  const [now] = useState(() => new Date());
  const [filters, setFilters] = useState<BilanFilters>({ ...DEFAULT_BILAN_FILTERS, deckKey: initialDeck });
  const [sheetOpen, setSheetOpen] = useState(false);
  const [position, setPosition] = useState<PositionState>(DEFAULT_POSITION_STATE);
  const [selection, setSelection] = useState<Selection | null>(null);
  const facts = useMemo(() => (data ? filterFacts(data.facts, filters, now) : []), [data, filters, now]);

  const changeFilters = (next: BilanFilters) => {
    setFilters(next);
    setSelection(null);
  };
  const deckNameOfFact = (fact: GameFact) => (fact.deckKey && data ? data.deckName(fact.deckKey) : null);
  const axesProps = data ? { data, facts, position, onPosition: setPosition, now } : null;

  return (
    <div className="page page--games" data-testid="bilan-page">
      <div className={selection && isDesktop ? "bilan-layout bilan-layout--panel" : "bilan-layout"}>
        <div className="bilan-main">
          <div className="decks-header play-header">
            <div>
              <h2 className="page-title">Parties</h2>
              <p className="page-meta">Bilan · lecture locale</p>
            </div>
            <div className="play-header__actions">
              <Link to={{ name: "notebook" }} className="btn btn-secondary" data-testid="notebook-open">
                <AddressBookIcon size={16} />
                Carnet
              </Link>
            </div>
          </div>
          <div className="games-toolbar">
            <PlaySwitcher active="bilan" gameCount={data?.games.length} />
          </div>

          {!data || !axesProps ? (
            <LoadingState variant={isDesktop ? "table" : "list"} caption="Lecture des parties — aucun appel réseau." />
          ) : data.facts.length === 0 ? (
            <NoGames />
          ) : (
            <>
              {isDesktop ? (
                <BilanFilterBar
                  filters={filters}
                  onChange={changeFilters}
                  decks={data.playedDecks}
                  deckClan={data.deckClan}
                  now={now}
                />
              ) : (
                <BilanFilterLine summary={filtersSummary(filters, data.deckName)} onOpen={() => setSheetOpen(true)} />
              )}
              {facts.length === 0 ? (
                <NoMatch onClear={() => changeFilters(DEFAULT_BILAN_FILTERS)} />
              ) : (
                <>
                  <Summary facts={facts} />
                  {isDesktop ? (
                    <DesktopAxes {...axesProps} selection={selection} onSelect={setSelection} />
                  ) : (
                    <MobileAxes {...axesProps} />
                  )}
                </>
              )}
            </>
          )}
        </div>
        {isDesktop && selection && (
          <SelectionPanel selection={selection} onClose={() => setSelection(null)} deckName={deckNameOfFact} />
        )}
      </div>

      {sheetOpen && data && (
        <BilanFilterSheet
          filters={filters}
          onApply={(next) => {
            changeFilters(next);
            setSheetOpen(false);
          }}
          onClose={() => setSheetOpen(false)}
          facts={data.facts}
          decks={data.playedDecks}
          deckClan={data.deckClan}
          now={now}
        />
      )}
    </div>
  );
}
