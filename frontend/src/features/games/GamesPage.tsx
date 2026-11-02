import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { CaretDownIcon, CaretUpIcon, ClockCountdownIcon, FunnelIcon, PlusIcon } from "@phosphor-icons/react";
import { Link } from "../../app/Link";
import { consumeIntent, type GamesIntent } from "../../app/routes";
import { Kbd } from "../../components/Kbd";
import { LoadingState } from "../../components/Loading";
import { Pill } from "../../components/Pill";
import { BackRow, Sheet } from "../../components/Sheet";
import { useIsDesktop } from "../../components/useIsDesktop";
import { useKeyboardShortcuts } from "../../components/useKeyboardShortcuts";
import { plural } from "../../labels";
import {
  findByKey,
  useLocalDecks,
  useLocalGames,
  useLocalTournaments,
  useLocalVenues,
  type DeckKey,
  type LocalDeck,
  type LocalGame,
  type LocalVenue,
  type ResourceKey,
} from "../../offline/vtes";
import { GameDetail } from "./GameDetail";
import { GameForm } from "./GameForm";
import { dayHeading, dayKey, formatVp, roundLabel, shortDateTime, timeOfDay } from "./gameFormat";
import { PlaySwitcher } from "./PlaySwitcher";

type GameType = "all" | "tournament" | "casual";

const TYPES: Array<{ value: GameType; label: string }> = [
  { value: "all", label: "Toutes" },
  { value: "tournament", label: "Tournoi" },
  { value: "casual", label: "Amicale" },
];

type SortColumn = "date" | "deck" | "tournament" | "venue" | "result";
type SortDir = "asc" | "desc";

const COLUMNS: Array<{ key: SortColumn; label: string }> = [
  { key: "date", label: "Date" },
  { key: "deck", label: "Mon deck" },
  { key: "tournament", label: "Tournoi · ronde" },
  { key: "venue", label: "Lieu" },
  { key: "result", label: "Résultat" },
];

/** Ce que la liste lit en plus de la partie : noms de deck et de lieu. */
interface Lookups {
  deckName(game: LocalGame): string;
  venueName(game: LocalGame): string | null;
  tournamentText(game: LocalGame): string;
}

function makeLookups(decks: LocalDeck[] | undefined, venues: LocalVenue[] | undefined): Lookups {
  return {
    deckName: (game) =>
      game.me.deckKey === null
        ? "Sans deck"
        : (decks?.find((deck) => deck.key === game.me.deckKey)?.name ?? (decks ? "Deck inconnu sur cet appareil" : "…")),
    venueName: (game) => (game.venueKey && venues ? (findByKey(venues, game.venueKey)?.name ?? null) : null),
    tournamentText: (game) =>
      game.tournamentName ? [game.tournamentName, roundLabel(game)].filter(Boolean).join(" · ") : "Amicale",
  };
}

function compareGames(column: SortColumn, lookups: Lookups) {
  const text = (a: string, b: string) => a.localeCompare(b, "fr");
  return (a: LocalGame, b: LocalGame): number => {
    switch (column) {
      case "date":
        return a.playedAt < b.playedAt ? -1 : a.playedAt > b.playedAt ? 1 : 0;
      case "deck":
        return text(lookups.deckName(a), lookups.deckName(b));
      case "tournament":
        return text(lookups.tournamentText(a), lookups.tournamentText(b));
      case "venue":
        return text(lookups.venueName(a) ?? "", lookups.venueName(b) ?? "");
      case "result":
        return (
          (a.me.victoryPoints ?? -1) - (b.me.victoryPoints ?? -1) ||
          Number(a.me.gameWin === true) - Number(b.me.gameWin === true)
        );
    }
  };
}

/** « 3 VP » puis « · GW » en accent, comme l'écran 12. */
function ResultCell({ game }: { game: LocalGame }) {
  const vp = game.me.victoryPoints;
  return (
    <span className="game-result" data-testid="game-result">
      {vp === null ? "—" : `${formatVp(vp)} VP`}
      {game.me.gameWin === true && <span className="game-result__gw"> · GW</span>}
    </span>
  );
}

/** Ligne mobile : lien vers le détail. */
function GameItem({ game, lookups }: { game: LocalGame; lookups: Lookups }) {
  const meta = [
    game.tournamentName ?? "Amicale",
    game.tournamentName ? roundLabel(game) : null,
    timeOfDay(game.playedAt),
    lookups.venueName(game),
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <li className="row" data-testid="game-item" data-game-key={game.key} data-pending={game.pending}>
      <Link to={{ name: "game", key: game.key }} className="row__link" data-testid="game-link">
        <span>
          <span className="row__name">{lookups.deckName(game)}</span>
          <span className="row__meta">{meta}</span>
          {game.pending && (
            <span className="row__pending" data-testid="pending-badge">
              <ClockCountdownIcon size={14} />
              En attente de synchronisation
            </span>
          )}
        </span>
        <ResultCell game={game} />
      </Link>
    </li>
  );
}

