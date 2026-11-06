import { useDeferredValue, useEffect, useMemo, useState } from "react";
import type { AddedNotice } from "./AddSheet";
import { replaceSearchQuery } from "../../app/routes";
import {
  runCardSearch,
  todayUtc,
  useCardSearchStatus,
  useLocalCardSets,
  useLocalDecks,
  useSearchCatalog,
  type CardSetRow,
  type DeckKey,
  type LocalDeck,
  type SearchableCard,
} from "../../offline/vtes";
import { cardSetLabel } from "../../labels";
import { useCatalog } from "../catalog/catalogContext";
import type { EditorProps } from "./FilterEditor";
import type { PanelProps } from "./FilterPanels";
import type { RowStatus } from "./SearchResults";
import { VIRTUE_CODES } from "./glyphs";
import {
  activeFilterTotal,
  criteriaOf,
  initialState,
  isDefaultSort,
  sortForCategory,
  withHeld,
  type CategoryTab,
  type HeldRow,
  type SearchState,
  type SummaryContext,
} from "./searchModel";
import { buildSearchOptions } from "./searchOptions";

const EMPTY_SETS: CardSetRow[] = [];
const EMPTY_DECKS: LocalDeck[] = [];
/** Durée de la teinte de confirmation d'un ajout (handoff, écran 38). */
const CONFIRMATION_MS = 3000;
const ANNOUNCE_DELAY_MS = 60;

/**
 * Tout ce que la page Chercher affiche, sans la présentation (D1c) : état des
 * filtres, recherche sur le catalogue en mémoire, statut par carte (projection
 * locale), adresse réécrite par `replaceState`. Aucun appel réseau.
 *
 * Le deck cible arrive par l'adresse (`deck`, P12) : une clé inconnue est
 * ignorée une fois les decks lus.
 */
