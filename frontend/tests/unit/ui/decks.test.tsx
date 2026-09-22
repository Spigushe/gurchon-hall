import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { hrefFor } from "../../../src/app/routes";
import type { DeckKey } from "../../../src/offline/vtes";
import { renderApp, type AppOptions } from "./harness";

type App = Awaited<ReturnType<typeof renderApp>>;

const openDeck = (key: DeckKey) =>
  act(() => {
    window.location.hash = hrefFor({ name: "deck", key });
  });

/** Crée un deck via la couche offline et l'ouvre (hors ligne : il n'a pas encore d'identifiant). */
async function withDeck(options: AppOptions = {}, name = "Malkavien") {
  const app = await renderApp({ online: false, catalog: true, ...options });
  const { key } = await app.runtime.actions.createDeck({ name });
  openDeck(key);
  await screen.findByTestId("deck-page");
  return { ...app, key };
}

/** Un deck déjà connu du serveur (identifiant attribué), miroir rafraîchi. */
async function withSyncedDeck(app: App, name = "Malkavien") {
  const { key } = await app.runtime.actions.createDeck({ name });
  await act(async () => {
    await app.runtime.engine.flush();
    await app.runtime.refresh();
  });
  openDeck(key);
  await screen.findByTestId("deck-page");
  return key;
}

const LEGALITY = {
  deck_id: 1,
  evaluated_on: "2026-09-21",
  crypt_count: 11,
  library_count: 60,
  crypt_minimum: 12,
  library_minimum: 60,
  library_maximum: 90,
  crypt_groups: ["G2"],
  banned_cards: [],
  not_yet_legal_cards: [],
  is_legal: false,
  issues: ["La crypte compte 11 cartes (minimum 12)."],
};

