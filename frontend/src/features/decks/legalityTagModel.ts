import type { LocalDeck } from "../../offline/vtes";
import type { DeckLegality, LegalityOutcome } from "./useDeckLegality";

export type LegalityTagKind = "legal" | "illegal" | "unknown";

/**
 * Libellé du badge de légalité de l'aperçu (handoff `DECKS.md`, d22) : « Légal »,
 * ou « Illégal » suivi du premier motif dans l'ordre des règles du §5
 * (effectifs, groupes, cartes bannies, pas encore légales).
 */
export function illegalReason(legality: DeckLegality): string | null {
  const { crypt_count, crypt_minimum, library_count, library_minimum, library_maximum } = legality;
  if (crypt_count < crypt_minimum) return `crypte ${crypt_count}/${crypt_minimum}`;
  if (library_count < library_minimum) return `bibliothèque ${library_count}/${library_minimum}`;
  if (library_count > library_maximum) return `bibliothèque ${library_count}/${library_maximum}`;
  if (legality.crypt_groups.length > 2) return `groupes ${legality.crypt_groups.join(", ")}`;
  if (legality.banned_cards.length > 0) {
    const count = legality.banned_cards.length;
    return count === 1 ? "1 carte bannie" : `${count} cartes bannies`;
  }
  if (legality.not_yet_legal_cards.length > 0) {
    const count = legality.not_yet_legal_cards.length;
    return count === 1 ? "1 carte pas encore légale" : `${count} cartes pas encore légales`;
  }
  if (legality.crypt_groups.length === 2) return `groupes ${legality.crypt_groups.join(", ")}`;
  return null;
}

export function legalityTag(
  deck: Pick<LocalDeck, "id">,
  online: boolean,
  outcome: LegalityOutcome | null,
): { kind: LegalityTagKind; label: string } {
  if (deck.id === null) return { kind: "unknown", label: "Verdict en attente" };
  if (!online) return { kind: "unknown", label: "Légalité hors ligne" };
  if (outcome === null) return { kind: "unknown", label: "Légalité…" };
  if (outcome.kind === "error") return { kind: "unknown", label: "Légalité indisponible" };
  if (outcome.legality.is_legal) return { kind: "legal", label: "Légal" };
  const reason = illegalReason(outcome.legality);
  return { kind: "illegal", label: reason ? `Illégal · ${reason}` : "Illégal" };
}
