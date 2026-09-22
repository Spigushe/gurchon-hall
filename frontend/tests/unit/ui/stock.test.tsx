import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createFakeServer } from "../offline/fakeServer";
import { renderApp, setOnline } from "./harness";

/** Sélectionne une carte du catalogue local dans le formulaire de saisie du stock. */
async function pickCard(term: string) {
  const form = screen.getByTestId("stock-form");
  fireEvent.change(within(form).getByLabelText("Rechercher une carte"), { target: { value: term } });
  const option = await within(form).findByTestId("card-picker-option");
  fireEvent.click(option);
  await within(form).findByTestId("stock-form-card");
}

describe("collection : saisie hors ligne", () => {
  it("enregistre en file sans aucun appel réseau, affiche l'entrée et l'état de synchronisation", async () => {
    const { runtime, server, ui } = await renderApp({
      online: false,
      hash: "#/collection",
      catalog: true,
    });
    await screen.findByTestId("stock-form");

    await pickCard("elan"); // « elan » trouve « Élan vital » : même repli que le serveur
    const form = screen.getByTestId("stock-form");
    expect(within(form).getByTestId("stock-form-card")).toHaveTextContent("Élan vital");
    fireEvent.change(within(form).getByLabelText("Exemplaires possédés"), { target: { value: "3" } });
    fireEvent.click(within(form).getByLabelText(/Proxy autorisé/));
    fireEvent.click(within(form).getByTestId("stock-form-submit"));

    await waitFor(() => expect(screen.getByTestId("stock-entry")).toBeInTheDocument());
    const entry = screen.getByTestId("stock-entry");
    expect(entry).toHaveAttribute("data-card-id", "1");
    expect(entry).toHaveAttribute("data-language", "FR");
    expect(within(entry).getByTestId("stock-entry-quantity")).toHaveTextContent("3");
    expect(within(entry).getByTestId("pending-badge")).toHaveTextContent(
      "En attente de synchronisation",
    );

    // Saisie → file → statut, sans réseau (§10).
    const queued = await runtime.outbox.list();
    expect(queued).toHaveLength(1);
    expect(queued[0].operation).toMatchObject({
      type: "stock.upsert",
      data: { card_id: 1, language_code: "FR", quantity_owned: 3, proxy_allowed: true },
    });
    expect(server.state.requests).toEqual([]);
    expect(ui.requests).toEqual([]);
    await waitFor(() =>
      expect(screen.getByTestId("sync-status")).toHaveAttribute("data-pending", "1"),
    );
    expect(screen.getByTestId("sync-status")).toHaveAttribute("data-state", "offline");
    expect(screen.getByTestId("sync-label")).toHaveTextContent(
      "Hors ligne : 1 opération en attente",
    );
    expect(screen.getByTestId("stock-form-feedback")).toHaveTextContent(/sur cet appareil/);
  });

  it("se synchronise au retour du réseau puis affiche « Tout est à jour »", async () => {
    const { server, runtime, settle } = await renderApp({
      online: false,
      hash: "#/collection",
      catalog: true,
    });
    await screen.findByTestId("stock-form");
    await pickCard("theo");
    fireEvent.change(screen.getByLabelText("Exemplaires possédés"), { target: { value: "2" } });
    fireEvent.click(screen.getByTestId("stock-form-submit"));
    await waitFor(() => expect(screen.getByTestId("stock-entry")).toBeInTheDocument());
    expect(server.state.stock.size).toBe(0);

    act(() => setOnline(true));
    await waitFor(() => expect(server.state.stock.size).toBe(1));
    await settle();
    // Rafraîchissement explicite des miroirs : voir le point ouvert sur `autoRefresh` (rapport).
    await act(async () => {
      await runtime.refresh();
    });
    await waitFor(() =>
      expect(screen.getByTestId("sync-status")).toHaveAttribute("data-state", "synced"),
    );
    expect(screen.getByTestId("sync-label")).toHaveTextContent("Tout est à jour");
    expect(await runtime.outbox.list()).toHaveLength(0);
    await waitFor(() => expect(screen.queryByTestId("pending-badge")).not.toBeInTheDocument());
    expect(screen.getByTestId("stock-entry-name")).toHaveTextContent("Theo Bell");
  });

  it("ne crée qu'une opération quand on valide deux fois de suite", async () => {
    const { runtime } = await renderApp({ online: false, hash: "#/collection", catalog: true });
    await screen.findByTestId("stock-form");
    await pickCard("elan");
    const form = screen.getByTestId("stock-form");

    // Deux soumissions dans le même tour, avant tout nouveau rendu.
    await act(async () => {
      fireEvent.submit(form);
      fireEvent.submit(form);
    });
    await waitFor(async () => expect(await runtime.outbox.list()).toHaveLength(1));
  });

  it("désactive le bouton de validation pendant l'action", async () => {
    await renderApp({ online: false, hash: "#/collection", catalog: true });
    await screen.findByTestId("stock-form");
    await pickCard("elan");

    const submit = screen.getByTestId("stock-form-submit");
    fireEvent.click(submit);
    expect(submit).toBeDisabled();
    await waitFor(() => expect(submit).not.toBeDisabled());
  });

  it("refuse une saisie sans carte ou avec une quantité invalide, sans rien mettre en file", async () => {
    const { runtime } = await renderApp({ online: false, hash: "#/collection", catalog: true });
    await screen.findByTestId("stock-form");

    fireEvent.click(screen.getByTestId("stock-form-submit"));
    expect(await screen.findByTestId("stock-form-error")).toHaveTextContent("Choisissez une carte");

    await pickCard("elan");
    fireEvent.change(screen.getByLabelText("Exemplaires possédés"), { target: { value: "-2" } });
    fireEvent.click(screen.getByTestId("stock-form-submit"));
    expect(await screen.findByTestId("stock-form-error")).toHaveTextContent("entier, 0 ou plus");
    expect(await runtime.outbox.list()).toHaveLength(0);
  });

  it("le pas +/− renvoie l'état complet : proxy et notes ne sont pas remis à zéro", async () => {
    const { runtime } = await renderApp({ online: false, hash: "#/collection", catalog: true });
    await runtime.actions.saveStock({
      cardId: 1,
      languageCode: "FR",
      quantityOwned: 2,
      proxyAllowed: true,
      notes: "foil",
    });
    const entry = await screen.findByTestId("stock-entry");

    fireEvent.click(
      within(entry).getByRole("button", { name: /Ajouter un exemplaire de Élan vital \(FR\)/ }),
    );
    await waitFor(() => expect(screen.getByTestId("stock-entry-quantity")).toHaveTextContent("3"));

    const queued = await runtime.outbox.list();
    expect(queued).toHaveLength(2);
    expect(queued[1].operation).toMatchObject({
      type: "stock.upsert",
      data: { card_id: 1, language_code: "FR", quantity_owned: 3, proxy_allowed: true, notes: "foil" },
    });
  });

  it("supprime une entrée après confirmation", async () => {
    const { runtime } = await renderApp({ online: false, hash: "#/collection", catalog: true });
    await runtime.actions.saveStock({ cardId: 1, languageCode: "FR", quantityOwned: 1 });
    await screen.findByTestId("stock-entry");

    fireEvent.click(screen.getByTestId("stock-entry-delete"));
    expect(await runtime.outbox.list()).toHaveLength(1); // pas encore : il faut confirmer
    fireEvent.click(screen.getByTestId("stock-entry-delete-confirm"));

    await waitFor(() => expect(screen.getByTestId("stock-empty")).toBeInTheDocument());
    expect((await runtime.outbox.list()).map((entry) => entry.type)).toEqual([
      "stock.upsert",
      "stock.delete",
    ]);
  });

  it("filtre par nom (casse et accents ignorés) et par langue", async () => {
    const { runtime } = await renderApp({ online: false, hash: "#/collection", catalog: true });
    await runtime.actions.saveStock({ cardId: 1, languageCode: "FR", quantityOwned: 1 });
    await runtime.actions.saveStock({ cardId: 1, languageCode: "EN", quantityOwned: 1 });
    await runtime.actions.saveStock({ cardId: 3, languageCode: "EN", quantityOwned: 1 });
    await waitFor(() => expect(screen.getAllByTestId("stock-entry")).toHaveLength(3));

    fireEvent.change(screen.getByTestId("stock-search"), { target: { value: "ÉLAN" } });
    await waitFor(() => expect(screen.getAllByTestId("stock-entry")).toHaveLength(2));

    fireEvent.change(screen.getByTestId("stock-language-filter"), { target: { value: "FR" } });
    await waitFor(() => expect(screen.getAllByTestId("stock-entry")).toHaveLength(1));

    fireEvent.change(screen.getByTestId("stock-search"), { target: { value: "zzz" } });
    expect(await screen.findByTestId("stock-empty")).toHaveTextContent(
      "Aucune entrée ne correspond",
    );
  });

  it("verse un produit par la file (recherche en ligne, écriture différée)", async () => {
    const { runtime, ui } = await renderApp({ online: true, hash: "#/collection", catalog: true });
    ui.bundles = [{ id: 7, card_set_id: 1, code: "PB", name: "Précon Brujah", size: 90, release_date: null }];
    const panel = await screen.findByTestId("bundle-deposit");

    fireEvent.change(within(panel).getByLabelText("Rechercher un produit"), {
      target: { value: "brujah" },
    });
    fireEvent.click(await within(panel).findByText("Précon Brujah (PB)"));
    fireEvent.change(within(panel).getByLabelText("Nombre de produits"), { target: { value: "2" } });
    fireEvent.click(within(panel).getByTestId("bundle-submit"));

    await waitFor(() => expect(within(panel).getByTestId("bundle-feedback")).toHaveTextContent("mis en file"));
    await runtime.engine.whenIdle();
    // Rejoué par le moteur sous une clé d'idempotence, jamais par un appel direct.
    expect(ui.requests.filter((request) => request.method === "POST")).toEqual([]);
  });
});

