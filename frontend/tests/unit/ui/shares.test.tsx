import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hrefFor } from "../../../src/app/routes";
import type { DeckKey } from "../../../src/offline/vtes";
import { createFakeServer, type FakeServer } from "../offline/fakeServer";
import { renderApp, setOnline, type AppOptions, type UiServer } from "./harness";

/**
 * Lot 13, D2 : feuille de partage d'un deck et d'une version jouée, « Listes
 * partagées » de l'écran Compte, et la phrase de la confirmation de suppression,
 * sur le serveur simulé des lectures en ligne (`ui.shares`).
 */

const ACCOUNT = { id: 1, email: "lea@example.org", username: "lea-v", role: "user" as const };

function setViewportWidth(width: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: width });
}

let secure: PropertyDescriptor | undefined;
beforeEach(() => {
  secure = Object.getOwnPropertyDescriptor(window, "isSecureContext");
});
afterEach(() => {
  setViewportWidth(1024);
  if (secure) Object.defineProperty(window, "isSecureContext", secure);
  else delete (window as { isSecureContext?: boolean }).isSecureContext;
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
  vi.restoreAllMocks();
});

const go = (route: Parameters<typeof hrefFor>[0]) =>
  act(() => {
    window.location.hash = hrefFor(route);
  });

/** Un deck déjà connu du serveur (identifiant 1), avec archétype et notes, miroir rafraîchi, en ligne. */
async function syncedDeck(options: AppOptions = {}, server: FakeServer = createFakeServer()) {
  const app = await renderApp({ account: ACCOUNT, catalog: true, server, ...options });
  const { key } = await app.runtime.actions.createDeck({ name: "Banu Princes", archetype: "bleed", notes: "Mes remarques" });
  await act(async () => {
    await app.runtime.engine.flush();
    await app.runtime.refresh();
  });
  return { app, key, deckId: server.state.decks[0].id };
}

async function openDeck(key: DeckKey) {
  await go({ name: "deck", key });
  await screen.findByTestId("deck-page");
}

async function openSheet(key: DeckKey) {
  await openDeck(key);
  fireEvent.click(screen.getByTestId("deck-share"));
  return screen.findByTestId("share-sheet");
}

function shareOf(deckId: number, id: number, over: Record<string, unknown> = {}, deck: Record<string, unknown> = {}) {
  return {
    id,
    token: `tok${id}`.padEnd(8, "x"),
    kind: "live",
    show_notes: false,
    created_at: "2026-11-20T10:00:00Z",
    frozen_name: null,
    deck_version_number: null,
    deck: { id: deckId, name: "Banu Princes", discriminator: "0001", archived_at: null, deleted_at: null, ...deck },
    ...over,
  };
}

const seed = (ui: UiServer, ...shares: ReturnType<typeof shareOf>[]) => {
  ui.shares.list = shares;
};

describe("bouton « Partager » du détail d'un deck", () => {
  it("est grisé hors ligne, avec la raison, puis s'ouvre au retour du réseau", async () => {
    const { app, key } = await syncedDeck();
    await openDeck(key);
    act(() => setOnline(false));
    expect(screen.getByTestId("deck-share")).toBeDisabled();
    expect(screen.getByTestId("deck-share-offline")).toHaveTextContent("Partager demande le réseau");
    act(() => setOnline(true));
    await waitFor(() => expect(screen.getByTestId("deck-share")).toBeEnabled());
    expect(screen.queryByTestId("deck-share-offline")).not.toBeInTheDocument();
    expect(app.ui.requests.filter((request) => request.path.endsWith("/partages"))).toEqual([]);
  });

  it("est grisé pour un deck créé hors ligne, pas encore connu du serveur", async () => {
    const app = await renderApp({ account: ACCOUNT, catalog: true, online: false });
    const { key } = await app.runtime.actions.createDeck({ name: "Brouillon" });
    await openDeck(key);
    expect(screen.getByTestId("deck-share")).toBeDisabled();
  });

  it("reste présent pour un deck archivé", async () => {
    const { key } = await syncedDeck();
    await openDeck(key);
    fireEvent.click(screen.getByTestId("deck-archive"));
    await screen.findByTestId("deck-archived-note");
    expect(screen.getByTestId("deck-share")).toBeEnabled();
  });

  it("au mobile aussi", async () => {
    setViewportWidth(390);
    const { key } = await syncedDeck();
    await openDeck(key);
    expect(screen.getByTestId("deck-share")).toBeEnabled();
  });
});

