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

  describe("raccourcis clavier de navigation (`G` puis A/C/D/S)", () => {
    it("navigue vers la Collection, les Decks puis la Synchronisation", async () => {
      await renderApp({ online: false });

      fireEvent.keyDown(document, { key: "g" });
      fireEvent.keyDown(document, { key: "c" });
      expect(await screen.findByTestId("stock-page")).toBeInTheDocument();
      expect(window.location.hash).toBe("#/collection");

      fireEvent.keyDown(document, { key: "g" });
      fireEvent.keyDown(document, { key: "d" });
      expect(await screen.findByTestId("decks-page")).toBeInTheDocument();
      expect(window.location.hash).toBe("#/decks");

      fireEvent.keyDown(document, { key: "g" });
      fireEvent.keyDown(document, { key: "s" });
      expect(await screen.findByTestId("sync-page")).toBeInTheDocument();
      expect(window.location.hash).toBe("#/synchronisation");

      fireEvent.keyDown(document, { key: "g" });
      fireEvent.keyDown(document, { key: "a" });
      expect(await screen.findByTestId("home-page")).toBeInTheDocument();
      expect(window.location.hash).toBe("#/");
    });

    it("ne navigue pas sur `G` seul, sans deuxième touche", async () => {
      await renderApp({ online: false });

      fireEvent.keyDown(document, { key: "g" });

      expect(screen.getByTestId("home-page")).toBeInTheDocument();
      expect(window.location.hash).toBe("");
    });

    // Adapté au Lot 5c (étape 6) : le champ de recherche de la barre haute, qui servait de
    // champ de saisie à ce test, n'est plus rendu ; la même garantie se vérifie dans la
    // recherche de la Collection.
    it("reste inactif quand le focus est dans un champ de saisie (recherche de la Collection)", async () => {
      await renderApp({ online: false, hash: "#/collection" });

      const search = await screen.findByTestId("stock-search");
      search.focus();
      fireEvent.keyDown(search, { key: "g" });
      fireEvent.keyDown(search, { key: "d" });

      expect(screen.getByTestId("stock-page")).toBeInTheDocument();
      expect(window.location.hash).toBe("#/collection");
    });

    it("n'affiche plus de champ de recherche global dans la barre haute", async () => {
      await renderApp({ online: false });
      expect(screen.queryByRole("searchbox", { name: "Recherche" })).not.toBeInTheDocument();
    });
  });
});
