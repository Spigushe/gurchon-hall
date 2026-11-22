import type { components } from "../../api-client/schema.d.ts";
import type { ApiClient } from "../../offline/vtes";
import { describeErrorBody, parseRetryAfter } from "../../offline/vtes/transport";

/**
 * Routes du compte sous `/moi` (Lot 12, A1) et version du serveur (`/health`).
 *
 * Toutes en ligne seulement, aucune par `/sync` : on ne vérifie pas un mot de
 * passe hors ligne, et la liste des sessions vit sur le serveur. Chaque
 * fonction rend un résultat, jamais une exception : `network` quand la requête
 * n'a pas abouti, `unauthenticated` pour un 401 (session expirée ou fermée
 * depuis un autre appareil), `error` pour tout autre refus.
 */

export type SessionRead = components["schemas"]["SessionRead"];

export interface Failure {
  kind: "error";
  status: number;
  message: string;
  /** Champ visé par un 422, en dernier élément de `loc` (« current_password »). */
  field?: string;
  /** 429 seulement. */
  retryAfterMs?: number;
}

export type ApiOutcome<T> =
  | { kind: "ok"; value: T }
  | Failure
  | { kind: "unauthenticated" }
  | { kind: "network" };

/** Champ du premier détail d'un 422 FastAPI (`loc: ["body", "current_password"]`). */
function fieldOf(body: unknown): string | undefined {
  if (!body || typeof body !== "object" || !("detail" in body)) return undefined;
  const detail = (body as { detail: unknown }).detail;
  if (!Array.isArray(detail) || detail.length === 0) return undefined;
  const loc = (detail[0] as { loc?: unknown }).loc;
  return Array.isArray(loc) && loc.length > 0 ? String(loc[loc.length - 1]) : undefined;
}

/** Message seul, sans le chemin du champ que `describeErrorBody` préfixe pour un 422. */
function messageOf(body: unknown, status: number): string {
  if (body && typeof body === "object" && "detail" in body) {
    const detail = (body as { detail: unknown }).detail;
    if (Array.isArray(detail) && detail.length > 0) {
      const msg = (detail[0] as { msg?: unknown }).msg;
      if (typeof msg === "string") return msg;
    }
  }
  return describeErrorBody(body) || `Erreur inattendue (${status}).`;
}

export function failureOf(response: Response, body: unknown): ApiOutcome<never> {
  if (response.status === 401) return { kind: "unauthenticated" };
  const retryAfterMs = response.status === 429 ? parseRetryAfter(response.headers.get("Retry-After")) : undefined;
  const field = response.status === 422 ? fieldOf(body) : undefined;
  return {
    kind: "error",
    status: response.status,
    message: messageOf(body, response.status),
    ...(field !== undefined ? { field } : {}),
    ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
  };
}

export async function attempt<T>(request: () => Promise<ApiOutcome<T>>): Promise<ApiOutcome<T>> {
  try {
    return await request();
  } catch {
    return { kind: "network" };
  }
}

/** `POST /moi/mot-de-passe` : 204, les autres sessions fermées, celle-ci gardée (P2). */
export function changePassword(
  client: ApiClient,
  currentPassword: string,
  newPassword: string,
): Promise<ApiOutcome<null>> {
  return attempt(async () => {
    const { error, response } = await client.POST("/moi/mot-de-passe", {
      body: { current_password: currentPassword, new_password: newPassword },
    });
    return response.ok ? { kind: "ok", value: null } : failureOf(response, error);
  });
}

/** `GET /moi/sessions` : la courante en tête, puis par dernière utilisation. */
export function listSessions(client: ApiClient): Promise<ApiOutcome<SessionRead[]>> {
  return attempt(async () => {
    const { data, error, response } = await client.GET("/moi/sessions");
    return data ? { kind: "ok", value: data } : failureOf(response, error);
  });
}

/** `DELETE /moi/sessions/{id}` : une autre session (409 pour la courante, qui passe par la déconnexion). */
export function revokeSession(client: ApiClient, sessionId: number): Promise<ApiOutcome<null>> {
  return attempt(async () => {
    const { error, response } = await client.DELETE("/moi/sessions/{session_id}", {
      params: { path: { session_id: sessionId } },
    });
    return response.ok ? { kind: "ok", value: null } : failureOf(response, error);
  });
}

/** `DELETE /moi/sessions` : toutes sauf la courante. */
export function revokeOtherSessions(client: ApiClient): Promise<ApiOutcome<null>> {
  return attempt(async () => {
    const { error, response } = await client.DELETE("/moi/sessions");
    return response.ok ? { kind: "ok", value: null } : failureOf(response, error);
  });
}

export interface ExportFile {
  fileName: string;
  blob: Blob;
}

const FILE_NAME = /filename="([^"]+)"/;

/**
 * Nom du fichier : celui du serveur (`Content-Disposition`, exposé en CORS),
 * sinon le même gabarit refait ici, jour UTC compris, si l'en-tête manque.
 */
export function exportFileName(header: string | null, username: string, now: Date): string {
  const match = header ? FILE_NAME.exec(header) : null;
  return match ? match[1] : `gurchon-hall-${username}-${now.toISOString().slice(0, 10)}.json`;
}

/** `GET /moi/export` : le fichier JSON, lu en entier avant d'être proposé au téléchargement. */
export function exportAccount(client: ApiClient, username: string): Promise<ApiOutcome<ExportFile>> {
  return attempt(async () => {
    const { data, error, response } = await client.GET("/moi/export", { parseAs: "blob" });
    if (!data) return failureOf(response, error);
    const fileName = exportFileName(response.headers.get("Content-Disposition"), username, new Date());
    return { kind: "ok", value: { fileName, blob: data } };
  });
}

/** Version de l'API (`GET /health`, public), ou `null` si le serveur ne répond pas. */
export async function readServerVersion(client: ApiClient): Promise<string | null> {
  try {
    const { data } = await client.GET("/health");
    return data?.version ?? null;
  } catch {
    return null;
  }
}
