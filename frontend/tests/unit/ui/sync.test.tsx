import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hrefFor } from "../../../src/app/routes";
import { renderApp, setOnline } from "./harness";

type App = Awaited<ReturnType<typeof renderApp>>;

/**
 * jsdom vaut 1024 par défaut (bureau) : ces tests portent sur le comportement
 * mobile de l'écran Synchronisation (bascule inline par ligne refusée), fixé
 * ici explicitement comme `decks.test.tsx` le fait depuis le Lot 5bis étape 6 —
 * sans ce passage à 390, le Lot 5bis étape 12 (disposition bureau) les ferait
 * échouer en cherchant des boutons qui ont migré vers le panneau de droite.
 * Les tests bureau ont leur propre `describe` en bas de fichier, qui repasse
 * explicitement à 1024.
 */
function setViewportWidth(width: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: width });
}

beforeEach(() => {
  setViewportWidth(390);
});

afterEach(() => {
  setViewportWidth(1024);
});

/**
 * Relit les miroirs (ce que fait `autoRefresh` en production, ici coupé : voir le
 * rapport). Sans cela, une création de deck tranchée sort de la file avant que
 * le deck n'entre dans le miroir, et la description d'une opération ne peut
 * plus nommer ce deck.
 */
const refreshMirrors = (app: App) =>
  act(async () => {
    await app.runtime.refresh();
  });

/**
 * Les refus ne se lisent plus sur toutes les pages : ils vivent sur l'écran
 * Synchronisation (Lot 5, étape 11). On attend que la coquille compte le refus,
 * puis on ouvre l'écran.
 */
async function openSyncPage() {
  await waitFor(() => expect(screen.getByTestId("sync-status")).toHaveAttribute("data-rejected", "1"));
  act(() => {
    window.location.hash = hrefFor({ name: "sync" });
  });
  return screen.findByTestId("rejected-operations");
}

/**
 * Hors ligne : un deck et une carte ajoutée à ce deck sans avoir la carte en
 * collection. Au retour du réseau, le serveur refuse l'ajout (exemplaires
 * insuffisants) ; la création du deck passe.
 */
async function refusedDeckCard(app: App) {
  const { key } = await app.runtime.actions.createDeck({ name: "Gangrel" });
  await app.runtime.actions.saveDeckCard(key, { cardId: 2, languageCode: "EN", cardSetId: 9, quantity: 3 });
  act(() => setOnline(true));
  await openSyncPage();
  await app.settle();
  await refreshMirrors(app);
  return key;
}

describe("file de synchronisation : états", () => {
  it("passe de « hors ligne » à « en attente » puis « tout est à jour »", async () => {
    const app = await renderApp({ online: false, catalog: true });
    await app.runtime.actions.saveStock({ cardId: 1, languageCode: "EN", quantityOwned: 1 });
    await app.runtime.actions.saveStock({ cardId: 3, languageCode: "EN", quantityOwned: 1 });

    const bar = screen.getByTestId("sync-status");
    await waitFor(() => expect(bar).toHaveAttribute("data-pending", "2"));
    expect(bar).toHaveAttribute("data-state", "offline");
    expect(screen.getByTestId("sync-label")).toHaveTextContent("Hors ligne : 2 opérations en attente");
    expect(screen.queryByTestId("sync-flush")).not.toBeInTheDocument();

    act(() => setOnline(true));
    await app.settle();
    await waitFor(() => expect(bar).toHaveAttribute("data-state", "synced"));
    expect(screen.getByTestId("sync-label")).toHaveTextContent("Tout est à jour");
    expect(app.server.state.stock.size).toBe(2);
  });

  it("montre le serveur injoignable et laisse relancer à la main sans perdre la saisie", async () => {
    const app = await renderApp({ online: true, catalog: true });
    app.server.next.networkFailure = true;
    await act(async () => {
      await app.runtime.actions.saveStock({ cardId: 1, languageCode: "EN", quantityOwned: 1 });
      await app.runtime.engine.whenIdle();
    });

    const bar = screen.getByTestId("sync-status");
    await waitFor(() => expect(bar).toHaveAttribute("data-state", "pending"));
    expect(screen.getByTestId("sync-label")).toHaveTextContent("1 opération en attente : serveur injoignable");

    const flush = screen.getByTestId("sync-flush");
    fireEvent.click(flush);
    await waitFor(() => expect(bar).toHaveAttribute("data-state", "synced"));
    expect(app.server.state.stock.size).toBe(1);
    expect(app.server.state.journal.size).toBe(1); // une seule clé d'idempotence
  });

  it("un 503 (verrou d'écriture) n'est pas un refus : rien n'est perdu ni compté refusé", async () => {
    const app = await renderApp({ online: true, catalog: true });
    app.server.next.status = 503;
    await act(async () => {
      await app.runtime.actions.saveStock({ cardId: 1, languageCode: "EN", quantityOwned: 1 });
      await app.runtime.engine.whenIdle();
    });
    const bar = screen.getByTestId("sync-status");
    await waitFor(() => expect(bar).toHaveAttribute("data-state", "pending"));
    expect(bar).toHaveAttribute("data-rejected", "0");
    expect(screen.queryByTestId("rejected-operations")).not.toBeInTheDocument();
  });
});

