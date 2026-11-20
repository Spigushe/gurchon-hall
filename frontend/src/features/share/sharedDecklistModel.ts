import { cardDetailRowOf, cardRowOf } from "../../offline/vtes/refresh";
import type { LocalDeckCard } from "../../offline/vtes";
import { buildDeckTables, type DeckCardFacts, type DeckTables } from "../decks/deckTablesModel";
import { EXPORT_FORMATS, exportAs, type ExportFormat } from "../decks/export/exportFormats";
import { exportFileName } from "../decks/export/exportFile";
import type { SharedDecklist } from "./usePublicDecklist";

/**
 * Ce que la page publique tire de la réponse de `GET /listes/{token}` (Lot 13,
 * A7), sans jamais ouvrir le miroir local : les faits des cartes viennent de
 * `cards[].card` (`CardSearchItem`), les lignes sont synthétiques (une par
 * carte, quantité totale, sans proxies : le public ne voit ni langue, ni
 * extension, ni proxies). Fonctions pures, testées sur une table de cas.
 */

/** Langue des lignes synthétiques : jamais affichée, mais `LocalDeckCard` l'exige. */
const SYNTHETIC_LANGUAGE = "EN";

/** Les lignes que `buildDeckTables` et les exports attendent, par identifiant de carte croissant. */
export function sharedListLines(list: SharedDecklist): LocalDeckCard[] {
  return list.cards.map(({ card, quantity }) => ({
    cardId: card.id,
    languageCode: SYNTHETIC_LANGUAGE,
    cardSetId: card.latest_card_set_id ?? 0,
    quantity,
    proxyQuantity: 0,
    cardName: card.name,
    pending: false,
  }));
}

/** Faits de chaque carte (ligne courte et détails), comme le miroir les rendrait. */
export function sharedListFacts(list: SharedDecklist): Map<number, DeckCardFacts> {
  return new Map(
    list.cards.map(({ card }) => [card.id, { card: cardRowOf(card), details: cardDetailRowOf(card) }] as const),
  );
}

export interface SharedListModel {
  lines: LocalDeckCard[];
  facts: Map<number, DeckCardFacts>;
  tables: DeckTables;
  /** Nombre total de cartes (crypte et bibliothèque). */
  total: number;
}

export function buildSharedListModel(list: SharedDecklist): SharedListModel {
  const lines = sharedListLines(list);
  const facts = sharedListFacts(list);
  return { lines, facts, tables: buildDeckTables(lines, facts), total: lines.reduce((sum, line) => sum + line.quantity, 0) };
}

/** La liste aux quatre formats de VDB ; `(G6)` vient de `reprinted_card_ids`, pas d'une lecture du catalogue. */
export function sharedListTexts(list: SharedDecklist, model: SharedListModel): Record<ExportFormat, string> {
  const input = {
    name: list.name,
    description: list.notes,
    lines: model.lines,
    facts: model.facts,
    reprinted: new Set(list.reprinted_card_ids),
    event: null,
  };
  return Object.fromEntries(EXPORT_FORMATS.map(({ id }) => [id, exportAs(id, input)])) as Record<ExportFormat, string>;
}

/** Nom de fichier sans discriminant : le public ne le voit pas. */
export const sharedListFileName = (name: string, suffix: string | null) => exportFileName(name, null, undefined, suffix);

/** « 20 novembre 2026 », en UTC pour ne pas décaler d'un jour selon le fuseau du visiteur. */
export function formatListDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}
