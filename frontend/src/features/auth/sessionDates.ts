/**
 * Dates d'une session, telles que l'écran Compte les écrit (handoff Lot 12,
 * « Règles d'affichage communes ») : sans année (une session dure 90 jours au
 * plus), en jours du calendrier local, jamais en heures.
 *
 * « Utilisé » se lit dans `last_used_at`, que le serveur écrit au plus une fois
 * par jour et rend égal à `created_at` pour une session jamais renouvelée :
 * celle-là n'a « jamais été revue depuis », sauf si elle a été ouverte le jour
 * même. La session courante est utilisée à l'instant, quelle que soit la date
 * notée.
 */

const DAY_MONTH = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long" });

/** « 2 novembre ». */
export function dayMonth(iso: string): string {
  return DAY_MONTH.format(new Date(iso));
}

/** Nombre de jours du calendrier local entre deux instants (positif si `to` est après `from`). */
export function calendarDaysBetween(from: Date, to: Date): number {
  const start = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const end = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((end - start) / 86_400_000);
}

export interface SessionDates {
  created_at: string;
  last_used_at: string;
  expires_at: string;
  current: boolean;
}

/**
 * Dernière utilisation, sans verbe : « aujourd'hui », « hier », « il y a 3 jours »,
 * ou `null` pour une session jamais revue depuis son ouverture.
 */
export function lastUsedPhrase(session: SessionDates, now: Date): string | null {
  if (session.current) return "aujourd'hui";
  const lastUsed = new Date(session.last_used_at);
  const days = Math.max(0, calendarDaysBetween(lastUsed, now));
  if (session.last_used_at === session.created_at && days > 0) return null;
  if (days === 0) return "aujourd'hui";
  if (days === 1) return "hier";
  return `il y a ${days} jours`;
}

/** Mobile : « Utilisé aujourd'hui », « Jamais revu depuis ». */
export function usedLine(session: SessionDates, now: Date): string {
  const phrase = lastUsedPhrase(session, now);
  return phrase === null ? "Jamais revu depuis" : `Utilisé ${phrase}`;
}

/** Bureau, colonne « Utilisé » : « Aujourd'hui », « Il y a 3 jours », « Jamais revu depuis ». */
export function usedCell(session: SessionDates, now: Date): string {
  const phrase = lastUsedPhrase(session, now);
  return phrase === null ? "Jamais revu depuis" : phrase.charAt(0).toUpperCase() + phrase.slice(1);
}
