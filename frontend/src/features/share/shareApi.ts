import type { components } from "../../api-client/schema.d.ts";
import type { ApiClient } from "../../offline/vtes";
import { attempt, failureOf, type ApiOutcome } from "../auth/accountApi";

/**
 * Liens de partage d'une decklist (Lot 13, D2) : lectures et écritures directes
 * par le client typé, en ligne seulement (P4), hors miroir et hors file. Même
 * forme de résultat que les routes du compte (`accountApi.ts`) : jamais
 * d'exception, `network`, `unauthenticated` ou `error` avec son statut.
 */

export type DeckShareRead = components["schemas"]["DeckShareRead"];
export type DeckShareCreate = components["schemas"]["DeckShareCreate"];

/** `GET /decks/{id}/partages` : les liens d'un deck, du plus récent au plus ancien. */
export function listDeckShares(client: ApiClient, deckId: number): Promise<ApiOutcome<DeckShareRead[]>> {
  return attempt(async () => {
    const { data, error, response } = await client.GET("/decks/{deck_id}/partages", {
      params: { path: { deck_id: deckId } },
    });
    return data ? { kind: "ok", value: data } : failureOf(response, error);
  });
}

/** `POST /decks/{id}/partages` : un lien neuf, jeton compris. */
export function createDeckShare(
  client: ApiClient,
  deckId: number,
  body: DeckShareCreate,
): Promise<ApiOutcome<DeckShareRead>> {
  return attempt(async () => {
    const { data, error, response } = await client.POST("/decks/{deck_id}/partages", {
      params: { path: { deck_id: deckId } },
      body,
    });
    return data ? { kind: "ok", value: data } : failureOf(response, error);
  });
}

/** `GET /moi/partages` : tous les liens du compte, decks supprimés compris. */
export function listMyShares(client: ApiClient): Promise<ApiOutcome<DeckShareRead[]>> {
  return attempt(async () => {
    const { data, error, response } = await client.GET("/moi/partages");
    return data ? { kind: "ok", value: data } : failureOf(response, error);
  });
}

export type PurgeRequest = { scope: "selected"; shareIds: readonly number[] } | { scope: "deleted_decks" | "all" };

/** `DELETE /moi/partages` : le seul moyen de révoquer (P5). Rend le nombre de liens purgés. */
export function purgeShares(client: ApiClient, request: PurgeRequest): Promise<ApiOutcome<number>> {
  return attempt(async () => {
    const { data, error, response } = await client.DELETE("/moi/partages", {
      params: {
        query:
          request.scope === "selected"
            ? { scope: "selected", share_id: [...request.shareIds] }
            : { scope: request.scope },
      },
    });
    return data ? { kind: "ok", value: data.revoked } : failureOf(response, error);
  });
}
