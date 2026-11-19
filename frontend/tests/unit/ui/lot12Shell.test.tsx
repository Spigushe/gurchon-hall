import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { hrefFor } from "../../../src/app/routes";
import { AppUpdateBanner } from "../../../src/features/sync/AppUpdateBanner";
import { AppUpdateStore, appUpdateStore } from "../../../src/offline/core/appUpdate";
import { VtesOfflineProvider } from "../../../src/offline/vtes/VtesOfflineProvider";
import { createVtesOffline, type VtesOfflineRuntime } from "../../../src/offline/vtes/runtime";
import { CARD_SET_ID, createFakeServer } from "../offline/fakeServer";
import { freshDbName, manualTimers } from "../offline/helpers";
import { flushEffects, renderApp, setOnline } from "./harness";

// Lot 12, D2 : bandeau « nouvelle version » (P5), légende des raccourcis `?`
// (P8) et « Catalogue en cours de chargement » dans les decks (A8).

const ACCOUNT = { id: 1, email: "lea@example.org", username: "lea-v", role: "user" as const };

function setViewportWidth(width: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: width });
}

const runtimes: VtesOfflineRuntime[] = [];
afterEach(async () => {
  setViewportWidth(1024);
  for (const runtime of runtimes.splice(0)) {
    runtime.stop();
    await runtime.engine.whenIdle();
    runtime.dispose();
  }
});

describe("bandeau « nouvelle version » (P5)", () => {
  function setup() {
    const server = createFakeServer();
    const state = { online: false };
    const runtime = createVtesOffline({
      client: server.client,
      dbName: freshDbName("update-banner"),
      autoRefresh: false,
      engine: { isOnline: () => state.online, lockName: null, timers: manualTimers().timers },
    });
    runtimes.push(runtime);
    const store = new AppUpdateStore();
    render(
      <VtesOfflineProvider runtime={runtime}>
        <AppUpdateBanner store={store} />
      </VtesOfflineProvider>,
    );
    return { runtime, state, store };
  }

  it("rien tant qu'aucune version n'attend", () => {
    setup();
    expect(screen.queryByTestId("app-update-banner")).not.toBeInTheDocument();
  });

  it("saisies en attente : pas de « Mettre à jour », puis proposé de lui-même une fois la file vide", async () => {
    const { runtime, state, store } = setup();
    const install = vi.fn(async () => {});
    await act(async () => {
      await runtime.actions.saveStock({ cardId: 1, languageCode: "EN", cardSetId: CARD_SET_ID, quantityOwned: 2 });
      store.offer(install);
    });

    const banner = await screen.findByTestId("app-update-banner");
    await waitFor(() => expect(banner).toHaveAttribute("data-state", "waiting"));
    expect(banner).toHaveTextContent("Elle s'installera une fois votre saisie synchronisée.");
    expect(banner).toHaveTextContent("Hors ligne : l'envoi reprendra au retour du réseau.");
    expect(banner).toHaveTextContent("L'envoi se suit dans Compte › Synchronisation.");
    // A11 : aucun lien vers Synchronisation.
    expect(within(banner).queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByTestId("app-update-apply")).not.toBeInTheDocument();

    state.online = true;
    await act(async () => {
      await runtime.engine.flush();
    });
    await waitFor(() => expect(screen.getByTestId("app-update-banner")).toHaveAttribute("data-state", "ready"));
    expect(screen.getByTestId("app-update-banner")).toHaveTextContent("Une nouvelle version est disponible.");

    await act(async () => {
      fireEvent.click(screen.getByTestId("app-update-apply"));
    });
    expect(install).toHaveBeenCalledTimes(1);
  });

  it("une installation qui échoue le dit et laisse réessayer", async () => {
    const { store } = setup();
    act(() =>
      store.offer(async () => {
        throw new Error("service worker absent");
      }),
    );
    await act(async () => {
      fireEvent.click(await screen.findByTestId("app-update-apply"));
    });
    expect(screen.getByTestId("app-update-error")).toHaveTextContent("n'a pas pu s'installer");
    expect(screen.getByTestId("app-update-apply")).toBeEnabled();
  });

  it("« Plus tard » le masque", async () => {
    const { store } = setup();
    act(() => store.offer(async () => {}));
    fireEvent.click(await screen.findByTestId("app-update-later"));
    expect(screen.queryByTestId("app-update-banner")).not.toBeInTheDocument();
  });

  it("dans la coquille : sous la barre haute, sans prendre le `role=\"status\"` unique", async () => {
    await renderApp({ hash: "#/collection" });
    expect(screen.queryByTestId("app-update-banner")).not.toBeInTheDocument();

    act(() => appUpdateStore.offer(async () => {}));
    const banner = await screen.findByTestId("app-update-banner");
    expect(banner.closest(".shell-banners")).not.toBeNull();
    expect(screen.getAllByRole("status")).toHaveLength(1);

    fireEvent.click(screen.getByTestId("app-update-later"));
    expect(screen.queryByTestId("app-update-banner")).not.toBeInTheDocument();
  });
});

