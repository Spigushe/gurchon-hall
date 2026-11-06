import { ArrowRightIcon, FunnelSimpleIcon, MagnifyingGlassIcon } from "@phosphor-icons/react";
import { Link } from "../../app/Link";
import type { LocalDeck } from "../../offline/vtes";

/**
 * Lien vers Chercher avec ce deck pour cible (lot Chercher, D3, P12 ; handoff
 * Chercher, écrans 42 et d21) : Chercher s'ouvre avec le bandeau du deck et le
 * filtre « pas dans ce deck ». Absent d'un deck archivé, qu'on ne complète pas.
 * Au mobile, sous la composition ; au bureau, sous le champ du picker.
 */
export function SearchForDeckLink({ deck, desktop = false }: { deck: LocalDeck; desktop?: boolean }) {
  if (deck.archivedAt !== null) return null;
  const Icon = desktop ? FunnelSimpleIcon : MagnifyingGlassIcon;
  return (
    <Link to={{ name: "search", deck: deck.key }} className="search-from-deck" data-testid="search-from-deck">
      <Icon size={18} aria-hidden="true" />
      <span>{desktop ? "Chercher une carte pour ce deck, avec filtres" : "Chercher une carte pour ce deck"}</span>
      <ArrowRightIcon size={16} aria-hidden="true" />
    </Link>
  );
}
