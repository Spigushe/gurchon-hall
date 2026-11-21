import type { DeckArchetype, DeckCardInput, DeckImportInput } from "../../offline/vtes";
import type { DeckCardFacts } from "../decks/deckTablesModel";
import { DEFAULT_IMPORT_LANGUAGE, importDayLabel, importedDeckName } from "../decks/import";
import type { EffectiveCard } from "./effectiveList";
import type { SharedDecklist } from "./usePublicDecklist";

/**
 * Plan pur d'un « Dupliquer » (Lot 13, D5, A8) : la liste partagée devient un
 * deck du compte, avec les mêmes règles qu'un import du Lot 9 (tout en proxy,
 * brouillon, `proxy_allowed`, aucun lien gardé) mais sans appariement : les
 * cartes arrivent par identifiant. Les faits des cartes (extension la plus
 * récente, catégorie) viennent du miroir du visiteur, pas de la réponse
 * publique ; une carte absente du miroir est signalée, jamais écrite.
 */

export interface DuplicateChoices {
  name: string;
  archetype: DeckArchetype | null;
  languageCode?: string;
  notes: string;
}

export interface DuplicateSummary {
  cards: number;
  crypt: number;
  library: number;
  /** Exemplaires, tous en proxy. */
  proxies: number;
}

export interface DuplicatePlan extends DeckImportInput {
  summary: DuplicateSummary;
  /** Identifiants des cartes que le miroir ne connaît pas : « Créer » reste bloqué. */
  missing: number[];
}

const headerOf = (name: string) => ({ name, author: null, description: null });

/** Nom de départ : celui de la liste partagée, jamais vide. */
export const duplicateName = (list: Pick<SharedDecklist, "name">): string => importedDeckName(headerOf(list.name));

/**
 * Notes de départ : celles de la liste si le lien les montre, puis
 * « Dupliqué de la liste partagée le … » (jour local `AAAA-MM-JJ`).
 */
export function duplicateNotes(list: Pick<SharedDecklist, "notes">, day: string): string {
  const origin = `Dupliqué de la liste partagée le ${importDayLabel(day)}`;
  const own = list.notes?.trim();
  return own ? `${own}\n\n${origin}` : origin;
}

export function planDuplicate(
  cards: readonly EffectiveCard[],
  facts: ReadonlyMap<number, DeckCardFacts>,
  choices: DuplicateChoices,
): DuplicatePlan {
  const languageCode = choices.languageCode ?? DEFAULT_IMPORT_LANGUAGE;
  const missing: number[] = [];
  const lines: DeckCardInput[] = [];
  const total = { crypt: 0, library: 0, proxies: 0 };
  for (const { cardId, quantity } of cards) {
    const card = facts.get(cardId)?.card;
    if (!card) {
      missing.push(cardId);
      continue;
    }
    lines.push({ cardId, languageCode, cardSetId: card.latestCardSetId, quantity, proxyQuantity: quantity });
    total[card.category === "crypt" ? "crypt" : "library"] += quantity;
    total.proxies += quantity;
  }
  return {
    deck: {
      name: importedDeckName(headerOf(choices.name)),
      notes: choices.notes.trim() || null,
      archetype: choices.archetype,
      status: "draft",
      proxyAllowed: true,
    },
    lines,
    missing,
    summary: { cards: lines.length, ...total },
  };
}
