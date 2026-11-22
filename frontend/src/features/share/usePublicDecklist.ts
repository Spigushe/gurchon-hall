import { useEffect, useState } from "react";
import type { components } from "../../api-client/schema";
import { useApiClient } from "../../app/apiClientContext";

export type SharedDecklist = components["schemas"]["SharedDecklistRead"];

export type PublicDecklistState =
  | { kind: "loading" }
  | { kind: "ready"; list: SharedDecklist }
  | { kind: "not-found" }
  /** Réseau absent ou injoignable : le message dit que la page en a besoin. */
  | { kind: "offline" }
  /** 429 : `retryAfter` en secondes quand l'en-tête `Retry-After` est lisible. */
  | { kind: "rate-limited"; retryAfter: number | null }
  /** 5xx, forme inattendue. */
  | { kind: "error" };

/** Secondes d'attente annoncées par `Retry-After` (forme entière seulement), `null` sinon. */
export function retryAfterSeconds(response: Pick<Response, "headers"> | undefined): number | null {
  const raw = response?.headers?.get("Retry-After");
  if (!raw || !/^\d+$/.test(raw.trim())) return null;
  return Number(raw);
}

function failureOf(response: Response): PublicDecklistState {
  if (response.status === 404) return { kind: "not-found" };
  if (response.status === 429) return { kind: "rate-limited", retryAfter: retryAfterSeconds(response) };
  return { kind: "error" };
}

/**
 * `GET /listes/{token}` : lecture publique, **sans cookie** (`credentials:
 * "omit"`, alors que le client de l'application envoie `include`). Rien n'est
 * stocké : ni miroir, ni cache, ni file.
 */
export function usePublicDecklist(token: string): PublicDecklistState {
  const client = useApiClient();
  const [attempt, setAttempt] = useState<{ token: string; state: PublicDecklistState } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const settle = (state: PublicDecklistState) => {
      if (!cancelled) setAttempt({ token, state });
    };
    client
      .GET("/listes/{token}", { params: { path: { token } }, credentials: "omit" })
      .then((result) => {
        if (result.data) settle({ kind: "ready", list: result.data });
        else settle(failureOf(result.response));
      })
      .catch(() => settle({ kind: "offline" }));
    return () => {
      cancelled = true;
    };
  }, [client, token]);

  return attempt && attempt.token === token ? attempt.state : { kind: "loading" };
}
