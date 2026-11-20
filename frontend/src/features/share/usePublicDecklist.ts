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
  /** 429, 5xx (dont le 501 de la garde provisoire), forme inattendue. */
  | { kind: "error" };

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
        else settle({ kind: result.response.status === 404 ? "not-found" : "error" });
      })
      .catch(() => settle({ kind: "offline" }));
    return () => {
      cancelled = true;
    };
  }, [client, token]);

  return attempt && attempt.token === token ? attempt.state : { kind: "loading" };
}
