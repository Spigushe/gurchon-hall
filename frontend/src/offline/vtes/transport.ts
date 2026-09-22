import type { components } from "../../api-client/schema.d.ts";
import type { SyncTransport, SyncVerdict, TransportResult } from "../core/types";
import type { ApiClient, VtesOperation } from "./types";

type SyncOperationResult = components["schemas"]["SyncOperationResult"];

/** Verdict du contrat -> verdict générique du moteur. */
export function toVerdict(result: SyncOperationResult): SyncVerdict {
  const bindsDeckRef =
    result.type === "deck.create" &&
    result.error === null &&
    result.client_ref !== null &&
    result.resource?.deck_id != null;
  return {
    operationId: result.operation_id,
    outcome: result.outcome,
    error: result.error ? { code: result.error.code, message: result.error.message } : null,
    // La correspondance référence client -> deck_id est ce que le client doit
    // retenir d'une création appliquée (ou rejouée).
    refs: bindsDeckRef
      ? [{ ref: result.client_ref as string, id: result.resource!.deck_id as number }]
      : [],
  };
}

/** Texte lisible d'un corps d'erreur FastAPI (422 standard ou `{"detail": "…"}`). */
export function describeErrorBody(body: unknown): string {
  if (body && typeof body === "object" && "detail" in body) {
    const detail = (body as { detail: unknown }).detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail)) {
      return detail
        .map((item) => {
          if (item && typeof item === "object" && "msg" in item) {
            const { loc, msg } = item as { loc?: unknown[]; msg: string };
            return loc?.length ? `${loc.join(".")} : ${msg}` : msg;
          }
          return String(item);
        })
        .join(" ; ");
    }
  }
  return "";
}

/** `Retry-After` en secondes entières (la seule forme que le contrat promet), en millisecondes. */
export function parseRetryAfter(value: string | null): number | undefined {
  if (value === null || !/^\d+$/.test(value.trim())) return undefined;
  return Number(value.trim()) * 1000;
}

/**
 * Transport de la file VtES : `POST /sync` par le client typé généré.
 *
 * Ne lève jamais : réseau coupé, 503 transitoire (écriture concurrente,
 * `Retry-After` respecté), autre 5xx, 4xx inattendu deviennent `unavailable` (le moteur réessaiera, rien n'est perdu) ;
 * 422 devient `invalid` (le moteur isole l'opération fautive) ; 200 devient
 * `ok`. Le contrat garantit qu'un lot rend toujours 200, refus compris.
 */
export function createVtesSyncTransport(client: ApiClient): SyncTransport<VtesOperation> {
  return {
    async send(operations, signal): Promise<TransportResult> {
      try {
        const { data, error, response } = await client.POST("/sync", {
          body: { operations },
          signal,
        });
        if (data) return { status: "ok", verdicts: data.results.map(toVerdict) };
        if (response.status === 422) {
          return {
            status: "invalid",
            message: describeErrorBody(error) || "Lot refusé (422).",
          };
        }
        const retryAfterMs = parseRetryAfter(response.headers.get("Retry-After"));
        return {
          status: "unavailable",
          httpStatus: response.status,
          message: describeErrorBody(error) || response.statusText || "Réponse inattendue du serveur.",
          ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
        };
      } catch (error) {
        return {
          status: "unavailable",
          message: error instanceof Error ? error.message : "Réseau indisponible.",
        };
      }
    },
  };
}
