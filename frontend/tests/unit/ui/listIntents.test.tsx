import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { releaseListIntent } from "../../../src/features/share/listIntent";
import { createFakeServer, type FakeServer } from "../offline/fakeServer";
import { crypt, library } from "../offline/fixtures/syntheticCatalog";
import { renderApp, type UiServer } from "./harness";

/**
 * Lot 13, D5 : « Dupliquer » et « Comparer » une liste partagée depuis
 * l'application, par les intentions `#/decks?action=dupliquer|comparer&liste=…`.
 * La liste se lit en ligne (`GET /listes/{token}`), le deck s'écrit par la file.
 */

const TOKEN = "aB3x_9pQ";
const ANSON = crypt({ id: 1, name: "Anson", clan: "Ventrue", group: "2" });
const BECKETT = crypt({ id: 2, name: "Beckett", clan: "Gangrel", group: "2" });
const BLUR = library({ id: 10, name: "Blur", types: ["Combat"], cardSetIds: [3, 5] });
const VESSEL = library({ id: 11, name: "Vessel", types: ["Master"] });

const LIST = {
  name: "Banu Princes",
  archetype: "bleed",
  kind: "live",
  frozen_at: null,
  author: "alice",
  notes: "Notes de la liste.",
  cards: [
    { card: ANSON, quantity: 4 },
    { card: BLUR, quantity: 3 },
    { card: VESSEL, quantity: 2 },
  ],
  reprinted_card_ids: [],
};

function listServer(): FakeServer {
  const server = createFakeServer();
  server.state.catalog = [ANSON, BECKETT, BLUR, VESSEL];
  return server;
}

const serve = (list: unknown = LIST) => (ui: UiServer) => ui.lists.set(TOKEN, list);

async function openIntent(action: string, options: { server?: FakeServer; list?: unknown; revision?: string } = {}) {
  const revision = options.revision ? `&revision=${options.revision}` : "";
  const app = await renderApp({
    server: options.server ?? listServer(),
    catalog: true,
    autoRefresh: options.server !== undefined,
    hash: `#/decks?action=${action}&liste=${TOKEN}${revision}`,
    configure: serve(options.list),
  });
  return { ...app, sheet: await screen.findByTestId("list-intent-sheet") };
}

/** Charge utile d'une opération de la file (toutes celles lues ici portent `data`). */
const dataOf = (operation: unknown) => (operation as { data: Record<string, unknown> }).data;

/**
 * Opérations écrites par la saisie, dans l'ordre : le moteur de rejeu tourne
 * (en ligne), si bien qu'une partie peut déjà être partie au serveur simulé
 * quand le test lit la file. On lit donc les deux, envoyées d'abord.
 */
async function writtenOperations(runtime: { outbox: { list(): Promise<Array<{ operation: unknown }>> } }, server: FakeServer) {
  const sent = server.state.requests
    .filter((request) => request.path === "/sync")
    .flatMap((request) => (request.body as { operations: unknown[] }).operations);
  const queued = (await runtime.outbox.list()).map((entry) => entry.operation);
  const seen = new Set(sent.map((operation) => (operation as { operation_id: string }).operation_id));
  return [...sent, ...queued.filter((operation) => !seen.has((operation as { operation_id: string }).operation_id))] as Array<{
    type: string;
    data: Record<string, unknown>;
  }>;
}

afterEach(() => {
  cleanup();
  releaseListIntent();
});

