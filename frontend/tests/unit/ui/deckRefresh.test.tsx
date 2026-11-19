import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { hrefFor } from "../../../src/app/routes";
import type { DeckCardInput, DeckInput, DeckKey } from "../../../src/offline/vtes";
import { createFakeServer, type FakeServer } from "../offline/fakeServer";
import { crypt, library } from "../offline/fixtures/syntheticCatalog";
import { renderApp, setOnline } from "./harness";

/**
 * Lot 9, D3 : « Mettre à jour depuis VDB » d'un deck lié (P7, écran 4), depuis
 * le détail du deck et depuis la feuille d'import quand le lien collé est déjà
 * lié (P8). Lecture par le serveur en ligne, plan montré avant d'écrire, une
 * transaction de la file à « Appliquer ».
 */

function setViewportWidth(width: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: width });
}

afterEach(() => {
  setViewportWidth(1024);
});

const go = (route: Parameters<typeof hrefFor>[0]) =>
  act(() => {
    window.location.hash = hrefFor(route);
  });

function refreshServer(): FakeServer {
  const server = createFakeServer();
  server.state.catalog = [
    crypt({ id: 10, name: "Theo Bell", group: "G2", capacity: 7, clan: "Brujah" }),
    crypt({ id: 11, name: "Theo Bell", group: "G6", capacity: 7, clan: "Brujah" }),
    library({ id: 20, name: "Blur", types: ["Combat"], cardSetIds: [9, 31] }),
    library({ id: 21, name: "Vessel", types: ["Master"], text: "Trifle." }),
    library({ id: 22, name: "The Sargon Fragment", types: ["Equipment"] }),
    library({ id: 23, name: "Pursuit", types: ["Action Modifier"] }),
  ];
  return server;
}

const VDB_ID = "31203cb9e";

/** Le deck tel qu'il est lié : Theo Bell (G2) sur deux lignes, dont un exemplaire réel. */
const LINES: DeckCardInput[] = [
  { cardId: 10, languageCode: "EN", cardSetId: 9, quantity: 1, proxyQuantity: 0 },
  { cardId: 10, languageCode: "FR", cardSetId: 9, quantity: 1, proxyQuantity: 1 },
  { cardId: 20, languageCode: "EN", cardSetId: 31, quantity: 2, proxyQuantity: 2 },
  { cardId: 21, languageCode: "EN", cardSetId: 9, quantity: 6, proxyQuantity: 6 },
  { cardId: 22, languageCode: "EN", cardSetId: 9, quantity: 1, proxyQuantity: 1 },
  { cardId: 23, languageCode: "EN", cardSetId: 9, quantity: 1, proxyQuantity: 1 },
];

/** Même liste que `LINES`, carte × quantité, comme VDB la rend. */
const SAME_CARDS = [
  { vekn_id: 100020, quantity: 2 },
  { vekn_id: 100021, quantity: 6 },
  { vekn_id: 100022, quantity: 1 },
  { vekn_id: 100023, quantity: 1 },
  { vekn_id: 200010, quantity: 2 },
];

/** Theo Bell (G2) 2 → 3 (conflit), Theo Bell (G6) ajouté, Blur 2 → 3, Vessel 6 → 4, Pursuit retiré, une carte inconnue. */
const CHANGED_CARDS = [
  { vekn_id: 100020, quantity: 3 },
  { vekn_id: 100021, quantity: 4 },
  { vekn_id: 100022, quantity: 1 },
  { vekn_id: 200010, quantity: 3 },
  { vekn_id: 200011, quantity: 1 },
  { vekn_id: 299999, quantity: 1 },
];

const vdbBody = (cards: unknown[]) => ({
  vdb_deck_id: VDB_ID,
  name: "Brujah des cas difficiles",
  author: "Martin",
  description: null,
  cards,
  fetched_at: "2026-11-14T10:00:00Z",
});

/**
 * Un deck lié, rangé hors ligne puis synchronisé, et l'application revenue en
 * ligne : la file ne contient plus ensuite que ce que l'écran y range.
 */