describe("opérations refusées", () => {
  it("affiche chaque refus avec son motif en clair, jamais en silence", async () => {
    const app = await renderApp({ online: false, catalog: true });
    await refusedDeckCard(app);

    const panel = screen.getByTestId("rejected-operations");
    expect(screen.getByTestId("sync-rejected-count")).toHaveTextContent("1 refusée");
    expect(within(panel).getByRole("heading", { name: "1 opération refusée" })).toBeInTheDocument();

    const item = within(panel).getByTestId("rejected-operation");
    expect(item).toHaveAttribute("data-operation-type", "deck_card.upsert");
    expect(item).toHaveAttribute("data-rejection-code", "conflict");
    await waitFor(() =>
      expect(within(item).getByTestId("rejected-description")).toHaveTextContent(
        "Deck « Gangrel » : 3 × « Œuvre » (EN, TEST — Extension de test)",
      ),
    );
    expect(within(item).getByTestId("rejection-reason")).toHaveTextContent(
      "Règle de gestion non respectée : exemplaires insuffisants",
    );
    // Les autres opérations ont bien été appliquées : un refus n'arrête pas la file.
    expect(app.server.state.decks).toHaveLength(1);
    expect(screen.getByTestId("sync-status")).toHaveAttribute("data-pending", "0");
  });

  it("« corriger et renvoyer » crée une nouvelle opération sous une nouvelle clé, à la même place", async () => {
    const app = await renderApp({ online: false, catalog: true });
    await app.runtime.actions.saveStock({ cardId: 2, languageCode: "EN", quantityOwned: 1 });
    await refusedDeckCard(app);
    const [refused] = await app.runtime.outbox.list("rejected");

    fireEvent.click(screen.getByTestId("correct-button"));
    const form = await screen.findByTestId("correction-form");
    fireEvent.change(within(form).getByLabelText("Quantité"), { target: { value: "1" } });
    fireEvent.click(within(form).getByTestId("correction-submit"));

    await waitFor(() => expect(screen.queryByTestId("rejected-operation")).not.toBeInTheDocument()); // l'écran reste, sans refus
    await app.settle();
    expect(app.server.state.deckCards).toEqual([
      expect.objectContaining({ card_id: 2, language_code: "EN", quantity: 1 }),
    ]);
    // Deux clés d'idempotence distinctes ont été vues du serveur : l'ancienne (refusée) et la nouvelle.
    expect(app.server.state.journal.has(refused.operationId)).toBe(true);
    const keys = [...app.server.state.journal.keys()];
    expect(new Set(keys).size).toBe(keys.length);
    expect(await app.runtime.outbox.list()).toHaveLength(0);
  });

  it("valide la correction avant de renvoyer (rien en file si elle est invalide)", async () => {
    const app = await renderApp({ online: false, catalog: true });
    await refusedDeckCard(app);

    fireEvent.click(screen.getByTestId("correct-button"));
    const form = await screen.findByTestId("correction-form");
    fireEvent.change(within(form).getByLabelText("Quantité"), { target: { value: "0" } });
    fireEvent.click(within(form).getByTestId("correction-submit"));

    expect(await within(form).findByRole("alert")).toHaveTextContent("1 ou plus");
    expect(await app.runtime.outbox.list("rejected")).toHaveLength(1);
    expect(await app.runtime.outbox.list("pending")).toHaveLength(0);
  });

  it("« renvoyer tel quel » rejoue sous une nouvelle clé une fois la cause disparue", async () => {
    const app = await renderApp({ online: false, catalog: true });
    await refusedDeckCard(app);
    const [refused] = await app.runtime.outbox.list("rejected");
    await app.runtime.actions.saveStock({ cardId: 2, languageCode: "EN", quantityOwned: 3 });
    await app.settle();

    fireEvent.click(screen.getByTestId("reissue-button"));
    await waitFor(() => expect(screen.queryByTestId("rejected-operation")).not.toBeInTheDocument()); // l'écran reste, sans refus
    await app.settle();

    expect(app.server.state.deckCards).toHaveLength(1);
    expect(app.server.state.journal.has(refused.operationId)).toBe(true);
    expect(app.server.state.journal.size).toBe(4); // deck, refus, stock, renvoi : quatre clés
  });

  it("« abandonner » demande confirmation, puis renonce à la saisie", async () => {
    const app = await renderApp({ online: false, catalog: true });
    await refusedDeckCard(app);

    fireEvent.click(screen.getByTestId("discard-button"));
    expect(await app.runtime.outbox.list("rejected")).toHaveLength(1); // rien encore
    fireEvent.click(screen.getByTestId("discard-confirm"));

    await waitFor(() => expect(screen.queryByTestId("rejected-operation")).not.toBeInTheDocument()); // l'écran reste, sans refus
    expect(await app.runtime.outbox.list()).toHaveLength(0);
    expect(app.server.state.deckCards).toHaveLength(0);
    expect(screen.getByTestId("sync-status")).toHaveAttribute("data-rejected", "0");
  });

  it("garde le choix « garder » de l'abandon sans rien détruire", async () => {
    const app = await renderApp({ online: false, catalog: true });
    await refusedDeckCard(app);

    fireEvent.click(screen.getByTestId("discard-button"));
    fireEvent.click(screen.getByRole("button", { name: "Garder" }));
    expect(screen.getByTestId("discard-button")).toBeInTheDocument();
    expect(await app.runtime.outbox.list("rejected")).toHaveLength(1);
  });

  it("ne propose pas de correction pour une opération sans champ à corriger, seulement renvoyer ou abandonner", async () => {
    const app = await renderApp({ online: false, catalog: true });
    const { key } = await app.runtime.actions.createDeck({ name: "Tzimisce" });
    // Le serveur factice ne gère pas `deck.update` : il le refuse, ce qui donne un refus sans champ éditable.
    await app.runtime.actions.archiveDeck(key);
    act(() => setOnline(true));
    await openSyncPage();
    await app.settle();
    await refreshMirrors(app);

    const item = screen.getByTestId("rejected-operation");
    expect(item).toHaveAttribute("data-operation-type", "deck.update");
    await waitFor(() =>
      expect(within(item).getByTestId("rejected-description")).toHaveTextContent(
        "Deck « Tzimisce » : archivage",
      ),
    );
    expect(within(item).queryByTestId("correct-button")).not.toBeInTheDocument();
    expect(within(item).getByTestId("reissue-button")).toBeInTheDocument();
    expect(within(item).getByTestId("discard-button")).toBeInTheDocument();
  });

  it("les refus s'annoncent par une alerte sur l'Atelier, qui mène à l'écran Synchronisation", async () => {
    const app = await renderApp({ online: false, catalog: true });
    await refusedDeckCard(app);

    // Ni la Collection ni les Decks ne portent le panneau des refus.
    for (const route of [{ name: "stock" }, { name: "decks" }] as const) {
      act(() => {
        window.location.hash = hrefFor(route);
      });
      await screen.findByTestId(route.name === "stock" ? "stock-page" : "decks-page");
      expect(screen.queryByTestId("rejected-operations")).not.toBeInTheDocument();
      expect(screen.getByTestId("sync-status")).toHaveAttribute("data-rejected", "1");
    }

    act(() => {
      window.location.hash = hrefFor({ name: "home" });
    });
    const alert = await screen.findByTestId("sync-alert");
    expect(alert).toHaveTextContent("1 opération refusée");
    expect(screen.queryByTestId("rejected-operations")).not.toBeInTheDocument();
    fireEvent.click(within(alert).getByTestId("sync-alert-link"));
    expect(await screen.findByTestId("rejected-operations")).toBeInTheDocument();
  });

  it("un refus n'a aucun effet local : la lecture retombe sur l'instantané du serveur", async () => {
    const app = await renderApp({ online: false, catalog: true, hash: "#/decks" });
    const { key } = await app.runtime.actions.createDeck({ name: "Lasombra" });
    await app.runtime.actions.archiveDeck(key);
    // Avant l'envoi, la lecture locale montre l'archivage saisi (le deck quitte la liste des decks en cours).
    await waitFor(() => expect(screen.queryAllByTestId("deck-item")).toHaveLength(0));

    act(() => setOnline(true));
    // Le serveur factice refuse `deck.update` : la coquille compte le refus, sans changer de page.
    await waitFor(() => expect(screen.getByTestId("sync-status")).toHaveAttribute("data-rejected", "1"));
    await app.settle();
    await refreshMirrors(app);

    // La création est passée, l'archivage refusé n'a rien laissé : le deck est de nouveau en cours.
    const item = await screen.findByTestId("deck-item");
    expect(item).toHaveTextContent("Lasombra");
    expect(item).not.toHaveTextContent("Archivé");
  });
});

