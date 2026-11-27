import { useId, useMemo, useState } from "react";
import { useConnectivity } from "../../offline/react";
import type { LocalDeck, LocalDeckCard } from "../../offline/vtes";
import { DeckLegalityDetails } from "./DeckLegalityDetails";
import { deckLegalityVersion } from "./deckLegalityVersion";
import { legalityTag } from "./legalityTagModel";
import { useDeckLegality, type LegalityOutcome } from "./useDeckLegality";

/**
 * Légalité d'un deck, une seule pastille aux deux largeurs (v1.2.2, A3) :
 * « Légal » / « Illégal » dans un bouton, et le détail du Lot 5c (effectifs,
 * groupes, motifs, cartes bannies, alertes, avertissement de version) dans
 * `DeckLegalityDetails`.
 *
 * Au bureau, le détail s'ouvre en infobulle au survol ou au focus ; au toucher,
 * un appui l'ouvre ou le referme (`aria-expanded`), déplié sous la pastille.
 * Le clic ne recalcule rien : le verdict suit le deck (`deckLegalityVersion`).
 * Une seule lecture serveur pour la pastille et le détail.
 *
 * `lines` : les lignes du deck déjà lues par l'écran (`useLocalDeckCards`),
 * dont dépend l'empreinte qui relance la lecture.
 */
export function DeckLegalityBadge({
  deck,
  lines,
}: {
  deck: LocalDeck;
  lines: readonly LocalDeckCard[] | undefined;
}) {
  const online = useConnectivity();
  const version = useMemo(() => deckLegalityVersion(deck, lines), [deck, lines]);
  const outcome = useDeckLegality(deck.id, online, version);
  const { kind, label } = legalityTag(deck, online, outcome);
  const detailId = useId();
  const [open, setOpen] = useState(false);

  return (
    <div className="legality-badge" data-testid="deck-builder-legality">
      <button
        type="button"
        className={`legality-tag legality-tag--${kind} legality-badge__tag`}
        data-testid="deck-legality-toggle"
        data-legal={kind === "unknown" ? undefined : kind === "legal"}
        aria-expanded={open}
        aria-controls={detailId}
        aria-describedby={detailId}
        onClick={() => setOpen((value) => !value)}
      >
        <span data-testid="deck-legality-tag">{label}</span>
      </button>
      <div
        className={`legality-badge__tooltip${open ? " legality-badge__tooltip--open" : ""}`}
        role="tooltip"
        id={detailId}
        data-testid="deck-legality-tooltip"
      >
        <p className="legality-badge__title">{verdictTitle(outcome)}</p>
        <DeckLegalityDetails deck={deck} online={online} outcome={outcome} />
      </div>
    </div>
  );
}

/** « Deck légal · crypte 12, bibliothèque 80 · groupes G5, G6 · verdict du 2026-11-27 ». */
function verdictTitle(outcome: LegalityOutcome | null): string {
  if (outcome?.kind !== "ready") return "Verdict de légalité";
  const { legality } = outcome;
  const verdict = legality.is_legal ? "Deck légal" : "Deck illégal";
  const groups = legality.crypt_groups.length > 0 ? ` · groupes ${legality.crypt_groups.join(", ")}` : "";
  return `${verdict} · crypte ${legality.crypt_count}, bibliothèque ${legality.library_count}${groups} · verdict du ${legality.evaluated_on}`;
}
