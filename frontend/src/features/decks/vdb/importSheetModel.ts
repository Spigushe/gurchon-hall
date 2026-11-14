import { plural } from "../../../labels";
import type { LocalDeck, LocalDeckCard } from "../../../offline/vtes";
import type { DeckImportPlan, ImportSource, ParsedDecklist } from "../import";

/** Logique de la feuille d'import (Lot 9, D2), sans React. */

/** Ce que l'étape 1 passe à l'aperçu : la liste lue, et le deck VDB d'origine pour un lien. */
export interface ImportSelection {
  decklist: ParsedDecklist;
  vdbDeckId: string | null;
}

/** Date de création pour le tri ; un deck pas encore synchronisé (sans date) est le plus récent. */
const createdKey = (deck: LocalDeck) => deck.createdOn ?? "￿";

/**
 * Le deck vivant (archivé compris) déjà lié à ce deck VDB (P8) ; le plus
 * récemment créé s'il y en a deux, cas de deux appareils hors ligne (A6).
 */
export function linkedDeckOf(decks: readonly LocalDeck[] | undefined, vdbDeckId: string): LocalDeck | null {
  const linked = (decks ?? []).filter((deck) => deck.vdbDeckId === vdbDeckId);
  return linked.sort((a, b) => createdKey(b).localeCompare(createdKey(a)))[0] ?? null;
}

/** « Continuer » est grisé sans catalogue, pendant une lecture, sans liste, ou pour un lien déjà lié ou hors ligne. */
export function continueBlocked(
  source: ImportSource,
  context: { catalogEmpty: boolean; loading: boolean; linked: boolean; online: boolean },
): boolean {
  if (context.catalogEmpty || context.loading) return true;
  if (source.kind === "list") return false;
  if (source.kind === "vdb-deck") return context.linked || !context.online;
  return true;
}

/** Les lignes du plan, sous la forme que `DeckTables` lit (aucune n'est encore en file). */
export function previewLines(plan: DeckImportPlan): LocalDeckCard[] {
  return plan.lines.map((line) => ({
    cardId: line.cardId,
    languageCode: line.languageCode,
    cardSetId: line.cardSetId,
    quantity: line.quantity,
    proxyQuantity: line.proxyQuantity ?? line.quantity,
    cardName: null,
    pending: false,
  }));
}

/** « 102 cartes en proxy : le deck autorisera les proxies. Il est créé en brouillon. » */
export function importEffectText(plan: DeckImportPlan): string {
  if (plan.summary.proxies === 0) return "Aucune carte reconnue : rien à importer.";
  return `${plural(plan.summary.proxies, "carte")} en proxy : le deck autorisera les proxies. Il est créé en brouillon, sans rien prendre à la collection.`;
}
