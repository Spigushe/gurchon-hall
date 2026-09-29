import { useDeferredValue, useId, useRef, useState } from "react";
import { Database, DotsThree, MagnifyingGlass, Plus } from "@phosphor-icons/react";
import { Pill } from "../../components/Pill";
import { BackRow, Sheet } from "../../components/Sheet";
import { plural } from "../../labels";
import { useLocalStock, type LocalStockEntry } from "../../offline/vtes";
import { useCatalog } from "../catalog/catalogContext";
import { CatalogPanel } from "../catalog/CatalogPanel";
import { BundleDeposit } from "./BundleDeposit";
import { StockForm } from "./StockForm";
import { StockList } from "./StockList";
import { useCardSetOptions } from "./useCardSetOptions";
import { useLanguageOptions, type LanguageOption } from "./useLanguageOptions";

type Filter = "all" | "crypt" | "library" | "proxy";
type OwnedFilter = "all" | "owned" | "zero";

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: "all", label: "Toutes" },
  { value: "crypt", label: "Crypte" },
  { value: "library", label: "Bibliothèque" },
  { value: "proxy", label: "Proxy" },
];

const OWNED_FILTERS: Array<{ value: OwnedFilter; label: string }> = [
  { value: "all", label: "Toutes" },
  { value: "owned", label: "Possédées" },
  { value: "zero", label: "À 0" },
];

/**
 * Feuille de filtres (handoff : la langue quitte la page et passe dans un menu
 * débordant). Étendue au Lot 5 avec l'extension (Lot 4) et un tri-état de
 * possession, en plus de la langue : le handoff ne dessine que la langue,
 * les deux autres sont un ajout de ce lot (CLAUDE.md § 11, Lot 5).
 */
