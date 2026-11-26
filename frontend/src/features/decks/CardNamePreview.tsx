import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { CardImageView } from "../../components/CardImage";
import { useBrowserOnline } from "../auth/useBrowserOnline";
import { cardPreviewPosition } from "./cardPreviewPosition";
import { isRowTrigger } from "./cardRowTrigger";

/** Délai de survol avant l'aperçu, celui du tableau de la Collection. */
export const PREVIEW_HOVER_DELAY_MS = 300;

/** Taille de `CardImage` en variante `lg` (`.card-image--lg`). */
const PREVIEW_SIZE = { width: 180, height: 251 };

/**
 * Nom d'une carte qui montre son image (issue #71) : au survol après 300ms et
 * au focus clavier, comme le tableau de la Collection ; au toucher ou au clic,
 * l'aperçu reste ouvert jusqu'à un second toucher, un toucher ailleurs, la
 * perte du focus ou `Échap`.
 *
 * Avec `wholeRow`, un toucher n'importe où sur la ligne fait comme un toucher
 * sur le nom (retour de l'utilisateur du 2026-11-26), sauf sur un contrôle et
 * sur ce que `wholeRow.exclude` désigne (la quantité en révision). Un clic de
 * souris sur la ligne ne fait rien : au bureau, le survol du nom suffit.
 *
 * Image générique de la carte (une liste partagée n'a pas d'extension), et
 * repli expliqué hors ligne. La connectivité est celle du navigateur, pour
 * marcher hors du runtime hors ligne (page publique, hors `AuthGate`).
 */
export function CardNamePreview({
  name,
  imageUrl,
  wholeRow,
}: {
  name: string;
  imageUrl: string | null | undefined;
  wholeRow?: { exclude?: string };
}) {
  const online = useBrowserOnline();
  const previewId = useId();
  const button = useRef<HTMLButtonElement>(null);
  const root = useRef<HTMLSpanElement>(null);
  const hoverTimer = useRef<number | null>(null);
  // Un focus qui suit un toucher ou un clic n'ouvre rien : c'est le clic qui
  // décide, sans quoi le toucher ouvrirait puis refermerait aussitôt.
  const pointerFocus = useRef(false);
  // Un toucher sur la ligne fait perdre le focus au nom : ce départ-là ne
  // referme rien, c'est le clic sur la ligne qui décide.
  const rowPointer = useRef(false);
  const rowExclude = wholeRow ? (wholeRow.exclude ?? "") : null;
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

  const rowOf = useCallback(
    () => (rowExclude === null ? null : (root.current?.closest<HTMLElement>('[role="row"]') ?? null)),
    [rowExclude],
  );

  useEffect(() => {
    const row = rowOf();
    if (!row || rowExclude === null) return;
    let pointerType: string | null = null;
    const onPointerDown = (event: PointerEvent) => {
      pointerType = event.pointerType || null;
      rowPointer.current = isRowTrigger(event.target, row, root.current!, rowExclude || undefined);
    };
    const onClick = (event: MouseEvent) => {
      const trigger = isRowTrigger(event.target, row, root.current!, rowExclude || undefined);
      rowPointer.current = false;
      if (!trigger || pointerType === "mouse") return;
      clearHoverTimer();
      setHovered(false);
      setPinned((was) => !was);
    };
    row.addEventListener("pointerdown", onPointerDown);
    row.addEventListener("click", onClick);
    return () => {
      row.removeEventListener("pointerdown", onPointerDown);
      row.removeEventListener("click", onClick);
    };
  }, [rowOf, rowExclude, clearHoverTimer]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (root.current?.contains(event.target as Node)) return;
      const row = rowOf();
      if (row && isRowTrigger(event.target, row, root.current!, rowExclude || undefined)) return;
      close();
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
  }, [open, close, rowOf, rowExclude]);

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
          if (!rowPointer.current) close();
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
