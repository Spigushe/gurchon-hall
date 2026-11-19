import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { AccountMenu } from "../../../../src/features/auth/AccountMenu";
import { LogoutControl } from "../../../../src/features/auth/LogoutControl";
import { ReconnectBanner } from "../../../../src/features/auth/ReconnectBanner";
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

function makeRuntime(server = createFakeServer()) {
  const runtime = createVtesOffline({
    client: server.client,
    dbName: freshDbName("account-menu"),
    autoRefresh: false,
  });
  runtimes.push(runtime);
  return runtime;
}

function renderWithActions(runtime: VtesOfflineRuntime, node: ReactNode, actions?: Partial<AuthActions>) {
  const value: AuthActions = { logout: async () => {}, reconnect: async () => {}, ...actions };
  return render(
    <VtesOfflineProvider runtime={runtime}>
      <AuthActionsContext.Provider value={value}>{node}</AuthActionsContext.Provider>
    </VtesOfflineProvider>,
  );
}

function renderMenu(runtime: VtesOfflineRuntime, variant: "bar" | "menu" = "bar", actions?: Partial<AuthActions>) {
  return renderWithActions(runtime, <AccountMenu variant={variant} />, actions);
}

async function withAccount(runtime: VtesOfflineRuntime) {
  await saveLocalAccount(runtime.db, { id: 1, email: "a@x.fr", username: "alice", role: "user" });
}

describe("<AccountMenu />", () => {
  it("ne rend rien tant qu'aucun compte n'est connu localement (bancs d'essai sans AuthGate)", () => {
    const runtime = makeRuntime();
    const { container } = renderMenu(runtime);
    expect(container).toBeEmptyDOMElement();
  });

  it("au mobile, le nom mène à l'écran Compte et la déconnexion n'est plus dans la barre (écart 1)", async () => {
    const runtime = makeRuntime();
    await withAccount(runtime);
    renderMenu(runtime, "bar");

    expect(await screen.findByTestId("account-menu-username")).toHaveTextContent("alice");
    expect(screen.getByTestId("account-menu-link")).toHaveAttribute("href", "#/compte");
    expect(screen.queryByTestId("account-menu-logout")).not.toBeInTheDocument();
  });

  it("au bureau, le nom ouvre un menu Compte · Se déconnecter, refermé par Échap (écart 2, d36)", async () => {
    const runtime = makeRuntime();
    await withAccount(runtime);
    renderMenu(runtime, "menu");

    const toggle = await screen.findByTestId("account-menu-toggle");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("account-menu-panel")).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("account-menu-account")).toHaveAttribute("href", "#/compte");
    expect(screen.getByTestId("account-menu-logout")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("account-menu-panel")).not.toBeInTheDocument();
    expect(toggle).toHaveFocus();
  });

  it("au bureau, un clic hors du menu le referme", async () => {
    const runtime = makeRuntime();
    await withAccount(runtime);
    renderMenu(runtime, "menu");

    fireEvent.click(await screen.findByTestId("account-menu-toggle"));
    expect(screen.getByTestId("account-menu-panel")).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByTestId("account-menu-panel")).not.toBeInTheDocument();
  });

  it("déconnexion directe depuis le menu quand la file est vide", async () => {
    const runtime = makeRuntime();
    await withAccount(runtime);
    let logoutCalls = 0;
    renderMenu(runtime, "menu", { logout: async () => void logoutCalls++ });

    fireEvent.click(await screen.findByTestId("account-menu-toggle"));
    fireEvent.click(screen.getByTestId("account-menu-logout"));
    await waitFor(() => expect(logoutCalls).toBe(1));
    expect(screen.queryByTestId("account-menu-logout-confirm")).not.toBeInTheDocument();
  });

  it("au menu, « Rester connecté » renonce et referme le menu", async () => {
    const server = createFakeServer();
    server.state.refusedTypes.add("stock.upsert");
    const runtime = makeRuntime(server);
    await withAccount(runtime);
    await act(async () => {
      await runtime.actions.saveStock({ cardId: 1, languageCode: "FR", cardSetId: 1, quantityOwned: 1 });
    });
    let logoutCalls = 0;
    renderMenu(runtime, "menu", { logout: async () => void logoutCalls++ });
    await waitFor(() => {
      const status = runtime.engine.getStatus();
      expect(status.pending + status.rejected).toBe(1);
    });
    await act(async () => {});

    fireEvent.click(await screen.findByTestId("account-menu-toggle"));
    fireEvent.click(screen.getByTestId("account-menu-logout"));
    expect(await screen.findByTestId("account-menu-warning")).toHaveTextContent("1 opération");
    fireEvent.click(screen.getByTestId("account-menu-logout-cancel"));
    expect(screen.queryByTestId("account-menu-panel")).not.toBeInTheDocument();
    expect(logoutCalls).toBe(0);
  });

  it("au menu hors ligne, la déconnexion est remplacée par sa raison", async () => {
    setNavigatorOnLine(false);
    const runtime = makeRuntime();
    await withAccount(runtime);
    renderMenu(runtime, "menu");

    fireEvent.click(await screen.findByTestId("account-menu-toggle"));
    expect(screen.getByTestId("account-menu-offline-hint")).toBeInTheDocument();
    expect(screen.queryByTestId("account-menu-logout")).not.toBeInTheDocument();
  });
});

