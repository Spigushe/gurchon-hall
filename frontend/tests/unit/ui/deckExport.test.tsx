import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hrefFor } from "../../../src/app/routes";
import { createFakeServer, type FakeServer } from "../offline/fakeServer";
import { crypt, library } from "../offline/fixtures/syntheticCatalog";
import { renderApp } from "./harness";

/** Lot 9, D4 : la feuille d'export au format `TEXT` de VDB, depuis un deck et depuis une version jouée. */

const go = (route: Parameters<typeof hrefFor>[0]) =>
  act(() => {
    window.location.hash = hrefFor(route);
  });

function exportServer(): FakeServer {
  const server = createFakeServer();
  server.state.catalog = [
    crypt({ id: 10, name: "Theo Bell", group: "G2", capacity: 7, clan: "Brujah", disciplines: ["CEL", "POT", "pre"] }),
    crypt({ id: 11, name: "Theo Bell", group: "G6", capacity: 7, clan: "Brujah", disciplines: ["CEL", "pot"] }),
    library({ id: 20, name: "Blur", types: ["Combat"] }),
    library({ id: 22, name: "The Sargon Fragment", types: ["Equipment"] }),
  ];
  return server;
}

let secure: PropertyDescriptor | undefined;
beforeEach(() => {
  secure = Object.getOwnPropertyDescriptor(window, "isSecureContext");
});
afterEach(() => {
  if (secure) Object.defineProperty(window, "isSecureContext", secure);
  else delete (window as { isSecureContext?: boolean }).isSecureContext;
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
  vi.restoreAllMocks();
});

async function openExport() {
  const app = await renderApp({ server: exportServer(), catalog: true, online: false });
  const { key } = await app.runtime.actions.importDeck({
    deck: { name: "Brujah: Rush", notes: "Deux lignes\nde notes", proxyAllowed: true },
    lines: [
      { cardId: 11, languageCode: "EN", cardSetId: 9, quantity: 2, proxyQuantity: 2 },
      { cardId: 20, languageCode: "EN", cardSetId: 9, quantity: 3, proxyQuantity: 3 },
      { cardId: 22, languageCode: "FR", cardSetId: 9, quantity: 1, proxyQuantity: 1 },
    ],
  });
  await go({ name: "deck", key });
  await screen.findByTestId("deck-page");
  fireEvent.click(screen.getByTestId("deck-export"));
  const sheet = await screen.findByTestId("deck-export-sheet");
  const text = await within(sheet).findByTestId("deck-export-text");
  return { ...app, sheet, text: text as HTMLTextAreaElement };
}

describe("export d'un deck", () => {
  it("montre le texte de VDB et le nom du fichier, hors ligne", async () => {
    const { sheet, text, ui } = await openExport();
    expect(within(sheet).getByTestId("deck-export-filename")).toHaveTextContent("Brujah_ Rush.txt");
    expect(text.value).toBe(
      [
        "Deck Name: Brujah: Rush",
        "Description: Deux lignes",
        "de notes",
        "",
        "",
        "Crypt (2 cards, min=14 max=14 avg=7)",
        "====================================",
        "2x Theo Bell (G6)   7 CEL pot      Brujah:6",
        "",
        "Library (4 cards)",
        "=================",
        "Equipment (1)",
        "--------------",
        "1x Sargon Fragment, The",
        "",
        "Combat (3)",
        "-----------",
        "3x Blur",
        "",
      ].join("\n"),
    );
    expect(ui.requests).toEqual([]);
  });

  it("copie en contexte sécurisé", async () => {
    Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const { sheet, text } = await openExport();
    fireEvent.click(within(sheet).getByTestId("deck-export-copy"));
    await waitFor(() =>
      expect(within(sheet).getByTestId("deck-export-outcome")).toHaveAttribute("data-outcome", "copied"),
    );
    expect(writeText).toHaveBeenCalledWith(text.value);
  });

  it("sans HTTPS, sélectionne le texte et le dit", async () => {
    Object.defineProperty(window, "isSecureContext", { configurable: true, value: false });
    const { sheet, text } = await openExport();
    fireEvent.click(within(sheet).getByTestId("deck-export-copy"));
    await waitFor(() =>
      expect(within(sheet).getByTestId("deck-export-outcome")).toHaveTextContent("Copie impossible sans HTTPS"),
    );
    expect(document.activeElement).toBe(text);
    expect(text.selectionStart).toBe(0);
    expect(text.selectionEnd).toBe(text.value.length);
  });

  it("télécharge un .txt nommé d'après le deck", async () => {
    const created: Blob[] = [];
    const createObjectURL = vi.fn((blob: Blob) => {
      created.push(blob);
      return "blob:export";
    });
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const clicked: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this);
    });
    const { sheet, text } = await openExport();
    fireEvent.click(within(sheet).getByTestId("deck-export-download"));
    expect(clicked).toHaveLength(1);
    expect(clicked[0].download).toBe("Brujah_ Rush.txt");
    expect(clicked[0].getAttribute("href")).toBe("blob:export");
    expect(await created[0].text()).toBe(text.value);
    expect(created[0].type).toBe("text/plain;charset=utf-8");
    expect(within(sheet).getByTestId("deck-export-outcome")).toHaveTextContent(
      "Fichier Brujah_ Rush.txt téléchargé.",
    );
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith("blob:export"));
  });

  it("reste possible pour un deck archivé", async () => {
    const app = await renderApp({ server: exportServer(), catalog: true, online: false });
    const { key } = await app.runtime.actions.createDeck({ name: "Rangé" });
    await app.runtime.actions.archiveDeck(key, true);
    await go({ name: "deck", key });
    await screen.findByTestId("deck-archived-note");
    expect(screen.getByTestId("deck-export")).toBeEnabled();
  });
});

describe("export d'une version jouée", () => {
  it("exporte la liste figée, nommée d'après la version", async () => {
    const server = exportServer();
    server.state.decks.push({
      id: 1,
      name: "Banu Princes",
      discriminator: "1234",
      client_ref: null,
      proxy_allowed: false,
      archived_at: null,
    });
    const app = await renderApp({ server, catalog: true, online: true });
    await act(async () => {
      await app.runtime.refresh();
      // Le miroir ne relit que les versions des decks joués : la version est posée telle qu'il l'aurait lue.
      await app.runtime.db.deckVersions.put({
        id: 9,
        deckId: 1,
        number: 2,
        createdAt: "2026-10-24T10:00:00Z",
        cryptCount: 1,
        libraryCount: 2,
        cards: [
          { cardId: 10, quantity: 1 },
          { cardId: 20, quantity: 2 },
        ],
      });
    });
    await go({ name: "deckVersion", key: "id:1", number: 2 });
    fireEvent.click(await screen.findByTestId("deck-version-export"));
    const sheet = await screen.findByTestId("deck-export-sheet");
    expect(within(sheet).getByTestId("deck-export-filename")).toHaveTextContent("Banu Princes#1234 v2.txt");
    const text = (await within(sheet).findByTestId("deck-export-text")) as HTMLTextAreaElement;
    expect(text.value).toContain("Deck Name: Banu Princes v2\n\n\nCrypt (1 cards");
    // La version d'origine d'un vampire réimprimé n'a pas de marque.
    expect(text.value).toContain("1x Theo Bell   7 CEL POT pre      Brujah:2");
    expect(text.value).toContain("Combat (2)\n-----------\n2x Blur");
    expect(text.value).not.toContain("Description:");
  });
});
