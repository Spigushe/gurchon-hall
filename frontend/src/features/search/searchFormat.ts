import { cardLegality, type SearchableCard } from "../../offline/vtes";

/** Libellés de la fiche et des lignes de Chercher (D1c), hors composants. */

export { costLabel } from "../../components/glyphs/glyphs";

const formatDate = (iso: string) => iso.split("-").reverse().join("/");

export type LegalityKind = "legal" | "banned" | "soon" | "unknown";

/** Légalité du jour d'une carte, en clair ; « inconnue » sans détails (miroir incomplet). */
export function legalityText(item: SearchableCard, on: string): { label: string; kind: LegalityKind } {
  if (!item.details) return { label: "inconnue (catalogue à mettre à jour)", kind: "unknown" };
  const legality = cardLegality(item.details.bannedOn, item.details.legalFrom, on);
  if (legality.banned) return { label: "Bannie", kind: "banned" };
  if (legality.notYetLegal) return { label: `Légale le ${formatDate(item.details.legalFrom!)}`, kind: "soon" };
  return { label: "légale", kind: "legal" };
}
