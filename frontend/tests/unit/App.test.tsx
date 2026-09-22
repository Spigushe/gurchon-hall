import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderApp, setOnline } from "./ui/harness";

describe("<App /> : coquille", () => {
  it("affiche l'app shell (titre) sans aucun appel réseau quand on est hors ligne", async () => {
    const { server, ui } = await renderApp({ online: false });

    expect(screen.getByRole("heading", { name: /gurchon hall/i, level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Navigation principale" })).toBeInTheDocument();
    expect(await screen.findByTestId("home-page")).toBeInTheDocument();
    expect(server.state.requests).toEqual([]);
    expect(ui.requests).toEqual([]);
  });

  it("garde le texte de la coquille et un seul indicateur role=status (contrat des tests e2e)", async () => {
    await renderApp({ online: false });

    expect(
      screen.getByText(
        "Cette page s'affiche sans connexion réseau : elle constitue la base de l'app shell pour l'expérience hors-ligne (PWA).",
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("status")).toHaveLength(1);
  });

  it("affiche « En ligne » quand navigator.onLine est vrai", async () => {
    await renderApp({ online: true });
    expect(screen.getByRole("status")).toHaveTextContent("En ligne");
  });

  it("bascule sur « Hors ligne » puis revient « En ligne » avec les événements du navigateur", async () => {
    await renderApp({ online: true });
    expect(screen.getByRole("status")).toHaveTextContent("En ligne");

    act(() => setOnline(false));
    expect(screen.getByRole("status")).toHaveTextContent("Hors ligne");

    act(() => setOnline(true));
    expect(screen.getByRole("status")).toHaveTextContent("En ligne");
  });

  it("navigue par le hash : collection, decks, page inconnue", async () => {
    await renderApp({ online: false });

    fireEvent.click(screen.getByTestId("nav-stock"));
    expect(await screen.findByTestId("stock-page")).toBeInTheDocument();
    expect(window.location.hash).toBe("#/collection");
    expect(screen.getByTestId("nav-stock")).toHaveAttribute("aria-current", "page");

    fireEvent.click(screen.getByTestId("nav-decks"));
    expect(await screen.findByTestId("decks-page")).toBeInTheDocument();

    act(() => {
      window.location.hash = "#/nimportequoi";
    });
    expect(await screen.findByTestId("not-found")).toBeInTheDocument();
  });

  it("ouvre directement la route du hash au chargement (rechargement hors ligne)", async () => {
    await renderApp({ online: false, hash: "#/collection" });
    expect(await screen.findByTestId("stock-page")).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).not.toBeNull());
  });
});
