import createClient from "openapi-fetch";
import type { paths } from "../../../../src/api-client/schema.d.ts";

/**
 * Petit serveur factice pour les quatre routes d'authentification (Lot 6),
 * sans dépendre du `fakeServer`/`fakeRouter` de `tests/unit/offline/` (propre
 * à `POST /sync`) : les formulaires de connexion/inscription n'y passent
 * jamais (§ « D — écrans » : routes nécessairement en ligne, hors file).
 */
export interface AuthFakeUser {
  id: number;
  email: string;
  username: string;
  password: string;
  role: "user" | "admin";
}

export interface AuthFakeServer {
  client: ReturnType<typeof createClient<paths>>;
  users: AuthFakeUser[];
  requests: Array<{ method: string; path: string }>;
}

let nextId = 1;

export function createAuthFakeServer(seed: AuthFakeUser[] = []): AuthFakeServer {
  const server: AuthFakeServer = { users: [...seed], requests: [], client: null as unknown as AuthFakeServer["client"] };

  server.client = createClient<paths>({
    baseUrl: "http://auth.test",
    fetch: async (request: Request) => {
      const url = new URL(request.url);
      server.requests.push({ method: request.method, path: url.pathname });
      const json = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
      const body = request.method === "POST" && request.headers.get("content-type")?.includes("json")
        ? await request.clone().json().catch(() => ({}))
        : {};

      if (url.pathname === "/inscription") {
        const { email, username, password } = body as { email?: string; username?: string; password?: string };
        if (password && password.length < 12) {
          return json(
            { detail: [{ loc: ["body", "password"], msg: "trop court", type: "value_error" }] },
            422,
          );
        }
        if (server.users.some((user) => user.email === email)) {
          return json({ detail: "Cette adresse est déjà utilisée." }, 409);
        }
        if (server.users.some((user) => user.username === username)) {
          return json({ detail: "Ce nom est déjà pris." }, 409);
        }
        const user: AuthFakeUser = {
          id: nextId++,
          email: email ?? "",
          username: username ?? "",
          password: password ?? "",
          role: "user",
        };
        server.users.push(user);
        return json(userRead(user), 201);
      }

      if (url.pathname === "/connexion") {
        const { email, password } = body as { email?: string; password?: string };
        const user = server.users.find((candidate) => candidate.email === email);
        if (!user || user.password !== password) {
          return json({ detail: "Identifiants invalides." }, 401);
        }
        return json(userRead(user), 200);
      }

      if (url.pathname === "/deconnexion") {
        return new Response(null, { status: 204 });
      }

      if (url.pathname === "/moi") {
        return json({ detail: "Authentification requise." }, 401);
      }

      return json({ detail: `route non prévue : ${url.pathname}` }, 404);
    },
  });

  return server;
}

function userRead(user: AuthFakeUser) {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    role: user.role,
    created_at: "2026-10-01T00:00:00.000Z",
  };
}
