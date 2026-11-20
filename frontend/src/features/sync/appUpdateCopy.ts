import type { AppUpdateView } from "../../offline/react";

/** Textes du bandeau « nouvelle version » (Lot 12, P5, A11), en fonctions pures. */

/** Phrase principale du bandeau, selon la vue (fonction pure, testée à part). */
export function appUpdateTitle(view: Exclude<AppUpdateView, { kind: "hidden" }>): string {
  if (view.kind === "ready") return "Une nouvelle version est disponible.";
  return view.pending > 1
    ? `Nouvelle version prête. Elle s'installera une fois vos ${view.pending} saisies synchronisées.`
    : "Nouvelle version prête. Elle s'installera une fois votre saisie synchronisée.";
}

/** Lignes d'indication sous la phrase principale (fonction pure). */
export function appUpdateHints(view: Exclude<AppUpdateView, { kind: "hidden" }>): string[] {
  if (view.kind === "ready") {
    if (view.rejected === 0) return [];
    return [
      view.rejected > 1
        ? `${view.rejected} saisies refusées restent à régler ; elles seront conservées.`
        : "1 saisie refusée reste à régler ; elle sera conservée.",
    ];
  }
  const hints: string[] = [];
  if (!view.online) hints.push("Hors ligne : l'envoi reprendra au retour du réseau.");
  // A11 : plus de lien vers Synchronisation, l'écran s'ouvre depuis Compte.
  hints.push("L'envoi se suit dans Compte › Synchronisation.");
  return hints;
}
