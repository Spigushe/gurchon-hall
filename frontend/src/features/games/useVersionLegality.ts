import { useEffect, useState } from "react";
import type { components } from "../../api-client/schema";
import { useApiClient } from "../../app/apiClientContext";

export type DeckVersionLegality = components["schemas"]["DeckVersionLegality"];

export type VersionLegalityOutcome =
  | { kind: "ready"; legality: DeckVersionLegality }
  | { kind: "error"; message: string };

interface Settled {
  key: string;
  outcome: VersionLegalityOutcome;
}

/**
 * Légalité d'une version jouée à une date (Lot 8, P11), lue **depuis le
 * serveur** (`GET /decks/{id}/versions/{numero}/legalite?on=`), comme toute
 * légalité : les règles VtES ne sont pas recodées côté client. Une version ne
 * change jamais, donc la lecture ne se relance que si la version ou la date
 * changent.
 *
 * `null` hors ligne ou tant que la lecture est en cours.
 */
export function useVersionLegality(
  deckId: number,
  number: number,
  on: string,
  online: boolean,
): VersionLegalityOutcome | null {
  const client = useApiClient();
  const requestKey = `${deckId}|${number}|${on}`;
  const [settled, setSettled] = useState<Settled | null>(null);

  useEffect(() => {
    if (!online) return;
    let cancelled = false;
    const settle = (outcome: VersionLegalityOutcome) => {
      if (!cancelled) setSettled({ key: requestKey, outcome });
    };
    client
      .GET("/decks/{deck_id}/versions/{number}/legalite", {
        params: { path: { deck_id: deckId, number }, query: { on } },
      })
      .then((result) => {
        if (result.data) {
          settle({ kind: "ready", legality: result.data });
        } else {
          settle({ kind: "error", message: `réponse ${result.response.status}` });
        }
      })
      .catch(() => settle({ kind: "error", message: "le serveur est injoignable" }));
    return () => {
      cancelled = true;
    };
  }, [client, online, deckId, number, on, requestKey]);

  if (!online) return null;
  return settled?.key === requestKey ? settled.outcome : null;
}
