import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useOnlineStatus } from "../../src/useOnlineStatus";

/**
 * `useOnlineStatus` est le socle de l'affichage réseau de l'app shell
 * (CLAUDE.md §3) : c'est la seule logique JS non triviale de ce composant,
 * donc la cible prioritaire des tests unitaires (cf. skill tests-frontend).
 */
function setNavigatorOnLine(value: boolean) {
  Object.defineProperty(window.navigator, "onLine", {
    configurable: true,
    value,
  });
}

describe("useOnlineStatus", () => {
  afterEach(() => {
    // Toujours revenir à un état "en ligne" propre entre les tests.
    setNavigatorOnLine(true);
  });

  it("reflète navigator.onLine au premier rendu quand en ligne", () => {
    setNavigatorOnLine(true);
    const { result } = renderHook(() => useOnlineStatus());
    expect(result.current).toBe(true);
  });

  it("reflète navigator.onLine au premier rendu quand hors ligne", () => {
    setNavigatorOnLine(false);
    const { result } = renderHook(() => useOnlineStatus());
    expect(result.current).toBe(false);
  });

  it("passe à false quand l'événement 'offline' est déclenché", () => {
    setNavigatorOnLine(true);
    const { result } = renderHook(() => useOnlineStatus());
    expect(result.current).toBe(true);

    act(() => {
      setNavigatorOnLine(false);
      window.dispatchEvent(new Event("offline"));
    });

    expect(result.current).toBe(false);
  });

  it("repasse à true quand l'événement 'online' est déclenché après une coupure", () => {
    setNavigatorOnLine(false);
    const { result } = renderHook(() => useOnlineStatus());
    expect(result.current).toBe(false);

    act(() => {
      setNavigatorOnLine(true);
      window.dispatchEvent(new Event("online"));
    });

    expect(result.current).toBe(true);
  });

  it("désabonne les écouteurs online/offline au démontage", () => {
    const removeEventListenerSpy = vi.spyOn(window, "removeEventListener");
    const { unmount } = renderHook(() => useOnlineStatus());

    unmount();

    expect(removeEventListenerSpy).toHaveBeenCalledWith("online", expect.any(Function));
    expect(removeEventListenerSpy).toHaveBeenCalledWith("offline", expect.any(Function));
  });
});

describe("environment guard", () => {
  beforeEach(() => {
    setNavigatorOnLine(true);
  });

  it("n'effectue aucun appel réseau (fetch) pour déterminer l'état", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    renderHook(() => useOnlineStatus());

    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
