import { useCallback, useEffect, useState } from "react";
import { useApiClient } from "../../app/apiClientContext";
import type { ApiOutcome } from "../auth/accountApi";
import {
  createDeckShare,
  listDeckShares,
  listMyShares,
  purgeShares,
  type DeckShareCreate,
  type DeckShareRead,
  type PurgeRequest,
} from "./shareApi";

export type SharesState =
  | { kind: "loading" }
  | { kind: "ready"; shares: DeckShareRead[] }
  | { kind: "error"; message: string };

const NETWORK_MESSAGE = "Le serveur est injoignable. Vérifiez la connexion puis réessayez.";
const EXPIRED_MESSAGE = "Votre session a expiré : reconnectez-vous, puis recommencez.";

/** Message d'un appel qui n'a pas abouti. */
export function failureMessage(outcome: Exclude<ApiOutcome<unknown>, { kind: "ok" }>): string {
  if (outcome.kind === "network") return NETWORK_MESSAGE;
  if (outcome.kind === "unauthenticated") return EXPIRED_MESSAGE;
  return outcome.message;
}

/**
 * Liens de partage, lus et écrits directement par le client typé, hors miroir et
 * hors file (P4), comme les sessions de l'écran Compte. Avec `deckId`, les liens
 * de ce deck (`GET /decks/{id}/partages`) ; sans, tous ceux du compte
 * (`GET /moi/partages`). `enabled` coupe la lecture (hors ligne, ou deck pas
 * encore connu du serveur) ; elle repart au retour du réseau.
 */
export function useShares({ deckId, enabled }: { deckId?: number | null; enabled: boolean }) {
  const client = useApiClient();
  const [state, setState] = useState<SharesState>({ kind: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const target = deckId ?? null;
  const scoped = deckId !== undefined;

  useEffect(() => {
    if (!enabled || (scoped && target === null)) return;
    let cancelled = false;
    const read = scoped && target !== null ? listDeckShares(client, target) : listMyShares(client);
    void read.then((outcome) => {
      if (cancelled) return;
      setState(outcome.kind === "ok" ? { kind: "ready", shares: outcome.value } : { kind: "error", message: failureMessage(outcome) });
    });
    return () => {
      cancelled = true;
    };
  }, [client, enabled, scoped, target, reloadKey]);

  const reload = useCallback(() => setReloadKey((key) => key + 1), []);

  /** Crée un lien et le met en tête de la liste affichée. */
  const create = useCallback(
    async (body: DeckShareCreate): Promise<ApiOutcome<DeckShareRead>> => {
      if (target === null) return { kind: "error", status: 409, message: "Ce deck n'est pas encore synchronisé." };
      const outcome = await createDeckShare(client, target, body);
      if (outcome.kind === "ok") {
        setState((current) =>
          current.kind === "ready" ? { kind: "ready", shares: [outcome.value, ...current.shares] } : current,
        );
      }
      return outcome;
    },
    [client, target],
  );

  /** Purge, puis relit la liste : un refus de sélection (404, 409) veut dire que la liste affichée est périmée. */
  const purge = useCallback(
    async (request: PurgeRequest): Promise<ApiOutcome<number>> => {
      const outcome = await purgeShares(client, request);
      setReloadKey((key) => key + 1);
      return outcome;
    },
    [client],
  );

  return { state, reload, create, purge };
}
