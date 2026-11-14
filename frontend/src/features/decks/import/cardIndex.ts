import { foldText } from "../../../offline/core/foldText";
import type { CardRow } from "../../../offline/vtes";

/**
 * Ce que l'import lit d'une carte du catalogue (Lot 9, A2) : tout est au miroir
 * `cards` depuis le Lot 4, l'appariement se fait donc hors ligne.
 */
export type ImportCard = Pick<
  CardRow,
  "id" | "veknId" | "name" | "category" | "groupCode" | "advanced" | "latestCardSetId"
>;

/**
 * Lettres qui ne se décomposent pas en NFKD et que `foldText` laisse telles
 * quelles, alors que VDB les translittère (`unidecode`) : relevé sur le
 * catalogue complet à A1, seuls ł, ø, œ et les tirets longs servent. Un tiret
 * long devient `--`, que la coupure suivante traite comme VDB.
 */
const UNDECOMPOSED: ReadonlyArray<[RegExp, string]> = [
  [/ł/g, "l"],
  [/ø/g, "o"],
  [/œ/g, "oe"],
  [/[—–]/g, "--"],
];

/**
 * Clé de nom d'une carte, des deux côtés de l'appariement (ligne lue et
 * catalogue), sur le modèle de la « minification » de VDB : `foldText`, table
 * des lettres qui ne se décomposent pas, coupure au premier `--` (« Bang Nakh
 * -- Tiger's Claws » retrouve « Bang Nakh — Tiger's Claws »), « the » de tête
 * passé en fin (« The Sargon Fragment » et « Sargon Fragment, The »), puis
 * retrait de tout caractère hors `[a-z0-9]`. Table de cas :
 * `tests/fixtures/vdb-import-cases.json` (`minify`).
 */
export function minifyName(name: string): string {
  let key = foldText(name);
  for (const [letter, replacement] of UNDECOMPOSED) key = key.replace(letter, replacement);
  const cut = key.indexOf("--");
  if (cut >= 0) key = key.slice(0, cut);
  key = key.trim().replace(/^the\b\s*(.*)$/, "$1 the");
  return key.replace(/[^a-z0-9]/g, "");
}

export interface CardIndex {
  byVeknId: ReadonlyMap<number, ImportCard>;
  /** Toutes les versions d'un nom (une en bibliothèque, une ou plusieurs en crypte), par identifiant VEKN croissant. */
  byKey: ReadonlyMap<string, readonly ImportCard[]>;
  /** Par identifiant du catalogue, pour relire une ligne de deck. */
  byId: ReadonlyMap<number, ImportCard>;
}

/** Range le miroir du catalogue par identifiant VEKN et par clé de nom (A2). */
export function buildCardIndex(cards: Iterable<ImportCard>): CardIndex {
  const byVeknId = new Map<number, ImportCard>();
  const byKey = new Map<string, ImportCard[]>();
  const byId = new Map<number, ImportCard>();
  for (const card of cards) {
    byVeknId.set(card.veknId, card);
    byId.set(card.id, card);
    const key = minifyName(card.name);
    const versions = byKey.get(key) ?? [];
    versions.push(card);
    byKey.set(key, versions);
  }
  for (const versions of byKey.values()) versions.sort((a, b) => a.veknId - b.veknId);
  return { byVeknId, byKey, byId };
}

/** Groupe de crypte d'une carte (`"G3"` → 3) ; `null` si neutre (« Any », bibliothèque), comme `crypt_group`. */
export function cryptGroup(groupCode: string | null): number | null {
  const match = /^G([1-9])$/.exec(groupCode ?? "");
  return match ? Number(match[1]) : null;
}

/**
 * Règle des groupes de crypte de la légalité (§5, `group_issues` de
 * `vtes_rules.py`) : au plus deux groupes, et adjacents. Les groupes neutres ne
 * sont pas passés ici.
 */
export function cryptGroupsLegal(groups: Iterable<number>): boolean {
  const distinct = [...new Set(groups)].sort((a, b) => a - b);
  if (distinct.length <= 1) return true;
  return distinct.length === 2 && distinct[1] - distinct[0] === 1;
}