describe("légende des raccourcis (P8)", () => {
  const legendRows = (section: string) =>
    within(screen.getByTestId(section))
      .getAllByTestId("shortcuts-legend-row")
      .map((row) => row.textContent);

  it("`?` l'ouvre sur Decks : l'écran d'abord, puis partout, puis les feuilles", async () => {
    const { runtime } = await renderApp({ online: false, hash: "#/decks" });
    await runtime.actions.createDeck({ name: "Lasombra" });
    await screen.findByTestId("decks-detail-title");
    await flushEffects();

    fireEvent.keyDown(document, { key: "?" });
    const legend = await screen.findByTestId("shortcuts-legend");
    expect(within(legend).getByRole("heading", { name: "Raccourcis" })).toBeInTheDocument();
    expect(within(screen.getByTestId("shortcuts-legend-screen")).getByText("Decks")).toBeInTheDocument();
    expect(legendRows("shortcuts-legend-screen")).toEqual(["Nouveau deckN", "Ouvrir le deck sélectionné↵"]);
    expect(legendRows("shortcuts-legend-global")).toEqual([
      "AtelierG A",
      "CollectionG C",
      "DecksG D",
      "PartiesG P",
      "SynchronisationG S",
      "Rechercher (champ de la barre haute, ou de l'écran)/",
      "Cette légende?",
    ]);
    expect(legendRows("shortcuts-legend-sheet")).toEqual(["FermerÉchap", "Valider⌘↵"]);
  });

  it("suspend les raccourcis de l'écran tant qu'elle est ouverte, et se ferme par `?` ou Échap", async () => {
    const { runtime } = await renderApp({ online: false, hash: "#/decks" });
    await runtime.actions.createDeck({ name: "Lasombra" });
    await screen.findByTestId("decks-detail-title");
    await flushEffects();

    fireEvent.keyDown(document, { key: "?" });
    await screen.findByTestId("shortcuts-legend");
    await flushEffects();
    fireEvent.keyDown(document, { key: "n" });
    expect(screen.queryByTestId("deck-form-sheet")).not.toBeInTheDocument();
    fireEvent.keyDown(document, { key: "?" });
    await waitFor(() => expect(screen.queryByTestId("shortcuts-legend")).not.toBeInTheDocument());

    fireEvent.keyDown(document, { key: "?" });
    await screen.findByTestId("shortcuts-legend");
    await flushEffects();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("shortcuts-legend")).not.toBeInTheDocument());

    // Refermée, l'écran retrouve ses raccourcis.
    await flushEffects();
    fireEvent.keyDown(document, { key: "n" });
    expect(await screen.findByTestId("deck-form-sheet")).toBeInTheDocument();
  });

  it("depuis le menu du compte, sur un écran sans raccourci propre", async () => {
    await renderApp({ hash: "#/compte", account: ACCOUNT });
    fireEvent.click(await screen.findByTestId("account-menu-toggle"));
    const entry = await screen.findByTestId("account-menu-shortcuts");
    expect(entry).toHaveTextContent("Raccourcis");
    fireEvent.click(entry);

    await screen.findByTestId("shortcuts-legend");
    expect(screen.queryByTestId("account-menu-panel")).not.toBeInTheDocument();
    expect(within(screen.getByTestId("shortcuts-legend-screen")).getByText("Compte")).toBeInTheDocument();
    expect(screen.getByTestId("shortcuts-legend-screen-empty")).toHaveTextContent(
      "Cet écran n'a pas de raccourci propre.",
    );
  });

  it("rien au mobile : un téléphone n'a pas de clavier", async () => {
    setViewportWidth(390);
    await renderApp({ hash: "#/decks" });
    await flushEffects();
    fireEvent.keyDown(document, { key: "?" });
    await flushEffects();
    expect(screen.queryByTestId("shortcuts-legend")).not.toBeInTheDocument();
  });
});

