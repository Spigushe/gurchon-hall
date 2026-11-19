import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppUpdateStore } from "../../../src/offline/core/appUpdate";
import { RELOAD_FALLBACK_MS, registerServiceWorker } from "../../../src/offline/registerServiceWorker";
import { registered, updateCalls } from "../../stubs/virtualPwaRegister";

// `virtual:pwa-register` est remplacé par `tests/stubs/virtualPwaRegister.ts`
// (alias de `vitest.config.ts`) : on vérifie ce que le module lui demande.

const hadServiceWorker = "serviceWorker" in navigator;

function setServiceWorkerSupport(supported: boolean) {
  if (supported) {
    Object.defineProperty(navigator, "serviceWorker", { value: {}, configurable: true });
  } else {
    // `in` doit répondre faux : la propriété est retirée, pas mise à `undefined`.
    delete (navigator as unknown as Record<string, unknown>).serviceWorker;
  }
}

beforeEach(() => {
  registered.length = 0;
  updateCalls.length = 0;
});

afterEach(() => {
  setServiceWorkerSupport(hadServiceWorker);
  vi.useRealTimers();
});

describe("registerServiceWorker", () => {
  it("n'enregistre rien sans prise en charge des service workers", () => {
    setServiceWorkerSupport(false);
    registerServiceWorker();
    expect(registered).toEqual([]);
  });

  it("enregistre le service worker tout de suite", () => {
    setServiceWorkerSupport(true);
    registerServiceWorker();
    expect(registered).toHaveLength(1);
    expect(registered[0].immediate).toBe(true);
  });

  it("revérifie une mise à jour toutes les heures, et rien sans enregistrement", () => {
    vi.useFakeTimers();
    setServiceWorkerSupport(true);
    registerServiceWorker();
    const update = vi.fn(async () => {});

    registered[0].onRegisteredSW?.("/sw.js", undefined);
    vi.advanceTimersByTime(60 * 60 * 1000);
    expect(update).not.toHaveBeenCalled();

    registered[0].onRegisteredSW?.("/sw.js", { update } as unknown as ServiceWorkerRegistration);
    vi.advanceTimersByTime(60 * 60 * 1000 - 1);
    expect(update).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(update).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60 * 60 * 1000);
    expect(update).toHaveBeenCalledTimes(2);
  });

  it("journalise mise à jour, disponibilité hors ligne et échec", () => {
    setServiceWorkerSupport(true);
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    registerServiceWorker(new AppUpdateStore(), () => {});
    const options = registered[0];

    options.onNeedRefresh?.();
    options.onOfflineReady?.();
    const failure = new Error("refus");
    options.onRegisterError?.(failure);

    expect(info.mock.calls.map(([message]) => message)).toEqual([
      "[pwa] nouvelle version de l'app shell en attente",
      "[pwa] app shell disponible hors-ligne",
    ]);
    expect(error).toHaveBeenCalledWith("[pwa] échec de l'enregistrement du service worker", failure);
  });

  it("mode prompt : une version en attente est offerte au store, sans rien installer", () => {
    setServiceWorkerSupport(true);
    vi.spyOn(console, "info").mockImplementation(() => {});
    const store = new AppUpdateStore();
    registerServiceWorker(store, () => {});
    expect(store.getSnapshot().available).toBe(false);

    registered[0].onNeedRefresh?.();

    expect(store.getSnapshot()).toEqual({ available: true, dismissed: false, applying: false });
    expect(updateCalls).toEqual([]);
  });

  it("« Mettre à jour » envoie SKIP_WAITING, puis recharge d'office si rien ne l'a fait", async () => {
    vi.useFakeTimers();
    setServiceWorkerSupport(true);
    vi.spyOn(console, "info").mockImplementation(() => {});
    const store = new AppUpdateStore();
    const reload = vi.fn();
    registerServiceWorker(store, reload);
    registered[0].onNeedRefresh?.();

    await store.apply();

    expect(updateCalls).toHaveLength(1);
    expect(store.getSnapshot().applying).toBe(true);
    vi.advanceTimersByTime(RELOAD_FALLBACK_MS - 1);
    expect(reload).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
