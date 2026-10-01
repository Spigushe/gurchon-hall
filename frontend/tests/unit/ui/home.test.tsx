import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderApp, setOnline } from "./harness";

/**
 * `HomePage` bascule sa liste « En cours » vers un tableau bureau (comptes,
 * légalité, Lot 5bis étape 5) par une lecture réactive de `window.innerWidth`
 * (`useIsDesktop`), pas par une media query CSS : jsdom n'applique aucune CSS
 * ici (`css: false`, `vitest.config.ts`), et la lecture par deck de la
 * légalité en ligne ne doit partir que sous cette forme bureau (voir
 * `HomePage.tsx`). jsdom vaut 1024 par défaut (bureau, cf.
 * `tests/unit/components/Sheet.test.tsx`) : les tests qui veulent le mobile
 * le fixent explicitement, avant le rendu, et le remettent après coup.
 */
function setViewportWidth(width: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: width });
}

afterEach(() => {
  setViewportWidth(1024);
});

const LEGALITY = {
  deck_id: 1,
  evaluated_on: "2026-09-29",
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

describe("Atelier : disposition mobile (inchangée, Lot 5)", () => {
  it("garde la liste simple (nom, discriminant, statut, archétype), sans colonne ni appel de légalité", async () => {
    setViewportWidth(390);
    const app = await renderApp({ online: true, catalog: true });
    await app.runtime.actions.createDeck({ name: "Malkavien", archetype: "vote" });
    await act(async () => {
      await app.runtime.engine.whenIdle();
      await app.runtime.refresh();
    });

    const name = await screen.findByText("Malkavien");
    expect(name.closest(".row")).toHaveTextContent("vote");
    expect(screen.queryByTestId("home-deck-table")).not.toBeInTheDocument();
    expect(screen.queryByTestId("home-deck-row")).not.toBeInTheDocument();
    // Aucune lecture de légalité par deck sur cette disposition : la colonne
    // qui l'afficherait n'existe pas.
    expect(app.ui.requests).toEqual([]);
  });

  it("n'affiche pas les raccourcis principaux bureau (masqués, pas un second composant)", async () => {
    setViewportWidth(390);
    await renderApp({ online: false });
    // Toujours dans le DOM (un seul composant, CSS/JS tranchent), mais sans
    // équivalent mobile : présents mais non pertinents à ce gabarit.
    expect(screen.getByTestId("home-shortcuts")).toBeInTheDocument();
    expect(screen.getByTestId("catalog-panel")).toBeInTheDocument();
  });
});

describe("Atelier : tableau « En cours » bureau (d08, Lot 5bis étape 5)", () => {
  it("affiche nom, comptes et verdict de légalité lus en ligne pour un deck actif", async () => {
    setViewportWidth(1440);
    const app = await renderApp({ online: true, catalog: true });
    app.ui.legality = { status: 200, body: LEGALITY };
    await app.runtime.actions.createDeck({ name: "Ventrue" });
    await act(async () => {
      await app.runtime.engine.whenIdle();
      await app.runtime.refresh();
    });

    const row = await screen.findByTestId("home-deck-row");
    expect(row).toHaveTextContent("Ventrue");
    await waitFor(() =>
      expect(within(row).getByTestId("home-deck-row-counts")).toHaveTextContent(
        "11 crypte · 60 bibliothèque",
      ),
    );
    expect(within(row).getByTestId("home-deck-row-legality")).toHaveTextContent("Illégal");
    expect(within(row).getByTestId("home-deck-row-legality")).toHaveAttribute("data-legal", "false");
  });

  it("dit que le verdict n'existe pas encore pour un deck créé hors ligne, sans appel réseau", async () => {
    setViewportWidth(1440);
    const app = await renderApp({ online: false, catalog: true });
    await app.runtime.actions.createDeck({ name: "Tremere" });

    const row = await screen.findByTestId("home-deck-row");
    expect(within(row).getByTestId("home-deck-row-legality")).toHaveTextContent(
      "En attente de synchronisation",
    );
    expect(within(row).getByTestId("home-deck-row-counts")).toHaveTextContent("—");
    expect(app.ui.requests).toEqual([]);
  });

  it("signale le verdict indisponible hors ligne pour un deck déjà connu du serveur", async () => {
    setViewportWidth(1440);
    const app = await renderApp({ online: true, catalog: true });
    app.ui.legality = { status: 200, body: LEGALITY };
    await app.runtime.actions.createDeck({ name: "Lasombra" });
    await act(async () => {
      await app.runtime.engine.whenIdle();
      await app.runtime.refresh();
    });
    await screen.findByTestId("home-deck-row");

    act(() => setOnline(false));
    const row = screen.getByTestId("home-deck-row");
    await waitFor(() =>
      expect(within(row).getByTestId("home-deck-row-legality")).toHaveTextContent(
        "Indisponible hors ligne",
      ),
    );
    expect(within(row).getByTestId("home-deck-row-counts")).toHaveTextContent("—");
  });

  it("garde `.page--atelier` sur la coquille de page et expose les raccourcis vers Decks et Collection", async () => {
    setViewportWidth(1440);
    await renderApp({ online: false });

    expect(screen.getByTestId("home-page")).toHaveClass("page--atelier");
    const shortcuts = screen.getByTestId("home-shortcuts");
    // Adapté au Lot 5c (étape 5) : les raccourcis portent désormais une intention
    // d'ouverture dans le hash (la feuille annoncée s'ouvre à l'arrivée) ; la route
    // reste la même (écart D2 de l'audit).
    expect(within(shortcuts).getByTestId("home-shortcut-deck")).toHaveAttribute("href", "#/decks?action=nouveau");
    expect(within(shortcuts).getByTestId("home-shortcut-stock")).toHaveAttribute(
      "href",
      "#/collection?action=ajouter",
    );
    expect(within(shortcuts).getByTestId("home-shortcut-bundle")).toHaveAttribute(
      "href",
      "#/collection?action=verser",
    );
    expect(screen.getByTestId("catalog-panel")).toBeInTheDocument();
  });
});

describe("Atelier : symétrie mobile / bureau (Lot 5c, étape 5)", () => {
  async function withComposedDeck() {
    const app = await renderApp({ online: false, catalog: true });
    const { key } = await app.runtime.actions.createDeck({ name: "Tremere", proxyAllowed: true });
    await app.runtime.actions.saveDeckCard(key, {
      cardId: 1, // Élan vital, bibliothèque
      languageCode: "EN",
      cardSetId: 9,
      quantity: 3,
      proxyQuantity: 3,
    });
    await app.runtime.actions.saveDeckCard(key, {
      cardId: 3, // Theo Bell, crypte
      languageCode: "EN",
      cardSetId: 9,
      quantity: 2,
      proxyQuantity: 2,
    });
    return app;
  }

  it("mobile : la liste « En cours » affiche les comptes crypte / bibliothèque, calculés localement", async () => {
    setViewportWidth(390);
    const app = await withComposedDeck();
    const counts = await screen.findByTestId("home-deck-counts");
    await waitFor(() => expect(counts).toHaveTextContent("2 crypte · 3 bibliothèque"));
    // Aucun verdict de légalité ni appel serveur : comptes purement locaux.
    expect(screen.queryByTestId("home-deck-row-legality")).not.toBeInTheDocument();
    expect(app.ui.requests).toEqual([]);
  });

  it("bureau : discriminant et statut sous le nom dans le tableau « En cours »", async () => {
    setViewportWidth(1440);
    await withComposedDeck();
    const row = await screen.findByTestId("home-deck-row");
    expect(within(row).getByTestId("home-deck-row-discriminator")).toHaveTextContent("numéro à l'attribution");
    expect(within(row).getByTestId("home-deck-row-status")).toHaveTextContent("brouillon");
    expect(within(row).getByTestId("home-deck-row-status")).toHaveAttribute("data-status", "draft");
  });

  it("raccourci « Ajouter une carte » : ouvre la feuille de saisie, une seule fois", async () => {
    setViewportWidth(1440);
    await renderApp({ online: false, catalog: true });
    fireEvent.click(screen.getByTestId("home-shortcut-stock"));

    expect(await screen.findByTestId("stock-form-sheet")).toBeInTheDocument();
    // Consommée : l'adresse est redevenue nue, sans nouvelle entrée d'historique.
    await waitFor(() => expect(window.location.hash).toBe("#/collection"));

    // Quitter puis revenir à l'écran (retour arrière, rechargement) ne rouvre rien.
    act(() => {
      window.location.hash = "#/";
    });
    await screen.findByTestId("home-page");
    act(() => {
      window.location.hash = "#/collection";
    });
    await screen.findByTestId("stock-page");
    expect(screen.queryByTestId("stock-form-sheet")).not.toBeInTheDocument();
  });

  it("raccourci « Verser un produit » : ouvre la feuille de versement", async () => {
    setViewportWidth(1440);
    await renderApp({ online: false, catalog: true });
    fireEvent.click(screen.getByTestId("home-shortcut-bundle"));
    expect(await screen.findByTestId("bundle-deposit")).toBeInTheDocument();
    await waitFor(() => expect(window.location.hash).toBe("#/collection"));
    expect(screen.queryByTestId("stock-form-sheet")).not.toBeInTheDocument();
  });

  it("raccourci « Nouveau deck » : ouvre la feuille de création, une seule fois", async () => {
    setViewportWidth(1440);
    await renderApp({ online: false, catalog: true });
    fireEvent.click(screen.getByTestId("home-shortcut-deck"));
    expect(await screen.findByTestId("deck-form-sheet")).toBeInTheDocument();
    await waitFor(() => expect(window.location.hash).toBe("#/decks"));

    // Fermer la feuille ne la rouvre pas (l'intention est consommée).
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("deck-form-sheet")).not.toBeInTheDocument());
  });

  it("un rechargement de l'adresse à intention rouvre la feuille une fois, pas en boucle", async () => {
    setViewportWidth(1440);
    await renderApp({ online: false, catalog: true, hash: "#/decks?action=nouveau" });
    expect(await screen.findByTestId("deck-form-sheet")).toBeInTheDocument();
    await waitFor(() => expect(window.location.hash).toBe("#/decks"));
  });
});
