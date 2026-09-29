import { useSyncExternalStore } from "react";

/**
 * Seuil bureau, identique à celui d'`index.css` (`@media (min-width: 1024px)`)
 * et à `DESKTOP_BREAKPOINT_PX` de `Sheet.tsx` (`docs/design-handoff-mobile/DESKTOP.md`).
 *
 * Contrairement à `isDesktopViewport` de `Sheet.tsx` (relu une fois, à
 * l'ouverture d'une feuille : un redimensionnement pendant que la feuille est
 * ouverte n'est pas couvert par le handoff), ce hook est **réactif** : un
 * écran dont la disposition change réellement d'interaction selon la largeur
 * — pas seulement de style — doit suivre un redimensionnement de fenêtre.
 * Cas d'usage introduit à l'étape 5 du Lot 5bis (`docs/lot5bis-plan-design.md`) :
 * l'Atelier ne déclenche la lecture de légalité par deck (`GET
 * /decks/{id}/legalite`) que sous cette forme bureau, pour ne pas la
 * multiplier par deck actif sur l'écran mobile qui ne l'affiche pas.
 */
const DESKTOP_BREAKPOINT_PX = 1024;

function getSnapshot(): boolean {
  return typeof window !== "undefined" && window.innerWidth >= DESKTOP_BREAKPOINT_PX;
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
}

export function useIsDesktop(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
