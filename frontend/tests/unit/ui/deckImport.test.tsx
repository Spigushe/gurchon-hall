import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { createFakeServer, type FakeServer } from "../offline/fakeServer";
import { crypt, library } from "../offline/fixtures/syntheticCatalog";
import { renderApp, setOnline } from "./harness";

/**
 * Lot 9, D2 : la feuille « Importer depuis VDB » — liste collée ou fichier,
 * hors ligne ; adresse d'un deck VDB lue par le serveur, en ligne ; aperçu,
 * rapport, création en une transaction de la file.
 */

function setViewportWidth(width: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: width });
}

afterEach(() => {
  setViewportWidth(1024);
});

/** Un petit catalogue : un vampire réimprimé (G2, G6), un advanced, un G5, et quelques cartes de bibliothèque. */
function importServer(): FakeServer {
  const server = createFakeServer();
  server.state.catalog = [
    crypt({ id: 10, name: "Theo Bell", group: "G2", capacity: 7, clan: "Brujah" }),
    crypt({ id: 11, name: "Theo Bell", group: "G6", capacity: 7, clan: "Brujah" }),
    crypt({ id: 12, name: "Count Germaine", group: "G4", capacity: 8, clan: "Brujah" }),
    crypt({ id: 13, name: "Count Germaine", group: "G4", capacity: 8, clan: "Brujah", advanced: true }),
    crypt({ id: 15, name: "Dmitra Ilyanova", group: "G5", capacity: 9, clan: "Brujah" }),
    library({ id: 20, name: "Blur", types: ["Combat"], cardSetIds: [9, 31] }),
    library({ id: 21, name: "Vessel", types: ["Master"], text: "Trifle." }),
    library({ id: 22, name: "The Sargon Fragment", types: ["Equipment"] }),
  ];
  return server;
}

const LIST = `Deck Name: Trophy Hunter
Author: Guillermo
Description: Un deck de test

Crypt (4 cards, min=0 max=0 avg=0)
==================================
3x Dmitra Ilyanova    9 CEL   Brujah:5
1x Theo Bell

Library (5 cards)
=================
2x Blur
2x Vessel
1x Sargon Fragment, The
4x Carte Inconnue
`;

async function openImport(options: { online?: boolean; hash?: string } = {}) {
  const app = await renderApp({
    server: importServer(),
    catalog: true,
    online: options.online ?? false,
    hash: options.hash ?? "#/decks?action=importer",
  });
  const sheet = await screen.findByTestId("deck-import-sheet");
  await within(sheet).findByTestId("deck-import-input");
  return { ...app, sheet };
}

const paste = (text: string) => fireEvent.change(screen.getByTestId("deck-import-text"), { target: { value: text } });

const deckBody = {
  vdb_deck_id: "4fc0ee5e9",
  name: "Guns and shit",
  author: "Édouard",
  description: "Date: 2026-01-25",
  cards: [
    { vekn_id: 200012, quantity: 2 },
    { vekn_id: 100020, quantity: 3 },
  ],
  fetched_at: "2026-11-14T10:00:00Z",
};

