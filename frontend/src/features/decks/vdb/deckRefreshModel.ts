import { plural } from "../../../labels";
import type { LocalDeck } from "../../../offline/vtes";
import type { CardChange, CardChangeKind, DeckRefreshPlan, DecklistMatch, ImportReport } from "../import";

/** Libellés de la mise à jour depuis VDB (Lot 9, D3, écran 4), sans React. */

/** Message de l'action grisée hors connexion (P1) : la mise à jour lit le deck chez VDB. */
export const VDB_REFRESH_OFFLINE_MESSAGE =
  "La mise à jour depuis VDB demande le réseau. Hors connexion, le deck reste tel quel.";

/** Refus d'une mise à jour pour un deck archivé (P7), même texte que `DeckNotRefreshableError`. */
export const VDB_REFRESH_ARCHIVED_MESSAGE = "Désarchivez le deck pour le mettre à jour.";

export const CHANGE_KIND_LABELS: Readonly<Record<CardChangeKind, string>> = {
  added: "Ajoutée",
  increased: "Augmentée",
  decreased: "Diminuée",
  remade: "Refaite en proxy",
  removed: "Retirée",
};

const DETAILS: Readonly<Record<CardChangeKind, (change: CardChange) => string>> = {
  added: (change) => `${plural(change.after, "proxy", "proxies")}`,
  increased: (change) => `${change.before} → ${change.after}, ${plural(change.after - change.before, "proxy ajouté", "proxies ajoutés")}`,
  decreased: (change) => `${change.before} → ${change.after}`,
  // Le message du plan commence par le libellé de la carte, déjà affiché devant.
  remade: (change) => (change.message ?? `${change.before} → ${change.after}`).replace(`${change.label} : `, ""),
  removed: (change) => `${plural(change.before, "exemplaire retiré", "exemplaires retirés")}`,
};

/** Le détail d'un changement : « 2 → 3, 1 proxy ajouté », ou le message d'une carte refaite. */
export function changeDetail(change: CardChange): string {
  return DETAILS[change.kind](change);
}

/**
 * Ce que la mise à jour fera, en clair, avant d'écrire : le nombre de cartes
 * qui changent, le passage en brouillon, l'autorisation de proxy rendue, et ce
 * qui ne bouge pas (P7).
 */
export function refreshEffectText(plan: DeckRefreshPlan): string {
  if (plan.empty) return "Rien à mettre à jour : le deck a déjà la liste de VDB.";
  const parts = [
    `${plural(plan.changes.length, "carte change", "cartes changent")}, ${plural(plan.unchanged, "inchangée", "inchangées")}.`,
  ];
  if (plan.toDraft) parts.push("Le deck repasse en brouillon.");
  if (plan.allowsProxies) parts.push("Il autorisera de nouveau les proxies, que la mise à jour ajoute.");
  parts.push("Nom, notes, archétype et versions jouées ne changent pas.");
  return parts.join(" ");
}

/** Le rapport d'une liste lue chez VDB : seules des cartes inconnues du catalogue peuvent manquer. */
export function refreshReport(match: DecklistMatch): ImportReport {
  return { unreadable: [], unmatched: match.unmatched, deduced: [], assumed: [] };
}

/**
 * Pourquoi l'action « Mettre à jour depuis VDB » est grisée, ou `null` si elle
 * est permise. Elle n'existe que pour un deck lié.
 */
export function refreshBlockedReason(deck: Pick<LocalDeck, "archivedAt">, online: boolean): string | null {
  if (deck.archivedAt !== null) return VDB_REFRESH_ARCHIVED_MESSAGE;
  if (!online) return VDB_REFRESH_OFFLINE_MESSAGE;
  return null;
}