async function linkedDeck(
  options: { deck?: Partial<DeckInput>; lines?: DeckCardInput[]; archived?: boolean; hash?: string } = {},
) {
  const app = await renderApp({ server: refreshServer(), catalog: true, online: false, hash: options.hash });
  await app.runtime.actions.saveStock({ cardId: 10, languageCode: "EN", cardSetId: 9, quantityOwned: 1 });
  const { key } = await app.runtime.actions.importDeck({
    deck: { name: "Brujah", status: "active", proxyAllowed: true, vdbDeckId: VDB_ID, ...options.deck },
    lines: options.lines ?? LINES,
  });
  if (options.archived) await app.runtime.actions.archiveDeck(key, true);
  setOnline(true);
  await app.settle();
  expect(await app.runtime.outbox.list()).toEqual([]);
  return { ...app, key };
}

async function openDeck(key: DeckKey) {
  await go({ name: "deck", key });
  return screen.findByTestId("deck-page");
}

/** Lectures chez VDB seules : le détail du deck lit aussi sa légalité en ligne. */
const vdbReads = (app: { ui: { requests: Array<{ path: string }> } }) =>
  app.ui.requests.filter((request) => request.path.startsWith("/vdb/"));

const operations = async (app: Awaited<ReturnType<typeof linkedDeck>>) =>
  (await app.runtime.outbox.list()).map((entry) => entry.operation);

