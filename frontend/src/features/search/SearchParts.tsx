import { useId, type RefObject } from "react";
import { MagnifyingGlassIcon, SortAscendingIcon, XCircleIcon, XIcon } from "@phosphor-icons/react";
import { Kbd } from "../../components/Kbd";
import { useConnectivity } from "../../offline/react";
import { CATEGORY_LABELS } from "../../labels";
import { CatalogPanel } from "../catalog/CatalogPanel";
import { VIRTUE_CODES } from "../../components/glyphs/glyphs";
import { PAGE_SEARCH_ATTR } from "./globalSearch";
import { countLabel, resetFilters, sortById, sortId, sortOptions, type CategoryTab } from "./searchModel";
import type { SearchPageModel } from "./useSearchPage";

/** Pièces communes aux deux dispositions de Chercher (D1c). */

const formatCount = (count: number) => count.toLocaleString("fr-FR");

export function PageHead({ page, desktop = false }: { page: SearchPageModel; desktop?: boolean }) {
  const online = useConnectivity();
  const count = page.catalogCount;
  const unit = page.complete ? "cartes" : "noms";
  return (
    <div className="search-head">
      <div>
        <h2 className="page-title">Chercher</h2>
        <p className="page-meta" data-testid="search-meta">
          Catalogue local{count ? ` · ${formatCount(count)} ${unit}` : ""}
          {desktop && !online && <span data-testid="search-offline"> · hors ligne, images indisponibles</span>}
        </p>
      </div>
      {page.deck && <DeckBanner name={page.deck.name} onClear={page.clearDeck} />}
    </div>
  );
}

export function DeckBanner({ name, onClear }: { name: string; onClear: () => void }) {
  return (
    <div className="deck-banner" data-testid="search-deck-banner">
      <div>
        <p className="deck-banner__kicker">Pour le deck</p>
        <p className="deck-banner__name">{name}</p>
      </div>
      <button type="button" className="icon-btn icon-btn--44" onClick={onClear} aria-label={`Ne plus chercher pour le deck ${name}`} data-testid="search-deck-clear">
        <XIcon size={20} />
      </button>
    </div>
  );
}

export function SearchField({
  page,
  inputRef,
  boxed = false,
}: {
  page: SearchPageModel;
  inputRef?: RefObject<HTMLInputElement | null>;
  boxed?: boolean;
}) {
  const inputId = useId();
  const disabled = page.catalogCount === 0;
  const placeholder = boxed ? "Nom ou texte de carte — accents et casse ignorés" : "Nom ou texte de carte";
  return (
    <div className={boxed ? "search-field search-field--boxed" : "search-field"}>
      <MagnifyingGlassIcon size={18} className="search-field__icon" aria-hidden="true" />
      <label htmlFor={inputId} className="sr-only">
        Chercher une carte : nom ou texte
      </label>
      <input
        id={inputId}
        ref={inputRef}
        type="search"
        value={page.state.query}
        onChange={(event) => page.setQuery(event.target.value)}
        autoComplete="off"
        placeholder={placeholder}
        disabled={disabled}
        data-testid="search-input"
        {...{ [PAGE_SEARCH_ATTR]: "" }}
      />
      {page.state.query !== "" && (
        <button type="button" className="icon-btn" onClick={() => page.setQuery("")} aria-label="Vider le champ" data-testid="search-clear">
          <XCircleIcon size={18} />
        </button>
      )}
      {boxed && <Kbd>/</Kbd>}
    </div>
  );
}

const TABS: Array<{ id: CategoryTab; label: string }> = [
  { id: "all", label: "Toutes" },
  { id: "crypt", label: CATEGORY_LABELS.crypt },
  { id: "library", label: CATEGORY_LABELS.library },
];

