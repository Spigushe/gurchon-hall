/**
 * Références client dans une opération, et refus en cascade.
 *
 * Générique : le cœur ne sait rien des genres de ressources (un `kind` est une
 * chaîne opaque) ni des champs où l'adaptateur range ses références. Il fournit
 * un marcheur, qui lit des chemins déclarés par l'adaptateur, et le
 * regroupement des refus qui découlent d'un autre refus.
 *
 * Une référence est un objet portant un champ `client_ref` (texte), comme le
 * protocole `/sync` en désigne les ressources créées hors ligne.
 */

/** Où chercher une référence dans une opération, et de quel genre elle est. */
export interface ReferenceField {
  /**
   * Chemin pointé depuis l'opération : `owner`, `data.parent`. Un segment suivi
   * de `[]` parcourt chaque élément d'un tableau : `data.rows[].who`.
   * Un segment absent, nul ou d'un autre type n'est pas une erreur (champ facultatif).
   */
  path: string;
  kind: string;
}

/** Une référence client lue dans une opération. */
export interface ReferenceUse {
  kind: string;
  clientRef: string;
}

/** Ce qu'une opération crée et ce qu'elle désigne par référence client. */
export interface OperationReferences {
  creates: ReferenceUse | null;
  uses: ReferenceUse[];
}

function collect(value: unknown, segments: readonly string[], out: unknown[]): void {
  if (segments.length === 0) {
    out.push(value);
    return;
  }
  if (value === null || typeof value !== "object") return;
  const [head, ...rest] = segments;
  const each = head.endsWith("[]");
  const name = each ? head.slice(0, -2) : head;
  const child = (value as Record<string, unknown>)[name];
  if (!each) return collect(child, rest, out);
  if (!Array.isArray(child)) return;
  for (const item of child) collect(item, rest, out);
}

/**
 * Les références client que `operation` désigne aux chemins déclarés, dans
 * l'ordre des champs. Seules comptent celles qui portent un `client_ref` : une
 * désignation par identifiant serveur ne dépend d'aucune opération de la file.
 */
export function collectClientRefs(
  operation: unknown,
  fields: readonly ReferenceField[],
): ReferenceUse[] {
  const uses: ReferenceUse[] = [];
  for (const { path, kind } of fields) {
    const found: unknown[] = [];
    collect(operation, path.split("."), found);
    for (const value of found) {
      const ref = (value as { client_ref?: unknown } | null)?.client_ref;
      if (value !== null && typeof value === "object" && typeof ref === "string" && ref !== "") {
        uses.push({ kind, clientRef: ref });
      }
    }
  }
  return uses;
}

const referenceKey = (use: ReferenceUse) => `${use.kind}\u0000${use.clientRef}`;

/** Un refus et les refus qui n'en sont que la suite. */
export interface CascadeGroup<TEntry> {
  /** Le refus qui n'en désigne aucun autre : c'est lui qu'il faut traiter. */
  root: TEntry;
  /** Refus dont une référence vise, de proche en proche, la création refusée de `root`. */
  dependents: TEntry[];
}

/**
 * Regroupe des opérations refusées : celle dont une référence client vise la
 * création d'une autre opération refusée est rangée sous elle (de proche en
 * proche : le groupe est celui de la première création refusée de la chaîne).
 * Corriger la racine suffit souvent à rendre les dépendantes inutiles ; les
 * afficher à part évite à l'utilisateur de les traiter une à une.
 *
 * Pure. L'ordre d'entrée est conservé dans les groupes et entre eux. Une
 * création qui suit son utilisation dans l'ordre fourni (cas d'une correction
 * rangée en fin de file) est reconnue aussi : le lien ne dépend pas de l'ordre.
 */
export function groupCascades<TEntry>(
  rejected: readonly TEntry[],
  referencesOf: (entry: TEntry) => OperationReferences,
): CascadeGroup<TEntry>[] {
  const refs = rejected.map(referencesOf);
  const creator = new Map<string, number>();
  refs.forEach((item, index) => {
    if (item.creates) creator.set(referenceKey(item.creates), index);
  });

  /**
   * Racine de `index`, en remontant ses références. Un cycle (deux créations qui
   * se désignent l'une l'autre, qui ne devrait pas exister) se résout sur la
   * plus ancienne des opérations du cycle, pour que le résultat soit stable.
   */
  const rootOf = (index: number, visited: Set<number>): number => {
    visited.add(index);
    for (const use of refs[index].uses) {
      const parent = creator.get(referenceKey(use));
      if (parent === undefined) continue;
      if (visited.has(parent)) return Math.min(...visited);
      return rootOf(parent, visited);
    }
    return index;
  };

  const groups = new Map<number, CascadeGroup<TEntry>>();
  rejected.forEach((entry, index) => {
    const root = rootOf(index, new Set());
    let group = groups.get(root);
    if (!group) {
      group = { root: rejected[root], dependents: [] };
      groups.set(root, group);
    }
    if (root !== index) group.dependents.push(entry);
  });
  // Ordre des racines dans l'ordre d'entrée.
  return [...groups.entries()].sort(([a], [b]) => a - b).map(([, group]) => group);
}
