import { plural } from "../../../labels";
import type { ImportReport } from "./deckImportPlan";
import type { DecklistMatch, ResolvedLine, UnmatchedReason } from "./matchDecklist";
import type { DecklistFormat } from "./parseDecklist";

/**
 * Libellés de l'écran d'import (Lot 9, D2), en fonctions pures : ce qui a été
 * reconnu (étape 1) et le rapport replié de l'aperçu (étape 2).
 */

export const FORMAT_LABELS: Readonly<Record<DecklistFormat, string>> = {
  text: "Format texte de VDB",
  twd: "Format TWD",
  jol: "Format JOL",
  lackey: "Format Lackey",
  list: "Liste « quantité, puis nom »",
  "vdb-url": "Lien VDB qui porte la liste",
  "vdb-api": "Deck lu chez VDB",
};

export const UNMATCHED_REASONS: Readonly<Record<UnmatchedReason, string>> = {
  unknown_vekn_id: "identifiant inconnu du catalogue",
  unknown_name: "carte introuvable dans le catalogue",
  no_such_version: "cette version de la carte n'existe pas",
};

/** Exemplaires de crypte et de bibliothèque d'une liste appariée. */
export function matchCounts(match: DecklistMatch): { crypt: number; library: number } {
  let crypt = 0;
  let library = 0;
  for (const { card, quantity } of match.cards) {
    if (card.category === "crypt") crypt += quantity;
    else library += quantity;
  }
  return { crypt, library };
}

/** « Format texte de VDB · 12 cartes de crypte, 90 de bibliothèque · 2 lignes non reconnues ». */
export function recognitionText(format: DecklistFormat, match: DecklistMatch, unreadable: number): string {
  const { crypt, library } = matchCounts(match);
  const missing = match.unmatched.length + unreadable;
  const parts = [
    FORMAT_LABELS[format],
    crypt + library === 0
      ? "aucune carte reconnue"
      : `${plural(crypt, "carte")} de crypte, ${library} de bibliothèque`,
  ];
  if (missing > 0) parts.push(plural(missing, "ligne non reconnue", "lignes non reconnues"));
  return parts.join(" · ");
}

export type ReportKind = "unreadable" | "unmatched" | "deduced" | "assumed";

export interface ReportEntry {
  kind: ReportKind;
  line: number;
  text: string;
  message: string;
}

const groupOf = (line: ResolvedLine) => line.card.groupCode ?? "?";
const alternativesOf = (line: ResolvedLine) =>
  line.alternatives.map((card) => `(${card.groupCode ?? "?"})`).join(" ou ");

/** Les lignes du rapport, toutes sortes confondues, dans l'ordre du texte. */
export function reportEntries(report: ImportReport): ReportEntry[] {
  const entries: ReportEntry[] = [
    ...report.unreadable.map((line) => ({ kind: "unreadable" as const, ...line, message: "ligne illisible" })),
    ...report.unmatched.map((line) => ({
      kind: "unmatched" as const,
      line: line.line,
      text: line.text,
      message: UNMATCHED_REASONS[line.reason],
    })),
    ...report.deduced.map((line) => ({
      kind: "deduced" as const,
      line: line.line,
      text: line.text,
      message: `groupe déduit de la crypte : ${groupOf(line)}`,
    })),
    ...report.assumed.map((line) => ({
      kind: "assumed" as const,
      line: line.line,
      text: line.text,
      message: `version supposée : ${groupOf(line)} ; écrire ${alternativesOf(line)} pour l'autre`,
    })),
  ];
  return entries.sort((a, b) => a.line - b.line);
}

/** « 2 lignes non reconnues · 1 groupe déduit · 1 version supposée » ; `null` si le rapport est vide. */
export function reportSummary(report: ImportReport): string | null {
  const missing = report.unreadable.length + report.unmatched.length;
  const parts = [
    missing > 0 ? plural(missing, "ligne non reconnue", "lignes non reconnues") : null,
    report.deduced.length > 0 ? plural(report.deduced.length, "groupe déduit", "groupes déduits") : null,
    report.assumed.length > 0 ? plural(report.assumed.length, "version supposée", "versions supposées") : null,
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** « Ligne 12 » d'un texte, « Entrée 3 » d'une adresse ou d'un deck lu chez VDB. */
export function lineWord(format: DecklistFormat): string {
  return format === "vdb-url" || format === "vdb-api" ? "Entrée" : "Ligne";
}

/** Le jour local `AAAA-MM-JJ` d'une date. */
export function localDay(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Message P1 : un lien VDB ne se lit qu'en ligne. */
export const VDB_OFFLINE_MESSAGE =
  "Un lien VDB se lit en ligne. Hors connexion, collez le texte exporté depuis VDB (Exporter, puis Texte).";

const VDB_READ_ERRORS: Readonly<Record<number, (detail: string | null, retryAfter: string | null) => string>> = {
  401: () => "Reconnexion nécessaire pour lire un deck VDB.",
  404: (detail) => detail ?? "Deck VDB introuvable.",
  422: () => "Cet identifiant de deck VDB n'a pas la forme attendue.",
  429: (_detail, retryAfter) =>
    `Trop de lectures chez VDB d'affilée : réessayez${retryAfter ? ` dans ${retryAfter} s` : " dans un instant"}.`,
  502: (detail) => `Lecture chez VDB impossible${detail ? ` : ${detail}` : "."}`,
};

/** Message d'un refus de `GET /vdb/decks/{id}` (A7), selon le statut ; `status` nul : serveur injoignable. */
export function vdbReadError(status: number | null, detail: string | null, retryAfter: string | null): string {
  if (status === null) {
    return "Le serveur est injoignable. Collez plutôt le texte exporté depuis VDB (Exporter, puis Texte).";
  }
  const message = VDB_READ_ERRORS[status];
  return message ? message(detail, retryAfter) : `Réponse inattendue du serveur (${status}).`;
}
