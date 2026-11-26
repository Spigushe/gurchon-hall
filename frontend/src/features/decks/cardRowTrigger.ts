/** Ce qu'un toucher sur la ligne n'active jamais : les contrôles qu'elle porte. */
const INTERACTIVE = "button, a, input, select, textarea, label, [role='button']";

/**
 * Toucher sur la ligne du tableau (`[role="row"]`) qui contient le nom d'une
 * carte (issue #71, retour du 2026-11-26) : vrai hors du nom lui-même (son
 * bouton s'en charge), hors d'un contrôle et hors de ce que `exclude` désigne.
 */
export function isRowTrigger(target: EventTarget | null, row: Element, root: Element, exclude?: string): boolean {
  if (!(target instanceof Element) || !row.contains(target) || root.contains(target)) return false;
  if (target.closest(INTERACTIVE)) return false;
  return !(exclude && target.closest(exclude));
}
