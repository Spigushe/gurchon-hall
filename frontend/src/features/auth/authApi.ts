import type { components } from "../../api-client/schema.d.ts";
import type { ApiClient } from "../../offline/vtes";
import { describeErrorBody, parseRetryAfter } from "../../offline/vtes/transport";

export type UserRead = components["schemas"]["UserRead"];
type UserSignUp = components["schemas"]["UserSignUp"];
type UserLogIn = components["schemas"]["UserLogIn"];

export interface AuthOk {
  kind: "ok";
  user: UserRead;
}

/** Réponse d'erreur du serveur (401, 403, 409, 422, 429…). */
export interface AuthError {
  kind: "error";
  status: number;
  message: string;
  /** Présent seulement pour un 429 qui porte l'en-tête. */
  retryAfterMs?: number;
}

/** Le réseau a manqué avant même d'obtenir une réponse (routes nécessairement en ligne, § D). */
export interface AuthNetworkError {
  kind: "network";
  message: string;
}

export type AuthResult = AuthOk | AuthError | AuthNetworkError;

/**
 * Un seul message par statut, sans détail qui distinguerait une adresse
 * inconnue d'un mauvais mot de passe (P1 : « pas d'oracle sur la connexion »,
 * déjà garanti côté serveur — on ne réinvente pas de distinction ici).
 * `describeErrorBody` (contrat) prime quand le serveur en fournit un, sinon ce
 * repli générique s'applique.
 */
const FALLBACK_MESSAGES: Record<number, string> = {
  401: "Adresse ou mot de passe incorrect.",
  403: "Requête refusée par le serveur.",
  409: "Cette adresse ou ce nom d'utilisateur est déjà pris.",
  422: "Le formulaire n'est pas valide.",
  429: "Trop de tentatives depuis cet appareil. Réessayez plus tard.",
};

function errorFrom(status: number, error: unknown, headers: Headers): AuthError {
  const retryAfterMs = status === 429 ? parseRetryAfter(headers.get("Retry-After")) : undefined;
  return {
    kind: "error",
    status,
    message: describeErrorBody(error) || FALLBACK_MESSAGES[status] || `Erreur inattendue (${status}).`,
    ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
  };
}

function networkError(failure: unknown): AuthNetworkError {
  return {
    kind: "network",
    message: failure instanceof Error ? failure.message : "Réseau indisponible.",
  };
}

/** `POST /inscription` : compte créé, session ouverte dans la même réponse (P2). */
export async function signUp(client: ApiClient, input: UserSignUp): Promise<AuthResult> {
  try {
    const { data, error, response } = await client.POST("/inscription", { body: input });
    if (data) return { kind: "ok", user: data };
    return errorFrom(response.status, error, response.headers);
  } catch (failure) {
    return networkError(failure);
  }
}

/** `POST /connexion`. */
export async function logIn(client: ApiClient, input: UserLogIn): Promise<AuthResult> {
  try {
    const { data, error, response } = await client.POST("/connexion", { body: input });
    if (data) return { kind: "ok", user: data };
    return errorFrom(response.status, error, response.headers);
  } catch (failure) {
    return networkError(failure);
  }
}

/**
 * `POST /deconnexion` : toujours résolue, jamais levée. Un 401 ou un échec
 * réseau disent seulement que la session côté serveur était déjà morte ou
 * injoignable — l'appelant respecte quand même l'ordre du Lot 6 (D3) : purger
 * la base locale seulement après cet appel, qu'il ait réussi ou non.
 */
export async function logOut(client: ApiClient): Promise<void> {
  try {
    await client.POST("/deconnexion");
  } catch {
    // Pas de réseau : rien de plus à faire ici.
  }
}