describe("feuille de partage d'un deck", () => {
  it("vide : le dit, et propose un aperçu de ce qui sera public, notes masquées par défaut", async () => {
    const { key } = await syncedDeck();
    const sheet = await openSheet(key);
    expect(await within(sheet).findByTestId("share-empty")).toBeInTheDocument();
    expect(within(sheet).getByTestId("share-preview-name")).toHaveTextContent("Banu Princes");
    expect(within(sheet).getByTestId("share-preview-archetype")).toHaveTextContent("Bleed");
    await waitFor(() => expect(within(sheet).getByTestId("share-preview-author")).toHaveTextContent("@lea-v"));
    expect(within(sheet).getByTestId("share-preview-notes")).toHaveTextContent("Masquées");
    expect(within(sheet).getByTestId("share-show-notes")).not.toBeChecked();
    expect(within(sheet).queryByTestId("share-purge")).not.toBeInTheDocument(); // rien à purger
  });

  it("liste les liens du deck : genre, date, version d'origine, case et « Copier le lien »", async () => {
    const { app, key, deckId } = await syncedDeck();
    seed(
      app.ui,
      shareOf(deckId, 5, { kind: "frozen", deck_version_number: 2 }),
      shareOf(deckId, 4),
      shareOf(deckId + 1, 3, {}, { id: deckId + 1, name: "Autre" }),
    );
    const sheet = await openSheet(key);
    const rows = await within(sheet).findAllByTestId("share-row");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByTestId("share-kind")).toHaveTextContent("Figé");
    expect(within(rows[0]).getByTestId("share-meta")).toHaveTextContent("version v2 · 20 novembre 2026");
    expect(within(rows[1]).getByTestId("share-kind")).toHaveTextContent("Vivant");
    expect(within(rows[1]).getByTestId("share-select")).not.toBeChecked();
    expect(within(rows[1]).getByTestId("share-copy")).toHaveTextContent("Copier le lien");
  });

  it("crée un lien vivant, notes masquées, et le met en tête de la liste", async () => {
    const { app, key, deckId } = await syncedDeck();
    const sheet = await openSheet(key);
    await within(sheet).findByTestId("share-empty");
    fireEvent.click(within(sheet).getByTestId("share-create"));
    expect(await within(sheet).findByTestId("share-feedback")).toHaveTextContent("Lien vivant créé.");
    expect(app.ui.shares.bodies).toEqual([{ kind: "live", show_notes: false }]);
    expect(app.ui.requests).toContainEqual({ method: "POST", path: `/decks/${deckId}/partages`, search: "" });
    const rows = within(sheet).getAllByTestId("share-row");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveAttribute("data-kind", "live");
  });

  it("« Montrer les notes » les ajoute à l'aperçu et au corps de la création, d'un lien figé", async () => {
    const { app, key } = await syncedDeck();
    const sheet = await openSheet(key);
    await within(sheet).findByTestId("share-empty");
    fireEvent.click(within(sheet).getByTestId("share-kind-frozen"));
    expect(within(sheet).getByTestId("share-kind-hint")).toHaveTextContent("ne bougera plus");
    fireEvent.click(within(sheet).getByTestId("share-show-notes"));
    expect(within(sheet).getByTestId("share-preview-notes")).toHaveTextContent("Mes remarques");
    fireEvent.click(within(sheet).getByTestId("share-create"));
    expect(await within(sheet).findByTestId("share-feedback")).toHaveTextContent("Lien figé créé.");
    expect(app.ui.shares.bodies).toEqual([{ kind: "frozen", show_notes: true }]);
  });

  it("un figé attend la file du deck : « Créer » est désactivé avec le nombre de modifications, le vivant non", async () => {
    const server = createFakeServer();
    const { app, key } = await syncedDeck({}, server);
    server.next.networkFailure = true;
    await app.runtime.actions.updateDeck(key, { name: "Banu Princes bis" });
    await act(async () => {
      await app.settle();
    });
    const sheet = await openSheet(key);
    await within(sheet).findByTestId("share-empty");
    expect(within(sheet).getByTestId("share-create")).toBeEnabled(); // vivant : n'attend pas
    fireEvent.click(within(sheet).getByTestId("share-kind-frozen"));
    expect(await within(sheet).findByTestId("share-blocked")).toHaveTextContent(
      "1 modification à synchroniser avant de figer la liste",
    );
    expect(within(sheet).getByTestId("share-create")).toBeDisabled();
    fireEvent.click(within(sheet).getByTestId("share-kind-live"));
    expect(within(sheet).queryByTestId("share-blocked")).not.toBeInTheDocument();
  });

  it("copie le lien de l'origine de la PWA en contexte sécurisé", async () => {
    Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const { app, key, deckId } = await syncedDeck();
    seed(app.ui, shareOf(deckId, 7, { token: "aB3x_9pQ" }));
    const sheet = await openSheet(key);
    fireEvent.click(await within(sheet).findByTestId("share-copy"));
    await waitFor(() => expect(within(sheet).getByTestId("share-copied")).toHaveAttribute("data-outcome", "copied"));
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/#/liste/aB3x_9pQ`);
  });

  it("hors contexte sécurisé, sélectionne le lien et le dit", async () => {
    Object.defineProperty(window, "isSecureContext", { configurable: true, value: false });
    const { app, key, deckId } = await syncedDeck();
    seed(app.ui, shareOf(deckId, 7, { token: "aB3x_9pQ" }));
    const sheet = await openSheet(key);
    fireEvent.click(await within(sheet).findByTestId("share-copy"));
    const link = (await within(sheet).findByTestId("share-copied-link")) as HTMLInputElement;
    expect(within(sheet).getByTestId("share-copied")).toHaveTextContent("Copie automatique impossible");
    expect(link.value).toBe(`${window.location.origin}/#/liste/aB3x_9pQ`);
    await waitFor(() => expect(document.activeElement).toBe(link));
    expect(link.selectionEnd).toBe(link.value.length);
  });

  it("purge la sélection après confirmation du nombre de liens, par scope=selected", async () => {
    const { app, key, deckId } = await syncedDeck();
    seed(app.ui, shareOf(deckId, 12), shareOf(deckId, 11), shareOf(deckId, 10));
    const sheet = await openSheet(key);
    const rows = await within(sheet).findAllByTestId("share-row");
    fireEvent.click(within(rows[0]).getByTestId("share-select"));
    fireEvent.click(within(rows[2]).getByTestId("share-select"));
    fireEvent.click(within(sheet).getByTestId("share-purge"));
    expect(within(sheet).getByTestId("share-purge-warning")).toHaveTextContent("Purger 2 liens ?");
    expect(app.ui.requests.some((request) => request.method === "DELETE")).toBe(false);

    fireEvent.click(within(sheet).getByTestId("share-purge-cancel"));
    expect(within(sheet).queryByTestId("share-purge-warning")).not.toBeInTheDocument();

    fireEvent.click(within(sheet).getByTestId("share-purge"));
    fireEvent.click(within(sheet).getByTestId("share-purge-confirm"));
    expect(await within(sheet).findByTestId("share-feedback")).toHaveTextContent("2 liens purgés.");
    const request = app.ui.requests.find((item) => item.method === "DELETE");
    expect(request?.path).toBe("/moi/partages");
    expect(new URLSearchParams(request?.search).get("scope")).toBe("selected");
    expect(new URLSearchParams(request?.search).getAll("share_id")).toEqual(["12", "10"]);
    await waitFor(() => expect(within(sheet).getAllByTestId("share-row")).toHaveLength(1));
  });

  it("un refus de sélection (404) relit la liste et le dit", async () => {
    const { app, key, deckId } = await syncedDeck();
    seed(app.ui, shareOf(deckId, 12), shareOf(deckId, 11));
    const sheet = await openSheet(key);
    const rows = await within(sheet).findAllByTestId("share-row");
    fireEvent.click(within(rows[0]).getByTestId("share-select"));
    app.ui.shares.list = [shareOf(deckId, 11)]; // le lien 12 a été purgé depuis un autre appareil
    fireEvent.click(within(sheet).getByTestId("share-purge"));
    fireEvent.click(within(sheet).getByTestId("share-purge-confirm"));
    expect(await within(sheet).findByTestId("share-error")).toHaveTextContent("La sélection ne correspond plus");
    await waitFor(() => expect(within(sheet).getAllByTestId("share-row")).toHaveLength(1));
  });

  it("rend un échec de lecture avec « Réessayer »", async () => {
    const { app, key, deckId } = await syncedDeck();
    app.ui.shares.failures.set(`GET /decks/${deckId}/partages`, "network");
    const sheet = await openSheet(key);
    expect(await within(sheet).findByTestId("share-list-error")).toHaveTextContent("injoignable");
    app.ui.shares.failures.clear();
    fireEvent.click(within(sheet).getByTestId("share-list-retry"));
    expect(await within(sheet).findByTestId("share-empty")).toBeInTheDocument();
  });

  it("une création refusée affiche le message du serveur", async () => {
    const { app, key, deckId } = await syncedDeck();
    app.ui.shares.failures.set(`POST /decks/${deckId}/partages`, { status: 409, body: { detail: "Deck supprimé." } });
    const sheet = await openSheet(key);
    await within(sheet).findByTestId("share-empty");
    fireEvent.click(within(sheet).getByTestId("share-create"));
    expect(await within(sheet).findByTestId("share-error")).toHaveTextContent("Deck supprimé.");
  });

  it("au mobile, la même feuille", async () => {
    setViewportWidth(390);
    const { key } = await syncedDeck();
    const sheet = await openSheet(key);
    expect(await within(sheet).findByTestId("share-empty")).toBeInTheDocument();
    expect(within(sheet).getByTestId("share-create")).toBeEnabled();
  });
});

