/**
 * Stockage persistant (lot Chercher, P14) : demande au navigateur de ne pas
 * évincer les bases IndexedDB de l'origine sous pression de stockage. Sans
 * cela, un téléphone presque plein peut vider en silence le miroir du
 * catalogue et la file d'attente — la file, elle, ne se reconstruit pas.
 *
 * Le comportement dépend du navigateur : Chrome accorde ou refuse sans
 * demander, selon l'usage de l'origine (une PWA installée est accordée) ;
 * Firefox peut afficher une invite ; Safari accorde selon ses propres règles.
 * Un refus n'empêche rien de fonctionner : le stockage reste « au mieux »
 * (*best-effort*), comme avant.
 *
 * Résultats possibles :
 * - `"persisted"` : déjà persistant, ou accordé à l'instant ;
 * - `"denied"` : refusé ;
 * - `"unsupported"` : API absente (vieux navigateur, contexte non sécurisé,
 *   environnement de test) ;
 * - `"error"` : l'appel a levé.
 *
 * Ne lève jamais, n'attend pas le réseau, n'affiche rien.
 */
export type PersistResult = "persisted" | "denied" | "unsupported" | "error";

export async function requestPersistentStorage(
  storage: Pick<StorageManager, "persist" | "persisted"> | undefined = typeof navigator === "undefined"
    ? undefined
    : navigator.storage,
): Promise<PersistResult> {
  if (!storage || typeof storage.persist !== "function") return "unsupported";
  try {
    if (typeof storage.persisted === "function" && (await storage.persisted())) return "persisted";
    return (await storage.persist()) ? "persisted" : "denied";
  } catch {
    return "error";
  }
}
