import type { ReactNode } from "react";

/** Action pleine largeur au-dessus de la tab bar (handoff Nocturne, « pilule flottante »). */
export function Pill({
  children,
  onClick,
  type = "button",
  disabled = false,
  "data-testid": testId,
  "aria-label": ariaLabel,
  "aria-expanded": ariaExpanded,
  round = false,
  compact = false,
}: {
  children: ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  disabled?: boolean;
  "data-testid"?: string;
  "aria-label"?: string;
  "aria-expanded"?: boolean;
  round?: boolean;
  /** Pilule autonome 40px (hors zone d'action flottante), plutôt que le format plein largeur 50px. */
  compact?: boolean;
}) {
  return (
    <button
      type={type}
      className={`pill ${compact ? "pill--compact" : "pill--floating"} ${round ? "pill--round" : ""}`}
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      aria-label={ariaLabel}
      aria-expanded={ariaExpanded}
    >
      {children}
    </button>
  );
}