export function CategoryTabs({ page, withCount = false }: { page: SearchPageModel; withCount?: boolean }) {
  return (
    <div className="search-tabs" role="tablist" aria-label="Catégorie">
      {TABS.map((tab) => {
        const selected = page.state.category === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={selected}
            className={selected ? "search-tab search-tab--on" : "search-tab"}
            onClick={() => page.setCategory(tab.id)}
            data-testid={`search-category-${tab.id}`}
          >
            {tab.label}
            {withCount && selected && page.results && <span> · {page.results.length}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function ResultCount({ page }: { page: SearchPageModel }) {
  if (!page.results) return null;
  return (
    <p className="search-count" data-testid="search-count" aria-live="polite">
      {countLabel(page.results.length, page.byName, page.deferredQuery)}
    </p>
  );
}

export function SortSelect({ page }: { page: SearchPageModel }) {
  const id = useId();
  return (
    <label className="search-sort" htmlFor={id}>
      <SortAscendingIcon size={18} aria-hidden="true" />
      <span className="sr-only">Tri</span>
      <select
        id={id}
        value={sortId(page.state.sort)}
        onChange={(event) => page.setState((current) => ({ ...current, sort: sortById(event.target.value) }))}
        data-testid="search-sort"
      >
        {sortOptions(page.state.category).map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Catalogue présent mais sans ses détails (P11) : recherche par le nom seulement. */
export function OutdatedNotice({ page }: { page: SearchPageModel }) {
  const online = useConnectivity();
  const { status, update } = page.catalogState;
  if (page.complete || !page.catalogCount) return null;
  return (
    <div className="notice-block" data-testid="search-outdated">
      <p className="notice-block__title">Recherche dans le nom seulement</p>
      <p>
        Le catalogue attend sa mise à jour : les textes et les détails ne sont pas encore là, les filtres non plus. Elle
        partira d'elle-même au retour du réseau.
      </p>
      {status === "loading" ? (
        <p className="hint">Mise à jour en cours…</p>
      ) : (
        <button type="button" className="btn btn-secondary" onClick={() => void update()} disabled={!online} data-testid="search-outdated-update">
          Mettre à jour maintenant
        </button>
      )}
    </div>
  );
}

export function EmptyCatalog({ page }: { page: SearchPageModel }) {
  if (page.catalogCount !== 0) return null;
  return (
    <>
      <CatalogPanel compact />
      <p className="hint" data-testid="search-empty-catalog">
        Catalogue absent : téléchargez-le (bouton « Mettre à jour le catalogue ») pour chercher une carte.
      </p>
    </>
  );
}

export function Loading({ page }: { page: SearchPageModel }) {
  if (page.results !== undefined || page.catalogCount === 0) return null;
  return (
    <p className="hint" data-testid="search-loading" aria-busy="true">
      Lecture du miroir local — aucun appel réseau.
    </p>
  );
}

export function NoResult({ page, desktop = false }: { page: SearchPageModel; desktop?: boolean }) {
  if (!page.results || page.results.length > 0) return null;
  const { activeFilters, state } = page;
  const query = page.deferredQuery.trim();
  const recap = [
    query ? `« ${query} »` : "",
    activeFilters > 0 ? `avec ${activeFilters} filtre${activeFilters > 1 ? "s" : ""}` : "",
    state.category !== "all" ? `en ${CATEGORY_LABELS[state.category]}` : "",
  ]
    .filter(Boolean)
    .join(", ");
  return (
    <div className="search-empty" data-testid="search-no-result">
      <h3 className="search-empty__title">Aucune carte ne correspond</h3>
      {recap && <p className="page-meta">{recap}.</p>}
      <div className="search-empty__actions">
        {desktop && query && (
          <button type="button" className="btn btn-secondary" onClick={() => page.setQuery("")} data-testid="search-no-result-clear">
            Effacer le champ
          </button>
        )}
        {activeFilters > 0 && (
          <button type="button" className="pill pill--compact" onClick={() => page.panel.onChange(resetAll(page))} data-testid="search-no-result-reset">
            Retirer les {activeFilters} filtre{activeFilters > 1 ? "s" : ""}
          </button>
        )}
        {state.category !== "all" && (
          <button type="button" className="btn btn-secondary" onClick={() => page.setCategory("all")} data-testid="search-no-result-all">
            Toutes catégories
          </button>
        )}
      </div>
    </div>
  );
}

const resetAll = (page: SearchPageModel) => resetFilters(page.state, VIRTUE_CODES);

/** Annonce du dernier ajout (D2), pour un lecteur d'écran ; la ligne, elle, se teinte. */
export function AddFeedback({ page }: { page: SearchPageModel }) {
  return (
    <p className="sr-only" aria-live="polite" data-testid="search-add-feedback">
      {page.notice?.message ?? ""}
    </p>
  );
}
