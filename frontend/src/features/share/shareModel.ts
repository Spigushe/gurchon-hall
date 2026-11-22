import { plural } from "../../labels";
import type { OutboxEntry } from "../../offline/core";
import type { DeckArchetype, LocalDeck, VtesOperation } from "../../offline/vtes";
import { DECK_ARCHETYPE_LABELS } from "../../offline/vtes";
import type { DeckShareRead } from "./shareApi";

/**
 * Règles de la feuille de partage et de « Listes partagées » (Lot 13, D2), en
 * fonctions pures pour être testées sans monter l'écran.
 */

/** L'adresse publique d'une liste : l'origine de la PWA, puis le jeton dans le hash (P6). */
export function shareLink(origin: string, token: string): string {
  return `${origin}/#/liste/${token}`;
}

/** « Vivant » ou « Figé ». */
export function kindLabel(share: Pick<DeckShareRead, "kind">): string {
  return share.kind === "live" ? "Vivant" : "Figé";
}

const DAY = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric" });

/** « Vivant · créé le 20 novembre 2026 », « Figé · v3 · 20 novembre 2026 », « Figé · liste du 20 novembre 2026 ». */
export function shareMeta(share: DeckShareRead): string {
  const day = DAY.format(new Date(share.created_at));
  if (share.kind === "live") return `créé le ${day}`;
  return share.deck_version_number !== null ? `version v${share.deck_version_number} · ${day}` : `liste du ${day}`;
}

/** Nom d'un deck pour l'écran : « Banu Princes#1234 ». */
export function deckLabel(deck: { name: string; discriminator: string }): string {
  return `${deck.name}#${deck.discriminator}`;
}

type Entry = OutboxEntry<VtesOperation>;

/**
 * Opérations en attente qui touchent la liste de ce deck : sa création, sa
 * modification, ses lignes. Un deck se désigne par son identifiant serveur ou
 * par la référence client de sa création, qui reste dans la file après coup.
 */
export function pendingOperationsOnDeck(entries: readonly Entry[], deck: Pick<LocalDeck, "id" | "clientRef">): number {
  const matches = (ref: { deck_id?: number | null; client_ref?: string | null } | undefined): boolean =>
    ref !== undefined &&
    ((deck.id !== null && ref.deck_id === deck.id) ||
      (deck.clientRef !== null && ref.client_ref === deck.clientRef));
  let count = 0;
  for (const { operation } of entries) {
    switch (operation.type) {
      case "deck.create":
        if (deck.clientRef !== null && operation.client_ref === deck.clientRef) count += 1;
        break;
      case "deck.update":
      case "deck.delete":
      case "deck_card.upsert":
      case "deck_card.delete":
        if (matches(operation.deck)) count += 1;
        break;
      default:
        break;
    }
  }
  return count;
}

/** Ce qui retient la création d'un figé tant que la file a des opérations sur le deck (P4). */
export function freezeBlockedMessage(pending: number): string | null {
  if (pending <= 0) return null;
  return `${plural(pending, "modification")} à synchroniser avant de figer la liste`;
}

export interface SharePreview {
  name: string;
  archetype: string | null;
  author: string | null;
  /** `null` : notes masquées ; sinon le texte que la page montrera (vide si le deck n'en a pas). */
  notes: string | null;
}

/** Ce que la page publique montrera (P2) : nom, archétype et auteur toujours, notes si la case est cochée. */
export function sharePreview(
  deck: Pick<LocalDeck, "name" | "archetype" | "notes">,
  username: string | null,
  showNotes: boolean,
): SharePreview {
  return {
    name: deck.name,
    archetype: deck.archetype ? DECK_ARCHETYPE_LABELS[deck.archetype as DeckArchetype] : null,
    author: username,
    notes: showNotes ? (deck.notes ?? "") : null,
  };
}

export interface ShareGroup {
  deck: DeckShareRead["deck"];
  shares: DeckShareRead[];
}

export interface GroupedShares {
  /** Liens des decks non supprimés, groupés par deck, dans l'ordre d'arrivée (du plus récent lien au plus ancien). */
  groups: ShareGroup[];
  /** Liens des decks supprimés, rangés à part : ils se purgent à l'unité ou ensemble (P5 amendée à F). */
  deleted: DeckShareRead[];
}

export function groupShares(shares: readonly DeckShareRead[]): GroupedShares {
  const groups = new Map<number, ShareGroup>();
  const deleted: DeckShareRead[] = [];
  for (const share of shares) {
    if (share.deck.deleted_at !== null) {
      deleted.push(share);
      continue;
    }
    const group = groups.get(share.deck.id);
    if (group) group.shares.push(share);
    else groups.set(share.deck.id, { deck: share.deck, shares: [share] });
  }
  return { groups: [...groups.values()], deleted };
}

export type PurgeKind = "selected" | "deleted_decks" | "all";

/** Texte de la confirmation d'une purge, avec le nombre de liens visés. */
export function purgeConfirmation(kind: PurgeKind, count: number): { question: string; confirm: string } {
  const links = plural(count, "lien");
  const effect = "Les adresses cessent de fonctionner ; une page déjà consultée peut rester lisible une minute.";
  switch (kind) {
    case "selected":
      return { question: `Purger ${links} ? ${effect}`, confirm: `Purger ${links}` };
    case "deleted_decks":
      return {
        question: `Purger ${plural(count, "lien")} de decks supprimés ? ${effect}`,
        confirm: `Purger ${links}`,
      };
    case "all":
      return { question: `Purger les ${links} du compte, vivants et figés ? ${effect}`, confirm: `Tout purger (${count})` };
  }
}

/** Retour d'une purge réussie. */
export function purgedMessage(revoked: number): string {
  return revoked === 0 ? "Aucun lien à purger." : revoked === 1 ? "1 lien purgé." : `${revoked} liens purgés.`;
}

/**
 * Phrase de la confirmation de suppression d'un deck (P5) : ses liens vivants
 * tombent avec lui, ses figés restent publics jusqu'à une purge. `shares` est
 * `null` hors ligne ou tant que la lecture n'est pas revenue : une phrase
 * prudente, sans nombre.
 */
export function deleteSharesNote(shares: readonly DeckShareRead[] | null): string {
  if (shares === null) {
    return "Si ce deck a des liens de partage figés, ils resteront publics après sa suppression ; ses liens vivants seront révoqués.";
  }
  const frozen = shares.filter((share) => share.kind === "frozen").length;
  const live = shares.length - frozen;
  const parts: string[] = [];
  if (frozen > 0) {
    parts.push(
      frozen === 1
        ? "1 lien figé restera public après la suppression."
        : `${frozen} liens figés resteront publics après la suppression.`,
    );
  }
  if (live > 0) parts.push(live === 1 ? "1 lien vivant sera révoqué." : `${live} liens vivants seront révoqués.`);
  return parts.join(" ");
}

/** Ce qui grise « Partager », ou `null` : en ligne seulement (P4), et un deck déjà connu du serveur. */
export function shareBlockedReason(deck: Pick<LocalDeck, "id">, online: boolean): string | null {
  if (!online) return "Partager demande le réseau : les liens se créent en ligne.";
  if (deck.id === null) return "Ce deck n'est pas encore synchronisé.";
  return null;
}