describe("feuille de partage d'une version jouée", () => {
  async function openVersionSheet() {
    const server = createFakeServer();
    const { app, key, deckId } = await syncedDeck({}, server);
    await act(async () => {
      await app.runtime.db.deckVersions.put({
        id: 9,
        deckId,
        number: 2,
        createdAt: "2026-10-24T10:00:00Z",
        cryptCount: 0,
        libraryCount: 0,
        cards: [],
      });
    });
    await go({ name: "deckVersion", key, number: 2 });
    await screen.findByTestId("deck-version-share");
    fireEvent.click(screen.getByTestId("deck-version-share"));
    return { app, sheet: await screen.findByTestId("share-sheet") };
  }

  it("crée un figé de cette version, sans choix de genre", async () => {
    const { app, sheet } = await openVersionSheet();
    expect(await within(sheet).findByTestId("share-from-version")).toHaveTextContent("v2");
    expect(within(sheet).queryByTestId("share-kind-live")).not.toBeInTheDocument();
    fireEvent.click(within(sheet).getByTestId("share-create"));
    expect(await within(sheet).findByTestId("share-feedback")).toHaveTextContent("Lien figé créé.");
    expect(app.ui.shares.bodies).toEqual([{ kind: "frozen", show_notes: false, deck_version_number: 2 }]);
    expect(within(sheet).getByTestId("share-meta")).toHaveTextContent("version v2");
  });

  it("n'attend pas la file du deck : la version est déjà connue du serveur", async () => {
    const server = createFakeServer();
    const { app, key, deckId } = await syncedDeck({}, server);
    await act(async () => {
      await app.runtime.db.deckVersions.put({
        id: 9,
        deckId,
        number: 1,
        createdAt: "2026-10-24T10:00:00Z",
        cryptCount: 0,
        libraryCount: 0,
        cards: [],
      });
    });
    server.next.networkFailure = true;
    await app.runtime.actions.updateDeck(key, { name: "Banu bis" });
    await act(async () => {
      await app.settle();
    });
    await go({ name: "deckVersion", key, number: 1 });
    fireEvent.click(await screen.findByTestId("deck-version-share"));
    const sheet = await screen.findByTestId("share-sheet");
    await within(sheet).findByTestId("share-empty");
    expect(within(sheet).queryByTestId("share-blocked")).not.toBeInTheDocument();
    expect(within(sheet).getByTestId("share-create")).toBeEnabled();
  });

  it("le bouton est grisé hors ligne, la raison dite", async () => {
    const { app, key, deckId } = await syncedDeck();
    await act(async () => {
      await app.runtime.db.deckVersions.put({
        id: 9,
        deckId,
        number: 1,
        createdAt: "2026-10-24T10:00:00Z",
        cryptCount: 0,
        libraryCount: 0,
        cards: [],
      });
    });
    await go({ name: "deckVersion", key, number: 1 });
    await screen.findByTestId("deck-version-share");
    act(() => setOnline(false));
    expect(screen.getByTestId("deck-version-share")).toBeDisabled();
    expect(screen.getByTestId("deck-version-share-offline")).toHaveTextContent("réseau");
  });
});

