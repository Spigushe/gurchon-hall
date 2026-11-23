import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { CardImageView } from "../../components/CardImage";
import { useBrowserOnline } from "../auth/useBrowserOnline";
import { cardPreviewPosition } from "./cardPreviewPosition";

/** Délai de survol avant l'aperçu, celui du tableau de la Collection. */
export const PREVIEW_HOVER_DELAY_MS = 300;

/** Taille de `CardImage` en variante `lg` (`.card-image--lg`). */
const PREVIEW_SIZE = { width: 180, height: 251 };

/**
 * Nom d'une carte qui montre son image (issue #71) : au survol après 300ms et
 * au focus clavier, comme le tableau de la Collection ; au toucher ou au clic,
 * l'aperçu reste ouvert jusqu'à un second toucher, un toucher ailleurs, la
 * perte du focus ou `Échap`. Seul le nom ouvre l'image : en révision, la
 * quantité garde ses boutons.
 *
 * Image générique de la carte (une liste partagée n'a pas d'extension), et
 * repli expliqué hors ligne. La connectivité est celle du navigateur, pour
 * marcher hors du runtime hors ligne (page publique, hors `AuthGate`).
 */
export function CardNamePreview({ name, imageUrl }: { name: string; imageUrl: string | null | undefined }) {
  const online = useBrowserOnline();
  const previewId = useId();
  const button = useRef<HTMLButtonElement>(null);
  const root = useRef<HTMLSpanElement>(null);
  const hoverTimer = useRef<number | null>(null);
  // Un focus qui suit un toucher ou un clic n'ouvre rien : c'est le clic qui
  // décide, sans quoi le toucher ouvrirait puis refermerait aussitôt.
  const pointerFocus = useRef(false);
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const open = hovered || pinned;

  const clearHoverTimer = useCallback(() => {
    if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
  }, []);
  const close = useCallback(() => {
    clearHoverTimer();
    setHovered(false);
    setPinned(false);
  }, [clearHoverTimer]);

  useEffect(() => clearHoverTimer, [clearHoverTimer]);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = button.current?.getBoundingClientRect();
      if (!rect) return;
      setPosition(
        cardPreviewPosition(rect, PREVIEW_SIZE, { width: window.innerWidth, height: window.innerHeight }),
      );
    };
    place();
    window.addEventListener("scroll", place, { capture: true, passive: true });
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, { capture: true });
      window.removeEventListener("resize", place);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, close]);

  return (
    <span
      ref={root}
      className="card-name-preview"
      onMouseEnter={() => {
        clearHoverTimer();
        hoverTimer.current = window.setTimeout(() => setHovered(true), PREVIEW_HOVER_DELAY_MS);
      }}
      onMouseLeave={() => {
        clearHoverTimer();
        setHovered(false);
      }}
    >
      <button
        ref={button}
        type="button"
        className="deck-table__name-btn"
        aria-expanded={open}
        aria-controls={open ? previewId : undefined}
        data-testid="deck-card-name"
        onPointerDown={() => {
          pointerFocus.current = true;
        }}
        onFocus={() => {
          if (!pointerFocus.current) setHovered(true);
          pointerFocus.current = false;
        }}
        onBlur={() => {
          pointerFocus.current = false;
          close();
        }}
        onClick={() => {
          clearHoverTimer();
          if (pinned) close();
          else setPinned(true);
        }}
      >
        {name}
      </button>
      {open && (
        <span
          id={previewId}
          className="card-name-preview__popup"
          style={(position ?? { visibility: "hidden" }) as CSSProperties}
          data-testid="deck-card-preview"
        >
          <CardImageView src={imageUrl} alt={name} size="lg" explain online={online} />
        </span>
      )}
    </span>
  );
}
