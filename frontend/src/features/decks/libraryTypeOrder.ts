import vdbCardtypeOrder from "../../assets/data/cardtypeSortedFull.json";

/**
 * Ordre des groupes de bibliothèque, **le même pour toutes les decklists** de
 * l'application : tableaux d'un deck (`DeckTables`), exports `TEXT`, `TWD`,
 * `JOL` et `LACKEY`, liste publique, compte-rendu de tournoi.
 *
 * Il est figé sur celui de VDB, recopié tel quel dans
 * `src/assets/data/cardtypeSortedFull.json` depuis
 * `smeea/vdb`, `frontend/src/assets/data/cardtypeSortedFull.json` (licence MIT).
 * Le workflow `.github/workflows/vdb-cardtype-order.yml` compare chaque mois la
 * copie au fichier de VDB et propose une PR quand il change : aucune autre
 * ligne de code n'a à suivre.
 *
 * La liste de VDB range des **libellés**, types seuls et combinaisons
 * (`Action Modifier/Reaction`). Une carte prend le libellé de la liste qui a
 * exactement ses types, quel que soit l'ordre où le catalogue les donne : une
 * carte `Reaction` + `Combat` se range sous `Combat/Reaction`, au rang de VDB.
 *
 * Écart voulu : un type ou une combinaison que la liste ne connaît pas
 * (`Reflex` au 2026-11-23, qu'aucune carte de crypte ou de bibliothèque
 * ordinaire ne porte) n'est pas perdu, là où l'export de VDB l'omet. Il vient
 * après le dernier libellé de la liste, par ordre alphabétique, et ses types
 * suivent l'ordre des types seuls de la liste, les inconnus à la fin.
 */
export const VDB_CARDTYPE_ORDER: readonly string[] = vdbCardtypeOrder;

const SEPARATOR = "/";

const setKey = (types: readonly string[]) => [...types].sort().join(SEPARATOR);

const LISTED: ReadonlyMap<string, { rank: number; types: readonly string[] }> = new Map(
  VDB_CARDTYPE_ORDER.map((label, rank) => {
    const types = label.split(SEPARATOR);
    return [setKey(types), { rank, types }];
  }),
);

/** Rang d'un type seul dans la liste ; un type absent vient après tous les autres. */
const SINGLE_RANK: ReadonlyMap<string, number> = new Map(
  VDB_CARDTYPE_ORDER.filter((label) => !label.includes(SEPARATOR)).map((label, index) => [label, index]),
);

const singleRank = (type: string) => SINGLE_RANK.get(type) ?? SINGLE_RANK.size;

const orderSingles = (types: readonly string[]) =>
  [...types].sort((a, b) => singleRank(a) - singleRank(b) || (a < b ? -1 : a > b ? 1 : 0));

export interface LibraryTypeGroup {
  /** Types dans l'ordre du libellé de VDB (`["Combat", "Reaction"]`). */
  types: string[];
  /** Rang dans la liste de VDB ; `VDB_CARDTYPE_ORDER.length` hors liste. */
  rank: number;
  /** Libellé de VDB (`Combat/Reaction`), ou types joints par `/` hors liste. */
  label: string;
}

/** Groupe d'une carte d'après ses types ; `null` pour une carte sans type connu. */
export function libraryTypeGroup(types: readonly string[]): LibraryTypeGroup | null {
  if (types.length === 0) return null;
  const listed = LISTED.get(setKey(types));
  if (listed) return { types: [...listed.types], rank: listed.rank, label: listed.types.join(SEPARATOR) };
  const ordered = orderSingles(types);
  return { types: ordered, rank: VDB_CARDTYPE_ORDER.length, label: ordered.join(SEPARATOR) };
}

/** Rang de VDB, puis libellé (seul cas d'égalité : deux libellés hors liste). */
export function compareLibraryTypeGroups(a: LibraryTypeGroup, b: LibraryTypeGroup): number {
  return a.rank - b.rank || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0);
}
