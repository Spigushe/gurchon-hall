import type { CatalogMirrorState } from "../../offline/vtes";
import type { CatalogState } from "./catalogContext";

/**
 * Le catalogue est-il « en cours de chargement » (Lot 12, A8) ?
 *
 * À la première connexion d'un appareil, les decks arrivent avant le catalogue
 * (les miroirs passent d'abord, puis environ 22 pages de cartes) : pendant ces
 * secondes, le miroir des cartes est vide et la liste des decks montrait
 * « 0 / 0 » et « Hors catalogue local ». L'écriture elle-même ne laisse voir
 * aucun état intermédiaire (une transaction Dexie : on lit l'avant ou
 * l'après), si bien que la fenêtre à signaler est celle de la lecture, que
 * `CatalogProvider` suit par `status`.
 *
 * - miroir pas encore lu : vrai (on ne sait pas encore, et rien d'utile ne
 *   s'affiche de toute façon) ;
 * - catalogue complet : faux, même pendant une mise à jour ;
 * - absent ou incomplet : vrai tant qu'une lecture est en cours. Hors ligne,
 *   ou après un échec, faux : l'écran garde ses mentions d'aujourd'hui.
 */
export function isCatalogLoading(
  mirror: CatalogMirrorState | undefined,
  status: CatalogState["status"],
): boolean {
  if (mirror === undefined) return true;
  return !mirror.complete && status === "loading";
}
