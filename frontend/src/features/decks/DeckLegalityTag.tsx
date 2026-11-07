import { useConnectivity } from "../../offline/react";
import type { LocalDeck } from "../../offline/vtes";
import { legalityTag } from "./legalityTagModel";
import { useDeckLegality } from "./useDeckLegality";

/** Badge de légalité d'un deck, lu en ligne comme le reste de la légalité (§11, Lot 3). */
export function DeckLegalityTag({ deck }: { deck: LocalDeck }) {
  const online = useConnectivity();
  const outcome = useDeckLegality(deck.id, online, deck.pending ? "pending" : "synced", 0);
  const { kind, label } = legalityTag(deck, online, outcome);
  return (
    <span className={`legality-tag legality-tag--${kind}`} data-testid="deck-legality-tag" data-legal={kind === "unknown" ? undefined : kind === "legal"}>
      {label}
    </span>
  );
}
