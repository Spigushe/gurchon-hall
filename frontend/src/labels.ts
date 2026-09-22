import type { CardRow, DeckPatch, LocalStockEntry } from "./offline/vtes";
import type { RejectionCode } from "./offline/core";

/** Libellés d'interface (français) des valeurs du contrat. */

export type DeckStatus = NonNullable<DeckPatch["status"]>;

export const CATEGORY_LABELS = { crypt: "Crypte", library: "Bibliothèque" } as const;

export const DECK_STATUS_LABELS: Record<DeckStatus, string> = {
  draft: "Brouillon",
  active: "Actif",
};

/** Motif d'un refus, en clair ; le texte du service (`message`) le précise. */
export const REJECTION_LABELS: Record<RejectionCode, string> = {
  not_found: "Élément introuvable",
  conflict: "Règle de gestion non respectée",
  invalid: "Données invalides",
  unresolved_client_ref: "Deck d'origine introuvable ou refusé",
  mismatched_replay: "Clé d'opération déjà utilisée avec un autre contenu",
  invalid_request: "Opération mal formée",
};

export function plural(count: number, one: string, many: string = `${one}s`): string {
  return `${count} ${count > 1 ? many : one}`;
}

/** « Theo Bell (G2, Adv) » : le nom ne suffit pas à désigner un vampire (§11). */
export function cardLabel(card: Pick<CardRow, "name" | "groupCode" | "advanced" | "category">): string {
  if (card.category !== "crypt" || !card.groupCode) return card.name;
  return `${card.name} (${card.groupCode}${card.advanced ? ", Adv" : ""})`;
}

export function stockEntryLabel(entry: Pick<LocalStockEntry, "cardName" | "cardId">): string {
  return entry.cardName ?? `Carte n° ${entry.cardId}`;
}

export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
}

export function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleTimeString("fr-FR", { timeStyle: "medium" });
}

/**
 * Date sans heure (`evaluated_on`, format `YYYY-MM-DD`) affichée en `JJ/MM/AAAA`.
 * Analyse la chaîne directement plutôt que de passer par `Date` : une date sans
 * heure ni fuseau, une fois construite avec `new Date("YYYY-MM-DD")`, est ancrée
 * à minuit UTC et peut retomber sur la veille une fois reformatée dans un fuseau
 * à l'ouest de Greenwich.
 */
export function formatDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return iso;
  const [, year, month, day] = match;
  return `${day}/${month}/${year}`;
}
