/** Le `/` global et les deux champs qu'il désigne (lot Chercher, D3, P8). */

/** Marque le champ principal de la page Chercher (`SearchField`). */
export const PAGE_SEARCH_ATTR = "data-search-field";
/** Marque le champ global de la barre haute. */
export const GLOBAL_SEARCH_ATTR = "data-global-search";

/**
 * Le geste de `/` : le champ de la page sur Chercher, le champ global ailleurs.
 * Rend `false` quand rien n'a pu prendre le focus.
 */
export function focusSearch(onSearchPage: boolean): boolean {
  const selector = onSearchPage ? `[${PAGE_SEARCH_ATTR}]` : `[${GLOBAL_SEARCH_ATTR}]`;
  const target = document.querySelector<HTMLElement>(selector);
  if (!target) return false;
  target.focus();
  return document.activeElement === target;
}
