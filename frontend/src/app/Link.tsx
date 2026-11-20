import type { ReactNode } from "react";
import { hrefFor, type Route } from "./routes";

/** Lien vers une route cliente : une ancre `#/…`, sans JavaScript ni rechargement. */
export function Link({
  to,
  children,
  current,
  className,
  ...rest
}: {
  to: Route;
  children: ReactNode;
  /** Marque le lien de la page courante pour les lecteurs d'écran. */
  current?: boolean;
  className?: string;
  "data-testid"?: string;
  /** Entrée d'un menu (`menuitem`, menu du compte au bureau). */
  role?: string;
  /** La navigation reste celle de l'ancre ; sert à refermer un menu au passage. */
  onClick?: () => void;
}) {
  return (
    <a href={hrefFor(to)} aria-current={current ? "page" : undefined} className={className} {...rest}>
      {children}
    </a>
  );
}
