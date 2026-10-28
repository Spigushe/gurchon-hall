import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AccountMenu } from "../../../../src/features/auth/AccountMenu";
import { AuthActionsContext, type AuthActions } from "../../../../src/features/auth/context";
import { OfflineProvider } from "../../../../src/offline/react";
import type { SyncStatus } from "../../../../src/offline/core/syncEngine";
import { VtesOfflineProvider } from "../../../../src/offline/vtes/VtesOfflineProvider";
import { createVtesOffline, type VtesOfflineRuntime } from "../../../../src/offline/vtes/runtime";
import { saveLocalAccount } from "../../../../src/offline/vtes/account";
import { createFakeServer } from "../../offline/fakeServer";
import { freshDbName, setNavigatorOnLine, restoreNavigatorOnLine } from "../../offline/helpers";

const runtimes: VtesOfflineRuntime[] = [];

afterEach(async () => {
  cleanup();
  for (const runtime of runtimes.splice(0)) {
    runtime.stop();
    await runtime.engine.whenIdle();
    runtime.dispose();
  }
  restoreNavigatorOnLine();
});

function makeRuntime() {
  const server = createFakeServer();
  const runtime = createVtesOffline({
    client: server.client,
    dbName: freshDbName("account-menu"),
    autoRefresh: false,
  });
  runtimes.push(runtime);
  return runtime;
}

function renderMenu(runtime: VtesOfflineRuntime, actions?: Partial<AuthActions>) {
  const value: AuthActions = { logout: async () => {}, reconnect: async () => {}, ...actions };
  return render(
    <VtesOfflineProvider runtime={runtime}>
      <AuthActionsContext.Provider value={value}>
        <AccountMenu />
      </AuthActionsContext.Provider>
    </VtesOfflineProvider>,
  );
}

describe("<AccountMenu />", () => {
  it("ne rend rien tant qu'aucun compte n'est connu localement (bancs d'essai sans AuthGate)", () => {
    const runtime = makeRuntime();
    const { container } = renderMenu(runtime);
    expect(container).toBeEmptyDOMElement();
  });

  it("affiche le nom d'utilisateur une fois le compte enregistré", async () => {
    const runtime = makeRuntime();
    await saveLocalAccount(runtime.db, {
      id: 1,
      email: "a@x.fr",
      username: "alice",
      role: "user",
    });
    renderMenu(runtime);
    expect(await screen.findByTestId("account-menu-username")).toHaveTextContent("alice");
  });

  it("déconnexion directe quand la file est vide", async () => {
    const runtime = makeRuntime();
    await saveLocalAccount(runtime.db, { id: 1, email: "a@x.fr", username: "alice", role: "user" });
    let logoutCalls = 0;
    renderMenu(runtime, { logout: async () => void logoutCalls++ });

    fireEvent.click(await screen.findByTestId("account-menu-logout"));
    await waitFor(() => expect(logoutCalls).toBe(1));
    expect(screen.queryByTestId("account-menu-logout-confirm")).not.toBeInTheDocument();
  });

  it("demande confirmation quand la file contient des opérations, et n'agit qu'après confirmation (D3)", async () => {
    const runtime = makeRuntime();
    await saveLocalAccount(runtime.db, { id: 1, email: "a@x.fr", username: "alice", role: "user" });
    await act(async () => {
      await runtime.actions.saveStock({ cardId: 1, languageCode: "FR", cardSetId: 1, quantityOwned: 1 });
    });
    let logoutCalls = 0;
    renderMenu(runtime, { logout: async () => void logoutCalls++ });

    fireEvent.click(await screen.findByTestId("account-menu-logout"));
    expect(await screen.findByTestId("account-menu-warning")).toHaveTextContent("1 opération");
    expect(logoutCalls).toBe(0);

    fireEvent.click(screen.getByTestId("account-menu-logout-cancel"));
    expect(screen.queryByTestId("account-menu-warning")).not.toBeInTheDocument();
    expect(logoutCalls).toBe(0);

    fireEvent.click(screen.getByTestId("account-menu-logout"));
    fireEvent.click(await screen.findByTestId("account-menu-logout-confirm"));
    await waitFor(() => expect(logoutCalls).toBe(1));
  });

  it("désactive la déconnexion hors ligne, avec une explication", async () => {
    setNavigatorOnLine(false);
    const runtime = makeRuntime();
    await saveLocalAccount(runtime.db, { id: 1, email: "a@x.fr", username: "alice", role: "user" });
    renderMenu(runtime);

    expect(await screen.findByTestId("account-menu-offline-hint")).toBeInTheDocument();
    expect(screen.queryByTestId("account-menu-logout")).not.toBeInTheDocument();
  });
});

function makeSyncStatus(overrides: Partial<SyncStatus> = {}): SyncStatus {
  return {
    online: true,
    running: false,
    pending: 0,
    sending: 0,
    rejected: 0,
    lastError: null,
    lastSuccessAt: null,
    nextRetryAt: null,
    failures: 0,
    authRequired: false,
    ...overrides,
  };
}

describe("<ReconnectBanner />", () => {
  it("ne s'affiche pas tant que le moteur n'est pas en pause d'authentification", async () => {
    const { ReconnectBanner } = await import("../../../../src/features/auth/ReconnectBanner");
    const status = makeSyncStatus({ authRequired: false });
    render(
      <OfflineProvider
        runtime={{
          db: {} as never,
          outbox: {} as never,
          engine: { subscribe: () => () => {}, getStatus: () => status } as never,
          start() {},
          stop() {},
        }}
      >
        <ReconnectBanner />
      </OfflineProvider>,
    );
    expect(screen.queryByTestId("reconnect-banner")).not.toBeInTheDocument();
  });

  it("s'affiche et ouvre un panneau de reconnexion quand le moteur est en pause", async () => {
    const { ReconnectBanner } = await import("../../../../src/features/auth/ReconnectBanner");
    const status = makeSyncStatus({ authRequired: true, pending: 2 });
    render(
      <OfflineProvider
        runtime={{
          db: {} as never,
          outbox: {} as never,
          engine: { subscribe: () => () => {}, getStatus: () => status } as never,
          start() {},
          stop() {},
        }}
      >
        <ReconnectBanner />
      </OfflineProvider>,
    );
    expect(screen.getByTestId("reconnect-banner")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("reconnect-banner-link"));
    expect(await screen.findByTestId("reconnect-sheet")).toBeInTheDocument();
    expect(screen.getByTestId("login-form")).toBeInTheDocument();
  });
});
