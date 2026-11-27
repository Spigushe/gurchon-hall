import type { components } from "../../api-client/schema";
import { compareFolded } from "../../offline/core";
import type { CardSetRow } from "../../offline/vtes";

export type Bundle = components["schemas"]["BundleRead"];

export interface BundleGroup {
  cardSetId: number;
  /** Nom complet de l'extension, à défaut son abréviation, à défaut « Extension N ». */
  label: string;
  bundles: Bundle[];
}

export const bundleLabel = (bundle: Bundle) =>
  [bundle.name ?? "Produit sans nom", bundle.code && `(${bundle.code})`].filter(Boolean).join(" ");

/** Libellé d'une option : le produit, puis son nombre de cartes s'il est connu. */
export const bundleOptionLabel = (bundle: Bundle) =>
  bundle.size === null ? bundleLabel(bundle) : `${bundleLabel(bundle)} · ${bundle.size} cartes`;

const compareDatesDesc = (a: string | null, b: string | null) => {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? 1 : -1;
};

const compareBundles = (a: Bundle, b: Bundle) =>
  compareDatesDesc(a.release_date, b.release_date) ||
  compareFolded(a.name ?? "Produit sans nom", b.name ?? "Produit sans nom") ||
  a.id - b.id;

/**
 * Range les produits par extension : extensions de la plus récente à la plus
 * ancienne (sans date en dernier, puis par abréviation), produits de chacune par
 * date décroissante puis nom replié.
 */
export function groupBundles(bundles: readonly Bundle[], cardSets: readonly CardSetRow[]): BundleGroup[] {
  const setsById = new Map(cardSets.map((set) => [set.id, set]));
  const groups = new Map<number, Bundle[]>();
  for (const bundle of bundles) {
    const list = groups.get(bundle.card_set_id);
    if (list) list.push(bundle);
    else groups.set(bundle.card_set_id, [bundle]);
  }
  const rank = (id: number) => {
    const set = setsById.get(id);
    return { date: set?.releaseDate ?? null, abbrev: set?.abbrev ?? "" };
  };
  return [...groups.entries()]
    .sort(([a], [b]) => {
      const ra = rank(a);
      const rb = rank(b);
      return compareDatesDesc(ra.date, rb.date) || compareFolded(ra.abbrev, rb.abbrev) || a - b;
    })
    .map(([cardSetId, list]) => {
      const set = setsById.get(cardSetId);
      return {
        cardSetId,
        label: set?.fullName || set?.abbrev || `Extension ${cardSetId}`,
        bundles: [...list].sort(compareBundles),
      };
    });
}
