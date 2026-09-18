import { useEffect, useState } from "react";

/**
 * Suit l'état de connectivité réseau du navigateur.
 * Base sur `navigator.onLine` + les événements `online`/`offline`.
 * Aucun appel réseau : purement local, compatible avec un affichage
 * sans connexion (cf. CLAUDE.md §3).
 */
export function useOnlineStatus(): boolean {
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  return isOnline;
}