describe("decks : liste et création", () => {
  it("crée un deck hors ligne, ouvre son détail sous une clé ref:<uuid> et le met en file", async () => {
    const { runtime, server } = await renderApp({ online: false, hash: "#/decks" });
    await screen.findByTestId("decks-page");
    expect(await screen.findByTestId("decks-empty")).toBeInTheDocument();

    const form = screen.getByTestId("deck-form");
    fireEvent.change(within(form).getByLabelText("Nom du deck"), { target: { value: "  Malkavien 2022 " } });
    fireEvent.click(within(form).getByTestId("deck-form-submit"));

    const page = await screen.findByTestId("deck-page");
    expect(page.getAttribute("data-deck-key")).toMatch(/^ref:[0-9a-f-]{36}$/);
    expect(screen.getByTestId("deck-title")).toHaveTextContent("Malkavien 2022");
    expect(screen.getByTestId("deck-discriminator")).toHaveTextContent("numéro à l'attribution");
    expect(screen.getByTestId("deck-status")).toHaveAttribute("data-status", "draft");
    expect(screen.getByTestId("pending-badge")).toBeInTheDocument();

    const queued = await runtime.outbox.list();
    expect(queued).toHaveLength(1);
    expect(queued[0].operation).toMatchObject({
      type: "deck.create",
      data: { name: "Malkavien 2022" },
    });
    expect(server.state.requests).toEqual([]);
    // Le hash, jamais un chemin : rien ne ressemble à une ressource de l'API.
    expect(window.location.pathname).toBe("/");
    expect(window.location.hash).toMatch(/^#\/decks\/ref%3A/);
  });

  it("ne crée qu'un deck quand on valide deux fois de suite, et refuse un nom vide", async () => {
    const { runtime } = await renderApp({ online: false, hash: "#/decks" });
    const form = await screen.findByTestId("deck-form");

    fireEvent.click(within(form).getByTestId("deck-form-submit"));
    expect(await screen.findByTestId("deck-form-error")).toHaveTextContent("obligatoire");
    expect(await runtime.outbox.list()).toHaveLength(0);

    fireEvent.change(within(form).getByLabelText("Nom du deck"), { target: { value: "Gangrel" } });
    await act(async () => {
      fireEvent.submit(form);
      fireEvent.submit(form);
    });
    await screen.findByTestId("deck-page");
    expect(await runtime.outbox.list()).toHaveLength(1);
  });

  it("liste les decks, filtre par nom et sépare actifs et archivés", async () => {
    const { runtime } = await renderApp({ online: false, hash: "#/decks" });
    const a = await runtime.actions.createDeck({ name: "Ventrue" });
    await runtime.actions.createDeck({ name: "Toreador" });
    await runtime.actions.archiveDeck(a.key);

    await waitFor(() => expect(screen.getAllByTestId("deck-item")).toHaveLength(1));
    expect(screen.getByTestId("deck-item")).toHaveTextContent("Toreador");

    fireEvent.click(screen.getByLabelText("Archivés"));
    await waitFor(() => expect(screen.getByTestId("deck-item")).toHaveTextContent("Ventrue"));
    expect(screen.getByTestId("deck-item")).toHaveTextContent("Archivé");

    fireEvent.click(screen.getByLabelText("Tous"));
    await waitFor(() => expect(screen.getAllByTestId("deck-item")).toHaveLength(2));
    fireEvent.change(screen.getByLabelText("Filtrer par nom"), { target: { value: "TOREADOR" } });
    await waitFor(() => expect(screen.getAllByTestId("deck-item")).toHaveLength(1));
  });

  it("route par deck.key : un lien de la liste ouvre le détail, une clé inconnue est introuvable", async () => {
    const { runtime } = await renderApp({ online: false, hash: "#/decks" });
    const { key } = await runtime.actions.createDeck({ name: "Brujah" });
    fireEvent.click(await screen.findByTestId("deck-link"));
    expect((await screen.findByTestId("deck-page")).getAttribute("data-deck-key")).toBe(key);

    act(() => {
      window.location.hash = hrefFor({ name: "deck", key: "id:999" });
    });
    expect(await screen.findByTestId("deck-not-found")).toBeInTheDocument();
  });

  it("garde la même clé (et la même page) après la synchronisation, et affiche le numéro attribué", async () => {
    const app = await renderApp({ online: false, catalog: true });
    const { key } = await app.runtime.actions.createDeck({ name: "Nosferatu" });
    openDeck(key);
    await screen.findByTestId("deck-page");
    expect(screen.getByTestId("deck-discriminator")).toHaveTextContent("numéro à l'attribution");

    await act(async () => {
      // Réseau de retour : rejeu de la file, puis relecture des miroirs.
      Object.defineProperty(window.navigator, "onLine", { configurable: true, value: true });
      window.dispatchEvent(new Event("online"));
      await app.runtime.engine.whenIdle();
      await app.runtime.refresh();
    });

    await waitFor(() =>
      expect(screen.getByTestId("deck-discriminator")).toHaveTextContent(/^#\d{4}$/),
    );
    expect(screen.getByTestId("deck-page").getAttribute("data-deck-key")).toBe(key);
    expect(screen.queryByTestId("pending-badge")).not.toBeInTheDocument();
  });

  it("ne perd pas le deck entre le verdict du serveur et le rafraîchissement des miroirs", async () => {
    const app = await renderApp({ online: false, catalog: true });
    const { key } = await app.runtime.actions.createDeck({ name: "Tzimisce" });
    openDeck(key);
    await screen.findByTestId("deck-page");

    // « Introuvable » ne doit s'afficher à aucun moment, même une fraction de seconde.
    let flashed = false;
    const observer = new MutationObserver(() => {
      if (screen.queryByTestId("deck-not-found")) flashed = true;
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // Verdict reçu (l'opération a quitté la file) ; aucune relecture du serveur.
    await act(async () => {
      Object.defineProperty(window.navigator, "onLine", { configurable: true, value: true });
      await app.runtime.engine.flush();
    });
    expect(await app.runtime.outbox.list()).toEqual([]);
    expect(await app.runtime.db.decks.count()).toBe(0);

    // Le serveur l'a confirmé : la marque « en attente » tombe, la page reste.
    await waitFor(() => expect(screen.queryByTestId("pending-badge")).not.toBeInTheDocument());
    observer.disconnect();
    expect(flashed).toBe(false);
    expect(screen.queryByTestId("deck-not-found")).not.toBeInTheDocument();
    expect(screen.getByTestId("deck-page").getAttribute("data-deck-key")).toBe(key);
    expect(screen.getByTestId("deck-title")).toHaveTextContent("Tzimisce");
  });
});

describe("decks : composition", () => {
  it("ajoute une carte de la collection au deck, hors ligne, par la file", async () => {
    const { runtime, server, key } = await withDeck();
    await runtime.actions.saveStock({ cardId: 1, languageCode: "FR", quantityOwned: 3, proxyAllowed: true });
    server.state.requests.length = 0;

    const form = screen.getByTestId("deck-card-form");
    fireEvent.change(within(form).getByTestId("deck-card-search"), { target: { value: "ELAN" } });
    fireEvent.click(await within(form).findByTestId("deck-card-option"));
    expect(within(form).getByTestId("deck-card-form-chosen")).toHaveTextContent("possédée en 3 exemplaires");
    fireEvent.change(within(form).getByLabelText("Quantité dans le deck"), { target: { value: "2" } });
    fireEvent.change(within(form).getByLabelText("Dont proxies"), { target: { value: "1" } });
    fireEvent.click(within(form).getByTestId("deck-card-form-submit"));

    const line = await screen.findByTestId("deck-card");
    expect(line).toHaveAttribute("data-quantity", "2");
    expect(line).toHaveAttribute("data-proxy-quantity", "1");
    expect(within(line).getByTestId("pending-badge")).toBeInTheDocument();

    const queued = await runtime.outbox.list();
    const last = queued[queued.length - 1].operation;
    expect(last).toMatchObject({
      type: "deck_card.upsert",
      deck: { client_ref: key.slice(4) },
      data: { card_id: 1, language_code: "FR", quantity: 2, proxy_quantity: 1 },
    });
    expect(server.state.requests).toEqual([]);
  });

  it("propose d'ajouter d'abord la carte à la collection quand elle n'y est pas", async () => {
    await withDeck();
    const form = screen.getByTestId("deck-card-form");
    fireEvent.change(within(form).getByTestId("deck-card-search"), { target: { value: "elan" } });
    expect(await within(form).findByTestId("deck-card-no-result")).toHaveTextContent(
      "doit être possédée",
    );
    expect(within(form).getByRole("link", { name: /collection/i })).toHaveAttribute(
      "href",
      "#/collection",
    );
  });

  it("modifie la quantité d'une ligne sans perdre ses proxies, et retire la ligne", async () => {
    const { runtime } = await withDeck();
    const key = screen.getByTestId("deck-page").getAttribute("data-deck-key") as DeckKey;
    await runtime.actions.saveStock({ cardId: 1, languageCode: "FR", quantityOwned: 4, proxyAllowed: true });
    await runtime.actions.saveDeckCard(key, { cardId: 1, languageCode: "FR", quantity: 2, proxyQuantity: 1 });
    const line = await screen.findByTestId("deck-card");

    fireEvent.click(within(line).getByRole("button", { name: /Ajouter un exemplaire de Élan vital/ }));
    await waitFor(() => expect(screen.getByTestId("deck-card-quantity")).toHaveTextContent("3"));
    const ops = await runtime.outbox.list();
    expect(ops[ops.length - 1].operation).toMatchObject({
      type: "deck_card.upsert",
      data: { quantity: 3, proxy_quantity: 1 },
    });

    fireEvent.click(within(screen.getByTestId("deck-card")).getByTestId("deck-card-remove"));
    await waitFor(() => expect(screen.getByTestId("deck-cards-empty")).toBeInTheDocument());
    const after = await runtime.outbox.list();
    expect(after[after.length - 1].operation.type).toBe("deck_card.delete");
  });
});

describe("decks : cycle de vie", () => {
  it("archive (composition verrouillée), désarchive, puis supprime un deck archivé après confirmation", async () => {
    const { runtime, key } = await withDeck();
    await runtime.actions.saveStock({ cardId: 1, languageCode: "FR", quantityOwned: 2 });
    await runtime.actions.saveDeckCard(key, { cardId: 1, languageCode: "FR", quantity: 1 });
    await screen.findByTestId("deck-card");
    expect(screen.queryByTestId("deck-delete")).not.toBeInTheDocument(); // pas de suppression d'un deck vivant

    fireEvent.click(screen.getByTestId("deck-archive"));
    expect(await screen.findByTestId("deck-archived-note")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Ajouter un exemplaire de Élan vital/ })).toBeDisabled();
    expect(screen.getByTestId("deck-status-toggle")).toBeDisabled();
    expect(screen.getByTestId("deck-edit")).toBeDisabled();
    expect(screen.queryByTestId("deck-card-form")).not.toBeInTheDocument();
    expect(screen.getByTestId("deck-unarchive")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("deck-unarchive"));
    await waitFor(() => expect(screen.queryByTestId("deck-archived-note")).not.toBeInTheDocument());
    fireEvent.click(screen.getByTestId("deck-archive"));
    await screen.findByTestId("deck-archived-note");

    fireEvent.click(screen.getByTestId("deck-delete"));
    expect(
      (await runtime.outbox.list()).some((entry) => entry.operation.type === "deck.delete"),
    ).toBe(false);
    fireEvent.click(screen.getByTestId("deck-delete-confirm"));

    await waitFor(() => expect(window.location.hash).toBe("#/decks"));
    const types = (await runtime.outbox.list()).map((entry) => entry.operation.type);
    expect(types[types.length - 1]).toBe("deck.delete");
  });

  it("renomme et change le statut par la file, en n'envoyant que les champs modifiés", async () => {
    const { runtime } = await withDeck();
    fireEvent.click(screen.getByTestId("deck-edit"));
    const form = await screen.findByTestId("deck-edit-form");
    fireEvent.change(within(form).getByLabelText("Nom du deck"), { target: { value: "Malkavien 2023" } });
    fireEvent.click(within(form).getByTestId("deck-edit-submit"));
    await waitFor(() => expect(screen.getByTestId("deck-title")).toHaveTextContent("Malkavien 2023"));

    fireEvent.click(screen.getByTestId("deck-status-toggle"));
    await waitFor(() => expect(screen.getByTestId("deck-status")).toHaveAttribute("data-status", "active"));

    const ops = (await runtime.outbox.list()).map((entry) => entry.operation);
    expect(ops[1]).toMatchObject({ type: "deck.update", data: { name: "Malkavien 2023" } });
    expect(ops[1]).not.toHaveProperty("data.archetype");
    expect(ops[2]).toMatchObject({ type: "deck.update", data: { status: "active" } });
  });
});

describe("decks : légalité", () => {
  it("affiche le verdict du serveur en ligne : effectifs, groupes et motifs en clair", async () => {
    const app = await renderApp({ online: true, catalog: true });
    await withSyncedDeck(app);
    app.ui.legality = { status: 200, body: LEGALITY };
    fireEvent.click(await screen.findByTestId("legality-refresh"));

    const verdict = await screen.findByTestId("legality-verdict");
    expect(within(verdict).getByTestId("legality-badge")).toHaveTextContent("Deck illégal");
    expect(within(verdict).getByTestId("legality-crypt")).toHaveTextContent("Crypte : 11 (minimum 12)");
    expect(within(verdict).getByTestId("legality-library")).toHaveTextContent("entre 60 et 90");
    expect(within(verdict).getByTestId("legality-issues")).toHaveTextContent("minimum 12");
    expect(verdict).toHaveTextContent("G2");
    // Un brouillon n'a pas à être légal : pas d'alerte.
    expect(screen.queryByTestId("legality-active-illegal")).not.toBeInTheDocument();
  });

  it("dit clairement que le verdict est indisponible hors ligne", async () => {
    const app = await renderApp({ online: true, catalog: true });
    await withSyncedDeck(app);
    act(() => {
      Object.defineProperty(window.navigator, "onLine", { configurable: true, value: false });
      window.dispatchEvent(new Event("offline"));
    });

    expect(await screen.findByTestId("legality-unavailable")).toHaveTextContent(
      "indisponible hors ligne",
    );
    expect(screen.queryByTestId("legality-refresh")).not.toBeInTheDocument();
    expect(screen.queryByTestId("legality-verdict")).not.toBeInTheDocument();
  });

  it("dit que le verdict n'existe pas encore pour un deck créé hors ligne", async () => {
    await withDeck();
    expect(screen.getByTestId("legality-unavailable")).toHaveTextContent(
      "n'existe pas encore côté serveur",
    );
  });

  it("signale un deck actif devenu illégal", async () => {
    const app = await renderApp({ online: true, catalog: true });
    const key = await withSyncedDeck(app);
    app.ui.legality = { status: 200, body: LEGALITY };
    // Le serveur est momentanément indisponible : le passage en actif reste en file
    // (et la page l'affiche déjà « actif » : elle lit l'instantané plus la file).
    app.server.next.status = 503;
    await act(async () => {
      await app.runtime.actions.updateDeck(key, { status: "active" });
      await app.runtime.engine.whenIdle();
    });

    expect(await screen.findByTestId("legality-active-illegal")).toHaveTextContent(
      "actif mais n'est plus légal",
    );
    // Et la page prévient que le verdict porte sur la version du serveur.
    expect(screen.getByTestId("legality-stale")).toBeInTheDocument();
  });

  it("affiche l'échec du calcul (serveur en erreur ou injoignable) au lieu de se taire", async () => {
    const app = await renderApp({ online: true, catalog: true });
    await withSyncedDeck(app);

    app.ui.legality = { status: 409, body: { detail: "Deck supprimé : composition figée." } };
    fireEvent.click(await screen.findByTestId("legality-refresh"));
    expect(await screen.findByTestId("legality-error")).toHaveTextContent("Deck supprimé");

    app.ui.legality = { status: 0, body: null };
    fireEvent.click(await screen.findByTestId("legality-refresh"));
    await waitFor(() =>
      expect(screen.getByTestId("legality-error")).toHaveTextContent("injoignable"),
    );
  });
});
