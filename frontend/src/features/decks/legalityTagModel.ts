import type { LocalDeck } from "../../offline/vtes";
import type { LegalityOutcome } from "./useDeckLegality";

export type LegalityTagKind = "legal" | "illegal" | "unknown";

/**
 * Libellé de la pastille de légalité (v1.2.2, A2) : « Légal » ou « Illégal »,
 * sans motif — les motifs se lisent dans le détail, au survol ou au toucher.
 * Les états sans verdict gardent leur libellé : ce ne sont pas des verdicts.
 */
export function legalityTag(
  deck: Pick<LocalDeck, "id">,
  online: boolean,
  outcome: LegalityOutcome | null,
): { kind: LegalityTagKind; label: string } {
  if (deck.id === null) return { kind: "unknown", label: "Verdict en attente" };
  if (!online) return { kind: "unknown", label: "Légalité hors ligne" };
  if (outcome === null) return { kind: "unknown", label: "Légalité…" };
  if (outcome.kind === "error") return { kind: "unknown", label: "Légalité indisponible" };
  return outcome.legality.is_legal
    ? { kind: "legal", label: "Légal" }
    : { kind: "illegal", label: "Illégal" };
}