describe("confirmation de suppression d'un deck", () => {
  async function archivedDeck() {
    const { app, key, deckId } = await syncedDeck();
    await openDeck(key);
    fireEvent.click(screen.getByTestId("deck-archive"));
    await screen.findByTestId("deck-archived-note");
    return { app, key, deckId };
  }

  it("dit combien de liens figés resteront publics, et renvoie à « Listes partagées »", async () => {
    const { app, deckId } = await archivedDeck();
    seed(
      app.ui,
      shareOf(deckId, 3, { kind: "frozen" }),
      shareOf(deckId, 2, { kind: "frozen" }),
      shareOf(deckId, 1),
    );
    fireEvent.click(screen.getByTestId("deck-delete"));
    const note = await screen.findByTestId("deck-delete-shares");
    expect(note).toHaveTextContent("2 liens figés resteront publics après la suppression.");
    expect(note).toHaveTextContent("1 lien vivant sera révoqué.");
    const link = within(note).getByTestId("deck-delete-shares-link");
    expect(link).toHaveAttribute("href", hrefFor({ name: "account" }));
  });

  it("ne dit rien d'un deck sans lien", async () => {
    await archivedDeck();
    fireEvent.click(screen.getByTestId("deck-delete"));
    await screen.findByTestId("deck-delete-confirm");
    await waitFor(() => expect(screen.queryByTestId("deck-delete-shares")).not.toBeInTheDocument());
  });

  it("hors ligne : une phrase prudente, sans nombre", async () => {
    const { app } = await archivedDeck();
    seed(app.ui);
    act(() => setOnline(false));
    fireEvent.click(screen.getByTestId("deck-delete"));
    const note = await screen.findByTestId("deck-delete-shares");
    expect(note.textContent ?? "").not.toMatch(/\d/);
    expect(note).toHaveTextContent("resteront publics");
  });
});

