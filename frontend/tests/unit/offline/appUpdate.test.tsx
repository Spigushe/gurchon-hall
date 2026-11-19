import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppUpdateStore, type AppUpdateSnapshot } from "../../../src/offline/core/appUpdate";
import { appUpdateViewOf, useAppUpdate } from "../../../src/offline/react/useAppUpdate";
import { VtesOfflineProvider } from "../../../src/offline/vtes/VtesOfflineProvider";
import { createVtesOffline, type VtesOfflineRuntime } from "../../../src/offline/vtes/runtime";
import { CARD_SET_ID, createFakeServer } from "./fakeServer";
import { freshDbName, manualTimers } from "./helpers";

// Lot 12, A6 et P5 : le store de la version en attente, la vue du bandeau
// selon la file, et le hook qui les croise.

const snapshot = (patch: Partial<AppUpdateSnapshot> = {}): AppUpdateSnapshot => ({
  available: true,
  dismissed: false,
  applying: false,
  ...patch,
});
const sync = (patch: Partial<{ pending: number; rejected: number; online: boolean; authRequired: boolean }> = {}) => ({
  pending: 0,
  rejected: 0,
  online: true,
  authRequired: false,
  ...patch,
});

describe("AppUpdateStore", () => {
  it("part sans version, l'offre, puis la masque par « Plus tard »", () => {
    const store = new AppUpdateStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    expect(store.getSnapshot()).toEqual({ available: false, dismissed: false, applying: false });

    store.offer(async () => {});
    expect(store.getSnapshot().available).toBe(true);
    store.dismiss();
    expect(store.getSnapshot().dismissed).toBe(true);
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    store.offer(async () => {});
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("garde le même instantané tant que rien ne change (useSyncExternalStore)", () => {
    const store = new AppUpdateStore();
    expect(store.getSnapshot()).toBe(store.getSnapshot());
  });

  it("n'installe rien sans version offerte", async () => {
    const store = new AppUpdateStore();
    await store.apply();
    expect(store.getSnapshot().applying).toBe(false);
  });

  it("installe une seule fois, même sur deux clics", async () => {
    const store = new AppUpdateStore();
    const install = vi.fn(async () => {});
    store.offer(install);
    await Promise.all([store.apply(), store.apply()]);
    expect(install).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().applying).toBe(true);
  });

  it("rend la main sur un échec d'installation, pour réessayer", async () => {
    const store = new AppUpdateStore();
    store.offer(async () => {
      throw new Error("pas de service worker en attente");
    });
    await expect(store.apply()).rejects.toThrow("pas de service worker en attente");
    expect(store.getSnapshot().applying).toBe(false);
  });
});

describe("appUpdateViewOf", () => {
  it("masqué sans version, ou après « Plus tard »", () => {
    expect(appUpdateViewOf(snapshot({ available: false }), sync({ pending: 3 }))).toEqual({ kind: "hidden" });
    expect(appUpdateViewOf(snapshot({ dismissed: true }), sync())).toEqual({ kind: "hidden" });
  });

  it("attend les saisies en attente, sans proposer la mise à jour", () => {
    expect(appUpdateViewOf(snapshot(), sync({ pending: 3, rejected: 2, online: false, authRequired: true }))).toEqual({
      kind: "waiting",
      pending: 3,
      online: false,
      authRequired: true,
    });
  });

  it("propose la mise à jour à file vide, refusées comptées mais non bloquantes", () => {
    expect(appUpdateViewOf(snapshot(), sync())).toEqual({ kind: "ready", rejected: 0, applying: false });
    expect(appUpdateViewOf(snapshot({ applying: true }), sync({ rejected: 2 }))).toEqual({
      kind: "ready",
      rejected: 2,
      applying: true,
    });
  });
});

const runtimes: VtesOfflineRuntime[] = [];
afterEach(async () => {
  for (const runtime of runtimes.splice(0)) {
    runtime.stop();
    await runtime.engine.whenIdle();
    runtime.dispose();
  }
});

function Banner({ store }: { store: AppUpdateStore }) {
  const { view, apply, dismiss } = useAppUpdate(store);
  return (
    <div>
      <p data-testid="view">{JSON.stringify(view)}</p>
      <button type="button" onClick={() => void apply()}>
        Mettre à jour
      </button>
      <button type="button" onClick={dismiss}>
        Plus tard
      </button>
    </div>
  );
}

describe("useAppUpdate", () => {
  function setup() {
    const server = createFakeServer();
    const state = { online: false };
    const runtime = createVtesOffline({
      client: server.client,
      dbName: freshDbName("app-update"),
      autoRefresh: false,
      engine: { isOnline: () => state.online, lockName: null, timers: manualTimers().timers },
    });
    runtimes.push(runtime);
    const store = new AppUpdateStore();
    const install = vi.fn(async () => {});
    render(
      <VtesOfflineProvider runtime={runtime}>
        <Banner store={store} />
      </VtesOfflineProvider>,
    );
    return { runtime, state, store, install };
  }
  const view = () => JSON.parse(screen.getByTestId("view").textContent ?? "{}") as { kind: string };

  it("bloque la mise à jour tant qu'une saisie attend, puis la propose une fois envoyée", async () => {
    const { runtime, state, store, install } = setup();
    expect(view().kind).toBe("hidden");

    await act(async () => {
      await runtime.actions.saveStock({ cardId: 1, languageCode: "EN", cardSetId: CARD_SET_ID, quantityOwned: 2 });
      store.offer(install);
    });
    await waitFor(() => expect(view()).toMatchObject({ kind: "waiting", pending: 1, online: false }));

    // Un clic sur un bandeau resté affiché n'installe rien tant que la file attend.
    await act(async () => {
      screen.getByText("Mettre à jour").click();
    });
    expect(install).not.toHaveBeenCalled();

    state.online = true;
    await act(async () => {
      await runtime.engine.flush();
    });
    await waitFor(() => expect(view()).toMatchObject({ kind: "ready", rejected: 0 }));

    await act(async () => {
      screen.getByText("Mettre à jour").click();
    });
    expect(install).toHaveBeenCalledTimes(1);
  });

  it("« Plus tard » masque le bandeau", async () => {
    const { store, install } = setup();
    act(() => store.offer(install));
    expect(view().kind).toBe("ready");
    act(() => screen.getByText("Plus tard").click());
    expect(view().kind).toBe("hidden");
  });
});
