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
}) {
  return (
    <a href={hrefFor(to)} aria-current={current ? "page" : undefined} className={className} {...rest}>
      {children}
    </a>
  );
}
