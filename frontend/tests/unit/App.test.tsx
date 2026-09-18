import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../../src/App";

function setNavigatorOnLine(value: boolean) {
  Object.defineProperty(window.navigator, "onLine", {
    configurable: true,
    value,
  });
}

describe("<App />", () => {
  afterEach(() => {
    setNavigatorOnLine(true);
  });

  it("affiche l'app shell (titre) sans aucun appel réseau", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    render(<App />);

    expect(screen.getByRole("heading", { name: /gurchon hall/i })).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it("affiche « En ligne » quand navigator.onLine est vrai", () => {
    setNavigatorOnLine(true);
    render(<App />);

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("En ligne");
  });

  it("bascule sur « Hors ligne » quand l'événement 'offline' survient", () => {
    setNavigatorOnLine(true);
    render(<App />);

    expect(screen.getByRole("status")).toHaveTextContent("En ligne");

    act(() => {
      setNavigatorOnLine(false);
      window.dispatchEvent(new Event("offline"));
    });

    expect(screen.getByRole("status")).toHaveTextContent("Hors ligne");
  });

  it("revient sur « En ligne » quand l'événement 'online' survient après une coupure", () => {
    setNavigatorOnLine(false);
    render(<App />);

    expect(screen.getByRole("status")).toHaveTextContent("Hors ligne");

    act(() => {
      setNavigatorOnLine(true);
      window.dispatchEvent(new Event("online"));
    });

    expect(screen.getByRole("status")).toHaveTextContent("En ligne");
  });
});