describe("<LogoutControl place=\"page\" />", () => {
  it("déconnexion directe quand la file est vide", async () => {
    const runtime = makeRuntime();
    let logoutCalls = 0;
    renderWithActions(runtime, <LogoutControl place="page" />, {
      logout: async () => void logoutCalls++,
    });

    fireEvent.click(screen.getByTestId("account-page-logout"));
    await waitFor(() => expect(logoutCalls).toBe(1));
  });

  it("demande confirmation quand la file contient des opérations, et n'agit qu'après confirmation (D3)", async () => {
    // Refusée par le serveur, l'opération reste dans la file au lieu d'en sortir appliquée.
    const server = createFakeServer();
    server.state.refusedTypes.add("stock.upsert");
    const runtime = makeRuntime(server);
    await act(async () => {
      await runtime.actions.saveStock({ cardId: 1, languageCode: "FR", cardSetId: 1, quantityOwned: 1 });
    });
    let logoutCalls = 0;
    renderWithActions(runtime, <LogoutControl place="page" />, {
      logout: async () => void logoutCalls++,
    });
    // L'état de la file se publie une fois le fournisseur monté et le lot tranché.
    await waitFor(() => {
      const status = runtime.engine.getStatus();
      expect(status.pending + status.rejected).toBe(1);
    });
    await act(async () => {});

    fireEvent.click(screen.getByTestId("account-page-logout"));
    expect(await screen.findByTestId("account-page-warning")).toHaveTextContent("1 opération");
    expect(logoutCalls).toBe(0);

    fireEvent.click(screen.getByTestId("account-page-logout-cancel"));
    expect(screen.queryByTestId("account-page-warning")).not.toBeInTheDocument();
    expect(logoutCalls).toBe(0);

    fireEvent.click(screen.getByTestId("account-page-logout"));
    fireEvent.click(await screen.findByTestId("account-page-logout-confirm"));
    await waitFor(() => expect(logoutCalls).toBe(1));
  });

  it("hors ligne, le bouton reste visible mais désactivé, avec sa raison", async () => {
    setNavigatorOnLine(false);
    const runtime = makeRuntime();
    renderWithActions(runtime, <LogoutControl place="page" />);

    expect(await screen.findByTestId("account-page-offline-hint")).toHaveTextContent("Indisponible hors ligne.");
    expect(screen.getByTestId("account-page-logout")).toBeDisabled();
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
