import { useEffect, useState } from "react";
import type { components } from "../../api-client/schema";
import { useApiClient } from "../../app/apiClientContext";

export type DeckLegality = components["schemas"]["DeckLegality"];

export type LegalityOutcome =
  | { kind: "ready"; legality: DeckLegality }
  | { kind: "error"; message: string };

interface Settled {
  key: string;
  outcome: LegalityOutcome;
}

/**
 * Verdict de légalité d'un deck, lu **depuis le serveur** (`GET
 * /decks/{id}/legalite`) : la légalité se calcule à la demande côté back, la
 * dupliquer ici violerait la règle de ne pas recoder les règles VtES.
 *
 * `null` tant que la lecture est en cours (ou non éligible). Éligible seulement
 * en ligne et pour un deck qui a un identifiant serveur. `version` relance la
 * lecture quand le deck a changé (fin d'une synchronisation, nouvelle saisie),
 * `refreshToken` quand l'utilisateur demande un recalcul.
 */
export function useDeckLegality(
  deckId: number | null,
  online: boolean,
  version: string,
  refreshToken: number,
): LegalityOutcome | null {
  const client = useApiClient();
  const eligible = online && deckId !== null;
  const requestKey = `${deckId}|${version}|${refreshToken}`;
  const [settled, setSettled] = useState<Settled | null>(null);

  useEffect(() => {
    if (!eligible || deckId === null) return;
    let cancelled = false;
    const settle = (outcome: LegalityOutcome) => {
      if (!cancelled) setSettled({ key: requestKey, outcome });
    };
    client
      .GET("/decks/{deck_id}/legalite", { params: { path: { deck_id: deckId } } })
      .then((result) => {
        if (result.data) {
          settle({ kind: "ready", legality: result.data });
        } else {
          const detail =
            result.error && "detail" in result.error && typeof result.error.detail === "string"
              ? result.error.detail
              : `réponse ${result.response.status}`;
          settle({ kind: "error", message: detail });
        }
      })
      .catch(() => settle({ kind: "error", message: "le serveur est injoignable" }));
    return () => {
      cancelled = true;
    };
  }, [client, eligible, deckId, requestKey]);

  if (!eligible) return null;
  return settled?.key === requestKey ? settled.outcome : null;
}
