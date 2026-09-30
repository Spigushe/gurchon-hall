import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { createFakeServer } from "../offline/fakeServer";
import { renderApp, setOnline } from "./harness";

/**
 * jsdom vaut 1024 par défaut (bureau) : les tests qui veulent le mobile le
 * fixent explicitement, avant le rendu, et le remettent après coup (même
 * convention que `tests/unit/ui/decks.test.tsx`, Lot 5bis étape 7).
 */
function setViewportWidth(width: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: width });
}

afterEach(() => {
  setViewportWidth(1024);
});

/** Ouvre la feuille de saisie depuis la page Collection (le formulaire n'est plus affiché d'emblée). */
async function openStockForm() {
  fireEvent.click(await screen.findByTestId("stock-add"));
  return screen.findByTestId("stock-form");
}

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
    await openStockForm();

    await pickCard("elan"); // « elan » trouve « Élan vital » : même repli que le serveur
    const form = screen.getByTestId("stock-form");
    expect(within(form).getByTestId("stock-form-card")).toHaveTextContent("Élan vital");
    fireEvent.change(within(form).getByLabelText("Exemplaires possédés"), { target: { value: "3" } });
    // Une seule impression connue du serveur factice : l'extension est déjà présélectionnée.
    expect(within(form).getByTestId("stock-form-card-set")).toHaveValue("9");
    fireEvent.click(within(form).getByTestId("stock-form-submit"));

    await waitFor(() => expect(screen.getByTestId("stock-entry")).toBeInTheDocument());
    const entry = screen.getByTestId("stock-entry");
    expect(entry).toHaveAttribute("data-card-id", "1");
    expect(entry).toHaveAttribute("data-language", "FR");
    await waitFor(() =>
      expect(within(entry).getByTestId("stock-entry-card-set")).toHaveTextContent("TEST"),
    );
    expect(within(entry).getByTestId("stock-entry-quantity")).toHaveTextContent("3");
    expect(within(entry).getByTestId("pending-badge")).toHaveTextContent(
      "En attente de synchronisation",
    );

    // Saisie → file → statut, sans réseau (§10).
    const queued = await runtime.outbox.list();
    expect(queued).toHaveLength(1);
    expect(queued[0].operation).toMatchObject({
      type: "stock.upsert",
      data: { card_id: 1, language_code: "FR", card_set_id: 9, quantity_owned: 3 },
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
    await openStockForm();
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
    await openStockForm();
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
    await openStockForm();
    await pickCard("elan");

    const submit = screen.getByTestId("stock-form-submit");
    fireEvent.click(submit);
    expect(submit).toBeDisabled();
    await waitFor(() => expect(submit).not.toBeDisabled());
  });

  it("refuse une saisie sans carte ou avec une quantité invalide, sans rien mettre en file", async () => {
    const { runtime } = await renderApp({ online: false, hash: "#/collection", catalog: true });
    await openStockForm();

    fireEvent.click(screen.getByTestId("stock-form-submit"));
    expect(await screen.findByTestId("stock-form-error")).toHaveTextContent("Choisissez une carte");

    await pickCard("elan");
    fireEvent.change(screen.getByLabelText("Exemplaires possédés"), { target: { value: "-2" } });
    fireEvent.click(screen.getByTestId("stock-form-submit"));
    expect(await screen.findByTestId("stock-form-error")).toHaveTextContent("entier, 0 ou plus");
    expect(await runtime.outbox.list()).toHaveLength(0);
  });

  it("le pas +/− renvoie l'état complet : l'extension et les notes ne sont pas remis à zéro", async () => {
    const { runtime } = await renderApp({ online: false, hash: "#/collection", catalog: true });
    await runtime.actions.saveStock({
      cardId: 1,
      languageCode: "FR",
      cardSetId: 9,
      quantityOwned: 2,
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
      data: { card_id: 1, language_code: "FR", card_set_id: 9, quantity_owned: 3, notes: "foil" },
    });
  });

  it("propose l'extension quand la carte a plusieurs impressions, présélectionnée sur la dernière version", async () => {
    const { runtime } = await renderApp({ online: false, hash: "#/collection", catalog: true });
    // Une seconde impression, plus récente, pour « Élan vital » (une seule dans le serveur factice).
    await runtime.db.cardSets.put({
      id: 21,
      abbrev: "NEW",
      fullName: "Extension récente",
      releaseDate: "2022-01-01",
      company: null,
      isPlaceholder: false,
    });
    const card = await runtime.db.cards.get(1);
    await runtime.db.cards.put({ ...card!, cardSetIds: [9, 21], latestCardSetId: 21 });

    await openStockForm();
    await pickCard("elan");
    const form = screen.getByTestId("stock-form");
    fireEvent.change(within(form).getByLabelText("Exemplaires possédés"), { target: { value: "2" } });
    const select = within(form).getByTestId("stock-form-card-set") as HTMLSelectElement;
    expect(select).toHaveValue("21"); // présélection sur la dernière version (D2a)
    expect(within(select).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "TEST — Extension de test",
      "NEW — Extension récente",
    ]);

    fireEvent.change(select, { target: { value: "9" } });
    fireEvent.click(within(form).getByTestId("stock-form-submit"));

    await waitFor(() => expect(screen.getByTestId("stock-entry")).toBeInTheDocument());
    const queued = await runtime.outbox.list();
    expect(queued[0].operation).toMatchObject({
      type: "stock.upsert",
      data: { card_id: 1, card_set_id: 9, quantity_owned: 2 },
    });
  });

  it("enregistre une carte à 0 exemplaire sous sa dernière version, sans demander l'extension (D2a)", async () => {
    const { runtime } = await renderApp({ online: false, hash: "#/collection", catalog: true });
    await runtime.db.cardSets.put({
      id: 21,
      abbrev: "NEW",
      fullName: "Extension récente",
      releaseDate: "2022-01-01",
      company: null,
      isPlaceholder: false,
    });
    const card = await runtime.db.cards.get(1);
    await runtime.db.cards.put({ ...card!, cardSetIds: [9, 21], latestCardSetId: 21 });

    await openStockForm();
    await pickCard("elan");
    const form = screen.getByTestId("stock-form");
    fireEvent.change(within(form).getByLabelText("Exemplaires possédés"), { target: { value: "0" } });
    expect(within(form).queryByTestId("stock-form-card-set")).not.toBeInTheDocument();
    expect(within(form).getByTestId("stock-form-proxy-hint")).toBeInTheDocument();
    fireEvent.click(within(form).getByTestId("stock-form-submit"));

    await waitFor(() => expect(screen.getByTestId("stock-entry")).toBeInTheDocument());
    const queued = await runtime.outbox.list();
    expect(queued[0].operation).toMatchObject({
      type: "stock.upsert",
      data: { card_id: 1, card_set_id: 21, quantity_owned: 0 },
    });
  });

  it("supprime une entrée après confirmation", async () => {
    const { runtime } = await renderApp({ online: false, hash: "#/collection", catalog: true });
    await runtime.actions.saveStock({ cardId: 1, languageCode: "FR", quantityOwned: 1 });
    await screen.findByTestId("stock-entry");

    // La suppression vit dans la feuille de modification (handoff Nocturne), plus dans la liste.
    fireEvent.click(screen.getByRole("button", { name: "Modifier Élan vital (FR)" }));
    const sheet = await screen.findByTestId("stock-form");
    fireEvent.click(within(sheet).getByTestId("stock-entry-delete"));
    expect(await runtime.outbox.list()).toHaveLength(1); // pas encore : il faut confirmer
    fireEvent.click(within(sheet).getByTestId("stock-entry-delete-confirm"));

    await waitFor(() => expect(screen.getByTestId("stock-empty")).toBeInTheDocument());
    expect(screen.queryByTestId("stock-form")).not.toBeInTheDocument(); // la feuille se referme
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

    // Le filtre de langue est passé dans une feuille de filtres (handoff Nocturne).
    fireEvent.click(screen.getByTestId("stock-filters-open"));
    fireEvent.change(await screen.findByTestId("stock-language-filter"), { target: { value: "FR" } });
    fireEvent.click(screen.getByTestId("stock-filters-done"));
    await waitFor(() => expect(screen.getAllByTestId("stock-entry")).toHaveLength(1));

    fireEvent.change(screen.getByTestId("stock-search"), { target: { value: "zzz" } });
    expect(await screen.findByTestId("stock-empty")).toHaveTextContent(
      "Aucune entrée ne correspond",
    );
  });

  it("ouvre une entrée par sa ligne : l'extension et la langue sont figées, l'enregistrement garde l'état complet", async () => {
    const { runtime } = await renderApp({ online: false, hash: "#/collection", catalog: true });
    await runtime.actions.saveStock({
      cardId: 1,
      languageCode: "FR",
      cardSetId: 9,
      quantityOwned: 2,
      notes: "foil",
    });
    fireEvent.click(await screen.findByRole("button", { name: "Modifier Élan vital (FR)" }));
    const form = await screen.findByTestId("stock-form");

    // Le titre (et son testid « stock-form-card ») vit dans `SheetHeader`, hors du
    // `<form>`, en disposition bureau (jsdom ≥ 1024px par défaut) — cf. la feuille
    // « pied bureau/mobile » ci-dessous.
    expect(screen.getByTestId("stock-form-card")).toHaveTextContent("Élan vital");
    expect(within(form).getByTestId("stock-form-card-set")).toBeDisabled();
    expect(within(form).getByTestId("stock-form-card-set")).toHaveValue("9");
    expect(within(form).getByRole("radio", { name: "FR" })).toBeChecked();
    expect(within(form).getByRole("radio", { name: "EN" })).toBeDisabled(); // la langue fait partie de la clé
    expect(within(form).getByLabelText("Notes")).toHaveValue("foil");

    fireEvent.click(within(form).getByRole("button", { name: "Ajouter : Exemplaires possédés" }));
    fireEvent.click(within(form).getByTestId("stock-form-submit"));

    await waitFor(() => expect(screen.queryByTestId("stock-form")).not.toBeInTheDocument());
    const queued = await runtime.outbox.list();
    expect(queued).toHaveLength(2);
    expect(queued[1].operation).toMatchObject({
      type: "stock.upsert",
      data: { card_id: 1, language_code: "FR", card_set_id: 9, quantity_owned: 3, notes: "foil" },
    });
  });

  it("garde l'entrée quand on choisit « Garder » au lieu de confirmer la suppression", async () => {
    const { runtime } = await renderApp({ online: false, hash: "#/collection", catalog: true });
    await runtime.actions.saveStock({ cardId: 1, languageCode: "FR", cardSetId: 9, quantityOwned: 1 });
    fireEvent.click(await screen.findByRole("button", { name: "Modifier Élan vital (FR)" }));
    const form = await screen.findByTestId("stock-form");

    fireEvent.click(within(form).getByTestId("stock-entry-delete"));
    fireEvent.click(within(form).getByRole("button", { name: "Garder" }));
    expect(within(form).queryByTestId("stock-entry-delete-confirm")).not.toBeInTheDocument();
    expect(within(form).getByTestId("stock-entry-delete")).toBeInTheDocument();
    expect(await runtime.outbox.list()).toHaveLength(1);
  });

  it("verse un produit par la file (recherche en ligne, écriture différée)", async () => {
    const { runtime, ui } = await renderApp({ online: true, hash: "#/collection", catalog: true });
    ui.bundles = [{ id: 7, card_set_id: 1, code: "PB", name: "Précon Brujah", size: 90, release_date: null }];
    fireEvent.click(await screen.findByTestId("bundle-open"));
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

describe("stock : entrée, pied bureau/mobile (Lot 5bis)", () => {
  it(
    "bureau (jsdom ≥ 1024px par défaut) : pied à deux actions, Annuler ferme sans écrire, " +
      "aucun texte flottant mobile",
    async () => {
      const { runtime } = await renderApp({ online: false, hash: "#/collection", catalog: true });
      await openStockForm();
      await pickCard("elan");
      const form = screen.getByTestId("stock-form");

      expect(within(form).getByTestId("stock-form-submit")).toHaveTextContent(
        "Ajouter à la collection",
      );
      expect(
        within(form).queryByText("Enregistré sur cet appareil, envoyé au prochain réseau"),
      ).not.toBeInTheDocument();

      fireEvent.click(within(form).getByRole("button", { name: "Annuler" }));
      expect(screen.queryByTestId("stock-form-sheet")).not.toBeInTheDocument();
      expect(await runtime.outbox.list()).toHaveLength(0);
    },
  );

  it("⌘↵ ajoute l'entrée à la collection, comme un clic sur le bouton primaire", async () => {
    const { runtime } = await renderApp({ online: false, hash: "#/collection", catalog: true });
    await openStockForm();
    await pickCard("elan");
    fireEvent.change(screen.getByLabelText("Exemplaires possédés"), { target: { value: "2" } });

    fireEvent.keyDown(document, { key: "Enter", ctrlKey: true });

    await waitFor(() => expect(screen.getByTestId("stock-entry")).toBeInTheDocument());
    const queued = await runtime.outbox.list();
    expect(queued).toHaveLength(1);
    expect(queued[0].operation).toMatchObject({
      type: "stock.upsert",
      data: { card_id: 1, language_code: "FR", card_set_id: 9, quantity_owned: 2 },
    });
  });

  it(
    "aucune régression mobile : un seul bouton « Ajouter à la collection », pas d'Annuler, " +
      "le texte flottant reste affiché",
    async () => {
      setViewportWidth(390);
      const { runtime } = await renderApp({ online: false, hash: "#/collection", catalog: true });
      await openStockForm();
      await pickCard("elan");
      const form = screen.getByTestId("stock-form");

      expect(within(form).queryByRole("button", { name: "Annuler" })).not.toBeInTheDocument();
      const submit = within(form).getByTestId("stock-form-submit");
      expect(submit).toHaveTextContent("Ajouter à la collection");
      expect(
        screen.getByText("Enregistré sur cet appareil, envoyé au prochain réseau"),
      ).toBeInTheDocument();

      fireEvent.click(submit);
      await waitFor(() => expect(screen.getByTestId("stock-entry")).toBeInTheDocument());
      expect(await runtime.outbox.list()).toHaveLength(1);
    },
  );
});

describe("bundle : verser un produit, pied bureau/mobile (Lot 5bis)", () => {
  it("bureau (jsdom ≥ 1024px par défaut) : pied à deux actions, Annuler ferme sans verser", async () => {
    const { runtime, ui } = await renderApp({ online: true, hash: "#/collection", catalog: true });
    ui.bundles = [
      { id: 7, card_set_id: 1, code: "PB", name: "Précon Brujah", size: 90, release_date: null },
    ];
    fireEvent.click(await screen.findByTestId("bundle-open"));
    const panel = await screen.findByTestId("bundle-deposit");

    expect(within(panel).getByTestId("bundle-submit")).toHaveTextContent("Verser dans la collection");

    fireEvent.click(within(panel).getByRole("button", { name: "Annuler" }));
    expect(screen.queryByTestId("bundle-deposit")).not.toBeInTheDocument();
    expect(await runtime.outbox.list()).toHaveLength(0);
  });

  it("⌘↵ verse le produit, comme un clic sur le bouton primaire", async () => {
    const { runtime, ui } = await renderApp({ online: true, hash: "#/collection", catalog: true });
    ui.bundles = [
      { id: 7, card_set_id: 1, code: "PB", name: "Précon Brujah", size: 90, release_date: null },
    ];
    fireEvent.click(await screen.findByTestId("bundle-open"));
    const panel = await screen.findByTestId("bundle-deposit");

    fireEvent.change(within(panel).getByLabelText("Rechercher un produit"), {
      target: { value: "brujah" },
    });
    fireEvent.click(await within(panel).findByText("Précon Brujah (PB)"));

    fireEvent.keyDown(document, { key: "Enter", ctrlKey: true });

    await waitFor(() =>
      expect(within(panel).getByTestId("bundle-feedback")).toHaveTextContent("mis en file"),
    );
    await runtime.engine.whenIdle();
    // Rejoué par le moteur sous une clé d'idempotence, jamais par un appel direct.
    expect(ui.requests.filter((request) => request.method === "POST")).toEqual([]);
  });

  it("aucune régression mobile : un seul bouton « Verser dans la collection », pas d'Annuler", async () => {
    setViewportWidth(390);
    const { ui } = await renderApp({ online: true, hash: "#/collection", catalog: true });
    ui.bundles = [
      { id: 7, card_set_id: 1, code: "PB", name: "Précon Brujah", size: 90, release_date: null },
    ];
    fireEvent.click(await screen.findByTestId("bundle-open"));
    const panel = await screen.findByTestId("bundle-deposit");

    expect(within(panel).queryByRole("button", { name: "Annuler" })).not.toBeInTheDocument();
    expect(within(panel).getByTestId("bundle-submit")).toHaveTextContent("Verser dans la collection");
  });
});

describe("catalogue", () => {
  it("dit clairement qu'il manque quand on est hors ligne, et bloque la recherche de carte", async () => {
    await renderApp({ online: false, hash: "#/collection" });
    await openStockForm();

    const state = await screen.findByTestId("catalog-state");
    await waitFor(() => expect(state).toHaveTextContent("pas encore téléchargé"));
    expect(screen.getByTestId("catalog-offline-hint")).toHaveTextContent(/hors ligne/i);
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
    await openStockForm();
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