describe("mise à jour depuis le détail d'un deck lié", () => {
  it("lit le deck chez VDB, montre chaque changement, puis écrit en une transaction", async () => {
    const app = await linkedDeck();
    app.ui.vdbDecks.set(VDB_ID, vdbBody(CHANGED_CARDS));
    await openDeck(app.key);
    fireEvent.click(screen.getByTestId("deck-vdb-refresh"));

    const sheet = await screen.findByTestId("deck-refresh-sheet");
    const changes = await within(sheet).findAllByTestId("deck-refresh-change");
    expect(vdbReads(app)).toEqual([{ method: "GET", path: `/vdb/decks/${VDB_ID}`, search: "" }]);
    expect(within(sheet).getByTestId("deck-refresh-source")).toHaveTextContent(
      `Deck VDB ${VDB_ID} · « Brujah des cas difficiles »`,
    );
    expect(changes.map((change) => change.textContent)).toEqual([
      "Ajoutée Theo Bell (G6) — 1 proxy",
      "Augmentée Blur — 2 → 3, 1 proxy ajouté",
      "Diminuée Vessel — 6 → 4",
      "Refaite en proxy Theo Bell (G2) — 2 lignes remplacées par 3 proxies, les exemplaires réels ont été rendus à la collection.",
      "Retirée Pursuit — 1 exemplaire retiré",
    ]);
    expect(within(sheet).getByTestId("deck-refresh-effect")).toHaveTextContent(
      "5 cartes changent, 1 inchangée. Le deck repasse en brouillon. Nom, notes, archétype et versions jouées ne changent pas.",
    );
    expect(within(sheet).getByTestId("deck-import-report-summary")).toHaveTextContent("1 ligne non reconnue");

    // L'écriture ne demande pas le réseau : seule la lecture chez VDB le demandait.
    setOnline(false);
    fireEvent.click(within(sheet).getByTestId("deck-refresh-apply"));
    await waitFor(() => expect(screen.queryByTestId("deck-refresh-sheet")).not.toBeInTheDocument());

    const ops = await operations(app);
    expect(ops.map((op) => op.type)).toEqual([
      "deck.update",
      "deck_card.delete",
      "deck_card.delete",
      "deck_card.delete",
      "deck_card.upsert",
      "deck_card.upsert",
      "deck_card.upsert",
      "deck_card.upsert",
    ]);
    expect(ops[0]).toEqual(expect.objectContaining({ type: "deck.update", data: { status: "draft" } }));
    const upserts = ops.filter((op) => op.type === "deck_card.upsert").map((op) => op.data);
    expect(upserts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ card_id: 11, language_code: "EN", card_set_id: 9, quantity: 1, proxy_quantity: 1 }),
        expect.objectContaining({ card_id: 10, language_code: "EN", card_set_id: 9, quantity: 3, proxy_quantity: 3 }),
        expect.objectContaining({ card_id: 20, language_code: "EN", card_set_id: 31, quantity: 3, proxy_quantity: 3 }),
        expect.objectContaining({ card_id: 21, language_code: "EN", card_set_id: 9, quantity: 4, proxy_quantity: 4 }),
      ]),
    );
    await waitFor(() => expect(screen.getByTestId("deck-status")).toHaveAttribute("data-status", "draft"));
  });

  it("listes identiques : « Rien à mettre à jour », rien n'est écrit", async () => {
    const app = await linkedDeck();
    app.ui.vdbDecks.set(VDB_ID, vdbBody(SAME_CARDS));
    await openDeck(app.key);
    fireEvent.click(screen.getByTestId("deck-vdb-refresh"));

    const sheet = await screen.findByTestId("deck-refresh-sheet");
    expect(await within(sheet).findByTestId("deck-refresh-effect")).toHaveTextContent(
      "Rien à mettre à jour : le deck a déjà la liste de VDB.",
    );
    const apply = within(sheet).getByTestId("deck-refresh-apply");
    expect(apply).toHaveTextContent("Rien à mettre à jour");
    expect(apply).toBeDisabled();
    expect(within(sheet).queryByTestId("deck-refresh-changes")).not.toBeInTheDocument();
    expect(await operations(app)).toEqual([]);
  });

  it("un refus de lecture se dit, et « Réessayer » relit", async () => {
    const app = await linkedDeck();
    app.ui.vdbDecks.set(VDB_ID, { status: 502, body: { detail: "VDB est injoignable." } });
    await openDeck(app.key);
    fireEvent.click(screen.getByTestId("deck-vdb-refresh"));

    expect(await screen.findByTestId("deck-refresh-error")).toHaveTextContent(
      "Lecture chez VDB impossible : VDB est injoignable.",
    );
    app.ui.vdbDecks.set(VDB_ID, vdbBody(SAME_CARDS));
    fireEvent.click(screen.getByTestId("deck-refresh-retry"));
    expect(await screen.findByTestId("deck-refresh-effect")).toHaveTextContent("Rien à mettre à jour");
    expect(vdbReads(app)).toHaveLength(2);
  });

  it("hors ligne, l'action est grisée et sa raison dite, au mobile", async () => {
    setViewportWidth(390);
    const app = await linkedDeck();
    setOnline(false);
    await openDeck(app.key);
    const button = screen.getByTestId("deck-vdb-refresh");
    expect(button).toBeDisabled();
    expect(screen.getByTestId("deck-vdb-refresh-offline")).toHaveTextContent("demande le réseau");
    expect(vdbReads(app)).toEqual([]);
  });

  it("un deck archivé ne se met pas à jour", async () => {
    const app = await linkedDeck({ archived: true });
    await openDeck(app.key);
    const button = screen.getByTestId("deck-vdb-refresh");
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", "Désarchivez le deck pour le mettre à jour.");
  });

  it("un deck non lié n'a pas l'action", async () => {
    const app = await linkedDeck({ deck: { vdbDeckId: undefined } });
    await openDeck(app.key);
    expect(screen.getByTestId("deck-export")).toBeInTheDocument();
    expect(screen.queryByTestId("deck-vdb-refresh")).not.toBeInTheDocument();
  });

  it("rend l'autorisation de proxy à un deck qui l'avait perdue, et le dit", async () => {
    // Tous les proxies convertis, puis l'autorisation retirée : il ne reste qu'un exemplaire réel.
    const app = await linkedDeck({
      deck: { proxyAllowed: false },
      lines: [{ cardId: 10, languageCode: "EN", cardSetId: 9, quantity: 1, proxyQuantity: 0 }],
    });
    app.ui.vdbDecks.set(VDB_ID, vdbBody([{ vekn_id: 100020, quantity: 1 }, { vekn_id: 200010, quantity: 1 }]));
    await openDeck(app.key);
    fireEvent.click(screen.getByTestId("deck-vdb-refresh"));
    expect(await screen.findByTestId("deck-refresh-effect")).toHaveTextContent(
      "Il autorisera de nouveau les proxies, que la mise à jour ajoute.",
    );
    setOnline(false);
    fireEvent.click(screen.getByTestId("deck-refresh-apply"));
    await waitFor(() => expect(screen.queryByTestId("deck-refresh-sheet")).not.toBeInTheDocument());
    const [update] = await operations(app);
    expect(update).toMatchObject({ type: "deck.update", data: { status: "draft", proxy_allowed: true } });
  });
});

