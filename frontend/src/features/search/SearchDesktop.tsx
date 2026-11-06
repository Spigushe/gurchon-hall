import { useRef, useState } from "react";
import { PlusIcon } from "@phosphor-icons/react";
import { isInteractiveTarget, useKeyboardShortcuts } from "../../components/useKeyboardShortcuts";
import { Kbd } from "../../components/Kbd";
import type { SearchableCard } from "../../offline/vtes";
import { AddSheet } from "./AddSheet";
import { CardDetail } from "./CardDetail";
import { FilterColumn } from "./FilterPanels";
import { SearchResultTable } from "./SearchResults";
import { AddFeedback, CategoryTabs, EmptyCatalog, Loading, NoResult, OutdatedNotice, PageHead, SearchField } from "./SearchParts";
import { countLabel, sortOptions, sortId, toggleSort } from "./searchModel";
import type { SearchPageModel } from "./useSearchPage";

/**
 * Chercher au bureau (handoff d17 à d20) : filtres en colonne à gauche,
 * tableau triable au centre, fiche toujours visible à droite. Raccourcis de
 * page : `F` focalise les filtres, `↑ ↓` parcourent, `↵` va à la fiche, `N`
 * ouvre la feuille d'ajout de la carte choisie (D2) ; ils ne prennent jamais
 * `A C D P S` (navigation) et se taisent quand la feuille est ouverte. `/`
 * vient avec le champ global (D3).
 */
export function SearchDesktop({ page }: { page: SearchPageModel }) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [adding, setAdding] = useState<SearchableCard | null>(null);
  const columnRef = useRef<HTMLElement>(null);
  const detailTitleRef = useRef<HTMLHeadingElement>(null);
  const results = page.results ?? [];
  const selected = results.find((item) => item.card.id === selectedId) ?? null;

  const move = (delta: number) => {
    if (results.length === 0) return;
    const index = results.findIndex((item) => item.card.id === selectedId);
    const next = index < 0 ? 0 : Math.min(results.length - 1, Math.max(0, index + delta));
    setSelectedId(results[next].card.id);
  };

  useKeyboardShortcuts([
    { keys: ["f"], onTrigger: () => columnRef.current?.focus() },
    { keys: ["arrowdown"], onTrigger: () => move(1), ignoreTarget: isInteractiveTarget },
    { keys: ["arrowup"], onTrigger: () => move(-1), ignoreTarget: isInteractiveTarget },
    { keys: ["enter"], onTrigger: () => detailTitleRef.current?.focus(), ignoreTarget: isInteractiveTarget },
    { keys: ["n"], onTrigger: () => selected && setAdding(selected) },
  ], { enabled: adding === null });

  const select = (item: SearchableCard) => setSelectedId(item.card.id);

  return (
    <div className="page page--search page--search-desktop" data-testid="search-page">
      <div className={page.complete ? "search-desktop" : "search-desktop search-desktop--outdated"}>
        <FilterColumn props={page.panel} total={page.activeFilters} columnRef={columnRef} />
        <section className="search-center" aria-label="Résultats">
          <PageHead page={page} desktop />
          <EmptyCatalog page={page} />
          <OutdatedNotice page={page} />
          <SearchField page={page} boxed />
          <div className="search-bar search-bar--desktop">
            <CategoryTabs page={page} withCount />
            <p className="search-sort-hint">
              Tri : {sortOptions(page.state.category).find((option) => option.id === sortId(page.state.sort))?.label ?? "Nom"} · clic sur un
              en-tête pour trier
            </p>
          </div>
          <Loading page={page} />
          <NoResult page={page} desktop />
          {results.length > 0 && (
            <SearchResultTable
              cards={results}
              category={page.state.category}
              status={page.rowStatus}
              sort={page.state.sort}
              onSort={(key) => page.setState((current) => ({ ...current, sort: toggleSort(current.sort, key) }))}
              selectedId={selectedId}
              onSelect={select}
              resetKey={page.resetKey}
            />
          )}
          <div className="search-foot">
            <p className="page-meta" data-testid="search-count">
              {page.results ? countLabel(page.results.length, page.byName, page.deferredQuery) : ""}
            </p>
            <p className="search-legend" aria-hidden="true">
              <Kbd>↑↓</Kbd> parcourir · <Kbd>↵</Kbd> ouvrir la fiche · <Kbd>N</Kbd> ajouter · <Kbd>F</Kbd> filtres
            </p>
          </div>
        </section>
        <aside className="search-detail-column" aria-label="Fiche de la carte">
          {selected ? (
            <>
              <CardDetail item={selected} on={page.on} expanded sets={page.setsById} disciplineName={page.options.disciplineName} titleRef={detailTitleRef} />
              <button type="button" className="btn btn-secondary search-detail-column__add" onClick={() => setAdding(selected)} aria-keyshortcuts="N" data-testid="search-detail-add">
                <PlusIcon size={18} aria-hidden="true" />
                Ajouter… <Kbd>N</Kbd>
              </button>
            </>
          ) : (
            <p className="hint" data-testid="search-detail-empty">
              Choisissez une carte dans le tableau.
            </p>
          )}
        </aside>
      </div>
      {adding && <AddSheet page={page} item={adding} onClose={() => setAdding(null)} onAdded={page.confirmAdd} />}
      <AddFeedback page={page} />
    </div>
  );
}
