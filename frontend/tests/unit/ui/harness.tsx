import { act, cleanup, render } from "@testing-library/react";
import createClient from "openapi-fetch";
import { afterEach } from "vitest";
import type { paths } from "../../../src/api-client/schema.d.ts";
import App from "../../../src/App";
import { ApiClientContext } from "../../../src/app/apiClientContext";
import { VtesOfflineProvider } from "../../../src/offline/vtes/VtesOfflineProvider";
import { createVtesOffline, type VtesOfflineRuntime } from "../../../src/offline/vtes/runtime";
import { refreshCatalog } from "../../../src/offline/vtes/refresh";
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

export interface UiServer {
  /** Réponses pour les lectures sans miroir local (légalité, produits). */
  legality: { status: number; body: unknown };
  bundles: unknown[];
  requests: Array<{ method: string; path: string }>;
  client: ReturnType<typeof createClient<paths>>;
}

function createUiServer(): UiServer {
  const ui: UiServer = {
    legality: { status: 200, body: null },
    bundles: [],
    requests: [],
    client: null as unknown as UiServer["client"],
  };
  ui.client = createClient<paths>({
    baseUrl: "http://ui.test",
    fetch: async (request: Request) => {
      const url = new URL(request.url);
      ui.requests.push({ method: request.method, path: url.pathname });
      const json = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
      if (/^\/decks\/\d+\/legalite$/.test(url.pathname)) {
        if (ui.legality.status === 0) throw new TypeError("Failed to fetch");
        return json(ui.legality.body, ui.legality.status);
      }
      if (url.pathname === "/bundles") return json(ui.bundles);
      return json({ detail: `route non prévue : ${url.pathname}` }, 404);
    },
  });
  return ui;
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
  if (options.catalog) await refreshCatalog(server.client, runtime.db);
  server.state.requests.length = 0;

  const view = render(
    <VtesOfflineProvider runtime={runtime}>
      <ApiClientContext.Provider value={ui.client}>
        <App />
      </ApiClientContext.Provider>
    </VtesOfflineProvider>,
  );

  /** Laisse le rejeu et le rafraîchissement en cours se terminer. */
  const settle = async () => {
    await act(async () => {
      await runtime.engine.whenIdle();
    });
  };

  return { ...view, runtime, server, ui, settle };
}
