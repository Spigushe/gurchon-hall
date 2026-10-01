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

  it("le pas +/− renvoie l'état complet : l'extension et les notes ne sont pas remis à zéro (mobile)", async () => {
    // Le stepper +/− en ligne n'existe que dans la liste mobile (Lot 5) : la vue
    // tableau bureau (Lot 5bis, étape 8) le remplace par le double-clic sur « Ex. »
    // et la feuille « Modifier une entrée », cf. `stock.test.tsx`, describe
    // « collection, vue tableau bureau ».
    setViewportWidth(390);
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

describe("collection : vue tableau bureau (Lot 5bis, étape 8)", () => {
  it(
    "bureau (jsdom ≥ 1024px par défaut) : vue tableau plutôt que la liste, triée par nom " +
      "par défaut, et trie par clic sur l'en-tête",
    async () => {
      const { runtime } = await renderApp({ online: false, hash: "#/collection", catalog: true });
      await runtime.actions.saveStock({ cardId: 1, languageCode: "FR", cardSetId: 9, quantityOwned: 2 }); // Élan vital, bibliothèque
      await runtime.actions.saveStock({ cardId: 3, languageCode: "EN", cardSetId: 9, quantityOwned: 5 }); // Theo Bell, crypte
      await waitFor(() => expect(screen.getAllByTestId("stock-entry")).toHaveLength(2));

      expect(screen.queryByTestId("stock-list")).not.toBeInTheDocument();
      expect(screen.getByTestId("stock-table")).toBeInTheDocument();

      const namesInOrder = () => screen.getAllByTestId("stock-entry-name").map((el) => el.textContent);
      // Comparaison par unités de code, comme le reste de l'app (§11) : « T » précède « É ».
      const initial = namesInOrder();
      expect(initial).toEqual(["Theo Bell", "Élan vital"]);

      // Reclic sur la colonne déjà active (Nom) : inverse la direction.
      fireEvent.click(screen.getByTestId("stock-table-sort-name"));
      await waitFor(() => expect(namesInOrder()).toEqual([...initial].reverse()));

      // Tri par une autre colonne (Ex., numérique) : 2 < 5.
      fireEvent.click(screen.getByTestId("stock-table-sort-quantity"));
      await waitFor(() => expect(namesInOrder()).toEqual(["Élan vital", "Theo Bell"]));
    },
  );

  it("double-clic sur Ex. ouvre l'édition en place ; ↵ valide (saveStock), Échap annule sans écrire", async () => {
    const { runtime } = await renderApp({ online: false, hash: "#/collection", catalog: true });
    await runtime.actions.saveStock({
      cardId: 1,
      languageCode: "FR",
      cardSetId: 9,
      quantityOwned: 2,
      notes: "foil",
    });
    const entry = await screen.findByTestId("stock-entry");

    fireEvent.doubleClick(within(entry).getByTestId("stock-entry-quantity-cell"));
    const input = within(entry).getByTestId("stock-table-qty-input");
    expect(input).toHaveValue(2);
    fireEvent.change(input, { target: { value: "5" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect(within(entry).getByTestId("stock-entry-quantity")).toHaveTextContent("5"),
    );
    expect(within(entry).queryByTestId("stock-table-qty-input")).not.toBeInTheDocument();
    const queued = await runtime.outbox.list();
    expect(queued[queued.length - 1].operation).toMatchObject({
      type: "stock.upsert",
      // L'état complet part avec l'écriture : les notes ne sont pas remises à zéro (§11).
      data: { card_id: 1, language_code: "FR", card_set_id: 9, quantity_owned: 5, notes: "foil" },
    });

    // Réouverture : Échap annule sans écrire.
    fireEvent.doubleClick(within(entry).getByTestId("stock-entry-quantity-cell"));
    const secondInput = within(entry).getByTestId("stock-table-qty-input");
    fireEvent.change(secondInput, { target: { value: "9" } });
    fireEvent.keyDown(secondInput, { key: "Escape" });

    expect(within(entry).queryByTestId("stock-table-qty-input")).not.toBeInTheDocument();
    expect(within(entry).getByTestId("stock-entry-quantity")).toHaveTextContent("5");
    expect(await runtime.outbox.list()).toHaveLength(2); // pas d'opération de plus que la première écriture
  });

  it("aperçu flottant de l'image après 300ms de survol du nom, masqué immédiatement à la sortie", async () => {
    const { runtime } = await renderApp({ online: false, hash: "#/collection", catalog: true });
    await runtime.actions.saveStock({ cardId: 1, languageCode: "FR", cardSetId: 9, quantityOwned: 1 });
    const entry = await screen.findByTestId("stock-entry");
    const nameCell = within(entry).getByTestId("stock-entry-name").closest('[role="cell"]') as HTMLElement;

    fireEvent.mouseEnter(nameCell);
    expect(within(entry).queryByTestId("stock-table-preview")).not.toBeInTheDocument();
    await waitFor(
      () => expect(within(entry).getByTestId("stock-table-preview")).toBeInTheDocument(),
      { timeout: 1000 },
    );

    fireEvent.mouseLeave(nameCell);
    expect(within(entry).queryByTestId("stock-table-preview")).not.toBeInTheDocument();
  });

  it("↵ sur le nom d'une ligne (focus clavier) ouvre « Modifier une entrée » (d03)", async () => {
    const { runtime } = await renderApp({ online: false, hash: "#/collection", catalog: true });
    await runtime.actions.saveStock({ cardId: 1, languageCode: "FR", cardSetId: 9, quantityOwned: 1 });
    const entry = await screen.findByTestId("stock-entry");
    const nameButton = within(entry).getByRole("button", { name: "Modifier Élan vital (FR)" });

    nameButton.focus();
    fireEvent.keyDown(nameButton, { key: "Enter" });

    // En édition bureau, le titre (et son testid) vit dans `SheetHeader`, hors du
    // `<form>` (cf. le commentaire équivalent plus haut, describe « saisie hors ligne »).
    await screen.findByTestId("stock-form");
    expect(screen.getByTestId("stock-form-card")).toHaveTextContent("Élan vital");
  });

  it("colonne Decks : nombre de decks utilisant la carte, calcul local (aucun appel réseau)", async () => {
    const { runtime } = await renderApp({ online: false, hash: "#/collection", catalog: true });
    await runtime.actions.saveStock({ cardId: 1, languageCode: "FR", cardSetId: 9, quantityOwned: 1 });
    await runtime.actions.saveStock({ cardId: 3, languageCode: "EN", cardSetId: 9, quantityOwned: 1 });
    const { key } = await runtime.actions.createDeck({ name: "Malkavien", proxyAllowed: true });
    await runtime.actions.saveDeckCard(key, {
      cardId: 1,
      languageCode: "FR",
      cardSetId: 9,
      quantity: 1,
      proxyQuantity: 0,
    });

    await waitFor(() => expect(screen.getAllByTestId("stock-entry")).toHaveLength(2));
    const rows = screen.getAllByTestId("stock-entry");
    const forCard = (id: string) => rows.find((row) => row.getAttribute("data-card-id") === id)!;
    await waitFor(() =>
      expect(within(forCard("1")).getByTestId("stock-entry-decks")).toHaveTextContent("1"),
    );
    expect(within(forCard("3")).getByTestId("stock-entry-decks")).toHaveTextContent("0");
  });

  it("clan et capacité affichés pour une carte de crypte, tirets pour une carte de bibliothèque", async () => {
    const { runtime } = await renderApp({ online: false, hash: "#/collection", catalog: true });
    const card = await runtime.db.cards.get(3); // Theo Bell, crypte
    await runtime.db.cards.put({ ...card!, clanName: "Toreador", capacity: 7 });
    await runtime.actions.saveStock({ cardId: 1, languageCode: "FR", cardSetId: 9, quantityOwned: 1 });
    await runtime.actions.saveStock({ cardId: 3, languageCode: "EN", cardSetId: 9, quantityOwned: 1 });

    await waitFor(() => expect(screen.getAllByTestId("stock-entry")).toHaveLength(2));
    const rows = screen.getAllByTestId("stock-entry");
    const forCard = (id: string) => rows.find((row) => row.getAttribute("data-card-id") === id)!;
    // La lecture du clan/capacité (`useCardsById`) est une lecture IndexedDB
    // asynchrone distincte de `entries` : attendre qu'elle soit à jour.
    await waitFor(() => expect(forCard("3")).toHaveTextContent("Toreador"));
    expect(forCard("3")).toHaveTextContent("7");
    // La bibliothèque n'a ni clan ni capacité dans le miroir (§ plan Lot 5bis) : tirets.
    expect(forCard("1").textContent).toMatch(/—.*—/);
  });

  it(
    "raccourcis V/N/F ouvrent Verser un produit / Ajouter une carte / Filtrer le tableau, " +
      "désactivés derrière une feuille déjà ouverte",
    async () => {
      await renderApp({ online: false, hash: "#/collection", catalog: true });
      await screen.findByTestId("stock-page");

      fireEvent.keyDown(document, { key: "n" });
      await screen.findByTestId("stock-form-sheet");
      fireEvent.keyDown(document, { key: "Escape" });
      await waitFor(() => expect(screen.queryByTestId("stock-form-sheet")).not.toBeInTheDocument());

      fireEvent.keyDown(document, { key: "v" });
      await screen.findByTestId("bundle-deposit");
      fireEvent.keyDown(document, { key: "Escape" });
      await waitFor(() => expect(screen.queryByTestId("bundle-deposit")).not.toBeInTheDocument());

      fireEvent.keyDown(document, { key: "f" });
      await screen.findByTestId("stock-filters-sheet");

      // `N` ne doit rien ouvrir derrière la feuille de filtres déjà ouverte.
      fireEvent.keyDown(document, { key: "n" });
      expect(screen.queryByTestId("stock-form-sheet")).not.toBeInTheDocument();
    },
  );

  it("en-tête bureau : boutons d'en-tête, onglets avec compteurs, sélecteur de langue inline", async () => {
    const { runtime } = await renderApp({ online: false, hash: "#/collection", catalog: true });
    await runtime.actions.saveStock({ cardId: 1, languageCode: "FR", cardSetId: 9, quantityOwned: 1 }); // bibliothèque, possédée
    await runtime.actions.saveStock({ cardId: 3, languageCode: "EN", cardSetId: 9, quantityOwned: 0 }); // crypte, proxy pur

    await waitFor(() => expect(screen.getAllByTestId("stock-entry")).toHaveLength(2));
    expect(screen.getByTestId("stock-add-desktop")).toBeInTheDocument();
    expect(screen.getByTestId("bundle-open-desktop")).toBeInTheDocument();
    expect(screen.getByTestId("stock-language-select-desktop")).toBeInTheDocument();

    expect(screen.getByTestId("stock-tab-count-all")).toHaveTextContent("2");
    expect(screen.getByTestId("stock-tab-count-crypt")).toHaveTextContent("1");
    expect(screen.getByTestId("stock-tab-count-library")).toHaveTextContent("1");
    expect(screen.getByTestId("stock-tab-count-proxy")).toHaveTextContent("1");

    fireEvent.click(screen.getByTestId("stock-add-desktop"));
    await screen.findByTestId("stock-form-sheet");
  });

  it("aucune régression mobile : liste `<ul>`, pas de tableau ni d'ajouts d'en-tête bureau (Lot 5)", async () => {
    setViewportWidth(390);
    const { runtime } = await renderApp({ online: false, hash: "#/collection", catalog: true });
    await runtime.actions.saveStock({ cardId: 1, languageCode: "FR", cardSetId: 9, quantityOwned: 1 });

    await screen.findByTestId("stock-entry");
    expect(screen.getByTestId("stock-list")).toBeInTheDocument();
    expect(screen.queryByTestId("stock-table")).not.toBeInTheDocument();
    expect(screen.queryByTestId("stock-add-desktop")).not.toBeInTheDocument();
    expect(screen.queryByTestId("bundle-open-desktop")).not.toBeInTheDocument();
    expect(screen.queryByTestId("stock-language-select-desktop")).not.toBeInTheDocument();
    // Adapté au Lot 5c (étape 3) : les compteurs d'onglets sont désormais aussi visibles en
    // mobile (écart n°4 de l'audit) ; ce test affirmait leur absence.
    expect(screen.getByTestId("stock-tab-count-all")).toBeInTheDocument();
  });
});

describe("collection mobile : méta, compteurs et tri (Lot 5c, étape 3)", () => {
  async function mobileWithCards() {
    setViewportWidth(390);
    const app = await renderApp({ online: false, hash: "#/collection", catalog: true });
    const theo = await app.runtime.db.cards.get(3);
    await app.runtime.db.cards.put({ ...theo!, clanName: "Brujah", capacity: 8 });
    await app.runtime.actions.saveStock({ cardId: 1, languageCode: "FR", cardSetId: 9, quantityOwned: 2 }); // Élan vital
    await app.runtime.actions.saveStock({ cardId: 3, languageCode: "EN", cardSetId: 9, quantityOwned: 5 }); // Theo Bell
    const first = await app.runtime.actions.createDeck({ name: "A", proxyAllowed: true });
    const second = await app.runtime.actions.createDeck({ name: "B", proxyAllowed: true });
    for (const deck of [first.key, second.key]) {
      await app.runtime.actions.saveDeckCard(deck, {
        cardId: 3,
        languageCode: "EN",
        cardSetId: 9,
        quantity: 1,
        proxyQuantity: 0,
      });
    }
    await waitFor(() => expect(screen.getAllByTestId("stock-entry")).toHaveLength(2));
    return app;
  }

  it("méta de ligne : catégorie, clan, capacité, langue, extension et nombre de decks", async () => {
    await mobileWithCards();
    const rows = screen.getAllByTestId("stock-entry");
    const theo = rows.find((row) => row.getAttribute("data-card-id") === "3")!;
    await waitFor(() =>
      expect(theo.querySelector(".row__meta")).toHaveTextContent(
        "Crypte · Brujah · cap. 8 · EN · TEST — Extension de test · dans 2 decks",
      ),
    );
    // Carte de bibliothèque sans deck : ni clan, ni capacité, ni « dans N decks ».
    const elan = rows.find((row) => row.getAttribute("data-card-id") === "1")!;
    expect(within(elan).queryByTestId("stock-entry-clan")).not.toBeInTheDocument();
    expect(within(elan).queryByTestId("stock-entry-capacity")).not.toBeInTheDocument();
    expect(within(elan).queryByTestId("stock-entry-decks")).not.toBeInTheDocument();
  });

  it("compteurs d'onglets et total d'exemplaires visibles", async () => {
    await mobileWithCards();
    expect(screen.getByTestId("stock-tab-count-all")).toHaveTextContent("2");
    expect(screen.getByTestId("stock-tab-count-crypt")).toHaveTextContent("1");
    expect(screen.getByTestId("stock-tab-count-library")).toHaveTextContent("1");
    expect(screen.getByTestId("stock-total-copies")).toHaveTextContent("7 exemplaires");
  });

  it("la feuille de filtres trie la liste (critère + sens), comme les en-têtes du tableau bureau", async () => {
    await mobileWithCards();
    const names = () => screen.getAllByTestId("stock-entry-name").map((el) => el.textContent);
    expect(names()).toEqual(["Theo Bell", "Élan vital"]); // nom croissant, par unités de code

    fireEvent.click(screen.getByTestId("stock-filters-open"));
    const sheet = await screen.findByTestId("stock-filters-sheet");
    fireEvent.change(within(sheet).getByTestId("stock-sort-column"), { target: { value: "quantity" } });
    await waitFor(() => expect(names()).toEqual(["Élan vital", "Theo Bell"])); // 2 puis 5

    fireEvent.click(within(within(sheet).getByTestId("stock-sort-dir")).getByLabelText("Décroissant"));
    await waitFor(() => expect(names()).toEqual(["Theo Bell", "Élan vital"]));
  });

  it("le tri choisi dans la feuille s'applique aussi au tableau bureau (état partagé)", async () => {
    setViewportWidth(1024);
    const app = await renderApp({ online: false, hash: "#/collection", catalog: true });
    await app.runtime.actions.saveStock({ cardId: 1, languageCode: "FR", cardSetId: 9, quantityOwned: 2 });
    await app.runtime.actions.saveStock({ cardId: 3, languageCode: "EN", cardSetId: 9, quantityOwned: 5 });
    await waitFor(() => expect(screen.getAllByTestId("stock-entry")).toHaveLength(2));

    fireEvent.keyDown(document, { key: "f" });
    const sheet = await screen.findByTestId("stock-filters-sheet");
    fireEvent.change(within(sheet).getByTestId("stock-sort-column"), { target: { value: "quantity" } });
    expect(screen.getByTestId("stock-table-sort-quantity")).toHaveAttribute("aria-sort", "ascending");
    await waitFor(() =>
      expect(screen.getAllByTestId("stock-entry-name").map((el) => el.textContent)).toEqual([
        "Élan vital",
        "Theo Bell",
      ]),
    );
  });
});

describe("collection : tableau bureau au clavier (Lot 5c, étape 7)", () => {
  async function oneRow() {
    const { runtime } = await renderApp({ online: false, hash: "#/collection", catalog: true });
    await runtime.actions.saveStock({ cardId: 1, languageCode: "FR", cardSetId: 9, quantityOwned: 2 });
    const entry = await screen.findByTestId("stock-entry");
    return { runtime, entry };
  }

  it("la cellule « Ex. » prend le focus au Tab ; ↵ ouvre l'édition, ↵ valide, le focus revient à la cellule", async () => {
    const { runtime, entry } = await oneRow();
    const cell = within(entry).getByTestId("stock-entry-quantity-cell");
    expect(cell).toHaveAttribute("tabindex", "0");

    cell.focus();
    fireEvent.keyDown(cell, { key: "Enter" });
    const input = within(entry).getByTestId("stock-table-qty-input");
    expect(input).toHaveValue(2);

    fireEvent.change(input, { target: { value: "4" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(within(entry).getByTestId("stock-entry-quantity")).toHaveTextContent("4"));
    expect(within(entry).queryByTestId("stock-table-qty-input")).not.toBeInTheDocument();
    await waitFor(() => expect(cell).toHaveFocus());
    expect((await runtime.outbox.list()).at(-1)!.operation).toMatchObject({
      type: "stock.upsert",
      data: { quantity_owned: 4 },
    });
  });

  it("Échap annule sans écrire et rend le focus à la cellule ; ↵ dans le champ ne rouvre rien", async () => {
    const { runtime, entry } = await oneRow();
    const cell = within(entry).getByTestId("stock-entry-quantity-cell");

    cell.focus();
    fireEvent.keyDown(cell, { key: "Enter" });
    const input = within(entry).getByTestId("stock-table-qty-input");
    fireEvent.change(input, { target: { value: "9" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(within(entry).queryByTestId("stock-table-qty-input")).not.toBeInTheDocument();
    expect(within(entry).getByTestId("stock-entry-quantity")).toHaveTextContent("2");
    await waitFor(() => expect(cell).toHaveFocus());
    expect(await runtime.outbox.list()).toHaveLength(1); // seule la saisie initiale
  });

  it("le double-clic reste un moyen d'éditer", async () => {
    const { entry } = await oneRow();
    fireEvent.doubleClick(within(entry).getByTestId("stock-entry-quantity-cell"));
    expect(within(entry).getByTestId("stock-table-qty-input")).toBeInTheDocument();
  });

  it("l'aperçu d'image apparaît au focus du nom (sans souris) et part au blur", async () => {
    const { entry } = await oneRow();
    const nameButton = within(entry).getByRole("button", { name: "Modifier Élan vital (FR)" });
    expect(within(entry).queryByTestId("stock-table-preview")).not.toBeInTheDocument();

    act(() => nameButton.focus());
    expect(await within(entry).findByTestId("stock-table-preview")).toBeInTheDocument();

    act(() => nameButton.blur());
    expect(within(entry).queryByTestId("stock-table-preview")).not.toBeInTheDocument();
  });
});