describe("Dupliquer une liste partagée", () => {
  it("lit la liste, montre l'aperçu et crée un deck tout en proxy par la file", async () => {
    const { runtime, server, ui, sheet } = await openIntent("dupliquer");
    const preview = await within(sheet).findByTestId("list-duplicate-preview");
    // L'intention est consommée : un rechargement ne rouvre pas la feuille.
    expect(window.location.hash).toBe("#/decks");
    expect(within(preview).getByTestId("list-duplicate-name")).toHaveValue("Banu Princes");
    expect((within(preview).getByTestId("list-duplicate-notes") as HTMLTextAreaElement).value).toMatch(
      /^Notes de la liste\.\n\nDupliqué de la liste partagée le \d+ \S+ \d{4}$/,
    );
    expect(within(preview).getByTestId("list-duplicate-archetype-bleed")).toBeChecked();
    expect(within(preview).getByTestId("list-duplicate-effect")).toHaveTextContent("9 cartes en proxy");
    await within(preview).findByTestId("deck-tables");

    fireEvent.change(within(preview).getByTestId("list-duplicate-name"), { target: { value: "Ma copie" } });
    fireEvent.click(within(preview).getByTestId("list-duplicate-create"));

    expect((await screen.findByTestId("deck-page")).getAttribute("data-deck-key")).toMatch(/^ref:/);
    expect(screen.queryByTestId("list-intent-sheet")).not.toBeInTheDocument();
    const operations = await writtenOperations(runtime, server);
    expect(operations[0]).toMatchObject({
      type: "deck.create",
      data: { name: "Ma copie", archetype: "bleed", status: "draft", proxy_allowed: true },
    });
    expect(operations[0]).not.toHaveProperty("data.vdb_deck_id");
    const lines = operations.slice(1);
    expect(lines.map((line) => [line.type, dataOf(line).card_id, dataOf(line).quantity, dataOf(line).proxy_quantity])).toEqual([
      ["deck_card.upsert", 1, 4, 4],
      ["deck_card.upsert", 10, 3, 3],
      ["deck_card.upsert", 11, 2, 2],
    ]);
    // Dernière extension de la carte, anglais.
    expect(dataOf(lines.find((line) => dataOf(line).card_id === 10))).toMatchObject({ language_code: "EN", card_set_id: 5 });
    // La liste est lue une fois ; la page du deck créé peut faire ses propres
    // lectures en ligne ensuite (légalité), selon le moment.
    expect(ui.requests.filter((request) => request.path.startsWith("/listes/"))).toEqual([
      { method: "GET", path: `/listes/${TOKEN}`, search: "" },
    ]);
  });

  it("duplique la liste retouchée par la révision de l'adresse, et signale l'illisible", async () => {
    const { runtime, server, sheet } = await openIntent("dupliquer", { revision: "2=1;11=-2;zz" });
    const preview = await within(sheet).findByTestId("list-duplicate-preview");
    expect(within(preview).getByTestId("list-intent-unreadable")).toHaveTextContent("1 modification illisible ignorée");
    expect(within(preview).getByTestId("list-duplicate-source")).toHaveTextContent("révision");
    await within(preview).findByTestId("deck-tables");
    fireEvent.click(within(preview).getByTestId("list-duplicate-create"));
    await screen.findByTestId("deck-page");
    const lines = (await writtenOperations(runtime, server)).slice(1);
    expect(lines.map((line) => [dataOf(line).card_id, dataOf(line).quantity])).toEqual([
      [1, 4],
      [2, 1],
      [10, 3],
    ]);
  });

  it("bloque « Créer » pour une carte que le catalogue de l'appareil ne connaît pas", async () => {
    const unknown = { ...LIST, cards: [...LIST.cards, { card: crypt({ id: 99, name: "Inconnu" }), quantity: 1 }] };
    const { runtime, sheet } = await openIntent("dupliquer", { list: unknown });
    const preview = await within(sheet).findByTestId("list-duplicate-preview");
    expect(await within(preview).findByTestId("list-intent-missing")).toHaveTextContent("ne connaît pas 1 carte");
    expect(within(preview).getByTestId("list-duplicate-create")).toBeDisabled();
    expect(await runtime.outbox.list()).toEqual([]);
  });

  it("hors ligne, dit que la liste demande le réseau, sans rien écrire", async () => {
    const { runtime, sheet } = await openIntent("dupliquer", { list: "network" });
    expect(await within(sheet).findByTestId("list-intent-read-error")).toHaveTextContent("demande une connexion au réseau");
    expect(await runtime.outbox.list()).toEqual([]);
  });

  it("dit « Liste introuvable » pour un lien révoqué", async () => {
    await renderApp({ server: listServer(), catalog: true, hash: `#/decks?action=dupliquer&liste=${TOKEN}` });
    expect(await screen.findByTestId("list-intent-read-error")).toHaveTextContent("Liste introuvable");
  });

  it("garde l'intention quand l'application est démontée puis remontée avant la fin (session expirée)", async () => {
    await openIntent("dupliquer");
    await screen.findByTestId("list-duplicate-preview");
    cleanup();
    await renderApp({ server: listServer(), catalog: true, hash: "#/decks", configure: serve() });
    expect(await screen.findByTestId("list-duplicate-preview")).toBeInTheDocument();
  });
});

