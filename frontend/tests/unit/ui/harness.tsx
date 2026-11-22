import { act, cleanup, render, waitForElementToBeRemoved } from "@testing-library/react";
import createClient from "openapi-fetch";
import { afterEach } from "vitest";
import type { paths } from "../../../src/api-client/schema.d.ts";
import App from "../../../src/App";
import { ApiClientContext } from "../../../src/app/apiClientContext";
import { VtesOfflineProvider } from "../../../src/offline/vtes/VtesOfflineProvider";
import { createVtesOffline, type VtesOfflineRuntime } from "../../../src/offline/vtes/runtime";
import { saveLocalAccount } from "../../../src/offline/vtes/account";
import { refreshCardSets, refreshCatalog } from "../../../src/offline/vtes/refresh";
import { createFakeServer, type FakeServer } from "../offline/fakeServer";
import { freshDbName, manualTimers } from "../offline/helpers";

/**
 * Banc d'essai de l'interface : la vraie couche offline (Dexie sur
 * fake-indexeddb, file, moteur de rejeu) branchée sur le serveur factice de la
 * couche offline. Rien n'est simulé côté UI : on saisit dans les formulaires et
 * on lit ce que la file et le serveur ont reçu.
 */

export function setNavigatorOnLine(value: boolean) {
  Object.defineProperty(window.navigator, "onLine", { configurable: true, value });
}

/** Passe hors ligne ou en ligne comme le navigateur : propriété puis événement. */
export function setOnline(value: boolean) {
  setNavigatorOnLine(value);
  window.dispatchEvent(new Event(value ? "online" : "offline"));
}

/**
 * Laisse React poser ses effets passifs en attente. `findBy*` rend la main dès que
 * le DOM a changé, parfois avant que les effets du même rendu aient tourné : un
 * raccourci clavier lit alors ses liaisons du rendu précédent (`useKeyboardShortcuts`
 * les met à jour dans un effet). À appeler entre l'attente d'un écran et la frappe.
 */
export const flushEffects = () => act(async () => {});

export interface UiServer {
  /** Réponses pour les lectures sans miroir local (légalité, produits). */
  legality: { status: number; body: unknown };
  /**
   * Légalité d'une version à une date (Lot 8, B3), par « deckId/numéro » ; une
   * version absente répond 404. La date reçue se lit dans `requests[].search`.
   */
  versionLegality: Map<string, unknown>;
  bundles: unknown[];
  /** Fiches servies par `GET /cartes/{id}` (lot Chercher, D3 : lecture à la demande). */
  cards: Map<number, unknown>;
  /**
   * Decks servis par `GET /vdb/decks/{id}` (Lot 9, D2), par identifiant : un
   * corps (200), ou une réponse d'erreur. Un identifiant absent rend 404.
   */
  vdbDecks: Map<string, unknown | { status: number; body: unknown; retryAfter?: string }>;
  /**
   * Listes partagées servies par `GET /listes/{token}` (Lot 13, D5), par jeton : un
   * corps (200), une réponse d'erreur ou `"network"`. Un jeton absent rend 404.
   */
  lists: Map<string, unknown | { status: number; body: unknown; retryAfter?: string }>;
  /**
   * Routes du compte (Lot 12, D1) : sessions servies par `GET /moi/sessions`
   * (fermées par les deux `DELETE`), réponse forcée d'une route (`failures`,
   * par « MÉTHODE chemin »), corps de l'export et version de `/health`.
   */
  account: {
    sessions: Array<{ id: number; current: boolean } & Record<string, unknown>>;
    failures: Map<string, { status: number; body: unknown; retryAfter?: string } | "network">;
    exportBody: unknown;
    exportFileName: string;
    serverVersion: string;
    passwordBodies: unknown[];
  };
  /**
   * Liens de partage (Lot 13, D2) : `GET/POST /decks/{id}/partages`, `GET` et
   * `DELETE /moi/partages`, sur cet état. `bodies` garde les corps des créations ;
   * `failures` (par « MÉTHODE chemin ») force une réponse.
   */
  shares: {
    list: Array<{ id: number; kind: string; deck: { id: number; deleted_at: string | null } } & Record<string, unknown>>;
    bodies: unknown[];
    failures: Map<string, { status: number; body: unknown } | "network">;
    nextId: number;
  };
  requests: Array<{ method: string; path: string; search: string }>;
  client: ReturnType<typeof createClient<paths>>;
}