describe("écran Compte : « Listes partagées »", () => {
  const frozenGone = { id: 9, name: "Ancien deck", discriminator: "0042", deleted_at: "2026-11-10T00:00:00Z" };
  const three = (ui: UiServer) =>
    seed(
      ui,
      shareOf(1, 30, { kind: "frozen", deck_version_number: 3 }),
      shareOf(1, 20),
      shareOf(2, 10, {}, { id: 2, name: "Autre", discriminator: "0007", archived_at: "2026-11-01T00:00:00Z" }),
      shareOf(9, 5, { kind: "frozen" }, frozenGone),
    );

  async function openAccount(options: AppOptions = {}) {
    const app = await renderApp({ hash: "#/compte", account: ACCOUNT, configure: three, ...options });
    await screen.findByTestId("account-page");
    return app;
  }

  it("groupe les liens par deck, ceux d'un deck supprimé à part et sans case", async () => {
    await openAccount();
    const groups = await screen.findAllByTestId("account-shares-group");
    expect(groups.map((group) => within(group).getByTestId("account-shares-group-title").textContent)).toEqual([
      "Banu Princes#0001",
      "Autre#0007 · archivé",
    ]);
    expect(within(groups[0]).getAllByTestId("account-shares-row")).toHaveLength(2);
    expect(within(groups[0]).getAllByTestId("account-shares-select")).toHaveLength(2);

    const deleted = screen.getByTestId("account-shares-deleted");
    expect(within(deleted).getByTestId("account-shares-deleted-item")).toHaveTextContent("Ancien deck#0042");
    expect(within(deleted).queryByTestId("account-shares-deleted-select")).not.toBeInTheDocument();
    expect(within(deleted).getByTestId("account-shares-deleted-copy")).toBeInTheDocument();
  });

  it("purge la sélection : confirmation avec le nombre, puis le retour de l'API", async () => {
    const app = await openAccount();
    const groups = await screen.findAllByTestId("account-shares-group");
    expect(screen.getByTestId("account-shares-purge-selected")).toBeDisabled();
    fireEvent.click(within(groups[0]).getAllByTestId("account-shares-select")[1]);
    fireEvent.click(within(groups[1]).getByTestId("account-shares-select"));
    fireEvent.click(screen.getByTestId("account-shares-purge-selected"));
    expect(screen.getByTestId("account-shares-purge-warning")).toHaveTextContent("Purger 2 liens ?");

    fireEvent.click(screen.getByTestId("account-shares-purge-cancel"));
    expect(app.ui.requests.some((request) => request.method === "DELETE")).toBe(false);

    fireEvent.click(screen.getByTestId("account-shares-purge-selected"));
    fireEvent.click(screen.getByTestId("account-shares-purge-confirm"));
    expect(await screen.findByTestId("account-shares-feedback")).toHaveTextContent("2 liens purgés.");
    const request = app.ui.requests.find((item) => item.method === "DELETE" && item.path === "/moi/partages");
    expect(new URLSearchParams(request?.search).get("scope")).toBe("selected");
    expect(new URLSearchParams(request?.search).getAll("share_id")).toEqual(["20", "10"]);
    await waitFor(() => expect(screen.getAllByTestId("account-shares-row")).toHaveLength(1));
  });

  it("purge les liens des decks supprimés, avec leur nombre, et garde les autres", async () => {
    const app = await openAccount();
    await screen.findByTestId("account-shares-deleted");
    expect(screen.getByTestId("account-shares-purge-deleted_decks")).toHaveTextContent("(1)");
    fireEvent.click(screen.getByTestId("account-shares-purge-deleted_decks"));
    expect(screen.getByTestId("account-shares-purge-warning")).toHaveTextContent("1 lien de decks supprimés");
    fireEvent.click(screen.getByTestId("account-shares-purge-confirm"));
    expect(await screen.findByTestId("account-shares-feedback")).toHaveTextContent("1 lien purgé.");
    expect(app.ui.requests).toContainEqual({ method: "DELETE", path: "/moi/partages", search: "?scope=deleted_decks" });
    await waitFor(() => expect(screen.queryByTestId("account-shares-deleted")).not.toBeInTheDocument());
    expect(screen.getAllByTestId("account-shares-row")).toHaveLength(3);
    expect(screen.getByTestId("account-shares-purge-deleted_decks")).toBeDisabled();
  });

  it("« Tout purger » confirme avec le total, puis vide la liste", async () => {
    const app = await openAccount();
    await screen.findAllByTestId("account-shares-group");
    fireEvent.click(screen.getByTestId("account-shares-purge-all"));
    expect(screen.getByTestId("account-shares-purge-warning")).toHaveTextContent("4 liens du compte");
    expect(screen.getByTestId("account-shares-purge-confirm")).toHaveTextContent("Tout purger (4)");
    fireEvent.click(screen.getByTestId("account-shares-purge-confirm"));
    expect(await screen.findByTestId("account-shares-feedback")).toHaveTextContent("4 liens purgés.");
    expect(app.ui.requests).toContainEqual({ method: "DELETE", path: "/moi/partages", search: "?scope=all" });
    expect(await screen.findByTestId("account-shares-empty")).toBeInTheDocument();
  });

  it("un refus de sélection (409) relit la liste", async () => {
    const app = await openAccount();
    const groups = await screen.findAllByTestId("account-shares-group");
    fireEvent.click(within(groups[0]).getAllByTestId("account-shares-select")[0]);
    app.ui.shares.failures.set("DELETE /moi/partages", { status: 409, body: { detail: "Le lien 30 vise un deck supprimé." } });
    fireEvent.click(screen.getByTestId("account-shares-purge-selected"));
    fireEvent.click(screen.getByTestId("account-shares-purge-confirm"));
    expect(await screen.findByTestId("account-shares-action-error")).toHaveTextContent("La sélection ne correspond plus");
    expect(screen.queryByTestId("account-shares-purge-warning")).not.toBeInTheDocument();
    await waitFor(() =>
      expect(app.ui.requests.filter((request) => request.method === "GET" && request.path === "/moi/partages")).toHaveLength(2),
    );
  });

  it("sans lien : le dit", async () => {
    await openAccount({ configure: () => {} });
    expect(await screen.findByTestId("account-shares-empty")).toHaveTextContent("Aucun lien de partage");
  });

  it("hors ligne : un bloc remplace la liste", async () => {
    await openAccount({ online: false });
    expect(screen.getByTestId("account-shares-offline")).toHaveTextContent("Liste indisponible hors ligne");
    expect(screen.queryByTestId("account-shares-purge-all")).not.toBeInTheDocument();
  });

  it("au mobile aussi, dans la colonne unique", async () => {
    setViewportWidth(390);
    await openAccount();
    expect(await screen.findAllByTestId("account-shares-group")).toHaveLength(2);
    expect(screen.getByTestId("account-shares-purge-all")).toBeEnabled();
  });
});
