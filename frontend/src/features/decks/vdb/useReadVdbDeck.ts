import { useCallback, useState } from "react";
import type { components } from "../../../api-client/schema";
import { useApiClient } from "../../../app/apiClientContext";
import { vdbReadError } from "../import/importLabels";

export type VdbDeckRead = components["schemas"]["VdbDeckRead"];

export type VdbReadState = { kind: "idle" } | { kind: "loading" } | { kind: "error"; message: string };

const detailOf = (error: unknown): string | null =>
  error && typeof error === "object" && "detail" in error && typeof error.detail === "string" ? error.detail : null;

/**
 * Lecture d'un deck VDB **par notre serveur** (`GET /vdb/decks/{id}`, P3, A7),
 * en ligne seulement : jamais une écriture, rien en file. Rend le deck lu, ou
 * `null` en laissant le motif du refus dans `state`.
 */
export function useReadVdbDeck(): { state: VdbReadState; read: (vdbDeckId: string) => Promise<VdbDeckRead | null>; reset: () => void } {
  const client = useApiClient();
  const [state, setState] = useState<VdbReadState>({ kind: "idle" });

  const read = useCallback(
    async (vdbDeckId: string) => {
      setState({ kind: "loading" });
      try {
        const result = await client.GET("/vdb/decks/{vdb_deck_id}", {
          params: { path: { vdb_deck_id: vdbDeckId } },
        });
        if (result.data) {
          setState({ kind: "idle" });
          return result.data;
        }
        const { status, headers } = result.response;
        setState({ kind: "error", message: vdbReadError(status, detailOf(result.error), headers.get("Retry-After")) });
      } catch {
        setState({ kind: "error", message: vdbReadError(null, null, null) });
      }
      return null;
    },
    [client],
  );

  const reset = useCallback(() => setState({ kind: "idle" }), []);
  return { state, read, reset };
}