function createUiServer(): UiServer {
  const ui: UiServer = {
    legality: { status: 200, body: null },
    versionLegality: new Map(),
    bundles: [],
    cards: new Map(),
    vdbDecks: new Map(),
    lists: new Map(),
    account: {
      sessions: [],
      failures: new Map(),
      exportBody: { format_version: 1 },
      exportFileName: "gurchon-hall-alice-2026-11-19.json",
      serverVersion: "9.9.9",
      passwordBodies: [],
    },
    shares: { list: [], bodies: [], failures: new Map(), nextId: 100 },
    requests: [],
    client: null as unknown as UiServer["client"],
  };
  ui.client = createClient<paths>({
    baseUrl: "http://ui.test",
    fetch: async (request: Request) => {
      const url = new URL(request.url);
      ui.requests.push({ method: request.method, path: url.pathname, search: url.search });
      const json = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
      if (/^\/decks\/\d+\/legalite$/.test(url.pathname)) {
        if (ui.legality.status === 0) throw new TypeError("Failed to fetch");
        return json(ui.legality.body, ui.legality.status);
      }
      const version = /^\/decks\/(\d+)\/versions\/(\d+)\/legalite$/.exec(url.pathname);
      if (version) {
        const body = ui.versionLegality.get(`${version[1]}/${version[2]}`);
        return body === undefined ? json({ detail: "Version introuvable." }, 404) : json(body);
      }
      if (url.pathname === "/bundles") return json(ui.bundles);
      if (url.pathname === "/moi/partages" || /^\/decks\/\d+\/partages$/.test(url.pathname)) {
        return sharesResponse(ui, request, url);
      }
      if (url.pathname === "/health" || url.pathname.startsWith("/moi")) return accountResponse(ui, request, url);
      const vdb = /^\/vdb\/decks\/([^/]+)$/.exec(url.pathname);
      if (vdb) return vdbResponse(ui.vdbDecks.get(decodeURIComponent(vdb[1])));
      const list = /^\/listes\/([^/]+)$/.exec(url.pathname);
      if (list) return vdbResponse(ui.lists.get(decodeURIComponent(list[1])));
      const card = /^\/cartes\/(\d+)$/.exec(url.pathname);
      if (card && ui.cards.has(Number(card[1]))) return json(ui.cards.get(Number(card[1])));
      return json({ detail: `route non prévue : ${url.pathname}` }, 404);
    },
  });
  return ui;
}

/** Routes du compte (Lot 12) et `/health`, sur l'état de `ui.account`. */
async function accountResponse(ui: UiServer, request: Request, url: URL): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
  const key = `${request.method} ${url.pathname}`;
  const failure = ui.account.failures.get(key);
  if (failure === "network") throw new TypeError("Failed to fetch");
  if (failure) {
    if (failure.retryAfter) headers["Retry-After"] = failure.retryAfter;
    return json(failure.body, failure.status);
  }
  if (key === "GET /health") return json({ status: "ok", version: ui.account.serverVersion });
  if (key === "GET /moi/sessions") return json(ui.account.sessions);
  if (key === "DELETE /moi/sessions") {
    ui.account.sessions = ui.account.sessions.filter((session) => session.current);
    return new Response(null, { status: 204 });
  }
  const one = /^\/moi\/sessions\/(\d+)$/.exec(url.pathname);
  if (one && request.method === "DELETE") {
    const id = Number(one[1]);
    if (!ui.account.sessions.some((session) => session.id === id && !session.current)) {
      return json({ detail: `Session ${id} introuvable.` }, 404);
    }
    ui.account.sessions = ui.account.sessions.filter((session) => session.id !== id);
    return new Response(null, { status: 204 });
  }
  if (key === "POST /moi/mot-de-passe") {
    ui.account.passwordBodies.push(await request.json());
    return new Response(null, { status: 204 });
  }
  if (key === "GET /moi/export") {
    return new Response(JSON.stringify(ui.account.exportBody), {
      status: 200,
      headers: { ...headers, "Content-Disposition": `attachment; filename="${ui.account.exportFileName}"` },
    });
  }
  return json({ detail: `route non prévue : ${url.pathname}` }, 404);
}

/** Liens de partage (Lot 13, D2), sur l'état de `ui.shares`. */
async function sharesResponse(ui: UiServer, request: Request, url: URL): Promise<Response> {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const key = `${request.method} ${url.pathname}`;
  const failure = ui.shares.failures.get(key);
  if (failure === "network") throw new TypeError("Failed to fetch");
  if (failure) return json(failure.body, failure.status);
  const perDeck = /^\/decks\/(\d+)\/partages$/.exec(url.pathname);
  if (perDeck) {
    const deckId = Number(perDeck[1]);
    if (request.method === "GET") return json(ui.shares.list.filter((share) => share.deck.id === deckId));
    const body = (await request.json()) as { kind: string; show_notes?: boolean; deck_version_number?: number | null };
    ui.shares.bodies.push(body);
    const share = {
      id: ui.shares.nextId++,
      token: `tok${ui.shares.nextId}xyz`.slice(0, 8),
      kind: body.kind,
      show_notes: body.show_notes ?? false,
      created_at: "2026-11-20T10:00:00Z",
      frozen_name: body.kind === "frozen" ? "Banu Princes" : null,
      deck_version_number: body.deck_version_number ?? null,
      deck: { id: deckId, name: "Banu Princes", discriminator: "0001", archived_at: null, deleted_at: null },
    };
    ui.shares.list.unshift(share);
    return json(share, 201);
  }
  if (request.method === "GET") return json(ui.shares.list);
  const scope = url.searchParams.get("scope");
  const ids = url.searchParams.getAll("share_id").map(Number);
  const before = ui.shares.list.length;
  if (scope === "selected") {
    const unknown = ids.find((id) => !ui.shares.list.some((share) => share.id === id));
    if (unknown !== undefined) return json({ detail: `Lien ${unknown} introuvable.` }, 404);
    ui.shares.list = ui.shares.list.filter((share) => !ids.includes(share.id));
  } else if (scope === "deleted_decks") {
    ui.shares.list = ui.shares.list.filter((share) => share.deck.deleted_at === null);
  } else {
    ui.shares.list = [];
  }
  return json({ revoked: before - ui.shares.list.length });
}

