import { CardImage, type CardImageSize } from "../../components/CardImage";
import { printingImage, useCardOnline } from "./useCardOnline";

/**
 * Art d'une impression précise (Lot 13, D4, P10), sans la mise en page du
 * picker : l'image de l'impression, lue à la demande en ligne
 * (`useCardOnline`), puis l'image générique du miroir, puis le pictogramme.
 * Sert l'aperçu au survol du tableau de la Collection, monté seulement quand
 * l'aperçu s'ouvre : aucune fiche n'est lue pour les lignes qu'on ne survole pas.
 */
export function PrintingImage({
  cardId,
  cardSetId,
  fallbackSrc,
  alt,
  size = "lg",
}: {
  cardId: number;
  cardSetId: number | null;
  /** L'image générique de la carte (`CardRow.imageUrl`). */
  fallbackSrc: string | null | undefined;
  alt: string;
  size?: CardImageSize;
}) {
  const read = useCardOnline(cardId);
  return <CardImage src={printingImage(read, cardSetId)} fallbackSrc={fallbackSrc} alt={alt} size={size} />;
}