describe("import d'une liste, hors ligne", () => {
  it("lit la liste, montre l'aperçu et le rapport, crée le deck tout en proxy en une transaction", async () => {
    const { runtime, server, ui } = await openImport();
    // L'intention est consommée : un rechargement ne rouvre pas la feuille.
    expect(window.location.hash).toBe("#/decks");

    paste(LIST);
    expect(screen.getByTestId("deck-import-recognized")).toHaveTextContent(
      "Format texte de VDB · 4 cartes de crypte, 5 de bibliothèque · 1 ligne non reconnue",
    );
    fireEvent.click(screen.getByTestId("deck-import-continue"));

    const preview = await screen.findByTestId("deck-import-preview");
    expect(within(preview).getByTestId("deck-import-name")).toHaveValue("Trophy Hunter");
    expect((within(preview).getByTestId("deck-import-notes") as HTMLTextAreaElement).value).toMatch(
      /^Auteur : Guillermo\n\nUn deck de test\n\nImporté de VDB le \d+ \S+ \d{4}$/,
    );
    expect(within(preview).getByTestId("deck-import-effect")).toHaveTextContent(
      "9 cartes en proxy : le deck autorisera les proxies.",
    );
    expect(within(preview).getByTestId("deck-import-report-summary")).toHaveTextContent(
      "Rapport : 1 ligne non reconnue · 1 groupe déduit",
    );
    const report = within(preview).getAllByTestId("deck-import-report-line");
    expect(report.map((line) => line.textContent)).toEqual([
      "Ligne 8 1x Theo Bell — groupe déduit de la crypte : G6",
      "Ligne 15 4x Carte Inconnue — carte introuvable dans le catalogue",
    ]);
    await within(preview).findByTestId("deck-tables");

    fireEvent.change(within(preview).getByTestId("deck-import-name"), { target: { value: "  Chasseur  " } });
    fireEvent.click(within(preview).getByTestId("deck-import-archetype-rush"));
    fireEvent.click(within(preview).getByRole("radio", { name: "FR" }));
    fireEvent.change(within(preview).getByTestId("deck-import-notes"), { target: { value: "  " } });
    fireEvent.click(within(preview).getByTestId("deck-import-create"));

    const page = await screen.findByTestId("deck-page");
    expect(page.getAttribute("data-deck-key")).toMatch(/^ref:/);
    expect(screen.getByTestId("deck-title")).toHaveTextContent("Chasseur");
    expect(screen.queryByTestId("deck-import-sheet")).not.toBeInTheDocument();

    const operations = (await runtime.outbox.list()).map((entry) => entry.operation);
    expect(operations[0]).toMatchObject({
      type: "deck.create",
      data: { name: "Chasseur", archetype: "rush", status: "draft", proxy_allowed: true, notes: null },
    });
    expect(operations[0].data).not.toHaveProperty("vdb_deck_id");
    const lines = operations.slice(1);
    expect(lines).toHaveLength(5);
    for (const line of lines) {
      expect(line.type).toBe("deck_card.upsert");
      const data = line.data as { quantity: number; proxy_quantity: number; language_code: string };
      expect(data.proxy_quantity).toBe(data.quantity);
      expect(data.language_code).toBe("FR");
    }
    // Dernière extension de la carte (P6) : Blur a été imprimée dans 9 puis 31.
    expect(lines.find((line) => (line.data as { card_id: number }).card_id === 20)?.data).toMatchObject({ card_set_id: 31 });
    expect(server.state.requests).toEqual([]);
    expect(ui.requests).toEqual([]);
  });

  it("garde le texte au retour depuis l'aperçu, et refuse une liste sans carte reconnue", async () => {
    await openImport();
    paste("3x Carte Inconnue");
    expect(screen.getByTestId("deck-import-recognized")).toHaveTextContent("aucune carte reconnue · 1 ligne non reconnue");
    fireEvent.click(screen.getByTestId("deck-import-continue"));
    const preview = await screen.findByTestId("deck-import-preview");
    expect(within(preview).getByTestId("deck-import-effect")).toHaveTextContent("Aucune carte reconnue");
    expect(within(preview).getByTestId("deck-import-create")).toBeDisabled();
    expect(within(preview).getByTestId("deck-import-name")).toHaveValue("Deck importé");

    fireEvent.click(within(preview).getByTestId("deck-import-back"));
    expect(await screen.findByTestId("deck-import-text")).toHaveValue("3x Carte Inconnue");
  });

  it("dit la version supposée quand la crypte ne tranche pas, avec l'autre écriture", async () => {
    await openImport();
    paste("2x Count Germaine (ADV)\n1x Theo Bell\n2x Blur");
    fireEvent.click(screen.getByTestId("deck-import-continue"));
    const preview = await screen.findByTestId("deck-import-preview");
    expect(within(preview).getByTestId("deck-import-report-summary")).toHaveTextContent("Rapport : 1 version supposée");
    expect(within(preview).getByTestId("deck-import-report-line")).toHaveTextContent(
      "Ligne 2 1x Theo Bell — version supposée : G2 ; écrire (G6) pour l'autre",
    );
  });

  it("lit une adresse qui porte la liste dans le navigateur, sans appel au serveur", async () => {
    const { ui } = await openImport();
    paste("https://vdb.im/decks/deck?name=Par%20l%27adresse#200012=2;100020=1;abc");
    expect(screen.getByTestId("deck-import-recognized")).toHaveTextContent(
      "Lien VDB qui porte la liste · 2 cartes de crypte, 1 de bibliothèque · 1 ligne non reconnue",
    );
    fireEvent.click(screen.getByTestId("deck-import-continue"));
    const preview = await screen.findByTestId("deck-import-preview");
    expect(within(preview).getByTestId("deck-import-name")).toHaveValue("Par l'adresse");
    expect(within(preview).getAllByTestId("deck-import-report-line")[0]).toHaveTextContent("Entrée 3 abc — ligne illisible");
    expect(ui.requests).toEqual([]);
  });

  it("lit un fichier .txt", async () => {
    await openImport();
    const file = new File([LIST], "deck.txt", { type: "text/plain" });
    fireEvent.change(screen.getByTestId("deck-import-file"), { target: { files: [file] } });
    await waitFor(() => expect(screen.getByTestId("deck-import-text")).toHaveValue(LIST));
    expect(screen.getByTestId("deck-import-recognized")).toHaveTextContent("Format texte de VDB");
  });

  it("refuse une adresse VDB qui ne désigne pas un deck", async () => {
    await openImport();
    paste("https://vdb.im/cards/100020");
    expect(screen.getByTestId("deck-import-invalid")).toHaveTextContent("ne désigne pas un deck");
    expect(screen.getByTestId("deck-import-continue")).toBeDisabled();
  });
});