function StockFilterSheet({
  languageCode,
  languages,
  onLanguageChange,
  cardSetId,
  cardSets,
  onCardSetChange,
  ownedFilter,
  onOwnedFilterChange,
  onClose,
}: {
  languageCode: string;
  languages: LanguageOption[];
  onLanguageChange: (code: string) => void;
  cardSetId: number | null;
  cardSets: ReturnType<typeof useCardSetOptions>;
  onCardSetChange: (id: number | null) => void;
  ownedFilter: OwnedFilter;
  onOwnedFilterChange: (value: OwnedFilter) => void;
  onClose: () => void;
}) {
  const id = useId();
  const ownedName = useId();
  const titleRef = useRef<HTMLHeadingElement>(null);
  return (
    <Sheet titleId={`${id}-title`} titleRef={titleRef} onClose={onClose} variant="pushed" data-testid="stock-filters-sheet">
      <BackRow label="Collection" onClick={onClose} />
      <h2 id={`${id}-title`} ref={titleRef} tabIndex={-1} className="sheet__title">
        Filtrer la collection
      </h2>
      <div className="field">
        <label htmlFor={`${id}-language`}>Langue</label>
        <select
          id={`${id}-language`}
          className="underline-field"
          value={languageCode}
          onChange={(event) => onLanguageChange(event.target.value)}
          data-testid="stock-language-filter"
        >
          <option value="">Toutes langues</option>
          {languages.map((language) => (
            <option key={language.code} value={language.code}>
              {language.label} ({language.code})
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor={`${id}-cardset`}>Extension</label>
        <select
          id={`${id}-cardset`}
          className="underline-field"
          value={cardSetId ?? ""}
          onChange={(event) => onCardSetChange(event.target.value === "" ? null : Number(event.target.value))}
          data-testid="stock-cardset-filter"
        >
          <option value="">Toutes extensions</option>
          {(cardSets.list ?? []).map((set) => (
            <option key={set.id} value={set.id}>
              {set.fullName ? `${set.abbrev} — ${set.fullName}` : set.abbrev}
            </option>
          ))}
        </select>
      </div>
      <fieldset className="tabs tabs--fieldset" aria-label="Stock" data-testid="stock-owned-filter">
        {OWNED_FILTERS.map((option) => (
          <label key={option.value} className="tab-option">
            <input
              type="radio"
              name={ownedName}
              value={option.value}
              checked={ownedFilter === option.value}
              onChange={() => onOwnedFilterChange(option.value)}
            />
            <span className="tab-option__label">{option.label}</span>
          </label>
        ))}
      </fieldset>
      <div className="sheet-form__footer">
        <Pill onClick={onClose} data-testid="stock-filters-done">
          Terminé
        </Pill>
      </div>
    </Sheet>
  );
}

/** Collection : une ligne par carte, langue et extension ; saisie et lecture locales. */
export function StockPage() {
  const searchId = useId();
  const filterName = useId();
  const catalog = useCatalog();
  const languages = useLanguageOptions();
  const cardSets = useCardSetOptions();
  const [term, setTerm] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [languageCode, setLanguageCode] = useState("");
  const [cardSetId, setCardSetId] = useState<number | null>(null);
  const [ownedFilter, setOwnedFilter] = useState<OwnedFilter>("all");
  const deferred = useDeferredValue(term.trim());
  const category = filter === "crypt" || filter === "library" ? filter : undefined;
  const rawEntries = useLocalStock({
    q: deferred || undefined,
    languageCode: languageCode || undefined,
    cardSetId: cardSetId ?? undefined,
    category,
  });
  const entries = rawEntries?.filter((entry) => {
    if (filter === "proxy" && entry.quantityOwned !== 0) return false;
    if (ownedFilter === "owned" && entry.quantityOwned === 0) return false;
    if (ownedFilter === "zero" && entry.quantityOwned !== 0) return false;
    return true;
  });

  const [mode, setMode] = useState<"closed" | "create" | "edit">("closed");
  const [editing, setEditing] = useState<LocalStockEntry | null>(null);
  const [bundleOpen, setBundleOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const isFiltered =
    deferred !== "" || languageCode !== "" || cardSetId !== null || ownedFilter !== "all" || filter !== "all";
  // Collection vide sans filtre : les deux actions passent dans l'état vide (une seule paire de boutons).
  const showActions = entries !== undefined && !(entries.length === 0 && !isFiltered);

  const openCreate = () => {
    setEditing(null);
    setMode("create");
  };
  const openEdit = (entry: LocalStockEntry) => {
    setEditing(entry);
    setMode("edit");
  };
  const closeForm = () => setMode("closed");

  return (
    <div className={showActions ? "page page--with-floating" : "page"} data-testid="stock-page">
      <div>
        <h2 className="page-title">Collection</h2>
        <p className="page-meta">
          {entries ? plural(entries.length, "entrée") : "…"} · une ligne par carte, langue et extension
        </p>
      </div>

      {catalog.count === 0 && <CatalogPanel compact />}

      <div className="search-field">
        <MagnifyingGlass size={18} className="search-field__icon" />
        <label htmlFor={searchId} className="sr-only">
          Chercher dans ma collection
        </label>
        <input
          id={searchId}
          type="search"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          autoComplete="off"
          placeholder="Chercher dans ma collection"
          data-testid="stock-search"
        />
      </div>

      <div className="filter-row">
        <fieldset className="tabs tabs--fieldset" aria-label="Filtrer par catégorie">
          {FILTERS.map((option) => (
            <label key={option.value} className="tab-option">
              <input
                type="radio"
                name={filterName}
                value={option.value}
                checked={filter === option.value}
                onChange={() => setFilter(option.value)}
              />
              <span className="tab-option__label">{option.label}</span>
            </label>
          ))}
        </fieldset>
        <button
          type="button"
          className="round-btn round-btn--flat"
          aria-label="Plus de filtres"
          data-testid="stock-filters-open"
          onClick={() => setFiltersOpen(true)}
        >
          <DotsThree size={22} />
        </button>
      </div>
      {(languageCode !== "" || cardSetId !== null || ownedFilter !== "all") && (
        <p className="hint" data-testid="stock-language-active">
          {languageCode !== "" &&
            `Langue : ${languages.find((language) => language.code === languageCode)?.label ?? languageCode} (${languageCode})`}
          {languageCode !== "" && (cardSetId !== null || ownedFilter !== "all") && " · "}
          {cardSetId !== null &&
            `Extension : ${cardSets.byId.has(cardSetId) ? cardSets.byId.get(cardSetId)!.abbrev : cardSetId}`}
          {cardSetId !== null && ownedFilter !== "all" && " · "}
          {ownedFilter !== "all" && OWNED_FILTERS.find((option) => option.value === ownedFilter)?.label}
        </p>
      )}

      <StockList
        entries={entries}
        filtered={isFiltered}
        onEdit={openEdit}
        onAdd={openCreate}
        onDeposit={() => setBundleOpen(true)}
      />

      {mode !== "closed" && (
        <StockForm key={editing ? `${editing.cardId}|${editing.languageCode}|${editing.cardSetId}` : "new"} editing={editing} onDone={closeForm} />
      )}

      {filtersOpen && (
        <StockFilterSheet
          languageCode={languageCode}
          languages={languages}
          onLanguageChange={setLanguageCode}
          cardSetId={cardSetId}
          cardSets={cardSets}
          onCardSetChange={setCardSetId}
          ownedFilter={ownedFilter}
          onOwnedFilterChange={setOwnedFilter}
          onClose={() => setFiltersOpen(false)}
        />
      )}

      {bundleOpen && <BundleDeposit onClose={() => setBundleOpen(false)} />}

      {showActions && (
        <div className="floating-actions">
          <Pill onClick={openCreate} data-testid="stock-add">
            <Plus size={20} />
            Ajouter une carte
          </Pill>
          <button
            type="button"
            className="round-btn"
            aria-label="Verser un produit"
            data-testid="bundle-open"
            onClick={() => setBundleOpen(true)}
          >
            <Database size={20} />
          </button>
        </div>
      )}
    </div>
  );
}