export function useSearchPage(initialQuery: string, initialDeck: DeckKey | undefined) {
  const [stored, setState] = useState<SearchState>(() => initialState(initialQuery, initialDeck ?? null));
  const catalogState = useCatalog();
  const catalog = useSearchCatalog();
  const decks = useLocalDecks({ state: "all" });
  const cardSets = useLocalCardSets() ?? EMPTY_SETS;

  // Une clé de deck inconnue des decks locaux (adresse tapée, deck supprimé depuis)
  // est ignorée, pas effacée : tant que les decks ne sont pas lus, ou qu'un premier
  // rafraîchissement ne les a pas apportés, le deck cible attend sans filtrer.
  const deckKnown = stored.deckKey !== null && (decks?.some((deck) => deck.key === stored.deckKey) ?? false);
  const state = useMemo(() => (deckKnown || stored.deckKey === null ? stored : { ...stored, deckKey: null }), [stored, deckKnown]);

  const deferredQuery = useDeferredValue(state.query);
  const status = useCardSearchStatus(state.deckKey);
  const on = todayUtc();
  const criteria = useMemo(() => criteriaOf(state, deferredQuery), [state, deferredQuery]);
  const sort = state.sort ?? undefined;
  const grouped = isDefaultSort(state.sort);
  const search = useMemo(
    () => runCardSearch(catalog, status, criteria, { on, sort, grouped }),
    [catalog, status, criteria, on, sort, grouped],
  );

  // Tant que les decks ne sont pas lus, le deck de l'adresse y reste ; lus, un deck inconnu en sort.
  const addressDeck = decks === undefined ? stored.deckKey : state.deckKey;
  useEffect(() => {
    replaceSearchQuery(deferredQuery.trim(), addressDeck ?? undefined);
  }, [deferredQuery, addressDeck]);

  // Confirmation d'un ajout (D2) : la ligne se teinte quelques secondes, et reste à sa
  // place jusqu'au prochain changement de filtre même si les filtres l'écartent.
  const [held, setHeld] = useState<{ key: unknown; rows: Array<HeldRow<SearchableCard>> }>({ key: criteria, rows: [] });
  if (held.key !== criteria) setHeld({ key: criteria, rows: [] });
  const [notice, setNotice] = useState<AddedNotice | null>(null);
  const [tinted, setTinted] = useState<AddedNotice | null>(null);
  useEffect(() => {
    if (!tinted) return;
    const timer = setTimeout(() => setTinted(null), CONFIRMATION_MS);
    return () => clearTimeout(timer);
  }, [tinted]);
  const results: SearchableCard[] | undefined = useMemo(
    () => (search.cards ? withHeld(search.cards, held.key === criteria ? held.rows : []) : undefined),
    [search.cards, held, criteria],
  );
  const confirmAdd = (added: AddedNotice) => {
    const index = results?.findIndex((item) => item.card.id === added.cardId) ?? -1;
    const item = results?.[index];
    if (item) setHeld((current) => ({ key: criteria, rows: [...(current.key === criteria ? current.rows : []), { item, index }] }));
    setTinted(added);
    // L'annonce attend la fermeture de la feuille : au bureau, le reste de l'application
    // est `inert` tant que le panneau est ouvert, et une région `aria-live` inerte se tait.
    setTimeout(() => setNotice(added), ANNOUNCE_DELAY_MS);
  };

  const options = useMemo(() => buildSearchOptions(catalog), [catalog]);
  const setsById = useMemo(() => new Map(cardSets.map((set) => [set.id, set])), [cardSets]);
  const deck = decks?.find((item) => item.key === state.deckKey) ?? null;

  const summary: SummaryContext = {
    cardSetName: (id) => {
      const set = setsById.get(id);
      return set ? (set.fullName ?? set.abbrev) : `n° ${id}`;
    },
    deckName: (key) => decks?.find((item) => item.key === key)?.name ?? null,
    disciplineName: options.disciplineName,
    virtues: VIRTUE_CODES,
  };

  const rowStatus: RowStatus = {
    owned: (cardId) => status?.ownedCounts.get(cardId) ?? 0,
    inDeck: (cardId) => status?.deckQuantities.get(cardId) ?? 0,
    hasDeck: state.deckKey !== null,
    on,
    confirmed: (cardId) => (tinted?.cardId === cardId ? `+${tinted.added} à l'instant` : null),
  };

  const setCategory = (category: CategoryTab) =>
    setState((current) => ({ ...current, category, sort: sortForCategory(current.sort, category) }));

  const editor: EditorProps = {
    state,
    onChange: setState,
    options,
    cardSets: [...cardSets].sort((a, b) => cardSetLabel(a).localeCompare(cardSetLabel(b), "fr")),
    decks: decks ?? EMPTY_DECKS,
    virtues: VIRTUE_CODES,
  };
  const panel: PanelProps = { ...editor, summary, resultCount: results?.length ?? 0, onCategory: setCategory };

  return {
    state,
    setState,
    setQuery: (query: string) => setState((current) => ({ ...current, query })),
    setCategory,
    clearDeck: () => setState((current) => ({ ...current, deckKey: null, common: { ...current.common, inDeck: null } })),
    deferredQuery,
    /** `undefined` tant que le catalogue en mémoire ou la projection n'est pas lu. */
    results,
    byName: search.byName,
    /** Tous les détails sont là : filtres et texte utilisables. */
    complete: search.complete,
    catalogCount: catalogState.count,
    catalogState,
    activeFilters: activeFilterTotal(state, VIRTUE_CODES),
    /** Résultats rejetés par les critères : le changement remet les tranches et la confirmation à zéro. */
    resetKey: criteria,
    deck,
    options,
    setsById,
    rowStatus,
    panel,
    on,
    /** Dernier ajout, annoncé par la région `aria-live` de la page. */
    notice,
    confirmAdd,
  };
}

export type SearchPageModel = ReturnType<typeof useSearchPage>;
