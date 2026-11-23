import { useEffect, useState } from "react";
import type { components } from "../../api-client/schema.d.ts";
import { useApiClient } from "../../app/apiClientContext";
import type { ApiClient } from "../../offline/vtes";
import { attempt, failureOf, type ApiOutcome } from "../auth/accountApi";
import { retryAfterSeconds } from "../share/usePublicDecklist";

/**
 * Accès réseau du compte-rendu (lot Compte-rendu, P7, P8, P9) : lien, réglage
 * des versions antérieures et lecture publique, en ligne seulement, hors miroir
 * et hors file. Couper une version, régler les notes sur les adversaires et
 * supprimer le compte-rendu passent par la file (`tournament.update`).
 */

export type TournamentReportRead = components["schemas"]["TournamentReportRead"];
export type MyTournamentReport = components["schemas"]["MyTournamentReportRead"];
export type PublicTournamentReport = components["schemas"]["PublicTournamentReportRead"];

const path = (tournamentId: number) => ({ params: { path: { tournament_id: tournamentId } } });

/** `POST /tournois/{id}/compte-rendu/lien` : tire le jeton, ou rend le lien existant. */
export function shareReport(client: ApiClient, tournamentId: number): Promise<ApiOutcome<TournamentReportRead>> {
  return attempt(async () => {
    const { data, error, response } = await client.POST(
      "/tournois/{tournament_id}/compte-rendu/lien",
      path(tournamentId),
    );
    return data ? { kind: "ok", value: data } : failureOf(response, error);
  });
}

/** `DELETE /tournois/{id}/compte-rendu/lien` : purge le lien, seul moyen de le révoquer. */
export function revokeReportLink(client: ApiClient, tournamentId: number): Promise<ApiOutcome<TournamentReportRead>> {
  return attempt(async () => {
    const { data, error, response } = await client.DELETE(
      "/tournois/{tournament_id}/compte-rendu/lien",
      path(tournamentId),
    );
    return data ? { kind: "ok", value: data } : failureOf(response, error);
  });
}

/** `PATCH /tournois/{id}/compte-rendu` : versions antérieures visibles par le lien (P9). */
export function updateReportSettings(
  client: ApiClient,
  tournamentId: number,
  showPreviousVersions: boolean,
): Promise<ApiOutcome<TournamentReportRead>> {
  return attempt(async () => {
    const { data, error, response } = await client.PATCH("/tournois/{tournament_id}/compte-rendu", {
      ...path(tournamentId),
      body: { show_previous_versions: showPreviousVersions },
    });
    return data ? { kind: "ok", value: data } : failureOf(response, error);
  });
}

/** `GET /moi/comptes-rendus` : les comptes-rendus du compte (écran Compte). */
export function listMyReports(client: ApiClient): Promise<ApiOutcome<MyTournamentReport[]>> {
  return attempt(async () => {
    const { data, error, response } = await client.GET("/moi/comptes-rendus");
    return data ? { kind: "ok", value: data } : failureOf(response, error);
  });
}

/** Adresse publique d'un compte-rendu : le jeton vit dans le hash, jamais de `?v=` (P9). */
export function reportLink(token: string, origin: string = window.location.origin): string {
  return `${origin}/#/compte-rendu/${token}`;
}

// --------------------------------------------------------------------------
// Lecture publique
// --------------------------------------------------------------------------

export type PublicReportState =
  | { kind: "loading" }
  | { kind: "ready"; report: PublicTournamentReport }
  | { kind: "not-found" }
  | { kind: "offline" }
  | { kind: "rate-limited"; retryAfter: number | null }
  | { kind: "error" };

function publicFailure(response: Response): PublicReportState {
  if (response.status === 404) return { kind: "not-found" };
  if (response.status === 429) return { kind: "rate-limited", retryAfter: retryAfterSeconds(response) };
  return { kind: "error" };
}

/**
 * `GET /comptes-rendus/{token}` (la dernière version) ou
 * `…/versions/{number}`, **sans cookie**. Le numéro choisi n'entre jamais dans
 * l'adresse (P9) : il vit dans l'état de la page.
 */
export function usePublicReport(token: string, number: number | null): PublicReportState {
  const client = useApiClient();
  const wanted = `${token}/${number ?? "latest"}`;
  const [result, setResult] = useState<{ wanted: string; state: PublicReportState } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const settle = (state: PublicReportState) => {
      if (!cancelled) setResult({ wanted, state });
    };
    const request =
      number === null
        ? client.GET("/comptes-rendus/{token}", { params: { path: { token } }, credentials: "omit" })
        : client.GET("/comptes-rendus/{token}/versions/{number}", {
            params: { path: { token, number } },
            credentials: "omit",
          });
    request
      .then((answer) => settle(answer.data ? { kind: "ready", report: answer.data } : publicFailure(answer.response)))
      .catch(() => settle({ kind: "offline" }));
    return () => {
      cancelled = true;
    };
  }, [client, token, number, wanted]);

  return result && result.wanted === wanted ? result.state : { kind: "loading" };
}
