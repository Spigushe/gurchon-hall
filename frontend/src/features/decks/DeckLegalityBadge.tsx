import { useId } from "react";
import { useConnectivity } from "../../offline/react";
import type { LocalDeck } from "../../offline/vtes";
import { DeckLegalityDetails } from "./DeckLegalityDetails";
import { legalityTag } from "./legalityTagModel";
import { useDeckLegality, type LegalityOutcome } from "./useDeckLegality";

/**
 * Légalité dans l'en-tête du deckbuilder bureau (lot Affichage des decks,
 * `DECKS.md` d23, choix de l'utilisateur à la clôture) : une pastille
 * « Légal » / « Illégal · bibliothèque 56/60 » à côté de la méta, et le
 * détail du Lot 5c (motifs, cartes bannies, alertes, avertissement de version)
 * dans une infobulle ouverte au survol ou au focus. Le détail reste dans le
 * DOM (`aria-describedby`), il n'est que masqué hors survol.
 *
 * La pastille est un bouton : un clic relance la lecture du verdict, comme
 * `R`. Une seule lecture serveur pour la pastille et l'infobulle.
 */
export function DeckLegalityBadge({
  deck,
  refreshToken,
  onRefresh,
}: {
  deck: LocalDeck;
  refreshToken: number;
  onRefresh: () => void;
}) {
  const online = useConnectivity();
  const outcome = useDeckLegality(deck.id, online, deck.pending ? "pending" : "synced", refreshToken);
  const { kind, label } = legalityTag(deck, online, outcome);
  const tooltipId = useId();

  return (
    <div className="legality-badge" data-testid="deck-builder-legality">
      <button
        type="button"
        className={`legality-tag legality-tag--${kind} legality-badge__tag`}
        data-testid="deck-legality-refresh"
        data-legal={kind === "unknown" ? undefined : kind === "legal"}
        aria-describedby={tooltipId}
        aria-keyshortcuts="r"
        onClick={onRefresh}
      >
        <span data-testid="deck-legality-tag">{label}</span>
      </button>
      <div className="legality-badge__tooltip" role="tooltip" id={tooltipId} data-testid="deck-legality-tooltip">
        <p className="legality-badge__title">{verdictTitle(outcome)}</p>
        <DeckLegalityDetails deck={deck} online={online} outcome={outcome} />
        <p className="legality-badge__hint">Clic ou R : recalculer le verdict.</p>
      </div>
    </div>
  );
}

function verdictTitle(outcome: LegalityOutcome | null): string {
  if (outcome?.kind !== "ready") return "Verdict de légalité";
  const { legality } = outcome;
  const verdict = legality.is_legal ? "Deck légal" : "Deck illégal";
  return `${verdict} · crypte ${legality.crypt_count}, bibliothèque ${legality.library_count} · verdict du ${legality.evaluated_on}`;
}