describe("Comparer une liste partagée", () => {
  function compareServer(): FakeServer {
    const server = listServer();
    server.state.decks.push(
      { id: 5, name: "Mon Banu", discriminator: "0005", client_ref: null, proxy_allowed: true, archived_at: null },
      { id: 6, name: "Vieux deck", discriminator: "0006", client_ref: null, proxy_allowed: false, archived_at: "2026-01-01T00:00:00Z" },
    );
    const line = (card_id: number, quantity: number, language_code = "EN", card_set_id = 9) => ({
      deck_id: 5,
      card_id,
      language_code,
      card_set_id,
      quantity,
      proxy_quantity: 0,
    });
    // Mon deck : Anson 4, Beckett 1, Blur 1 + 1 (deux langues). La liste : Anson 4, Blur 3, Vessel 2.
    server.state.deckCards.push(line(1, 4), line(2, 1), line(10, 1, "EN", 3), line(10, 1, "FR", 5));
    return server;
  }

  it("lit la liste puis propose mes decks, archivés compris, et ouvre l'écran de comparaison", async () => {
    const { sheet } = await openIntent("comparer", { server: compareServer() });
    const choices = await within(sheet).findAllByTestId("list-compare-choose");
    expect(choices.map((choice) => choice.textContent)).toEqual([
      expect.stringContaining("Mon Banu"),
      expect.stringContaining("Vieux deck"),
    ]);
    fireEvent.click(choices[0]);
    expect(window.location.hash).toBe(`#/decks/id:5/comparer/${TOKEN}`);

    const page = await screen.findByTestId("compare-page");
    await within(page).findByTestId("compare-changes");
    expect(within(page).getByTestId("compare-counts-mine-crypt")).toHaveTextContent("5");
    expect(within(page).getByTestId("compare-counts-mine-library")).toHaveTextContent("2");
    expect(within(page).getByTestId("compare-counts-shared-crypt")).toHaveTextContent("4");
    expect(within(page).getByTestId("compare-counts-shared-library")).toHaveTextContent("5");
    expect(within(within(page).getByTestId("compare-only-in")).getByText("Vessel")).toBeInTheDocument();
    expect(within(within(page).getByTestId("compare-only-out")).getByText(/Beckett/)).toBeInTheDocument();
    expect(within(within(page).getByTestId("compare-different-qty")).getByText("Blur")).toBeInTheDocument();
    // Mon deck est l'arrivée : de la quantité de la liste à la mienne.
    expect(within(page).getByTestId("compare-different-qty")).toHaveTextContent("3 → 2");
    // Mon deck en tableaux, chaque ligne marquée de son écart à la liste, sans stepper.
    const tables = within(page).getByTestId("deck-tables");
    expect(tables.getAttribute("data-editable")).toBe("false");
    const deltaOf = (name: RegExp) =>
      within(within(tables).getByText(name).closest("[data-testid='deck-card']") as HTMLElement).queryByTestId("revision-delta")
        ?.textContent ?? null;
    expect(deltaOf(/Beckett/)).toBe("nouvelle");
    expect(deltaOf(/Blur/)).toBe("−1");
    expect(deltaOf(/Anson/)).toBeNull();
    // Vessel, seulement dans la liste partagée, figure dans les tableaux à 0.
    const vessel = within(tables).getByText(/Vessel/).closest("[data-testid='deck-card']") as HTMLElement;
    expect(vessel.getAttribute("data-quantity")).toBe("0");
    expect(vessel.className).toContain("revision-row--removed");
    expect(within(vessel).getByTestId("revision-delta")).toHaveTextContent("−2");
    expect(within(page).queryByTestId("revision-removed")).toBeNull();
    // Bloc des écarts : mon deck, quantités différentes, puis la liste partagée.
    const groups = [...within(page).getByTestId("compare-changes").querySelectorAll("[data-testid^='compare-']")].map(
      (group) => group.getAttribute("data-testid"),
    );
    expect(groups.filter((id) => id !== "compare-identical")).toEqual(["compare-only-out", "compare-different-qty", "compare-only-in"]);
    expect(within(page).queryByText(/cartes? distinctes?/)).toBeNull();
    // Lecture seule : rien pour appliquer les différences.
    expect(within(page).queryByRole("button", { name: /appliquer|ajouter|retirer/i })).toBeNull();
  });

  it("se recharge sur son adresse, et applique la révision", async () => {
    await renderApp({
      server: compareServer(),
      catalog: true,
      autoRefresh: true,
      hash: `#/decks/id:5/comparer/${TOKEN}?revision=2=-1;11=-2;10=1`,
      configure: serve(),
    });
    const page = await screen.findByTestId("compare-page");
    await within(page).findByTestId("compare-changes");
    // Liste révisée : Anson 4, Blur 4 ; Vessel retiré, Beckett (absent de la liste) reste absent.
    expect(within(page).queryByTestId("compare-only-in")).toBeNull();
    expect(within(page).getByTestId("compare-only-out")).toHaveTextContent("Beckett");
    expect(within(page).getByTestId("compare-different-qty")).toHaveTextContent("4 → 2");
    expect(within(page).getByTestId("compare-counts-shared-library")).toHaveTextContent("4");
  });

  it("dit que les deux listes sont identiques, et signale un écart illisible", async () => {
    const server = listServer();
    server.state.decks.push({ id: 5, name: "Clone", discriminator: "0005", client_ref: null, proxy_allowed: true, archived_at: null });
    for (const [card_id, quantity] of [[1, 4], [10, 3], [11, 2]]) {
      server.state.deckCards.push({ deck_id: 5, card_id, language_code: "EN", card_set_id: 9, quantity, proxy_quantity: 0 });
    }
    await renderApp({
      server,
      catalog: true,
      autoRefresh: true,
      hash: `#/decks/id:5/comparer/${TOKEN}?revision=zz`,
      configure: serve(),
    });
    const page = await screen.findByTestId("compare-page");
    expect(await within(page).findByTestId("compare-identical")).toHaveTextContent("identiques");
    expect(within(page).getByTestId("list-intent-unreadable")).toHaveTextContent("1 modification illisible ignorée");
  });

  it("dit que la liste demande le réseau quand elle n'est pas joignable", async () => {
    await renderApp({
      server: compareServer(),
      catalog: true,
      autoRefresh: true,
      hash: `#/decks/id:5/comparer/${TOKEN}`,
      configure: serve("network"),
    });
    expect(await screen.findByTestId("list-intent-read-error")).toHaveAttribute("data-reason", "offline");
  });

  it("dit qu'un deck inconnu n'existe pas sur l'appareil", async () => {
    await renderApp({
      server: compareServer(),
      catalog: true,
      autoRefresh: true,
      hash: `#/decks/id:77/comparer/${TOKEN}`,
      configure: serve(),
    });
    await waitFor(() => expect(screen.getByTestId("compare-deck-missing")).toBeInTheDocument());
  });
});
