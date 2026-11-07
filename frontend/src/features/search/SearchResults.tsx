import { useEffect, useRef, type ReactNode } from "react";
import { CaretDownIcon, CaretUpIcon, CheckCircleIcon } from "@phosphor-icons/react";
import { cardLabel } from "../../labels";
import type { CardSort, CardSortKey, SearchableCard } from "../../offline/vtes";
import { LegalityMention } from "./CardDetail";
import { ClanGlyph, CostGlyph, DisciplineGlyphs, TypeGlyph } from "../../components/glyphs/Glyph";
import type { CategoryTab } from "./searchModel";
import { TRANCHE, useTranches } from "./useTranches";

/** Sentinelle observée au bas de la liste ; sans `IntersectionObserver` (jsdom), seul le bouton reste. */
function useAutoLoad(onVisible: () => void, enabled: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const callback = useRef(onVisible);
  useEffect(() => {
    callback.current = onVisible;
  });
  useEffect(() => {
    const node = ref.current;
    if (!enabled || !node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) callback.current();
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [enabled]);
  return ref;
}

export interface RowStatus {
  owned: (cardId: number) => number;
  inDeck: (cardId: number) => number;
  /** Deck cible choisi : la mention « dans ce deck ×N » et la colonne Deck ont un sens. */
  hasDeck: boolean;
  on: string;
  /** « +3 à l'instant » pendant la confirmation d'un ajout (D2), `null` sinon. */
  confirmed: (cardId: number) => string | null;
}

function Confirmed({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <span className="search-row__confirmed" data-testid="search-row-confirmed">
      <CheckCircleIcon size={14} weight="fill" aria-hidden="true" />
      {text}
    </span>
  );
}

function RowMeta({ item }: { item: SearchableCard }) {
  const { card, details } = item;
  if (card.category === "crypt") {
    const parts = [card.clanName, details?.sect, details?.title, card.groupCode].filter(Boolean);
    return (
      <span className="search-row__meta">
        <ClanGlyph name={card.clanName} decorative />
        {parts.join(" · ")}
      </span>
    );
  }
  const types = details?.types ?? [];
  return (
    <span className="search-row__meta">
      {types[0] && <TypeGlyph type={types[0]} decorative />}
      {types.join(" / ") || "Bibliothèque"}
    </span>
  );
}

function RowEnd({ item }: { item: SearchableCard }) {
  const { card, details } = item;
  if (card.category === "crypt") {
    return card.capacity === null ? null : (
      <span className="search-row__end" aria-label={`Capacité ${card.capacity}`}>
        <span className="search-row__capacity">{card.capacity}</span>
        <small aria-hidden="true">cap.</small>
      </span>
    );
  }
  if (!details?.costType || !details.costValue) return null;
  return (
    <span className="search-row__end">
      <CostGlyph costType={details.costType} value={details.costValue} />
      <small aria-hidden="true">{details.costType === "blood" ? "sang" : details.costType}</small>
    </span>
  );
}

function ResultRow({ item, status, onOpen }: { item: SearchableCard; status: RowStatus; onOpen: (item: SearchableCard) => void }) {
  const owned = status.owned(item.card.id);
  const inDeck = status.inDeck(item.card.id);
  const confirmed = status.confirmed(item.card.id);
  return (
    <li className={confirmed ? "search-row search-row--confirmed" : "search-row"} data-testid="search-row" data-card-id={item.card.id}>
      <button type="button" className="search-row__button" onClick={() => onOpen(item)}>
        <span className="search-row__main">
          <span className="search-row__name">{cardLabel(item.card)}</span>
          <RowMeta item={item} />
          <span className="search-row__status">
            {item.details && <DisciplineGlyphs disciplines={item.details.disciplines} size="row" />}
            {owned > 0 && (
              <span className="search-row__owned" data-testid="search-row-owned">
                {owned} en collection
              </span>
            )}
            {status.hasDeck && inDeck > 0 && <span className="search-row__deck">dans ce deck ×{inDeck}</span>}
            <LegalityMention item={item} on={status.on} />
            <Confirmed text={confirmed} />
          </span>
        </span>
        <RowEnd item={item} />
      </button>
    </li>
  );
}

function MoreButton({ shown, total, onMore }: { shown: number; total: number; onMore: () => void }) {
  return (
    <div className="search-more">
      <p className="page-meta">
        {shown} sur {total} · la suite se charge en descendant
      </p>
      <button type="button" className="btn btn-secondary search-more__button" onClick={onMore} data-testid="search-more">
        Afficher {Math.min(TRANCHE, total - shown)} de plus
      </button>
    </div>
  );
}

/** Liste mobile : une ligne par carte, ouverte d'un toucher. */
export function SearchResultList({
  cards,
  status,
  resetKey,
  onOpen,
}: {
  cards: SearchableCard[];
  status: RowStatus;
  resetKey: unknown;
  onOpen: (item: SearchableCard) => void;
}) {
  const { shown, more, hasMore } = useTranches(cards.length, resetKey);
  const sentinel = useAutoLoad(more, hasMore);
  return (
    <>
      <ul className="search-results" data-testid="search-results">
        {cards.slice(0, shown).map((item) => (
          <ResultRow key={item.card.id} item={item} status={status} onOpen={onOpen} />
        ))}
      </ul>
      {hasMore && (
        <>
          <div ref={sentinel} className="search-sentinel" aria-hidden="true" />
          <MoreButton shown={shown} total={cards.length} onMore={more} />
        </>
      )}
    </>
  );
}

// --- Tableau bureau ---------------------------------------------------------------

interface Column {
  id: string;
  label: string;
  sortKey?: CardSortKey;
  className?: string;
  cell: (item: SearchableCard, status: RowStatus) => ReactNode;
}

const nameColumn: Column = { id: "name", label: "Nom", sortKey: "name", className: "col-name", cell: (item) => cardLabel(item.card) };
const ownedColumn: Column = {
  id: "owned",
  label: "Coll.",
  className: "col-num",
  cell: (item, status) => <span className={status.owned(item.card.id) > 0 ? "" : "muted"}>{status.owned(item.card.id)}</span>,
};
const deckColumn: Column = {
  id: "deck",
  label: "Deck",
  className: "col-num",
  cell: (item, status) => (status.inDeck(item.card.id) > 0 ? status.inDeck(item.card.id) : <span className="muted">—</span>),
};

const typeCell = (item: SearchableCard) => (
  <>
    {item.details?.types[0] && <TypeGlyph type={item.details.types[0]} decorative />} {item.details?.types.join(" / ") ?? ""}
  </>
);

/** Sous « Toutes » : le clan d'un vampire dans « Requiert », sa capacité dans « Coût ». */
const requiresCell = (item: SearchableCard) =>
  item.card.category === "crypt" ? (
    <ClanGlyph name={item.card.clanName} />
  ) : (
    item.details && <DisciplineGlyphs disciplines={item.details.disciplines} size="meta" />
  );
const costCell = (item: SearchableCard) =>
  item.card.category === "crypt" ? item.card.capacity : <CostGlyph costType={item.details?.costType ?? null} value={item.details?.costValue ?? null} size="meta" />;

const LIBRARY_COLUMNS: Column[] = [
  nameColumn,
  { id: "type", label: "Type", className: "col-type", cell: typeCell },
  { id: "requires", label: "Requiert", className: "col-glyphs", cell: requiresCell },
  { id: "cost", label: "Coût", sortKey: "cost", className: "col-num", cell: costCell },
];

const CRYPT_COLUMNS: Column[] = [
  nameColumn,
  {
    id: "clan",
    label: "Clan · secte",
    className: "col-clan",
    cell: (item) => (
      <>
        <ClanGlyph name={item.card.clanName} decorative /> {[item.card.clanName, item.details?.sect].filter(Boolean).join(" · ")}
      </>
    ),
  },
  { id: "disciplines", label: "Disciplines", className: "col-glyphs", cell: (item) => item.details && <DisciplineGlyphs disciplines={item.details.disciplines} size="meta" /> },
  { id: "capacity", label: "Cap.", sortKey: "capacity", className: "col-num", cell: (item) => item.card.capacity },
  { id: "group", label: "Grp", sortKey: "group", className: "col-num", cell: (item) => item.card.groupCode?.replace(/^G/, "") ?? "" },
];

function columnsFor(category: CategoryTab, hasDeck: boolean): Column[] {
  const base = category === "crypt" ? CRYPT_COLUMNS : LIBRARY_COLUMNS;
  const sortable = (column: Column) =>
    category === "all" && column.sortKey === "cost" ? { ...column, sortKey: undefined } : column;
  return [...base.map(sortable), ownedColumn, ...(hasDeck ? [deckColumn] : [])];
}

function HeaderCell({ column, sort, onSort }: { column: Column; sort: CardSort | null; onSort: (key: CardSortKey) => void }) {
  const current = sort ?? { key: "name" as const };
  const active = column.sortKey !== undefined && current.key === column.sortKey;
  const descending = current.direction === "desc";
  const ariaSort = active ? (descending ? "descending" : "ascending") : undefined;
  if (!column.sortKey) return <th className={column.className}>{column.label}</th>;
  const key = column.sortKey;
  return (
    <th className={column.className} aria-sort={ariaSort}>
      <button type="button" className={active ? "th-sort th-sort--on" : "th-sort"} onClick={() => onSort(key)} data-testid={`search-sort-${column.id}`}>
        {column.label}
        {active && (descending ? <CaretDownIcon size={12} /> : <CaretUpIcon size={12} />)}
      </button>
    </th>
  );
}

/** Tableau bureau (d17, d18) : en-têtes triables limités aux tris de P9. */
export function SearchResultTable({
  cards,
  category,
  status,
  sort,
  onSort,
  selectedId,
  onSelect,
  resetKey,
}: {
  cards: SearchableCard[];
  category: CategoryTab;
  status: RowStatus;
  sort: CardSort | null;
  onSort: (key: CardSortKey) => void;
  selectedId: number | null;
  onSelect: (item: SearchableCard) => void;
  resetKey: unknown;
}) {
  const columns = columnsFor(category, status.hasDeck);
  const { shown, more, hasMore } = useTranches(cards.length, resetKey);
  const sentinel = useAutoLoad(more, hasMore);
  const shownCards = cards.slice(0, Math.max(shown, cards.findIndex((item) => item.card.id === selectedId) + 1));
  return (
    <div className="search-table-wrap">
      <table className="search-table" data-testid="search-results">
        <thead>
          <tr>
            {columns.map((column) => (
              <HeaderCell key={column.id} column={column} sort={sort} onSort={onSort} />
            ))}
          </tr>
        </thead>
        <tbody>
          {shownCards.map((item) => {
            const selected = item.card.id === selectedId;
            const confirmed = status.confirmed(item.card.id);
            const classes = ["search-table__row", selected && "search-table__row--selected", confirmed && "search-table__row--confirmed"];
            return (
              <tr
                key={item.card.id}
                className={classes.filter(Boolean).join(" ")}
                aria-selected={selected}
                onClick={() => onSelect(item)}
                data-testid="search-row"
                data-card-id={item.card.id}
              >
                {columns.map((column) => (
                  <td key={column.id} className={column.className}>
                    {column.id === "name" ? (
                      <>
                        <button type="button" className="search-table__name" onClick={() => onSelect(item)}>
                          {column.cell(item, status)}
                        </button>
                        <Confirmed text={confirmed} />
                      </>
                    ) : (
                      column.cell(item, status)
                    )}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
      {hasMore && (
        <>
          <div ref={sentinel} className="search-sentinel" aria-hidden="true" />
          <MoreButton shown={shown} total={cards.length} onMore={more} />
        </>
      )}
    </div>
  );
}
