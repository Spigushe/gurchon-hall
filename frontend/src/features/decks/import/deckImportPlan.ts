import type { DeckArchetype, DeckCardInput, DeckImportInput, DeckInput } from "../../../offline/vtes";
import type { DecklistMatch, ResolvedLine, UnmatchedLine } from "./matchDecklist";
import type { DecklistHeader, UnreadableLine } from "./parseDecklist";

/**
 * Plan pur d'un import (Lot 9, A3) : ce qui sera écrit, avant d'écrire. Pour ce
 * lot, **tout entre en proxy** (P5) : le deck autorise les proxies et chaque
 * carte a une seule ligne entièrement jouée en proxy, dans la langue choisie et
 * sous la dernière extension de la carte (P6). Le plan ne lit donc aucune
 * disponibilité du stock, et un import ne peut pas être refusé au rejeu pour
 * exemplaires insuffisants.
 */

export const DEFAULT_IMPORTED_DECK_NAME = "Deck importé";
export const DEFAULT_IMPORT_LANGUAGE = "EN";

export interface DeckImportChoices {
  /** Nom saisi dans l'aperçu ; vide ou omis, celui de la liste, à défaut « Deck importé ». */
  name?: string | null;
  archetype?: DeckArchetype | null;
  /** Langue des lignes (EN présélectionné, P6). */
  languageCode?: string;
  /** Deck VDB lu par son adresse (P7) ; omis ou nul pour une liste. */
  vdbDeckId?: string | null;
  /** Jour de l'import, `AAAA-MM-JJ` local, pour la note d'un deck non lié. */
  importedOn: string;
}

/** Une ligne du rapport replié de l'aperçu : non reconnue, illisible, groupe déduit ou version supposée. */
export interface ImportReport {
  /** Lignes qui commencent par un chiffre mais ne se lisent pas (analyseur). */
  unreadable: UnreadableLine[];
  /** Lignes lues dont la carte n'a pas été trouvée (appariement). */
  unmatched: UnmatchedLine[];
  deduced: ResolvedLine[];
  assumed: ResolvedLine[];
}

export interface DeckImportSummary {
  /** Cartes distinctes. */
  cards: number;
  crypt: number;
  library: number;
  /** Exemplaires, tous en proxy. */
  proxies: number;
}

export interface DeckImportPlan extends DeckImportInput {
  deck: DeckInput;
  lines: DeckCardInput[];
  summary: DeckImportSummary;
  report: ImportReport;
}

export interface DeckImportSource {
  header: DecklistHeader;
  unreadable: readonly UnreadableLine[];
  match: DecklistMatch;
}

/** « 13 novembre 2026 » pour une date locale `AAAA-MM-JJ`. */
export function importDayLabel(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return date.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

/**
 * Notes du deck (P7) : la description, précédée de « Auteur : … » s'il y en a
 * un, et suivie de « Importé de VDB le … » pour un deck non lié (le détail d'un
 * deck lié montre son lien, la date n'y apprend rien). `null` si rien à dire.
 */
export function importNotes(header: DecklistHeader, linked: boolean, importedOn: string): string | null {
  const parts = [
    header.author ? `Auteur : ${header.author}` : null,
    header.description,
    linked ? null : `Importé de VDB le ${importDayLabel(importedOn)}`,
  ].filter((part): part is string => part !== null && part.trim() !== "");
  return parts.length > 0 ? parts.join("\n\n") : null;
}

export function importedDeckName(header: DecklistHeader, chosen?: string | null): string {
  return chosen?.trim() || header.name?.trim() || DEFAULT_IMPORTED_DECK_NAME;
}

export function planDeckImport(source: DeckImportSource, choices: DeckImportChoices): DeckImportPlan {
  const vdbDeckId = choices.vdbDeckId ?? null;
  const languageCode = choices.languageCode ?? DEFAULT_IMPORT_LANGUAGE;
  const { match } = source;
  const lines: DeckCardInput[] = match.cards.map(({ card, quantity }) => ({
    cardId: card.id,
    languageCode,
    cardSetId: card.latestCardSetId,
    quantity,
    proxyQuantity: quantity,
  }));
  const count = (category: "crypt" | "library") =>
    match.cards.filter(({ card }) => card.category === category).reduce((sum, { quantity }) => sum + quantity, 0);

  return {
    deck: {
      name: importedDeckName(source.header, choices.name),
      notes: importNotes(source.header, vdbDeckId !== null, choices.importedOn),
      archetype: choices.archetype ?? null,
      status: "draft",
      proxyAllowed: true,
      ...(vdbDeckId !== null ? { vdbDeckId } : {}),
    },
    lines,
    summary: {
      cards: match.cards.length,
      crypt: count("crypt"),
      library: count("library"),
      proxies: lines.reduce((sum, line) => sum + line.quantity, 0),
    },
    report: {
      unreadable: [...source.unreadable],
      unmatched: [...match.unmatched],
      deduced: match.resolved.filter((line) => line.by === "deduced"),
      assumed: match.resolved.filter((line) => line.by === "assumed"),
    },
  };
}