describe("catalogue", () => {
  it("dit clairement qu'il manque quand on est hors ligne, et bloque la recherche de carte", async () => {
    await renderApp({ online: false, hash: "#/collection" });

    const state = await screen.findByTestId("catalog-state");
    await waitFor(() => expect(state).toHaveTextContent("pas encore téléchargé"));
    expect(screen.getByTestId("catalog-offline-hint")).toHaveTextContent("hors ligne");
    expect(screen.getByTestId("catalog-update")).toBeDisabled();
    expect(screen.getByLabelText("Rechercher une carte")).toBeDisabled();
    expect(screen.getByTestId("card-picker-empty-catalog")).toBeInTheDocument();
  });

  it("se télécharge tout seul au premier lancement en ligne", async () => {
    const { server } = await renderApp({ online: true, hash: "#/collection" });

    await waitFor(() =>
      expect(server.state.requests.some((request) => request.path === "/cartes")).toBe(true),
    );
    // Une fois téléchargé, la recherche locale trouve les cartes (sans réseau).
    fireEvent.change(screen.getByLabelText("Rechercher une carte"), { target: { value: "theo" } });
    expect(await screen.findByTestId("card-picker-option")).toHaveTextContent("Theo Bell");
    expect(screen.queryByTestId("catalog-panel")).not.toBeInTheDocument();
  });

  it("montre l'échec du téléchargement, puis se relance à la main", async () => {
    const server = createFakeServer();
    server.next.getStatus = 500; // le serveur répond, mais en erreur
    await renderApp({ online: true, hash: "#/", server });

    expect(await screen.findByTestId("catalog-error")).toHaveTextContent("Téléchargement impossible");
    expect(screen.getByTestId("catalog-state")).toHaveTextContent("pas encore téléchargé");

    server.next.getStatus = null;
    fireEvent.click(screen.getByTestId("catalog-update"));
    await waitFor(() =>
      expect(screen.getByTestId("catalog-state")).toHaveAttribute("data-count", "3"),
    );
    expect(screen.queryByTestId("catalog-error")).not.toBeInTheDocument();
  });

  it("propose « Mettre à jour le catalogue » en ligne", async () => {
    const { server } = await renderApp({ online: true, hash: "#/", catalog: true });
    await waitFor(() =>
      expect(screen.getByTestId("catalog-state")).toHaveAttribute("data-count", "3"),
    );
    expect(screen.getByTestId("catalog-update")).not.toBeDisabled();
    server.state.requests.length = 0;

    fireEvent.click(screen.getByTestId("catalog-update"));
    await waitFor(() =>
      expect(server.state.requests.some((request) => request.path === "/cartes")).toBe(true),
    );
    await waitFor(() => expect(screen.getByTestId("catalog-update")).not.toBeDisabled());
  });
});
