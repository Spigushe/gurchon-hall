import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { hrefFor } from "../../../src/app/routes";
import { renderApp, setOnline } from "./harness";

type App = Awaited<ReturnType<typeof renderApp>>;

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

/** Navigue vers l'écran « Synchronisation » (Lot 7 : seul endroit où vivent désormais
 * `SyncStatusBar` et `RejectedOperations`, cf. handoff « nothing is shown while healthy »). */
const goToSyncScreen = () =>
  act(() => {
    window.location.hash = hrefFor({ name: "sync" });
  });

/**
 * Hors ligne : un deck et une carte ajoutée à ce deck sans avoir la carte en
 * collection. Au retour du réseau, le serveur refuse l'ajout (exemplaires
 * insuffisants) ; la création du deck passe. Termine sur l'écran de
 * synchronisation, seul endroit où le refus est maintenant visible.
 */
async function refusedDeckCard(app: App) {
  const { key } = await app.runtime.actions.createDeck({ name: "Gangrel" });
  await app.runtime.actions.saveDeckCard(key, { cardId: 2, languageCode: "EN", quantity: 3 });
  act(() => setOnline(true));
  goToSyncScreen();
  await screen.findByTestId("rejected-operations");
  await app.settle();
  await refreshMirrors(app);
  return key;
}

describe("file de synchronisation : états", () => {
  it("passe de « hors ligne » à « en attente » puis « tout est à jour »", async () => {
    const app = await renderApp({ online: false, catalog: true, hash: "#/synchronisation" });
    await app.runtime.actions.saveStock({ cardId: 1, languageCode: "EN", quantityOwned: 1 });
    await app.runtime.actions.saveStock({ cardId: 3, languageCode: "EN", quantityOwned: 1 });

    const bar = await screen.findByTestId("sync-status");
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
    const app = await renderApp({ online: true, catalog: true, hash: "#/synchronisation" });
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
    const app = await renderApp({ online: true, catalog: true, hash: "#/synchronisation" });
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
        "Deck « Gangrel » : 3 × « Œuvre » (EN)",
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

    await waitFor(() => expect(screen.queryByTestId("rejected-operations")).not.toBeInTheDocument());
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
    await waitFor(() => expect(screen.queryByTestId("rejected-operations")).not.toBeInTheDocument());
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

    await waitFor(() => expect(screen.queryByTestId("rejected-operations")).not.toBeInTheDocument());
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
    goToSyncScreen();
    await screen.findByTestId("rejected-operations");
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

  it("Lot 7 : un refus fait apparaître l'alerte de l'Atelier, qui mène à l'écran de synchronisation dédié", async () => {
    const app = await renderApp({ online: false, catalog: true, hash: "#/" });
    await refusedDeckCard(app); // termine sur #/synchronisation
    act(() => {
      window.location.hash = hrefFor({ name: "home" });
    });

    const alert = await screen.findByTestId("home-sync-alert");
    expect(alert).toHaveTextContent("1 opération refusée");
    expect(alert).toHaveTextContent("Le serveur n'a pas appliqué ces saisies");

    fireEvent.click(within(alert).getByRole("link", { name: /Corriger maintenant/ }));
    // La navigation par `<a href="#...">` est asynchrone dans jsdom : on attend
    // l'écran cible avant de vérifier le hash, plutôt que de lire tout de suite.
    expect(await screen.findByTestId("rejected-operations")).toBeInTheDocument();
    expect(window.location.hash).toBe(hrefFor({ name: "sync" }));
    expect(screen.getByTestId("sync-status")).toBeInTheDocument();
  });

  it("Lot 7 : contrairement à avant, le panneau des refus ne s'affiche plus sur les autres pages — choix de design assumé (handoff « nothing is shown while healthy »), pas une régression", async () => {
    const app = await renderApp({ online: false, catalog: true });
    await refusedDeckCard(app); // termine sur #/synchronisation, où le panneau est bien visible
    expect(screen.getByTestId("rejected-operations")).toBeInTheDocument();

    const pages: Array<{ route: { name: "stock" } | { name: "decks" } | { name: "home" }; testId: string }> = [
      { route: { name: "stock" }, testId: "stock-page" },
      { route: { name: "decks" }, testId: "decks-page" },
      { route: { name: "home" }, testId: "home-page" },
    ];
    for (const { route, testId } of pages) {
      act(() => {
        window.location.hash = hrefFor(route);
      });
      await screen.findByTestId(testId);
      expect(screen.queryByTestId("rejected-operations")).not.toBeInTheDocument();
      expect(screen.queryByTestId("sync-status")).not.toBeInTheDocument();
    }
  });

  it("un refus n'a aucun effet local : la lecture retombe sur l'instantané du serveur", async () => {
    const app = await renderApp({ online: false, catalog: true, hash: "#/decks" });
    const { key } = await app.runtime.actions.createDeck({ name: "Lasombra" });
    await app.runtime.actions.archiveDeck(key);
    // Avant l'envoi, la lecture locale montre l'archivage saisi (le deck quitte la liste des decks en cours).
    await waitFor(() => expect(screen.queryAllByTestId("deck-item")).toHaveLength(0));

    act(() => setOnline(true));
    // Le panneau des refus ne vit plus que sur l'écran dédié (Lot 7) : on y passe le
    // temps d'attendre la fin du rejeu, avant de revenir sur les decks.
    goToSyncScreen();
    await screen.findByTestId("rejected-operations"); // le serveur factice refuse `deck.update`
    await app.settle();
    await refreshMirrors(app);
    act(() => {
      window.location.hash = hrefFor({ name: "decks" });
    });

    // La création est passée, l'archivage refusé n'a rien laissé : le deck est de nouveau en cours.
    const item = await screen.findByTestId("deck-item");
    expect(item).toHaveTextContent("Lasombra");
    expect(item).not.toHaveTextContent("Archivé");
  });
});
