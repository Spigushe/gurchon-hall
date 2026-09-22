import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderApp, setOnline } from "./ui/harness";

/**
 * Lot 7 (passe design « Nocturne ») : le chrome global a changé. `App.tsx` ne
 * porte plus de `<header>` (titre « Gurchon Hall », pastille réseau permanente
 * `role="status"`) ni de `<footer>` avec la note de coquille offline — voir le
 * handoff § « Interactions » : « nothing is shown while healthy ». Ces
 * éléments vivent maintenant, quand ils ont un équivalent, sur l'Atelier
 * (alerte conditionnelle) ou sur l'écran « Synchronisation » dédié
 * (`#/synchronisation`). Ces tests vérifient ce que la coquille garantit
 * réellement aujourd'hui : la tab bar (onglet « Chercher » compris depuis
 * l'étape 14), le routage par hash, la gestion du focus, et l'absence de tout
 * appel réseau hors ligne.
 */
describe("<App /> : coquille", () => {
  it("affiche l'app shell (tab bar, page Atelier) sans aucun appel réseau quand on est hors ligne", async () => {
    const { server, ui } = await renderApp({ online: false });

    expect(screen.getByRole("navigation", { name: "Navigation principale" })).toBeInTheDocument();
    expect(await screen.findByTestId("home-page")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Atelier", level: 2 })).toBeInTheDocument();
    expect(server.state.requests).toEqual([]);
    expect(ui.requests).toEqual([]);
  });

  it("n'affiche plus le titre de coquille, la pastille réseau permanente ni la note offline en chrome global (retirés au Lot 7)", async () => {
    await renderApp({ online: false });

    expect(screen.queryByRole("heading", { name: /gurchon hall/i })).not.toBeInTheDocument();
    expect(
      screen.queryByText(
        "Cette page s'affiche sans connexion réseau : elle constitue la base de l'app shell pour l'expérience hors-ligne (PWA).",
      ),
    ).not.toBeInTheDocument();
    // Aucun indicateur de connectivité permanent : ce que `role=status` portait
    // avant vit désormais dans les composants qui en ont besoin (voir le test
    // suivant, sur `BundleDeposit`), pas dans le chrome.
    expect(screen.queryAllByRole("status")).toHaveLength(0);
  });

  it("la connectivité reste observable via les composants qui la consomment (BundleDeposit), plus dans le chrome global", async () => {
    await renderApp({ online: true, hash: "#/collection" });
    await screen.findByTestId("bundle-deposit");
    expect(screen.queryByTestId("bundle-offline-hint")).not.toBeInTheDocument();

    act(() => setOnline(false));
    expect(await screen.findByTestId("bundle-offline-hint")).toHaveTextContent(/connexion/);

    act(() => setOnline(true));
    await waitFor(() => expect(screen.queryByTestId("bundle-offline-hint")).not.toBeInTheDocument());
  });

  it("l'onglet « Chercher » ouvre l'écran de recherche du catalogue (étape 14, ajoutée en cours de Lot 7)", async () => {
    await renderApp({ online: false });

    fireEvent.click(screen.getByTestId("nav-search"));
    expect(await screen.findByTestId("search-page")).toBeInTheDocument();
    expect(window.location.hash).toBe("#/rechercher");
    expect(screen.getByTestId("nav-search")).toHaveAttribute("aria-current", "page");
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

  it("rend l'écran de synchronisation sur #/synchronisation (Lot 7 : SyncStatusBar et RejectedOperations n'y vivent plus qu'ici)", async () => {
    await renderApp({ online: false, hash: "#/synchronisation" });

    expect(await screen.findByTestId("sync-page")).toBeInTheDocument();
    expect(screen.getByTestId("sync-status")).toBeInTheDocument();
  });

  it("déplace le focus sur le contenu après une navigation (accessibilité clavier / lecteur d'écran)", async () => {
    await renderApp({ online: false });
    const main = document.getElementById("contenu");
    expect(main).not.toBeNull();

    fireEvent.click(screen.getByTestId("nav-stock"));
    await screen.findByTestId("stock-page");
    await waitFor(() => expect(document.activeElement).toBe(main));
  });

  it("ouvre directement la route du hash au chargement (rechargement hors ligne)", async () => {
    await renderApp({ online: false, hash: "#/collection" });
    expect(await screen.findByTestId("stock-page")).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).not.toBeNull());
  });
});
