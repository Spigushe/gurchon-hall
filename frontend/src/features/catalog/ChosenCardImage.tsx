import { useState } from "react";
import { CardImage } from "../../components/CardImage";
import { useConnectivity } from "../../offline/react";
import { printingImage, useCardOnline } from "./useCardOnline";

/**
 * Image de la carte choisie dans le picker du deckbuilder (lot Chercher, D3,
 * P7 ; handoff Chercher, écran 41) : l'image de l'**impression** choisie, lue
 * à la demande en ligne, puis l'image générique du miroir, puis le
 * pictogramme. On parle ici d'un exemplaire précis, d'où l'impression.
 *
 * `enlargeable` (mobile) : l'image n'est montrée qu'en ligne, la ligne restant
 * celle d'avant hors ligne, et un toucher l'agrandit ou la réduit.
 */
export function ChosenCardImage({
  card,
  cardSetId,
  enlargeable = false,
}: {
  card: { cardId: number; label: string; imageUrl: string | null };
  cardSetId: number | null;
  enlargeable?: boolean;
}) {
  const online = useConnectivity();
  const read = useCardOnline(card.cardId);
  const [large, setLarge] = useState(false);
  const src = printingImage(read, cardSetId);

  if (!enlargeable) return <CardImage src={src} fallbackSrc={card.imageUrl} alt={card.label} size="sm" data-testid="deck-card-form-image" />;
  if (!online) return null;
  return (
    <div className="picker-image">
      <button
        type="button"
        className="picker-image__button"
        onClick={() => setLarge((value) => !value)}
        aria-pressed={large}
        aria-label={large ? `Réduire l'image de ${card.label}` : `Agrandir l'image de ${card.label}`}
        data-testid="deck-card-form-image"
      >
        <CardImage src={src} fallbackSrc={card.imageUrl} alt={card.label} size={large ? "lg" : "picker"} explain />
      </button>
      <span className="hint">Touchez l'image pour {large ? "la réduire" : "l'agrandir"}</span>
    </div>
  );
}
