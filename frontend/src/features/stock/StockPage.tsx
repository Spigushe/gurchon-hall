import { CaretDown, MagnifyingGlass, Plus } from "@phosphor-icons/react";
import { useDeferredValue, useId, useMemo, useState } from "react";
import { plural } from "../../labels";
import { useLocalStock, type LocalStockEntry } from "../../offline/vtes";
import { useCatalog } from "../catalog/catalogContext";
import { CatalogPanel } from "../catalog/CatalogPanel";
import { BundleDeposit } from "./BundleDeposit";
import { StockForm } from "./StockForm";
import { StockList } from "./StockList";
import { useLanguageOptions } from "./useLanguageOptions";

type CategoryFilter = "all" | "crypt" | "library" | "proxy";

const FILTERS: Array<{ value: CategoryFilter; label: string }> = [
  { value: "all", label: "Toutes" },
  { value: "crypt", label: "Crypte" },
  { value: "library", label: "Bibliothèque" },
  { value: "proxy", label: "Proxy" },
];

/**
 * Feuille d'overflow pour la langue (handoff § 2 : « le `<select>` actuel
 * passe dans une feuille en overflow »). Reprend le motif de puce introduit à
 * l'écran « Modifier une entrée » (étape 7).
 */
function LanguageFilterSheet({
  languageCode,
  onChange,
  onClose,
}: {
  languageCode: string;
  onChange: (code: string) => void;
  onClose: () => void;
}) {
  const languages = useLanguageOptions();
  return (
    <div className="sheet" role="dialog" aria-modal="true" aria-label="Filtrer par langue">
      <button type="button" className="sheet__back" onClick={onClose}>
        Collection
      </button>
      <h2 className="sheet__title">Langue</h2>
      <div className="chip-row" data-testid="stock-language-filter-options">
        <button
          type="button"
          className="chip"
          aria-pressed={languageCode === ""}
          data-testid="stock-language-filter-option"
          onClick={() => {
            onChange("");
            onClose();
          }}
        >
          Toutes
        </button>
        {languages.map((language) => (
          <button
            key={language.code}
            type="button"
            className="chip"
            aria-pressed={languageCode === language.code}
            data-testid="stock-language-filter-option"
            onClick={() => {
              onChange(language.code);
              onClose();
            }}
          >
            {language.label} ({language.code})
          </button>
        ))}
      </div>
    </div>
  );
}

/** Collection : une ligne par carte et par langue, saisie et lecture locales. */
export function StockPage() {
  const searchId = useId();
  const catalog = useCatalog();
  const languages = useLanguageOptions();
  const [term, setTerm] = useState("");
  const [languageCode, setLanguageCode] = useState("");
  const [filter, setFilter] = useState<CategoryFilter>("all");
  const deferred = useDeferredValue(term.trim());
  const entries = useLocalStock({ q: deferred || undefined, languageCode: languageCode || undefined });
  const [editing, setEditing] = useState<LocalStockEntry | null>(null);
  const [creating, setCreating] = useState(false);
  const [depositing, setDepositing] = useState(false);
  const [languageSheetOpen, setLanguageSheetOpen] = useState(false);

  const filteredEntries = useMemo(() => {
    if (!entries) return entries;
    if (filter === "all") return entries;
    if (filter === "proxy") return entries.filter((entry) => entry.proxyAllowed);
    return entries.filter((entry) => entry.category === filter);
  }, [entries, filter]);

  const languageLabel = languageCode
    ? (languages.find((language) => language.code === languageCode)?.label ?? languageCode)
    : "Toutes";

  return (
    <div className="page" data-testid="stock-page">
      <header className="page-header">
        <h2 className="page-title">Collection</h2>
        <p className="page-meta">
          {entries ? plural(entries.length, "entrée") : "…"} · une ligne par carte et par langue
        </p>
      </header>

      {catalog.count === 0 && <CatalogPanel compact />}

      <div className="search-field">
        <MagnifyingGlass size={18} className="search-field__icon" aria-hidden="true" />
        <label htmlFor={searchId} className="sr-only">
          Chercher dans ma collection
        </label>
        <input
          id={searchId}
          type="search"
          placeholder="Chercher dans ma collection"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          autoComplete="off"
          data-testid="stock-search"
        />
      </div>

      <div className="tabs" role="tablist" aria-label="Filtrer la collection">
        {FILTERS.map((option) => (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={filter === option.value}
            data-testid={`stock-filter-${option.value}`}
            onClick={() => setFilter(option.value)}
          >
            {option.label}
          </button>
        ))}
        <button
          type="button"
          className="filter-trigger"
          data-testid="stock-language-filter"
          onClick={() => setLanguageSheetOpen(true)}
        >
          {languageLabel}
          <CaretDown size={12} aria-hidden="true" />
        </button>
      </div>

      <StockList
        entries={filteredEntries}
        filtered={deferred !== "" || languageCode !== "" || filter !== "all"}
        onEdit={setEditing}
      />

      <div className="pill-row">
        <button
          type="button"
          className="pill pill--accent"
          data-testid="stock-add-open"
          onClick={() => setCreating(true)}
        >
          <Plus size={16} aria-hidden="true" />
          Ajouter une carte
        </button>
        <button
          type="button"
          className="pill pill--neutral"
          data-testid="bundle-deposit-open"
          onClick={() => setDepositing(true)}
        >
          Verser un produit
        </button>
      </div>

      {(editing || creating) && (
        <StockForm
          key={editing ? `${editing.cardId}|${editing.languageCode}` : "new"}
          editing={editing}
          onDone={() => {
            setEditing(null);
            setCreating(false);
          }}
          onCancel={() => {
            setEditing(null);
            setCreating(false);
          }}
        />
      )}

      {depositing && <BundleDeposit onClose={() => setDepositing(false)} />}

      {languageSheetOpen && (
        <LanguageFilterSheet
          languageCode={languageCode}
          onChange={setLanguageCode}
          onClose={() => setLanguageSheetOpen(false)}
        />
      )}
    </div>
  );
}
