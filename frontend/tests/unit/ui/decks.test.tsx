import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { hrefFor } from "../../../src/app/routes";
import type { DeckKey } from "../../../src/offline/vtes";
import { renderApp, setOnline, type AppOptions } from "./harness";

type App = Awaited<ReturnType<typeof renderApp>>;

/**
 * jsdom vaut 1024 par défaut (bureau) : les tests qui veulent le mobile le
 * fixent explicitement, avant le rendu, et le remettent après coup (même
 * convention que `tests/unit/ui/home.test.tsx`, Lot 5bis étape 5).
 */
function setViewportWidth(width: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: width });
}

afterEach(() => {
  setViewportWidth(1024);
});

const openDeck = (key: DeckKey) =>
  act(() => {
    window.location.hash = hrefFor({ name: "deck", key });
  });

/** Crée un deck via la couche offline et l'ouvre (hors ligne : il n'a pas encore d'identifiant). */
async function withDeck(
  options: AppOptions = {},
  name = "Malkavien",
  proxyAllowed = false,
) {
  const app = await renderApp({ online: false, catalog: true, ...options });
  const { key } = await app.runtime.actions.createDeck({ name, proxyAllowed });
  openDeck(key);
  await screen.findByTestId("deck-page");
  return { ...app, key };
}

