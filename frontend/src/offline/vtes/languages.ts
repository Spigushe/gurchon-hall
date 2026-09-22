import type { VtesOfflineDb } from "./db";

/** Langue « autre » : le repli d'une langue que le serveur ne connaît pas. */
export const FALLBACK_LANGUAGE = "XX";

/** Langues semées par le serveur, utilisées tant que `GET /langues` n'a jamais répondu. */
export const SEEDED_LANGUAGES: readonly string[] = ["EN", "FR", "ES", FALLBACK_LANGUAGE];

export function normalizeLanguageCode(code: string): string {
  return code.trim().toUpperCase();
}

/**
 * Code de langue à écrire dans une opération.
 *
 * `POST /langues` n'a pas d'équivalent dans la file : une langue inconnue du
 * serveur ne peut pas naître hors ligne. Une saisie dans une langue absente se
 * rabat donc sur `XX` (« autre »), quitte à la corriger en ligne
 * (docs/lot3-sync-contrat.md, points ouverts). Un code vide est une erreur de
 * l'appelant : une entrée de collection n'est jamais sans langue.
 */
export function resolveLanguageCode(code: string, known: Iterable<string>): string {
  const normalized = normalizeLanguageCode(code);
  if (normalized === "") {
    throw new RangeError("Le code de langue est obligatoire (jamais vide).");
  }
  const knownCodes = new Set<string>(known);
  return knownCodes.has(normalized) ? normalized : FALLBACK_LANGUAGE;
}

/**
 * Codes de langue que l'on sait valides côté serveur : la liste miroir, les
 * langues déjà présentes dans le stock (donc acceptées un jour), et `XX`.
 * Sans miroir de langues, les langues semées.
 */
export async function knownLanguageCodes(db: VtesOfflineDb): Promise<Set<string>> {
  const [languages, stock] = await Promise.all([
    db.languages.toArray(),
    db.stock.toCollection().primaryKeys(),
  ]);
  const known = new Set<string>([FALLBACK_LANGUAGE]);
  if (languages.length === 0) SEEDED_LANGUAGES.forEach((code) => known.add(code));
  for (const language of languages) known.add(language.code);
  for (const [, code] of stock) known.add(code);
  return known;
}