describe("catalogue en cours de chargement (A8)", () => {
  /**
   * Un deck à deux lignes saisi hors ligne, sans catalogue local, puis le
   * réseau qui revient : la lecture du catalogue est retenue par le serveur
   * factice jusqu'à `release`.
   */
  async function withDeckAwaitingCatalog(hash: string) {
    const server = createFakeServer();
    let release = () => {};
    server.next.catalogGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const app = await renderApp({ online: false, server, hash });
    const { key } = await app.runtime.actions.createDeck({ name: "Tremere", proxyAllowed: true });
    for (const cardId of [1, 3]) {
      await app.runtime.actions.saveDeckCard(key, {
        cardId,
        languageCode: "EN",
        cardSetId: CARD_SET_ID,
        quantity: 1,
        proxyQuantity: 1,
      });
    }
    act(() => setOnline(true));
    return { ...app, key, release };
  }

  it("liste et aperçu bureau : la mention à la place des comptes, puis les tableaux une fois le catalogue là", async () => {
    const { release } = await withDeckAwaitingCatalog("#/decks");

    const item = await screen.findByTestId("deck-item");
    await waitFor(() => expect(within(item).getByTestId("catalog-loading")).toBeInTheDocument());
    expect(within(item).queryByTestId("deck-item-counts")).not.toBeInTheDocument();
    expect(item).toHaveTextContent("Tremere");
    expect(await screen.findByTestId("catalog-loading-composition")).toHaveTextContent(
      "Les tableaux s'afficheront d'eux-mêmes dans quelques secondes.",
    );

    await act(async () => release());
    await waitFor(() => expect(screen.getByTestId("deck-item-counts")).toHaveTextContent("1 / 1"));
    expect(screen.queryByTestId("catalog-loading")).not.toBeInTheDocument();
    expect(await screen.findByTestId("deck-tables")).toBeInTheDocument();
  });

  it("liste mobile et deckbuilder : la mention sous la méta, la composition en squelette", async () => {
    setViewportWidth(390);
    const { key, release } = await withDeckAwaitingCatalog("#/decks");
    const item = await screen.findByTestId("deck-item");
    await waitFor(() => expect(within(item).getByTestId("catalog-loading")).toBeInTheDocument());

    act(() => {
      window.location.hash = hrefFor({ name: "deck", key });
    });
    await screen.findByTestId("deck-page");
    const composition = await screen.findByTestId("catalog-loading-composition");
    expect(composition).toHaveTextContent("La composition s'affichera d'elle-même dans quelques secondes.");

    await act(async () => release());
    await waitFor(() => expect(screen.queryByTestId("catalog-loading-composition")).not.toBeInTheDocument());
    expect(await screen.findByTestId("deck-tables")).toBeInTheDocument();
  });

  it("un deck vide garde son « 0 / 0 »", async () => {
    const server = createFakeServer();
    server.next.catalogGate = new Promise<void>(() => {});
    const app = await renderApp({ online: false, server, hash: "#/decks" });
    await app.runtime.actions.createDeck({ name: "Vide" });
    act(() => setOnline(true));
    await waitFor(() => expect(screen.getByTestId("deck-item-counts")).toHaveTextContent("0 / 0"));
    expect(screen.queryByTestId("catalog-loading")).not.toBeInTheDocument();
  });
});