/**
 * Disposition bureau (Lot 5bis, étape 12, DESKTOP.md « d06 ») : grille deux
 * colonnes, liste Refusées sélectionnable, liste En attente, panneau de droite
 * avec la correction. Ce `describe` repasse explicitement à 1024 (le
 * `beforeEach` de tête de fichier vise le mobile depuis cette étape).
 */
describe("bureau (≥ 1024px) : disposition à deux colonnes", () => {
  beforeEach(() => {
    setViewportWidth(1024);
  });

  it("affiche les deux colonnes, un bouton d'envoi toujours visible (désactivé hors ligne) et l'état vide du panneau", async () => {
    const app = await renderApp({ online: false, catalog: true, hash: "#/synchronisation" });
    await app.runtime.actions.saveStock({ cardId: 1, languageCode: "EN", quantityOwned: 1 });

    expect(await screen.findByTestId("sync-columns")).toBeInTheDocument();
    const flush = screen.getByTestId("sync-flush");
    expect(flush.tagName).toBe("BUTTON");
    expect(flush).toBeDisabled();

    await waitFor(() => expect(screen.getByTestId("sync-pending-list")).toBeInTheDocument());
    expect(
      within(screen.getByTestId("sync-pending-list")).getByTestId("pending-operation"),
    ).toBeInTheDocument();

    expect(screen.getByTestId("sync-detail")).toBeInTheDocument();
    expect(screen.getByTestId("sync-detail-empty")).toHaveTextContent("Aucune opération refusée");
  });

  it("liste « En attente » : description à gauche, heure à droite", async () => {
    const app = await renderApp({ online: false, catalog: true, hash: "#/synchronisation" });
    await app.runtime.actions.saveStock({ cardId: 1, languageCode: "EN", quantityOwned: 2 });

    const list = await screen.findByTestId("sync-pending-list");
    const row = within(list).getByTestId("pending-operation");
    expect(row).toHaveTextContent("Collection");
    expect(row.textContent).toMatch(/\d{2}:\d{2}/);
  });

  it("sélectionne (par repli) la première ligne refusée et affiche sa correction dans le panneau de droite", async () => {
    const app = await renderApp({ online: false, catalog: true });
    await app.runtime.actions.saveStock({ cardId: 2, languageCode: "EN", quantityOwned: 1 });
    await refusedDeckCard(app);

    const row = screen.getByTestId("rejected-operation");
    expect(row).toHaveAttribute("data-selected", "true");

    const panel = screen.getByTestId("sync-detail");
    const form = await within(panel).findByTestId("correction-form");
    // Pas de bouton « Annuler » côté bureau : changer de ligne en tient lieu.
    expect(within(panel).queryByText("Annuler")).not.toBeInTheDocument();

    fireEvent.change(within(form).getByLabelText("Quantité"), { target: { value: "1" } });
    fireEvent.click(within(form).getByTestId("correction-submit"));

    await waitFor(() => expect(screen.queryByTestId("rejected-operation")).not.toBeInTheDocument());
    await app.settle();
    expect(app.server.state.deckCards).toEqual([
      expect.objectContaining({ card_id: 2, language_code: "EN", quantity: 1 }),
    ]);
    expect(screen.getByTestId("sync-detail-empty")).toBeInTheDocument();
  });

  it("une opération sans champ à corriger montre le résumé et les deux actions, sans formulaire de correction", async () => {
    const app = await renderApp({ online: false, catalog: true });
    const { key } = await app.runtime.actions.createDeck({ name: "Tzimisce" });
    await app.runtime.actions.archiveDeck(key);
    act(() => setOnline(true));
    await openSyncPage();
    await app.settle();
    await refreshMirrors(app);

    const panel = screen.getByTestId("sync-detail");
    await waitFor(() =>
      expect(within(panel).getByTestId("rejected-description")).toHaveTextContent("archivage"),
    );
    expect(within(panel).queryByTestId("correction-form")).not.toBeInTheDocument();
    expect(within(panel).getByTestId("reissue-button")).toBeInTheDocument();
    expect(within(panel).getByTestId("discard-button")).toBeInTheDocument();
  });

  it("« Abandonner » dans le panneau de droite demande confirmation puis renonce à la saisie", async () => {
    const app = await renderApp({ online: false, catalog: true });
    await refusedDeckCard(app);

    const panel = screen.getByTestId("sync-detail");
    fireEvent.click(within(panel).getByTestId("discard-button"));
    fireEvent.click(within(panel).getByTestId("discard-confirm"));

    await waitFor(() => expect(screen.queryByTestId("rejected-operation")).not.toBeInTheDocument());
    expect(await app.runtime.outbox.list()).toHaveLength(0);
  });

  it("clic sur une ligne change la sélection ; l'abandon retombe sur la première entrée restante", async () => {
    const app = await renderApp({ online: false, catalog: true });
    const first = await app.runtime.actions.createDeck({ name: "Ventrue" });
    await app.runtime.actions.archiveDeck(first.key);
    const second = await app.runtime.actions.createDeck({ name: "Nosferatu" });
    await app.runtime.actions.archiveDeck(second.key);
    act(() => setOnline(true));
    await waitFor(() => expect(screen.getByTestId("sync-status")).toHaveAttribute("data-rejected", "2"));
    act(() => {
      window.location.hash = hrefFor({ name: "sync" });
    });
    await app.settle();
    await refreshMirrors(app);

    const rows = await screen.findAllByTestId("rejected-operation");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveAttribute("data-selected", "true"); // repli par défaut

    fireEvent.click(within(rows[1]).getByRole("button"));
    expect(rows[1]).toHaveAttribute("data-selected", "true");
    expect(rows[0]).not.toHaveAttribute("data-selected", "true");

    const panel = screen.getByTestId("sync-detail");
    fireEvent.click(within(panel).getByTestId("discard-button"));
    fireEvent.click(within(panel).getByTestId("discard-confirm"));

    await waitFor(() => expect(screen.getAllByTestId("rejected-operation")).toHaveLength(1));
    expect(screen.getByTestId("rejected-operation")).toHaveAttribute("data-selected", "true");
  });

  it("le raccourci « S » déclenche l'envoi manuel, comme le bouton", async () => {
    const app = await renderApp({ online: true, catalog: true, hash: "#/synchronisation" });
    app.server.next.networkFailure = true;
    await act(async () => {
      await app.runtime.actions.saveStock({ cardId: 1, languageCode: "EN", quantityOwned: 1 });
      await app.runtime.engine.whenIdle();
    });
    await screen.findByTestId("sync-flush");
    app.server.next.networkFailure = false;

    fireEvent.keyDown(document, { key: "s" });
    await waitFor(() => expect(app.server.state.stock.size).toBe(1));
  });

  it("le raccourci « ⌘↵ » soumet la correction affichée dans le panneau de droite", async () => {
    const app = await renderApp({ online: false, catalog: true });
    await app.runtime.actions.saveStock({ cardId: 2, languageCode: "EN", quantityOwned: 1 });
    await refusedDeckCard(app);

    const form = await screen.findByTestId("correction-form");
    fireEvent.change(within(form).getByLabelText("Quantité"), { target: { value: "1" } });
    fireEvent.keyDown(document, { key: "Enter", metaKey: true });

    await waitFor(() => expect(screen.queryByTestId("rejected-operation")).not.toBeInTheDocument());
    await app.settle();
    expect(app.server.state.deckCards).toHaveLength(1);
  });
});