describe("mise à jour depuis la feuille d'import (P8)", () => {
  it("un lien déjà lié propose la mise à jour, qui lit VDB puis ouvre le deck", async () => {
    const app = await linkedDeck({ hash: "#/decks" });
    app.ui.vdbDecks.set(VDB_ID, vdbBody(CHANGED_CARDS));
    await go({ name: "decks", intent: "import" });
    const sheet = await screen.findByTestId("deck-import-sheet");
    fireEvent.change(await within(sheet).findByTestId("deck-import-text"), {
      target: { value: `https://vdb.im/decks/${VDB_ID}` },
    });
    const notice = await within(sheet).findByTestId("deck-import-linked");
    expect(notice).toHaveTextContent("mettez ce deck à jour");
    fireEvent.click(within(notice).getByTestId("deck-import-linked-refresh"));

    expect(await within(sheet).findAllByTestId("deck-refresh-change")).toHaveLength(5);
    expect(vdbReads(app)).toHaveLength(1);
    setOnline(false);
    fireEvent.click(within(sheet).getByTestId("deck-refresh-apply"));
    await waitFor(() => expect(screen.getByTestId("deck-page")).toHaveAttribute("data-deck-key", app.key));
    expect(screen.queryByTestId("deck-import-sheet")).not.toBeInTheDocument();
    expect((await operations(app))[0]).toMatchObject({ type: "deck.update", data: { status: "draft" } });
  });

  it("le deck VDB déjà lu n'est pas relu", async () => {
    const app = await linkedDeck({ hash: "#/decks" });
    // L'adresse collée désigne un autre identifiant ; VDB rend celui du deck lié.
    app.ui.vdbDecks.set("b4a7ee6d5", vdbBody(SAME_CARDS));
    await go({ name: "decks", intent: "import" });
    const sheet = await screen.findByTestId("deck-import-sheet");
    fireEvent.change(await within(sheet).findByTestId("deck-import-text"), {
      target: { value: "https://vdb.im/decks/b4a7ee6d5" },
    });
    fireEvent.click(within(sheet).getByTestId("deck-import-continue"));
    const notice = await within(sheet).findByTestId("deck-import-linked");
    fireEvent.click(within(notice).getByTestId("deck-import-linked-refresh"));
    expect(await within(sheet).findByTestId("deck-refresh-effect")).toHaveTextContent("Rien à mettre à jour");
    expect(vdbReads(app)).toHaveLength(1);
  });

  it("un deck lié archivé : la notice le dit et ne propose pas la mise à jour", async () => {
    const app = await linkedDeck({ archived: true, hash: "#/decks" });
    await go({ name: "decks", intent: "import" });
    const sheet = await screen.findByTestId("deck-import-sheet");
    fireEvent.change(await within(sheet).findByTestId("deck-import-text"), {
      target: { value: `https://vdb.im/decks/${VDB_ID}` },
    });
    const notice = await within(sheet).findByTestId("deck-import-linked");
    expect(within(notice).getByTestId("deck-import-linked-archived")).toHaveTextContent("Désarchivez le deck");
    expect(within(notice).queryByTestId("deck-import-linked-refresh")).not.toBeInTheDocument();
    expect(vdbReads(app)).toEqual([]);
  });
});
