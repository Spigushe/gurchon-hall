import { act, cleanup, render, waitForElementToBeRemoved } from "@testing-library/react";
import createClient from "openapi-fetch";
import { afterEach } from "vitest";
import type { paths } from "../../../src/api-client/schema.d.ts";
import App from "../../../src/App";
import { ApiClientContext } from "../../../src/app/apiClientContext";
import { VtesOfflineProvider } from "../../../src/offline/vtes/VtesOfflineProvider";
import { createVtesOffline, type VtesOfflineRuntime } from "../../../src/offline/vtes/runtime";
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
      const vdb = /^\/vdb\/decks\/([^/]+)$/.exec(url.pathname);
      if (vdb) return vdbResponse(ui.vdbDecks.get(decodeURIComponent(vdb[1])));
      const card = /^\/cartes\/(\d+)$/.exec(url.pathname);
      if (card && ui.cards.has(Number(card[1]))) return json(ui.cards.get(Number(card[1])));
      return json({ detail: `route non prévue : ${url.pathname}` }, 404);
    },
  });
  return ui;
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
