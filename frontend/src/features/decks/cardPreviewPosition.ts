/**
 * Placement de l'aperçu d'une carte sous son nom (issue #71), en coordonnées
 * de la fenêtre (`position: fixed`) : les tableaux de deck sont en
 * `overflow: hidden`, un aperçu en position absolue y serait rogné.
 *
 * Sous le nom par défaut ; au-dessus s'il manque de place en bas et qu'il y
 * en a plus en haut ; toujours gardé dans la fenêtre, à `margin` des bords.
 */
export interface PreviewAnchor {
  top: number;
  bottom: number;
  left: number;
}

export interface PreviewSize {
  width: number;
  height: number;
}

export interface Viewport {
  width: number;
  height: number;
}

export const PREVIEW_GAP = 6;
export const PREVIEW_MARGIN = 8;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, Math.max(min, max)));

export function cardPreviewPosition(
  anchor: PreviewAnchor,
  size: PreviewSize,
  viewport: Viewport,
): { top: number; left: number } {
  const below = anchor.bottom + PREVIEW_GAP;
  const above = anchor.top - PREVIEW_GAP - size.height;
  const fitsBelow = below + size.height <= viewport.height - PREVIEW_MARGIN;
  const roomBelow = viewport.height - anchor.bottom;
  const top = fitsBelow || roomBelow >= anchor.top ? below : above;
  return {
    top: clamp(top, PREVIEW_MARGIN, viewport.height - PREVIEW_MARGIN - size.height),
    left: clamp(anchor.left, PREVIEW_MARGIN, viewport.width - PREVIEW_MARGIN - size.width),
  };
}
