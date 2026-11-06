import { useIsDesktop } from "../../components/useIsDesktop";
import type { DeckKey } from "../../offline/vtes";
import { SearchDesktop } from "./SearchDesktop";
import { SearchMobile } from "./SearchMobile";
import { useSearchPage } from "./useSearchPage";

/**
 * Chercher (lot Chercher) : recherche dans le miroir local du catalogue, sans
 * appel réseau, avec les filtres de P1, le tri de P9 et la fiche d'une carte
 * (étape D1c ; `docs/lot-chercher-plan.md`, handoff
 * `docs/design-handoff/CHERCHER.md`). Une seule source d'état
 * (`useSearchPage`) pour deux dispositions, choisies par la largeur.
 *
 * `initialQuery` (paramètre `q` du hash) et `deck` (deck cible, P12) ne sont
 * lus qu'à l'arrivée ; ensuite la page réécrit l'adresse par `replaceState`.
 */
export function SearchPage({ initialQuery = "", deck }: { initialQuery?: string; deck?: DeckKey }) {
  const isDesktop = useIsDesktop();
  const page = useSearchPage(initialQuery, deck);
  return isDesktop ? <SearchDesktop page={page} /> : <SearchMobile page={page} />;
}
