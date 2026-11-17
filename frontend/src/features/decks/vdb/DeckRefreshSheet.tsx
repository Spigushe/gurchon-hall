import { useId, useRef } from "react";
import { LoadingState } from "../../../components/Loading";
import { Sheet, SheetHeader } from "../../../components/Sheet";
import type { LocalDeck } from "../../../offline/vtes";
import { DeckRefreshStep } from "./DeckRefreshStep";
import { useImportCardIndex } from "./useImportCardIndex";

/**
 * Feuille « Mettre à jour depuis VDB » d'un deck lié (Lot 9, D3, écran 4),
 * ouverte depuis les actions du deck (sous la composition au mobile, dans
 * l'en-tête du deckbuilder au bureau).
 */
export function DeckRefreshSheet({ deck, onClose }: { deck: LocalDeck; onClose: () => void }) {
  const id = useId();
  const titleId = `${id}-title`;
  const titleRef = useRef<HTMLHeadingElement>(null);
  const { index, catalogEmpty } = useImportCardIndex();

  return (
    <Sheet titleId={titleId} titleRef={titleRef} onClose={onClose} data-testid="deck-refresh-sheet">
      <SheetHeader
        kicker={deck.name}
        title="Mettre à jour depuis VDB"
        titleId={titleId}
        titleRef={titleRef}
        onClose={onClose}
      />
      {index === null ? (
        <LoadingState caption="Lecture du catalogue…" />
      ) : catalogEmpty ? (
        <p className="quote-block" data-testid="deck-refresh-no-catalog">
          Le catalogue n'est pas encore sur cet appareil : il se charge à la première connexion au réseau.
        </p>
      ) : (
        <DeckRefreshStep deckKey={deck.key} index={index} onDone={onClose} onCancel={onClose} />
      )}
    </Sheet>
  );
}
