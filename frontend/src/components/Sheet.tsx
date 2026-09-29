import { useEffect, type ReactNode, type RefObject } from "react";
import { ArrowLeft, X } from "@phosphor-icons/react";

/**
 * Feuille plein écran ou écran poussé (handoff Nocturne).
 *
 * Deux variantes : `"full"` couvre tout, y compris la tab bar (créations,
 * corrections, ajout de cartes) ; `"pushed"` laisse la tab bar visible en bas
 * (formulaires ouverts depuis une page qui garde sa navigation, ex. modifier
 * une entrée de collection). Dans les deux cas, `role="dialog"`,
 * `aria-modal="true"`, Échap ferme, et le focus va au titre à l'ouverture (le
 * titre passé doit porter la ref fournie et un `tabIndex={-1}`).
 */
export function Sheet({
  titleId,
  titleRef,
  onClose,
  variant = "full",
  children,
  className = "",
  "data-testid": testId,
}: {
  titleId: string;
  titleRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  variant?: "full" | "pushed";
  children: ReactNode;
  className?: string;
  "data-testid"?: string;
}) {
  useEffect(() => {
    titleRef.current?.focus();
    // Ouverture seulement : on ne relance pas le focus à chaque rendu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className={`sheet sheet--${variant} ${className}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      data-testid={testId}
    >
      <div className="sheet__inner">{children}</div>
    </div>
  );
}

/** Ligne d'en-tête « kicker + titre + fermeture (X) », pour une feuille modale. */
export function SheetHeader({
  kicker,
  title,
  titleId,
  titleRef,
  onClose,
  closeLabel = "Fermer",
}: {
  kicker?: ReactNode;
  title: ReactNode;
  titleId: string;
  titleRef: RefObject<HTMLHeadingElement | null>;
  onClose: () => void;
  closeLabel?: string;
}) {
  return (
    <div className="sheet__header-row">
      <div>
        {kicker && <p className="kicker">{kicker}</p>}
        <h2 id={titleId} ref={titleRef} tabIndex={-1} className="sheet__title">
          {title}
        </h2>
      </div>
      <button type="button" className="sheet__close" onClick={onClose} aria-label={closeLabel}>
        <X size={20} />
      </button>
    </div>
  );
}

/** Ligne de retour « ← Libellé », pour un écran poussé sans fermeture en croix. */
export function BackRow({
  label,
  onClick,
  "data-testid": testId,
}: {
  label: string;
  onClick: () => void;
  "data-testid"?: string;
}) {
  return (
    <button type="button" className="back-row" onClick={onClick} data-testid={testId}>
      <ArrowLeft size={20} />
      {label}
    </button>
  );
}
