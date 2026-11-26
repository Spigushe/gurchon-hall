/**
 * Lecture du hash d'une page publique de compte-rendu (lot Compte-rendu, P8) :
 * `#/compte-rendu/<jeton>`, sans jamais de numéro de version (P9). Fonction
 * pure : `Root` s'en sert avant toute session, base IndexedDB ou moteur de sync.
 */

/** Même motif que le chemin de `GET /comptes-rendus/{token}`. */
export const REPORT_TOKEN_PATTERN = /^[A-Za-z0-9_]{8}$/;

const PUBLIC_PREFIX = "#/compte-rendu/";

export type PublicReportRoute = { kind: "none" } | { kind: "invalid" } | { kind: "report"; token: string };

export function parsePublicReportHash(hash: string): PublicReportRoute {
  if (!hash.startsWith(PUBLIC_PREFIX)) return { kind: "none" };
  const token = hash.slice(PUBLIC_PREFIX.length).split("?")[0].replace(/\/+$/, "");
  return REPORT_TOKEN_PATTERN.test(token) ? { kind: "report", token } : { kind: "invalid" };
}

export const isPublicReportHash = (hash: string): boolean => parsePublicReportHash(hash).kind !== "none";