describe("import par l'adresse d'un deck VDB", () => {
  it("hors ligne : le message de P1, sans lecture", async () => {
    const { ui } = await openImport();
    paste("vdb.im/decks/4fc0ee5e9");
    expect(screen.getByTestId("deck-import-recognized")).toHaveTextContent("Lien vers un deck VDB (4fc0ee5e9)");
    expect(screen.getByTestId("deck-import-offline")).toHaveTextContent("Un lien VDB se lit en ligne.");
    expect(screen.getByTestId("deck-import-continue")).toBeDisabled();
    expect(ui.requests).toEqual([]);
  });

  it("en ligne : lit le deck par le serveur, et le deck créé garde son lien", async () => {
    const { runtime, ui } = await openImport({ online: true });
    ui.vdbDecks.set("4fc0ee5e9", deckBody);
    paste("https://vdb.im/decks/4fc0ee5e9");
    fireEvent.click(screen.getByTestId("deck-import-continue"));

    const preview = await screen.findByTestId("deck-import-preview");
    expect(ui.requests).toEqual([{ method: "GET", path: "/vdb/decks/4fc0ee5e9", search: "" }]);
    expect(within(preview).getByTestId("deck-import-source")).toHaveTextContent("lié à VDB (4fc0ee5e9)");
    expect(within(preview).getByTestId("deck-import-name")).toHaveValue("Guns and shit");
    // Deck lié : pas de date d'import dans les notes, le détail montre le lien.
    expect(within(preview).getByTestId("deck-import-notes")).toHaveValue("Auteur : Édouard\n\nDate: 2026-01-25");
    expect(within(preview).getByTestId("deck-import-report-empty")).toBeInTheDocument();

    setOnline(false);
    fireEvent.click(within(preview).getByTestId("deck-import-create"));
    await screen.findByTestId("deck-page");
    expect(screen.getByTestId("deck-vdb-link")).toHaveTextContent("vdb.im/decks/4fc0ee5e9");
    const [create] = (await runtime.outbox.list()).map((entry) => entry.operation);
    expect(create).toMatchObject({ type: "deck.create", data: { vdb_deck_id: "4fc0ee5e9", name: "Guns and shit" } });
  });

  it("un deck VDB déjà lié mène au deck existant, sans lecture ni second import (P8)", async () => {
    const { runtime, ui } = await openImport({ online: true });
    const { key } = await runtime.actions.importDeck({
      deck: { name: "Déjà là", proxyAllowed: true, vdbDeckId: "4fc0ee5e9" },
      lines: [],
    });
    paste("https://vdb.im/decks/4fc0ee5e9");
    const linked = await screen.findByTestId("deck-import-linked");
    expect(linked).toHaveTextContent("déjà lié à « Déjà là »");
    expect(screen.getByTestId("deck-import-continue")).toBeDisabled();
    expect(ui.requests).toEqual([]);
    fireEvent.click(within(linked).getByTestId("deck-import-linked-open"));
    await waitFor(() => expect(screen.getByTestId("deck-page")).toHaveAttribute("data-deck-key", key));
  });

  it("VDB rend un autre identifiant déjà lié : l'aperçu ne s'ouvre pas", async () => {
    const { runtime, ui } = await openImport({ online: true });
    await runtime.actions.importDeck({ deck: { name: "Copie", proxyAllowed: true, vdbDeckId: "4fc0ee5e9" }, lines: [] });
    // Le deck lié n'est pas encore lu quand on clique : seule la vérification après lecture le trouve.
    ui.vdbDecks.set("b4a7ee6d5", deckBody);
    paste("https://vdb.im/decks/b4a7ee6d5");
    fireEvent.click(screen.getByTestId("deck-import-continue"));
    await waitFor(() => expect(ui.requests).toHaveLength(1));
    expect(await screen.findByTestId("deck-import-linked")).toHaveTextContent("« Copie »");
    expect(screen.queryByTestId("deck-import-preview")).not.toBeInTheDocument();
  });

  it.each([
    [undefined, "Deck VDB introuvable."],
    [{ status: 429, body: { detail: "Trop" }, retryAfter: "42" }, "réessayez dans 42 s"],
    [{ status: 502, body: { detail: "VDB est injoignable." } }, "Lecture chez VDB impossible : VDB est injoignable."],
    [{ status: 401, body: { detail: "Session" } }, "Reconnexion nécessaire"],
    [{ status: 500, body: {} }, "Réponse inattendue du serveur (500)."],
    ["network", "Le serveur est injoignable."],
  ])("refus %j : %s", async (response, message) => {
    const { ui } = await openImport({ online: true });
    if (response !== undefined) ui.vdbDecks.set("4fc0ee5e9", response);
    paste("https://vdb.im/decks/4fc0ee5e9");
    fireEvent.click(screen.getByTestId("deck-import-continue"));
    expect(await screen.findByTestId("deck-import-error")).toHaveTextContent(message);
    // Une nouvelle saisie efface le refus.
    paste("https://vdb.im/decks/4fc0ee5e");
    expect(screen.queryByTestId("deck-import-error")).not.toBeInTheDocument();
  });
});

