import { useEffect, useState, useSyncExternalStore } from "react";
import { AuthGate } from "../features/auth/AuthGate.tsx";
import { PublicDecklistPage } from "../features/share/PublicDecklistPage";
import { isPublicListHash } from "../features/share/publicListRoute";
import { PublicReportPage } from "../features/report/PublicReportPage";
import { isPublicReportHash } from "../features/report/publicReportRoute";

const subscribe = (notify: () => void) => {
  window.addEventListener("hashchange", notify);
  return () => window.removeEventListener("hashchange", notify);
};
const readHash = () => window.location.hash;
const reloadPage = () => window.location.reload();

/**
 * Aiguillage de la racine (Lot 13, C1, P6) : `#/liste/…`, et depuis le lot
 * Compte-rendu `#/compte-rendu/…`, montrent la page
 * publique **à la place** d'`AuthGate`, qui ne se monte donc pas : pas de
 * lecture de session, pas de base IndexedDB, pas de moteur de sync, pas de
 * `GET /moi`.
 *
 * Mécanique choisie : le côté (page publique ou application) est figé au
 * premier rendu, et **traverser la frontière recharge la page**
 * (`location.reload()`, le nouveau hash étant déjà dans l'adresse). Un
 * montage conditionnel aurait été propre pour public vers application, mais
 * pas l'inverse : démonter `AuthGate` en route laisse un runtime Dexie, un
 * moteur de sync, des écouteurs et des abonnements à fermer un à un, dont
 * aucun n'est conçu pour un démontage à froid. Le rechargement garantit par
 * construction qu'une page publique n'a jamais ouvert de base, et qu'une
 * application ne naît jamais d'un état à moitié défait. Coût : un
 * rechargement, servi par le precache, y compris hors ligne. Entre deux hash
 * du même côté, rien ne recharge (un autre jeton relit simplement sa liste).
 */
/** Une page publique : liste partagée (Lot 13) ou compte-rendu (lot Compte-rendu). */
const isPublicHash = (hash: string) => isPublicListHash(hash) || isPublicReportHash(hash);

export function Root({ reload = reloadPage }: { reload?: () => void }) {
  const hash = useSyncExternalStore(subscribe, readHash);
  const [startedPublic] = useState(() => isPublicHash(window.location.hash));
  const crossed = isPublicHash(hash) !== startedPublic;

  useEffect(() => {
    if (crossed) reload();
  }, [crossed, reload]);

  if (crossed) return null;
  if (!startedPublic) return <AuthGate />;
  return isPublicReportHash(hash) ? <PublicReportPage hash={hash} /> : <PublicDecklistPage hash={hash} />;
}
