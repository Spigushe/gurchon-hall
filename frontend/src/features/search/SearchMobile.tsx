import { useId, useRef, useState } from "react";
import { FunnelSimpleIcon, PlusIcon, XIcon } from "@phosphor-icons/react";
import { Sheet } from "../../components/Sheet";
import type { SearchableCard } from "../../offline/vtes";
import { AddSheet } from "./AddSheet";
import { CardDetail } from "./CardDetail";
import { FilterSheet } from "./FilterPanels";
import { SearchResultList } from "./SearchResults";
import { AddFeedback, CategoryTabs, EmptyCatalog, Loading, NoResult, OutdatedNotice, PageHead, ResultCount, SearchField, SortSelect } from "./SearchParts";
import type { SearchPageModel } from "./useSearchPage";

/**
 * Chercher au mobile (handoff, écrans 26 à 40) : champ, onglets de catégorie
 * et bouton « Filtres » (feuille plein écran), compteur et tri, liste par
 * tranches ; un toucher ouvre la fiche en demi-feuille, qu'un bouton étend.
 */
export function SearchMobile({ page }: { page: SearchPageModel }) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [detail, setDetail] = useState<SearchableCard | null>(null);
  const [adding, setAdding] = useState<SearchableCard | null>(null);
  const { activeFilters } = page;
  return (
    <div className="page page--search" data-testid="search-page">
      <PageHead page={page} />
      <EmptyCatalog page={page} />
      <OutdatedNotice page={page} />
      <SearchField page={page} />
      <div className="search-bar">
        <CategoryTabs page={page} />
        <button
          type="button"
          className="search-filters-button"
          onClick={() => setFiltersOpen(true)}
          disabled={!page.complete}
          data-testid="search-filters-open"
        >
          <FunnelSimpleIcon size={18} aria-hidden="true" />
          {activeFilters > 0 ? (
            <span data-testid="search-filters-count">
              {activeFilters} filtre{activeFilters > 1 ? "s" : ""} · <span className="accent">Modifier</span>
            </span>
          ) : (
            "Filtres"
          )}
        </button>
      </div>
      <div className="search-count-row">
        <ResultCount page={page} />
        <SortSelect page={page} />
      </div>
      <Loading page={page} />
      <NoResult page={page} />
      {page.results && page.results.length > 0 && (
        <SearchResultList cards={page.results} status={page.rowStatus} resetKey={page.resetKey} onOpen={setDetail} />
      )}
      {filtersOpen && <FilterSheet {...page.panel} onClose={() => setFiltersOpen(false)} />}
      {detail && (
        <CardSheet
          page={page}
          item={detail}
          onClose={() => setDetail(null)}
          onAdd={() => {
            setAdding(detail);
            setDetail(null);
          }}
        />
      )}
      {adding && <AddSheet page={page} item={adding} onClose={() => setAdding(null)} onAdded={page.confirmAdd} />}
      <AddFeedback page={page} />
    </div>
  );
}

/** Demi-feuille de fiche (33), qui s'étend jusqu'à 44px du haut (34) par la poignée ou la ligne d'invite. */
function CardSheet({ page, item, onClose, onAdd }: { page: SearchPageModel; item: SearchableCard; onClose: () => void; onAdd: () => void }) {
  const titleId = useId();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [expanded, setExpanded] = useState(false);
  const expand = () => setExpanded((value) => !value);
  return (
    <Sheet
      titleId={titleId}
      titleRef={titleRef}
      onClose={onClose}
      className={expanded ? "card-sheet card-sheet--expanded" : "card-sheet"}
      data-testid="search-detail-sheet"
    >
      <button
        type="button"
        className="card-sheet__handle"
        onClick={expand}
        aria-expanded={expanded}
        aria-label={expanded ? "Réduire la fiche" : "Étendre la fiche : image, impressions, légalité"}
        data-testid="search-detail-expand"
      />
      <CardDetail
        item={item}
        on={page.on}
        expanded={expanded}
        sets={page.setsById}
        disciplineName={page.options.disciplineName}
        titleId={titleId}
        titleRef={titleRef}
        header={
          <button type="button" className="sheet__close" onClick={onClose} aria-label="Fermer la fiche" data-testid="search-detail-close">
            <XIcon size={20} />
          </button>
        }
      />
      {!expanded && (
        <button type="button" className="btn-text card-sheet__invite" onClick={expand}>
          Étendre : image, impressions, légalité
        </button>
      )}
      <button type="button" className="pill pill--compact card-sheet__add" onClick={onAdd} data-testid="search-detail-add">
        <PlusIcon size={18} aria-hidden="true" />
        Ajouter…
      </button>
    </Sheet>
  );
}