/** Réponse simulée de la lecture d'un deck VDB par le serveur. */
function vdbResponse(entry: unknown): Response {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (entry === undefined) return new Response(JSON.stringify({ detail: "Deck VDB introuvable." }), { status: 404, headers });
  if (entry === "network") throw new TypeError("Failed to fetch");
  if (entry && typeof entry === "object" && "status" in entry) {
    const failure = entry as { status: number; body: unknown; retryAfter?: string };
    if (failure.retryAfter) headers["Retry-After"] = failure.retryAfter;
    return new Response(JSON.stringify(failure.body), { status: failure.status, headers });
  }
  return new Response(JSON.stringify(entry), { status: 200, headers });
}

const runtimes: VtesOfflineRuntime[] = [];

afterEach(async () => {
  cleanup();
  for (const runtime of runtimes.splice(0)) {
    runtime.stop();
    await runtime.engine.whenIdle();
    runtime.dispose();
  }
  setNavigatorOnLine(true);
  window.location.hash = "";
});

export interface AppOptions {
  online?: boolean;
  hash?: string;
  /** Rafraîchissement automatique des miroirs (démarrage, retour du réseau, après rejeu). */
  autoRefresh?: boolean;
  /** Catalogue déjà téléchargé (miroir local rempli avant le premier rendu). */
  catalog?: boolean;
  server?: FakeServer;
  /** Compte connu localement (copie du dernier `GET /moi`), écrit avant le premier rendu (Lot 12). */
  account?: { id: number; email: string; username: string; role: "user" | "admin" };
  /** Réglage du serveur simulé des lectures en ligne avant le premier rendu (sessions du compte…). */
  configure?: (ui: UiServer) => void;
}

export async function renderApp(options: AppOptions = {}) {
  const server = options.server ?? createFakeServer();
  const ui = createUiServer();
  setNavigatorOnLine(options.online ?? true);
  window.location.hash = options.hash ?? "";

  const runtime = createVtesOffline({
    client: server.client,
    dbName: freshDbName("ui"),
    autoRefresh: options.autoRefresh ?? false,
    engine: { lockName: null, timers: manualTimers().timers, backoff: { jitter: 0 } },
  });
  runtimes.push(runtime);
  // Les extensions accompagnent toujours le catalogue (Lot 4) : une carte sans son
  // miroir d'extensions ne pourrait pas libeller son impression dans l'UI.
  if (options.catalog) {
    await refreshCatalog(server.client, runtime.db);
    await refreshCardSets(server.client, runtime.db);
  }
  server.state.requests.length = 0;
  if (options.account) await saveLocalAccount(runtime.db, options.account);
  options.configure?.(ui);

  const view = render(
    <VtesOfflineProvider runtime={runtime}>
      <ApiClientContext.Provider value={ui.client}>
        <App />
      </ApiClientContext.Provider>
    </VtesOfflineProvider>,
  );

  // Les pages sont chargées à la demande (`React.lazy`, `App.tsx`) : le tout
  // premier rendu affiche systématiquement le fallback `<Suspense>` le temps
  // que le chunk de la route courante se résolve, même quand le module est
  // déjà en cache (mécanique de `React.lazy`, pas de latence réseau en test).
  // Sans cette attente, les appels synchrones `screen.getByTestId("home-page")`
  // etc. juste après `renderApp` verraient le squelette `route-loading` au
  // lieu du contenu de la page. On attend donc ici, une fois pour tous les
  // tests, plutôt que d'ajouter `findBy*`/`waitFor` dans chacun.
  const initialLoading = view.queryByTestId("route-loading");
  if (initialLoading) {
    await waitForElementToBeRemoved(initialLoading);
  }

  /** Laisse le rejeu et le rafraîchissement en cours se terminer. */
  const settle = async () => {
    await act(async () => {
      await runtime.engine.whenIdle();
    });
  };

  return { ...view, runtime, server, ui, settle };
}