/** Feuille « Deck, lieu » du mobile (écran 12) : deux listes simples, appliquées aussitôt. */
function GameFilterSheet({
  decks,
  venues,
  deckKey,
  venueKey,
  onDeckChange,
  onVenueChange,
  onClose,
}: {
  decks: LocalDeck[];
  venues: LocalVenue[];
  deckKey: DeckKey | null;
  venueKey: ResourceKey | null;
  onDeckChange: (key: DeckKey | null) => void;
  onVenueChange: (key: ResourceKey | null) => void;
  onClose: () => void;
}) {
  const id = useId();
  const titleRef = useRef<HTMLHeadingElement>(null);
  return (
    <Sheet titleId={`${id}-title`} titleRef={titleRef} onClose={onClose} variant="pushed" data-testid="game-filters-sheet">
      <BackRow label="Parties" onClick={onClose} />
      <h2 id={`${id}-title`} ref={titleRef} tabIndex={-1} className="sheet__title">
        Filtrer les parties
      </h2>
      <div className="field">
        <label htmlFor={`${id}-deck`}>Deck</label>
        <select
          id={`${id}-deck`}
          className="underline-field"
          value={deckKey ?? ""}
          onChange={(event) => onDeckChange(event.target.value === "" ? null : (event.target.value as DeckKey))}
          data-testid="game-filter-deck"
        >
          <option value="">Tous les decks</option>
          {decks.map((deck) => (
            <option key={deck.key} value={deck.key}>
              {deck.name}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor={`${id}-venue`}>Lieu</label>
        <select
          id={`${id}-venue`}
          className="underline-field"
          value={venueKey ?? ""}
          onChange={(event) =>
            onVenueChange(event.target.value === "" ? null : (event.target.value as ResourceKey))
          }
          data-testid="game-filter-venue"
        >
          <option value="">Tous les lieux</option>
          {venues.map((venue) => (
            <option key={venue.key} value={venue.key}>
              {venue.name}
            </option>
          ))}
        </select>
      </div>
      <div className="sheet-form__footer">
        <Pill onClick={onClose} data-testid="game-filters-done">
          Terminé
        </Pill>
      </div>
    </Sheet>
  );
}

/** Liste des parties groupées par jour (mobile). */
function DayGroups({ games, lookups }: { games: LocalGame[]; lookups: Lookups }) {
  const groups: Array<{ day: string; heading: string; games: LocalGame[] }> = [];
  for (const game of games) {
    const day = dayKey(game.playedAt);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.games.push(game);
    else groups.push({ day, heading: dayHeading(game.playedAt), games: [game] });
  }
  return (
    <div data-testid="game-list">
      {groups.map((group) => (
        <section key={group.day} className="day-group" data-testid="game-day">
          <p className="kicker">{group.heading}</p>
          <ul className="list">
            {group.games.map((game) => (
              <GameItem key={game.key} game={game} lookups={lookups} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** Tableau triable du bureau : une ligne sélectionne la partie du panneau de droite. */
function GamesTable({
  games,
  lookups,
  selectedKey,
  sort,
  onSort,
  onSelect,
}: {
  games: LocalGame[];
  lookups: Lookups;
  selectedKey: ResourceKey | null;
  sort: { column: SortColumn; dir: SortDir };
  onSort: (column: SortColumn) => void;
  onSelect: (key: ResourceKey) => void;
}) {
  return (
    <div className="games-table" data-testid="game-table-desktop">
      <div className="games-table__row games-table__row--head">
        {COLUMNS.map((column) => (
          <span
            key={column.key}
            className={`games-table__cell games-table__cell--head${column.key === "result" ? " games-table__cell--end" : ""}`}
            aria-sort={sort.column === column.key ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}
          >
            <button
              type="button"
              className="stock-table__sort"
              onClick={() => onSort(column.key)}
              data-testid={`game-sort-${column.key}`}
            >
              {column.label}
              {sort.column === column.key &&
                (sort.dir === "asc" ? <CaretUpIcon size={12} /> : <CaretDownIcon size={12} />)}
            </button>
          </span>
        ))}
      </div>
      <ul className="list" data-testid="game-list">
        {games.map((game) => (
          <li
            key={game.key}
            data-testid="game-item"
            data-game-key={game.key}
            data-pending={game.pending}
            data-selected={selectedKey === game.key}
          >
            <button
              type="button"
              className="games-table__row games-table__row--body"
              aria-current={selectedKey === game.key ? "true" : undefined}
              onClick={() => onSelect(game.key)}
              data-testid="game-select"
            >
              <span className="games-table__cell">
                {shortDateTime(game.playedAt)}
                {game.pending && (
                  <ClockCountdownIcon size={13} className="games-table__pending" data-testid="pending-badge" aria-label="En attente de synchronisation" />
                )}
              </span>
              <span className="games-table__cell games-table__cell--strong">{lookups.deckName(game)}</span>
              <span className={game.tournamentName ? "games-table__cell" : "games-table__cell games-table__cell--muted"}>
                {lookups.tournamentText(game)}
              </span>
              <span className="games-table__cell">{lookups.venueName(game) ?? "—"}</span>
              <span className="games-table__cell games-table__cell--end">
                <ResultCell game={game} />
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Parties : liste locale groupée par jour (mobile, écran 12) ou tableau triable avec détail
 * à droite (bureau, d10). Le sélecteur « Parties | Tournois » est une route à part.
 *
 * Filtres : onglets Toutes / Tournoi / Amicale et feuille « Deck, lieu » au mobile ; trois
 * sélecteurs texte au bureau, sur le même état. La saisie (`GameForm`) s'ouvre par la
 * pilule « Nouvelle partie », par `N`, ou par l'intention de route
 * `#/parties?action=nouvelle`, consommée une seule fois.
 */
export function GamesPage({ intent }: { intent?: GamesIntent } = {}) {
  const tabsName = useId();
  const isDesktop = useIsDesktop();
  const [type, setType] = useState<GameType>("all");
  const [deckFilter, setDeckFilter] = useState<DeckKey | null>(null);
  const [venueFilter, setVenueFilter] = useState<ResourceKey | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [detailEditing, setDetailEditing] = useState(false);
  const [selectedKey, setSelectedKey] = useState<ResourceKey | null>(null);
  const [sort, setSort] = useState<{ column: SortColumn; dir: SortDir }>({ column: "date", dir: "desc" });

  const games = useLocalGames({
    casual: type === "all" ? undefined : type === "casual",
    deckKey: deckFilter ?? undefined,
    venueKey: venueFilter ?? undefined,
  });
  const allGames = useLocalGames();
  const tournaments = useLocalTournaments();
  const decks = useLocalDecks({ state: "all" });
  const venues = useLocalVenues();
  const lookups = useMemo(() => makeLookups(decks, venues), [decks, venues]);

  // Intention portée par l'adresse (`#/parties?action=nouvelle`) : ouvre la saisie puis la
  // retire de l'adresse (`consumeIntent`), comme `DecksPage`.
  const [seenIntent, setSeenIntent] = useState<GamesIntent | undefined>(undefined);
  if (intent !== seenIntent) {
    setSeenIntent(intent);
    if (intent === "new") setCreating(true);
  }
  useEffect(() => {
    if (intent) consumeIntent({ name: "games", intent });
  }, [intent]);

  const sorted = useMemo(() => {
    if (!games) return undefined;
    const ordered = [...games].sort(compareGames(sort.column, lookups));
    return sort.dir === "desc" ? ordered.reverse() : ordered;
  }, [games, sort, lookups]);

  const selectedGame = useMemo(
    () => (sorted ? ((selectedKey && findByKey(sorted, selectedKey)) || sorted[0] || null) : null),
    [sorted, selectedKey],
  );

  const toggleSort = (column: SortColumn) =>
    setSort((current) =>
      column === current.column
        ? { column, dir: current.dir === "asc" ? "desc" : "asc" }
        : { column, dir: column === "date" || column === "result" ? "desc" : "asc" },
    );

  // `N` ouvre la saisie ; inactif pendant qu'une feuille est ouverte (elle a ses propres raccourcis).
  useKeyboardShortcuts([{ keys: ["n"], onTrigger: () => setCreating(true) }], {
    enabled: !creating && !filtersOpen && !detailEditing,
  });

  const filtered = type !== "all" || deckFilter !== null || venueFilter !== null;
  const total = allGames?.length;

  const typeTabs: ReactNode = (
    <fieldset className="tabs tabs--fieldset" aria-label="Type de partie" data-testid="game-type-tabs">
      {TYPES.map((option) => (
        <label key={option.value} className="tab-option">
          <input
            type="radio"
            name={tabsName}
            value={option.value}
            checked={type === option.value}
            onChange={() => setType(option.value)}
          />
          <span className="tab-option__label">{option.label}</span>
        </label>
      ))}
    </fieldset>
  );

  const desktopFilters = (
    <div className="games-filters" data-testid="game-filters">
      <label className="filter-select">
        <span>Type :</span>
        <select
          value={type}
          onChange={(event) => setType(event.target.value as GameType)}
          aria-label="Type"
          data-testid="game-filter-type"
        >
          {TYPES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label.toLowerCase()}
            </option>
          ))}
        </select>
      </label>
      <label className="filter-select">
        <span>Deck :</span>
        <select
          value={deckFilter ?? ""}
          onChange={(event) => setDeckFilter(event.target.value === "" ? null : (event.target.value as DeckKey))}
          aria-label="Deck"
          data-testid="game-filter-deck"
        >
          <option value="">tous</option>
          {(decks ?? []).map((deck) => (
            <option key={deck.key} value={deck.key}>
              {deck.name}
            </option>
          ))}
        </select>
      </label>
      <label className="filter-select">
        <span>Lieu :</span>
        <select
          value={venueFilter ?? ""}
          onChange={(event) =>
            setVenueFilter(event.target.value === "" ? null : (event.target.value as ResourceKey))
          }
          aria-label="Lieu"
          data-testid="game-filter-venue"
        >
          <option value="">tous</option>
          {(venues ?? []).map((venue) => (
            <option key={venue.key} value={venue.key}>
              {venue.name}
            </option>
          ))}
        </select>
      </label>
    </div>
  );

  const emptyAll = games !== undefined && games.length === 0 && !filtered;

  return (
    <div className="page page--with-floating page--games" data-testid="games-page">
      <div className="games-grid">
        <div className="games-master">
          <div className="decks-header">
            <div>
              <h2 className="page-title">Parties</h2>
              <p className="page-meta" data-testid="games-count">
                {games ? plural(games.length, "partie") : "…"}
                {isDesktop && tournaments ? ` · ${plural(tournaments.length, "tournoi")}` : ""} · lecture locale
              </p>
            </div>
            {isDesktop && (
              <button
                type="button"
                className="btn btn-primary"
                data-testid="games-new-desktop"
                aria-keyshortcuts="n"
                onClick={() => setCreating(true)}
              >
                <PlusIcon size={16} />
                Nouvelle partie
                <Kbd>N</Kbd>
              </button>
            )}
          </div>

          <div className="games-toolbar">
            <PlaySwitcher active="games" gameCount={total} tournamentCount={tournaments?.length} />
            {isDesktop && desktopFilters}
          </div>

          {!isDesktop && (
            <div className="filter-row">
              {typeTabs}
              <button
                type="button"
                className="btn-text games-filter-button"
                onClick={() => setFiltersOpen(true)}
                data-testid="game-filters-open"
              >
                <FunnelIcon size={16} />
                Deck, lieu
              </button>
            </div>
          )}

          {sorted === undefined ? (
            <LoadingState variant={isDesktop ? "table" : "list"} caption="Lecture des parties — aucun appel réseau." />
          ) : emptyAll ? (
            <div className="empty-state" data-testid="games-empty">
              <h3 className="empty-state__title">Aucune partie</h3>
              <p className="empty-state__body">Notez votre première partie : votre deck et vos VP suffisent.</p>
              <div className="empty-state__actions">
                <button
                  type="button"
                  className="btn btn-primary btn--pill"
                  data-testid="games-empty-create"
                  onClick={() => setCreating(true)}
                >
                  <PlusIcon size={18} />
                  Nouvelle partie
                </button>
              </div>
            </div>
          ) : sorted.length === 0 ? (
            <p className="empty-state__body" data-testid="games-no-match">
              Aucune partie ne correspond à ces filtres.
            </p>
          ) : isDesktop ? (
            <GamesTable
              games={sorted}
              lookups={lookups}
              selectedKey={selectedGame?.key ?? null}
              sort={sort}
              onSort={toggleSort}
              onSelect={setSelectedKey}
            />
          ) : (
            <DayGroups games={sorted} lookups={lookups} />
          )}
        </div>

        {isDesktop && (
          <div className="decks-detail games-detail" data-testid="games-detail">
            {selectedGame ? (
              <GameDetail
                key={selectedGame.key}
                game={selectedGame}
                dense
                shortcuts={!creating}
                onEditingChange={setDetailEditing}
              />
            ) : (
              <p className="empty-state__body" data-testid="games-detail-empty">
                Aucune partie à afficher. Créez-en une avec « Nouvelle partie ».
              </p>
            )}
          </div>
        )}
      </div>

      <div className="floating-actions">
        <Pill onClick={() => setCreating(true)} data-testid="game-add">
          <PlusIcon size={20} />
          Nouvelle partie
        </Pill>
      </div>

      {filtersOpen && !isDesktop && (
        <GameFilterSheet
          decks={decks ?? []}
          venues={venues ?? []}
          deckKey={deckFilter}
          venueKey={venueFilter}
          onDeckChange={setDeckFilter}
          onVenueChange={setVenueFilter}
          onClose={() => setFiltersOpen(false)}
        />
      )}
      {creating && <GameForm onClose={() => setCreating(false)} onSaved={setSelectedKey} />}
    </div>
  );
}