/** Ouvre la feuille « Ajouter » depuis le détail d'un deck déjà affiché. */
async function openAddCardSheet() {
  fireEvent.click(await screen.findByTestId("deck-card-add"));
  return screen.findByTestId("deck-card-form");
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

    fireEvent.click(await screen.findByTestId("deck-add"));
    const form = await screen.findByTestId("deck-form");
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

  it("autorise les proxies à la création, et peut désactiver l'autorisation à l'édition (Lot 4)", async () => {
    const { runtime } = await renderApp({ online: false, hash: "#/decks" });
    await screen.findByTestId("decks-page");

    fireEvent.click(await screen.findByTestId("deck-add"));
    const form = await screen.findByTestId("deck-form");
    fireEvent.change(within(form).getByLabelText("Nom du deck"), { target: { value: "Gangrel" } });
    fireEvent.click(within(form).getByTestId("deck-form-proxy-allowed"));
    fireEvent.click(within(form).getByTestId("deck-form-submit"));

    await screen.findByTestId("deck-page");
    expect(screen.getByTestId("deck-proxy-allowed")).toBeInTheDocument();
    const created = await runtime.outbox.list();
    expect(created[0].operation).toMatchObject({
      type: "deck.create",
      data: { name: "Gangrel", proxy_allowed: true },
    });

    fireEvent.click(screen.getByTestId("deck-edit"));
    const editForm = await screen.findByTestId("deck-edit-form");
    expect(within(editForm).getByTestId("deck-edit-proxy-allowed")).toBeChecked();
    fireEvent.click(within(editForm).getByTestId("deck-edit-proxy-allowed"));
    fireEvent.click(within(editForm).getByTestId("deck-edit-submit"));

    await waitFor(() => expect(screen.queryByTestId("deck-proxy-allowed")).not.toBeInTheDocument());
    const ops = (await runtime.outbox.list()).map((entry) => entry.operation);
    expect(ops[ops.length - 1]).toMatchObject({
      type: "deck.update",
      data: { proxy_allowed: false },
    });
    // Un renommage ou une note inchangés ne partent pas : seul le champ modifié.
    expect(ops[ops.length - 1]).not.toHaveProperty("data.name");
  });

  it("ne crée qu'un deck quand on valide deux fois de suite, et refuse un nom vide", async () => {
    const { runtime } = await renderApp({ online: false, hash: "#/decks" });
    fireEvent.click(await screen.findByTestId("deck-add"));
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
    expect(screen.getByTestId("deck-item")).toHaveTextContent(/archivé/);

    fireEvent.click(screen.getByLabelText("Tous"));
    await waitFor(() => expect(screen.getAllByTestId("deck-item")).toHaveLength(2));
    fireEvent.change(screen.getByLabelText("Filtrer par nom"), { target: { value: "TOREADOR" } });
    await waitFor(() => expect(screen.getAllByTestId("deck-item")).toHaveLength(1));
  });

  it("route par deck.key : un lien de la liste ouvre le détail, une clé inconnue est introuvable (mobile)", async () => {
    setViewportWidth(390);
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

describe("decks : maître/détail bureau (Lot 5bis, étape 6)", () => {
  it("sélectionne un deck dans la liste sans naviguer, et prévisualise le premier par défaut", async () => {
    const { runtime } = await renderApp({ online: false, hash: "#/decks" });
    await runtime.actions.createDeck({ name: "Assamite" });
    await runtime.actions.createDeck({ name: "Brujah" });

    await waitFor(() => expect(screen.getAllByTestId("deck-item")).toHaveLength(2));
    // La liste est triée par nom (comme le serveur) : « Assamite » d'abord.
    expect(await screen.findByTestId("decks-detail-title")).toHaveTextContent("Assamite");

    const items = screen.getAllByTestId("deck-select");
    fireEvent.click(items[1]); // « Brujah »
    expect(await screen.findByTestId("decks-detail-title")).toHaveTextContent("Brujah");
    // La sélection reste sur /decks : elle ne navigue jamais vers /decks/<clé>.
    expect(window.location.hash).toBe("#/decks");
    expect(screen.getAllByTestId("deck-item")[1]).toHaveAttribute("data-selected", "true");
    expect(screen.getAllByTestId("deck-item")[0]).toHaveAttribute("data-selected", "false");
  });

  it("ouvre le deckbuilder depuis le panneau de droite, au clic puis au raccourci Entrée", async () => {
    const { runtime } = await renderApp({ online: false, hash: "#/decks" });
    const { key } = await runtime.actions.createDeck({ name: "Gangrel" });
    await screen.findByTestId("decks-detail-title");

    fireEvent.click(screen.getByTestId("decks-detail-open"));
    expect((await screen.findByTestId("deck-page")).getAttribute("data-deck-key")).toBe(key);

    act(() => {
      window.location.hash = "#/decks";
    });
    await screen.findByTestId("decks-detail-title");
    fireEvent.keyDown(document, { key: "Enter" });
    expect((await screen.findByTestId("deck-page")).getAttribute("data-deck-key")).toBe(key);
  });

  it("le raccourci N ouvre « Nouveau deck », qui désactive Entrée tant qu'elle reste ouverte", async () => {
    const { runtime } = await renderApp({ online: false, hash: "#/decks" });
    await runtime.actions.createDeck({ name: "Lasombra" });
    await screen.findByTestId("decks-detail-title");

    fireEvent.keyDown(document, { key: "n" });
    await screen.findByTestId("deck-form-sheet");

    // Entrée ne doit jamais agir derrière une feuille ouverte (elle démonterait
    // la feuille en changeant de route, cf. le commentaire de `DecksPage.tsx`).
    fireEvent.keyDown(document, { key: "Enter" });
    expect(screen.getByTestId("deck-form-sheet")).toBeInTheDocument();
    expect(window.location.hash).toBe("#/decks");
  });

  it("garde des comptes crypte/bibliothèque locaux hors ligne, verdict et groupes indisponibles", async () => {
    const app = await renderApp({ online: true, catalog: true, hash: "#/decks" });
    const { key } = await app.runtime.actions.createDeck({ name: "Tremere", proxyAllowed: true });
    await act(async () => {
      await app.runtime.engine.flush();
      await app.runtime.refresh();
    });
    await app.runtime.actions.saveDeckCard(key, {
      cardId: 1, // Élan vital, bibliothèque
      languageCode: "EN",
      cardSetId: 9,
      quantity: 2,
      proxyQuantity: 2,
    });
    await app.runtime.actions.saveDeckCard(key, {
      cardId: 3, // Theo Bell, crypte
      languageCode: "EN",
      cardSetId: 9,
      quantity: 1,
      proxyQuantity: 1,
    });

    // Les deux lignes doivent être en file avant de couper le réseau : sans
    // cela, la seconde pourrait encore être en vol au moment de l'assertion.
    await waitFor(async () => expect(await app.runtime.outbox.list()).toHaveLength(2));

    act(() => setOnline(false));

    await waitFor(() =>
      expect(screen.getByTestId("deck-summary-verdict")).toHaveTextContent(/indisponible/i),
    );
    // Les comptes locaux (composition + miroir catalogue) se lisent par une
    // lecture IndexedDB asynchrone, distincte du verdict : attendre qu'ils
    // reflètent les deux lignes avant de les vérifier.
    await waitFor(() => expect(screen.getByTestId("deck-summary-crypt")).toHaveTextContent("1"));
    expect(screen.getByTestId("deck-summary-library")).toHaveTextContent("2");
    expect(screen.getByTestId("deck-summary-groups")).toHaveTextContent("indisponible");
    expect(screen.getByTestId("deck-summary-banned")).toHaveTextContent("indisponible");

    expect(within(screen.getByTestId("decks-detail-crypt")).getByText(/Theo Bell/)).toBeInTheDocument();
    expect(within(screen.getByTestId("decks-detail-library")).getByText(/Élan vital/)).toBeInTheDocument();
  });

  it("affiche le verdict du serveur (crypte, bibliothèque, groupes, bannies) une fois le deck synchronisé", async () => {
    const app = await renderApp({ online: true, catalog: true, hash: "#/decks" });
    app.ui.legality = { status: 200, body: LEGALITY };
    await app.runtime.actions.createDeck({ name: "Nosferatu" });
    await act(async () => {
      await app.runtime.engine.flush();
      await app.runtime.refresh();
    });

    await waitFor(() =>
      expect(screen.getByTestId("deck-summary-verdict")).toHaveTextContent("Deck illégal"),
    );
    expect(screen.getByTestId("deck-summary-crypt")).toHaveTextContent("11");
    expect(screen.getByTestId("deck-summary-library")).toHaveTextContent("60");
    expect(screen.getByTestId("deck-summary-groups")).toHaveTextContent("G2");
    expect(screen.getByTestId("deck-summary-banned")).toHaveTextContent("0");
  });

  it("aucune régression mobile : liste plein écran, sans panneau de droite ni bouton d'en-tête (Lot 5)", async () => {
    setViewportWidth(390);
    const { runtime } = await renderApp({ online: false, hash: "#/decks" });
    await runtime.actions.createDeck({ name: "Malkavien" });
    await screen.findByTestId("deck-item");

    expect(screen.queryByTestId("decks-detail")).not.toBeInTheDocument();
    expect(screen.queryByTestId("decks-new-desktop")).not.toBeInTheDocument();
    expect(screen.queryByTestId("deck-select")).not.toBeInTheDocument();
    expect(screen.getByTestId("deck-link")).toBeInTheDocument();
  });
});

describe("decks : composition", () => {
  it("ajoute une carte de la collection au deck, hors ligne, par la file", async () => {
    const { runtime, server, key } = await withDeck({}, "Malkavien", true);
    await runtime.actions.saveStock({ cardId: 1, languageCode: "FR", cardSetId: 9, quantityOwned: 3 });
    server.state.requests.length = 0;

    const form = await openAddCardSheet();
    fireEvent.change(within(form).getByLabelText("Rechercher une carte"), { target: { value: "ELAN" } });
    fireEvent.click(await within(form).findByTestId("card-picker-option"));
    expect(within(form).getByTestId("deck-card-form-chosen")).toHaveTextContent("Élan vital");
    fireEvent.change(within(form).getByLabelText("Copies dans le deck"), { target: { value: "2" } });
    // Une seule des deux copies est déclarée possédée : l'autre reste un proxy.
    fireEvent.click(within(form).getByRole("button", { name: "Ajouter : Dont déjà possédées" }));
    expect(within(form).getByTestId("deck-card-form-availability")).toHaveTextContent("1 proxy");
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
      data: { card_id: 1, language_code: "FR", card_set_id: 9, quantity: 2, proxy_quantity: 1 },
    });
    expect(server.state.requests).toEqual([]);
  });

  it("distingue deux impressions de la même carte et langue, et laisse choisir l'entrée précise", async () => {
    const { runtime, key } = await withDeck({}, "Malkavien", true);
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
    await runtime.actions.saveStock({ cardId: 1, languageCode: "FR", cardSetId: 9, quantityOwned: 3 });
    await runtime.actions.saveStock({ cardId: 1, languageCode: "FR", cardSetId: 21, quantityOwned: 5 });

    const form = await openAddCardSheet();
    fireEvent.change(within(form).getByLabelText("Rechercher une carte"), { target: { value: "ELAN" } });
    fireEvent.click(await within(form).findByTestId("card-picker-option"));

    // Déclarer au moins une copie possédée révèle le choix de l'impression (D2a).
    fireEvent.click(within(form).getByRole("button", { name: "Ajouter : Dont déjà possédées" }));
    const select = await within(form).findByTestId("deck-card-form-card-set");
    expect(within(select).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "TEST — Extension de test",
      "NEW — Extension récente",
    ]);
    // Présélectionnée sur la dernière version (D2a).
    expect(select).toHaveValue("21");

    fireEvent.change(select, { target: { value: "9" } }); // choisit l'autre impression, à 3 exemplaires
    fireEvent.click(within(form).getByTestId("deck-card-form-submit"));

    const line = await screen.findByTestId("deck-card");
    await waitFor(() => expect(within(line).getByTestId("deck-card-set")).toHaveTextContent("TEST"));
    const last = (await runtime.outbox.list()).at(-1)!.operation;
    expect(last).toMatchObject({
      type: "deck_card.upsert",
      deck: { client_ref: key.slice(4) },
      data: { card_id: 1, language_code: "FR", card_set_id: 9 },
    });
  });

  it("ajoute une carte absente de la collection, entièrement en proxy (deck qui autorise les proxies)", async () => {
    const { runtime, key } = await withDeck({}, "Malkavien", true);

    const form = await openAddCardSheet();
    fireEvent.change(within(form).getByLabelText("Rechercher une carte"), { target: { value: "elan" } });
    fireEvent.click(await within(form).findByTestId("card-picker-option"));

    // Rien en collection : D2a prend la dernière version sans demander l'extension,
    // et la copie entre entièrement en proxy (aucune acquisition).
    expect(within(form).queryByTestId("deck-card-form-card-set")).not.toBeInTheDocument();
    await waitFor(() =>
      expect(within(form).getByTestId("deck-card-form-availability")).toHaveTextContent(
        "Disponible en collection : 0",
      ),
    );
    fireEvent.click(within(form).getByTestId("deck-card-form-submit"));

    const line = await screen.findByTestId("deck-card");
    expect(line).toHaveAttribute("data-quantity", "1");
    expect(line).toHaveAttribute("data-proxy-quantity", "1");
    const last = (await runtime.outbox.list()).at(-1)!.operation;
    expect(last).toMatchObject({
      type: "deck_card.upsert",
      deck: { client_ref: key.slice(4) },
      data: { card_id: 1, language_code: "FR", card_set_id: 9, quantity: 1, proxy_quantity: 1 },
    });
  });

  it("acquiert les exemplaires manquants quand on possède plus que le stock ne l'autorise", async () => {
    const { runtime, key } = await withDeck({}, "Malkavien", true);
    await runtime.actions.saveStock({ cardId: 1, languageCode: "FR", cardSetId: 9, quantityOwned: 1 });

    const form = await openAddCardSheet();
    fireEvent.change(within(form).getByLabelText("Rechercher une carte"), { target: { value: "elan" } });
    fireEvent.click(await within(form).findByTestId("card-picker-option"));
    fireEvent.change(within(form).getByLabelText("Copies dans le deck"), { target: { value: "3" } });
    // La disponibilité se lit en IndexedDB (asynchrone) : attendre qu'elle soit à
    // jour avant d'enchaîner les clics, pour ne pas incrémenter « possédées » sur
    // une valeur encore obsolète (0) le temps que la lecture locale se résolve.
    await waitFor(() =>
      expect(within(form).getByTestId("deck-card-form-availability")).toHaveTextContent(
        "Disponible en collection : 1 exemplaire",
      ),
    );

    fireEvent.click(within(form).getByRole("button", { name: "Ajouter : Dont déjà possédées" }));
    fireEvent.click(within(form).getByRole("button", { name: "Ajouter : Dont déjà possédées" }));
    fireEvent.click(within(form).getByRole("button", { name: "Ajouter : Dont déjà possédées" }));
    await waitFor(() =>
      expect(within(form).getByTestId("deck-card-form-acquire")).toHaveTextContent("2 exemplaires"),
    );

    fireEvent.click(within(form).getByTestId("deck-card-form-submit"));

    const line = await screen.findByTestId("deck-card");
    expect(line).toHaveAttribute("data-quantity", "3");
    expect(line).toHaveAttribute("data-proxy-quantity", "0");
    const last = (await runtime.outbox.list()).at(-1)!.operation;
    expect(last).toMatchObject({
      type: "deck_card.upsert",
      deck: { client_ref: key.slice(4) },
      data: { card_id: 1, language_code: "FR", card_set_id: 9, quantity: 3, proxy_quantity: 0, acquired_quantity: 2 },
    });
  });

  it("verrouille les exemplaires possédés à la quantité quand le deck n'autorise pas les proxies", async () => {
    await withDeck({}, "Malkavien", false);
    const form = await openAddCardSheet();
    fireEvent.change(within(form).getByLabelText("Rechercher une carte"), { target: { value: "elan" } });
    fireEvent.click(await within(form).findByTestId("card-picker-option"));

    expect(within(form).getByTestId("deck-card-form-no-proxy")).toBeInTheDocument();
    expect(within(form).queryByLabelText("Dont déjà possédées")).not.toBeInTheDocument();
  });

  it("modifie la quantité d'une ligne sans perdre ses proxies, et retire la ligne", async () => {
    const { runtime } = await withDeck();
    const key = screen.getByTestId("deck-page").getAttribute("data-deck-key") as DeckKey;
    await runtime.actions.saveStock({ cardId: 1, languageCode: "FR", cardSetId: 9, quantityOwned: 4 });
    await runtime.actions.saveDeckCard(key, {
      cardId: 1,
      languageCode: "FR",
      cardSetId: 9,
      quantity: 2,
      proxyQuantity: 1,
    });
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

  it("clampe le nombre de copies à 1 au minimum (saisie directe, pas seulement le bouton −)", async () => {
    await withDeck({}, "Malkavien", true);
    const form = await openAddCardSheet();
    fireEvent.change(within(form).getByLabelText("Rechercher une carte"), { target: { value: "elan" } });
    fireEvent.click(await within(form).findByTestId("card-picker-option"));

    const copies = within(form).getByLabelText("Copies dans le deck");
    fireEvent.change(copies, { target: { value: "0" } });
    expect(copies).toHaveValue(1);
    fireEvent.change(copies, { target: { value: "-5" } });
    expect(copies).toHaveValue(1);
  });

  it("borne les exemplaires déjà possédés entre 0 et le nombre de copies, y compris en rabaissant les copies", async () => {
    await withDeck({}, "Malkavien", true);
    const form = await openAddCardSheet();
    fireEvent.change(within(form).getByLabelText("Rechercher une carte"), { target: { value: "elan" } });
    fireEvent.click(await within(form).findByTestId("card-picker-option"));
    fireEvent.change(within(form).getByLabelText("Copies dans le deck"), { target: { value: "3" } });

    const owned = within(form).getByLabelText("Dont déjà possédées");
    fireEvent.change(owned, { target: { value: "-2" } });
    expect(owned).toHaveValue(0);
    fireEvent.change(owned, { target: { value: "10" } });
    expect(owned).toHaveValue(3); // plafonné au nombre de copies

    // Rabaisser les copies re-plafonne ce qui était déjà saisi comme possédé.
    fireEvent.change(within(form).getByLabelText("Copies dans le deck"), { target: { value: "1" } });
    expect(owned).toHaveValue(1);
  });

  it("borne le nombre de proxies à convertir entre 1 et le total de proxies de la ligne", async () => {
    const { runtime, key } = await withDeck({}, "Malkavien", true);
    await runtime.actions.saveStock({ cardId: 1, languageCode: "FR", cardSetId: 9, quantityOwned: 5 });
    await runtime.actions.saveDeckCard(key, {
      cardId: 1,
      languageCode: "FR",
      cardSetId: 9,
      quantity: 4,
      proxyQuantity: 3,
    });
    const line = await screen.findByTestId("deck-card");
    const convert = within(line).getByTestId("deck-card-convert");
    const minus = within(convert).getByRole("button", { name: /Retirer un proxy à acquérir/ });
    const plus = within(convert).getByRole("button", { name: /Ajouter un proxy à acquérir/ });

    // Départ à 1, bouton − déjà désactivé (borne basse).
    expect(within(convert).getByTestId("deck-card-convert-count")).toHaveTextContent("1");
    expect(minus).toBeDisabled();

    fireEvent.click(plus);
    fireEvent.click(plus);
    fireEvent.click(plus);
    fireEvent.click(plus); // un clic de trop : reste à 3 (borne haute, le total de la ligne)
    expect(within(convert).getByTestId("deck-card-convert-count")).toHaveTextContent("3");
    expect(plus).toBeDisabled();

    fireEvent.click(within(convert).getByTestId("deck-card-convert-submit"));
    await waitFor(() => expect(screen.getByTestId("deck-card")).toHaveAttribute("data-proxy-quantity", "0"));
    const last = (await runtime.outbox.list()).at(-1)!.operation;
    expect(last).toMatchObject({
      type: "deck_card.upsert",
      data: { quantity: 4, proxy_quantity: 0, acquired_quantity: 3 },
    });
  });
});

describe("decks : cycle de vie", () => {
  it("archive (composition verrouillée), désarchive, puis supprime un deck archivé après confirmation", async () => {
    const { runtime, key } = await withDeck();
    await runtime.actions.saveStock({ cardId: 1, languageCode: "FR", cardSetId: 9, quantityOwned: 2 });
    await runtime.actions.saveDeckCard(key, { cardId: 1, languageCode: "FR", cardSetId: 9, quantity: 1 });
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
    expect(within(verdict).getByTestId("legality-crypt")).toHaveTextContent("11");
    expect(within(verdict).getByTestId("legality-crypt")).toHaveTextContent("min 12");
    expect(within(verdict).getByTestId("legality-library")).toHaveTextContent("60–90");
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
