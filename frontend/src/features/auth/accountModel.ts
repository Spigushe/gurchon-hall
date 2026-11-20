import { plural } from "../../labels";

/**
 * Petites règles de l'écran Compte (Lot 12, D1 et D5), en fonctions pures pour
 * être testées sans monter l'écran.
 */

/** Secondes restantes avant la fin d'un 429, arrondies au-dessus ; 0 une fois passé. */
export function secondsLeft(until: number, now: number): number {
  return Math.max(0, Math.ceil((until - now) / 1000));
}

/** Ce que la confirmation de « Fermer toutes les autres sessions » annonce, pour `count` sessions. */
export function closeOthersCopy(count: number): { short: string; warning: string; confirm: string } {
  return {
    short: count === 1 ? "1 appareil sera déconnecté." : `${count} appareils seront déconnectés.`,
    warning:
      count === 1
        ? "1 appareil sera déconnecté. Ses saisies en attente partiront après reconnexion."
        : `${count} appareils seront déconnectés. Leurs saisies en attente partiront après reconnexion.`,
    confirm: count === 1 ? "Fermer la session" : `Fermer les ${count} sessions`,
  };
}

/** Pied de l'écran : « Application 1.1.0 · Serveur 1.1.0 », le serveur omis s'il n'a pas répondu. */
export function versionsLine(appVersion: string, serverVersion: string | null): string {
  return serverVersion ? `Application ${appVersion} · Serveur ${serverVersion}` : `Application ${appVersion}`;
}

export interface QueueState {
  online: boolean;
  pending: number;
  rejected: number;
}

/**
 * Méta de la ligne « Synchronisation » du compte (A11) : l'état de la file,
 * lu par `useSyncStatus`. Les refus passent devant (ce sont eux qu'il faut
 * corriger), puis l'attente, puis « hors ligne » quand rien n'attend.
 */
export function syncRowMeta({ online, pending, rejected }: QueueState): string {
  const parts: string[] = [];
  if (rejected > 0) parts.push(plural(rejected, "refusée"));
  if (pending > 0) parts.push(`${pending} en attente`);
  if (!online) parts.push("hors ligne");
  return parts.length > 0 ? parts.join(" · ") : "À jour";
}

/** Avertissement de l'export quand des saisies n'ont pas encore atteint le serveur (P3). */
export function unsyncedExportWarning(pending: number): string | null {
  if (pending <= 0) return null;
  return pending === 1
    ? "1 saisie pas encore synchronisée n'y sera pas."
    : `${pending} saisies pas encore synchronisées n'y seront pas.`;
}
