import { useCallback, useEffect, useRef, useState } from "react";
import { parsePublicListHash } from "./publicListRoute";

/**
 * Valeur du paramètre `revision` de l'adresse, et ses deux sens (Lot 13, A10).
 *
 * - **Écrire** : `write` réécrit l'adresse par `history.replaceState`, sans
 *   entrée d'historique. `replaceState` ne déclenche pas `hashchange`, donc
 *   `Root` ne voit rien passer et ne recharge pas.
 * - **Relire** : une adresse changée à la main (ou par « précédent » vers une
 *   autre page) déclenche `hashchange`. Si son paramètre n'est pas celui que
 *   la page vient d'écrire, `epoch` change : le corps de la page, clé sur
 *   `epoch`, repart de la nouvelle adresse. Le paramètre est comparé à ce qui
 *   a été écrit en dernier, pas à ce que `Root` a gardé en mémoire : revenir à
 *   l'adresse d'origine après des modifications est donc bien relu.
 *
 * Un autre jeton n'est pas l'affaire de ce hook : `Root` remonte la page.
 */
export function useExternalRevision(token: string, initialRaw: string | null) {
  const [state, setState] = useState({ raw: initialRaw, epoch: 0 });
  const lastKnown = useRef<string | null>(initialRaw);

  useEffect(() => {
    const onHashChange = () => {
      const route = parsePublicListHash(window.location.hash);
      if (route.kind !== "list" || route.token !== token || route.revision === lastKnown.current) return;
      lastKnown.current = route.revision;
      setState((previous) => ({ raw: route.revision, epoch: previous.epoch + 1 }));
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [token]);

  const write = useCallback(
    (encoded: string | null) => {
      lastKnown.current = encoded;
      window.history.replaceState(window.history.state, "", revisionHash(token, encoded));
    },
    [token],
  );

  return { raw: state.raw, epoch: state.epoch, write };
}

/** `#/liste/<jeton>` puis `?revision=<écarts>` s'il y en a. */
export const revisionHash = (token: string, encoded: string | null): string =>
  `#/liste/${token}${encoded ? `?revision=${encoded}` : ""}`;

/** Adresse complète de la révision, pour la copier. */
export const revisionLink = (origin: string, pathname: string, token: string, encoded: string | null): string =>
  `${origin}${pathname}${revisionHash(token, encoded)}`;
