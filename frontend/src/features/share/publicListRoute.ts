/**
 * Lecture du hash d'une page publique de liste partagée (Lot 13, P6, A7) :
 * `#/liste/<jeton>` et, plus tard, `#/liste/<jeton>?revision=<écarts>` (P8, A10).
 *
 * Fonction pure, sans accès au navigateur : `Root` s'en sert avant même de
 * choisir entre la page publique et `AuthGate`, donc avant toute session, base
 * IndexedDB ou moteur de sync.
 */

/** Même motif que le chemin de `GET /listes/{token}` : 8 caractères de `[A-Za-z0-9_]`. */
export const SHARE_TOKEN_PATTERN = /^[A-Za-z0-9_]{8}$/;

const PUBLIC_PREFIX = "#/liste/";

export type PublicListRoute =
  /** Un autre hash : l'application normale, sous `AuthGate`. */
  | { kind: "none" }
  /** `#/liste/…` dont le jeton n'a pas la forme attendue : la page le dit, sans appel réseau. */
  | { kind: "invalid" }
  /**
   * `revision` : valeur **brute** du paramètre (jamais décodée ni coupée sur les
   * `=` et `;` qu'elle contient ; son décodage relève de A10), `null` s'il manque
   * ou s'il est vide.
   */
  | { kind: "list"; token: string; revision: string | null };

function rawRevision(query: string): string | null {
  for (const part of query.split("&")) {
    if (part.startsWith("revision=")) {
      const value = part.slice("revision=".length);
      return value === "" ? null : value;
    }
  }
  return null;
}

export function parsePublicListHash(hash: string): PublicListRoute {
  if (!hash.startsWith(PUBLIC_PREFIX)) return { kind: "none" };
  const rest = hash.slice(PUBLIC_PREFIX.length);
  const queryAt = rest.indexOf("?");
  const token = queryAt === -1 ? rest : rest.slice(0, queryAt);
  if (!SHARE_TOKEN_PATTERN.test(token)) return { kind: "invalid" };
  return { kind: "list", token, revision: queryAt === -1 ? null : rawRevision(rest.slice(queryAt + 1)) };
}

/** Vrai pour tout hash que la coquille publique prend en charge, jeton valide ou non. */
export const isPublicListHash = (hash: string): boolean => parsePublicListHash(hash).kind !== "none";