describe("entrées de l'import", () => {
  it("bureau : le bouton de l'en-tête de la liste ouvre la feuille", async () => {
    await renderApp({ server: importServer(), catalog: true, online: false, hash: "#/decks" });
    fireEvent.click(await screen.findByTestId("decks-import-desktop"));
    expect(await screen.findByTestId("deck-import-sheet")).toBeInTheDocument();
  });

  it("mobile : « Nouveau deck » propose l'import, et l'état vide aussi", async () => {
    setViewportWidth(390);
    await renderApp({ server: importServer(), catalog: true, online: false, hash: "#/decks" });
    fireEvent.click(await screen.findByTestId("deck-add"));
    fireEvent.click(await screen.findByTestId("deck-form-import"));
    expect(await screen.findByTestId("deck-import-sheet")).toBeInTheDocument();
    expect(screen.queryByTestId("deck-form-sheet")).not.toBeInTheDocument();
    fireEvent.click(within(screen.getByTestId("deck-import-sheet")).getByRole("button", { name: /fermer/i }));
    fireEvent.click(await screen.findByTestId("decks-empty-import"));
    expect(await screen.findByTestId("deck-import-sheet")).toBeInTheDocument();
  });

  it("sans catalogue sur l'appareil, l'import attend", async () => {
    await act(async () => {
      await renderApp({ server: importServer(), online: false, hash: "#/decks?action=importer" });
    });
    expect(await screen.findByTestId("deck-import-no-catalog")).toBeInTheDocument();
    paste("2x Blur");
    expect(screen.getByTestId("deck-import-continue")).toBeDisabled();
  });
});
