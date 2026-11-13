import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { hrefFor } from "../../../src/app/routes";
import { createFakeServer, type FakeParticipation, type FakeServer } from "../offline/fakeServer";
import { crypt, mirrorRows } from "../offline/fixtures/syntheticCatalog";
import { renderApp, type AppOptions } from "./harness";

/**
 * Lot 8, étape D1 : deck des adversaires et ligne sans nom dans la saisie
 * (1b-48, 1b-49, d27), version jouée, positions et « Figer sur la liste
 * actuelle » dans le détail d'une partie (1b-50, 1b-51, d28, d29).
 */

/** jsdom vaut 1024 (bureau) : le mobile se fixe avant le rendu, et se remet après coup. */
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

/** Trois vampires, pour trois clans au miroir (la liste des clans se déduit de la crypte). */
const CLAN_CARDS = [
  crypt({ id: 801, name: "Tremere Un", clan: "Tremere" }),
  crypt({ id: 802, name: "Brujah Un", clan: "Brujah" }),
  crypt({ id: 803, name: "Ministry Un", clan: "Ministry" }),
];
const clanId = (name: string) => CLAN_CARDS.find((card) => card.clan?.name === name)!.clan!.id;

async function seedClans(app: Awaited<ReturnType<typeof renderApp>>) {
  const { cards, details } = mirrorRows(CLAN_CARDS);
  await act(async () => {
    await app.runtime.db.cards.bulkPut(cards);
    await app.runtime.db.cardDetails.bulkPut(details);
  });
}

describe("saisie : deck des adversaires et ligne sans nom", () => {
  it("aide proie / prédateur, position, clan choisi dans la feuille, archétype à décocher, nom, puis l'envoi", async () => {
    setViewportWidth(390);
    const app = await renderApp({ online: false, hash: "#/parties" });
    await seedClans(app);
    await screen.findByTestId("games-empty");

    fireEvent.click(screen.getByTestId("game-add"));
    await screen.findByTestId("game-form");
    fireEvent.click(screen.getByTestId("game-form-seat-2"));
    fireEvent.click(screen.getByTestId("game-form-opponents-toggle"));
    expect(screen.getByTestId("game-form-prey-hint")).toHaveTextContent(
      "Votre proie : siège 3 · Votre prédateur : siège 1",
    );

    fireEvent.change(screen.getByTestId("game-form-opponent-input"), { target: { value: "Mikael" } });
    fireEvent.click(await screen.findByTestId("game-form-opponent-create"));
    const row = await screen.findByTestId("game-form-opponent");
    fireEvent.change(within(row).getByLabelText("Siège de Mikael"), { target: { value: "3" } });
    expect(within(row).getByTestId("game-form-opponent-position")).toHaveTextContent("proie");

    // « Son deck » est replié, et le dit facultatif.
    expect(within(row).getByTestId("game-form-opponent-deck-summary")).toHaveTextContent("Facultatif");
    fireEvent.click(within(row).getByTestId("game-form-opponent-deck-toggle"));

    // Clan principal : feuille 1b-49, au mobile.
    fireEvent.click(within(row).getByTestId("game-form-opponent-clan"));
    const picker = await screen.findByTestId("game-clan-picker");
    expect(within(picker).getByText("Siège 3 · Mikael")).toBeInTheDocument();
    fireEvent.click(within(within(picker).getByTestId("game-clan-picker-options")).getByText("Tremere"));
    await screen.findByTestId("game-form");
    const back = screen.getByTestId("game-form-opponent");
    expect(within(back).getByTestId("game-form-opponent-clan")).toHaveTextContent("Tremere");

    // Archétype : une seule puce, un second toucher la décoche.
    fireEvent.click(within(back).getByTestId("game-form-opponent-archetype-rush"));
    fireEvent.click(within(back).getByTestId("game-form-opponent-archetype-wall"));
    expect(within(back).getByTestId("game-form-opponent-archetype-rush")).not.toBeChecked();
    fireEvent.click(within(back).getByTestId("game-form-opponent-archetype-wall"));
    expect(within(back).getByTestId("game-form-opponent-archetype-wall")).not.toBeChecked();
    fireEvent.click(within(back).getByTestId("game-form-opponent-archetype-wall"));
    fireEvent.change(within(back).getByTestId("game-form-opponent-deck-name"), {
      target: { value: " Tremere wall " },
    });

    // Replié, il résume ce qui est saisi.
    fireEvent.click(within(back).getByTestId("game-form-opponent-deck-toggle"));
    expect(within(back).getByTestId("game-form-opponent-deck-summary")).toHaveTextContent(
      "Tremere · Wall · Tremere wall",
    );

    fireEvent.click(screen.getByTestId("game-form-submit"));
    await waitFor(() => expect(screen.queryByTestId("game-form")).not.toBeInTheDocument());
    const created = (await app.runtime.outbox.list()).map((entry) => entry.operation).find((op) => op.type === "game.create");
    if (created?.type !== "game.create") throw new Error("game.create attendu");
    expect(created.data.participations[1]).toMatchObject({
      seat: 3,
      opponent_clan_id: clanId("Tremere"),
      opponent_deck_archetype: "wall",
      opponent_deck_name: "Tremere wall",
    });
  });

  it("une ligne sans nom exige un siège ou un deck ; un deck prêté n'a pas de sous-bloc", async () => {
    const app = await renderApp({ online: false, hash: "#/parties" });
    await seedClans(app);
    const { actions } = app.runtime;
    await actions.createDeck({ name: "Nosferatu Rush" });
    await screen.findByTestId("games-empty");

    fireEvent.click(screen.getByTestId("game-add"));
    await screen.findByTestId("game-form");
    fireEvent.click(screen.getByTestId("game-form-seat-2"));
    fireEvent.click(screen.getByTestId("game-form-opponents-toggle"));
    fireEvent.click(screen.getByTestId("game-form-add-unnamed"));

    const row = await screen.findByTestId("game-form-opponent");
    expect(row).toHaveAttribute("data-unnamed", "true");
    expect(row).toHaveTextContent("Joueur non nommé");
    expect(screen.getByTestId("game-form-unnamed-error")).toHaveTextContent(
      "Une ligne sans nom doit porter un siège ou un deck pour être enregistrée.",
    );

    // Envoi refusé tant que la ligne ne dit rien.
    fireEvent.click(screen.getByTestId("game-form-submit"));
    expect(screen.getByTestId("game-form")).toBeInTheDocument();
    expect(await app.runtime.outbox.list()).toHaveLength(1);

    // Au bureau, le clan se choisit dans une liste déroulante.
    fireEvent.click(within(row).getByTestId("game-form-opponent-deck-toggle"));
    fireEvent.change(within(row).getByTestId("game-form-opponent-clan"), {
      target: { value: String(clanId("Brujah")) },
    });
    expect(screen.queryByTestId("game-form-unnamed-error")).not.toBeInTheDocument();

    // Un deck prêté efface le deck adverse et retire le sous-bloc.
    fireEvent.change(within(row).getByLabelText("Deck prêté à Joueur non nommé"), {
      target: { value: within(row).getByText("Joue mon Nosferatu Rush").getAttribute("value") },
    });
    expect(within(row).queryByTestId("game-form-opponent-deck")).not.toBeInTheDocument();
    expect(row).toHaveTextContent("deck déjà connu");

    fireEvent.click(screen.getByTestId("game-form-submit"));
    await waitFor(() => expect(screen.queryByTestId("game-form")).not.toBeInTheDocument());
    const created = (await app.runtime.outbox.list()).map((entry) => entry.operation).find((op) => op.type === "game.create");
    if (created?.type !== "game.create") throw new Error("game.create attendu");
    const unnamed = created.data.participations[1];
    expect(unnamed).not.toHaveProperty("player");
    expect(unnamed).not.toHaveProperty("opponent_clan_id");
    expect(unnamed.deck).toHaveProperty("client_ref");
  });

  it("reporte le deck adverse d'une table relue, et le garde à la modification", async () => {
    const server = playedServer();
    const app = await openPlayed(server);
    await go({ name: "game", key: "id:2" });
    await screen.findByTestId("game-page");
    fireEvent.click(await screen.findByTestId("game-edit-table"));
    const rows = await screen.findAllByTestId("game-form-opponent");
    expect(rows).toHaveLength(2);
    await waitFor(() =>
      expect(within(rows[1]).getByTestId("game-form-opponent-deck-summary")).toHaveTextContent(
        "Ministry · Bleed · Ministry stealth bleed",
      ),
    );
    expect(within(rows[1]).getByTestId("game-form-opponent-position")).toHaveTextContent("proie");

    // Seules les notes changent : la table ne repart pas.
    fireEvent.change(screen.getByTestId("game-form-notes"), { target: { value: "Tendue" } });
    fireEvent.click(screen.getByTestId("game-form-submit"));
    await waitFor(() => expect(screen.queryByTestId("game-form")).not.toBeInTheDocument());
    const update = (await app.runtime.outbox.list()).map((entry) => entry.operation)[0];
    if (update?.type !== "game.update") throw new Error("game.update attendu");
    expect(update).not.toHaveProperty("table");
  });
});

/**
 * Un tournoi multi-deck : ronde 1 avec Toreador (v1), rondes 2 et 3 avec Banu
 * Princes (v2, figée à la ronde 2), et une amicale avec Banu Princes (v2). La
 * ronde 2 a deux adversaires : Léa (siège 1, Brujah · Rush) et un joueur non
 * nommé (siège 3, Ministry · Bleed). La liste actuelle de Banu Princes diffère
 * de la v2.
 */
function playedServer(): FakeServer {
  const server = createFakeServer();
  server.state.decks.push(
    { id: 1, name: "Banu Princes", discriminator: "1234", client_ref: null, proxy_allowed: false, archived_at: null },
    { id: 2, name: "Toreador Mass Vote", discriminator: "0002", client_ref: null, proxy_allowed: true, archived_at: null },
  );
  server.state.deckCards.push({ deck_id: 1, card_id: 801, language_code: "EN", card_set_id: 9, quantity: 3, proxy_quantity: 3 });
  server.state.deckCards.push({ deck_id: 2, card_id: 802, language_code: "EN", card_set_id: 9, quantity: 2, proxy_quantity: 2 });
  server.state.players.push({ id: 2, name: "Léa", is_me: false });
  server.state.tournaments.push({
    id: 1,
    name: "Open de Lyon",
    start_date: "2026-10-24",
    end_date: null,
    venue_id: null,
    deck_policy: "multi",
    format: "constructed",
    event_tier: "standard",
    final_deck_rule: "free_choice",
    round_count: 3,
    player_count: null,
    my_ranking: null,
    notes: null,
    updated_at: "2026-10-24T10:00:00Z",
  });
  server.state.deckVersions.push(
    { id: 9, deck_id: 1, number: 1, created_at: "2026-09-19T10:00:00Z", crypt_count: 1, library_count: 0, cards: [{ card_id: 801, quantity: 1 }] },
    { id: 10, deck_id: 1, number: 2, created_at: "2026-10-24T10:00:00Z", crypt_count: 2, library_count: 0, cards: [{ card_id: 801, quantity: 2 }] },
    { id: 20, deck_id: 2, number: 1, created_at: "2026-10-24T10:00:00Z", crypt_count: 2, library_count: 0, cards: [{ card_id: 802, quantity: 2 }] },
  );
  server.state.tournamentDeckVersions.set(1, [
    { deck_id: 1, deck_version_id: 10, deck_version_number: 2, frozen_by_game_id: 2 },
    { deck_id: 2, deck_version_id: 20, deck_version_number: 1, frozen_by_game_id: 1 },
  ]);
  const me = (deckId: number, versionId: number, number: number, seat: number): FakeParticipation => ({
    player_id: 1,
    is_me: true,
    deck_id: deckId,
    deck_version_id: versionId,
    deck_version_number: number,
    seat,
    victory_points: 3,
    game_win: true,
    notes: null,
  });
  const base = { venue_id: null, notes: null, player_count: 5 };
  server.state.games.push(
    {
      ...base,
      id: 1,
      played_at: "2026-10-24T12:00:00Z",
      tournament_id: 1,
      round_number: 1,
      round_type: "preliminary",
      updated_at: "2026-10-24T12:00:00Z",
      participations: [me(2, 20, 1, 1)],
    },
    {
      ...base,
      id: 2,
      played_at: "2026-10-24T15:00:00Z",
      tournament_id: 1,
      round_number: 2,
      round_type: "preliminary",
      updated_at: "2026-10-24T15:00:00Z",
      participations: [
        me(1, 10, 2, 2),
        {
          player_id: 2,
          is_me: false,
          deck_id: null,
          seat: 1,
          victory_points: null,
          game_win: null,
          opponent_clan_id: clanId("Brujah"),
          opponent_deck_archetype: "rush",
          notes: null,
        },
        {
          player_id: null,
          is_me: false,
          deck_id: null,
          seat: 3,
          victory_points: null,
          game_win: null,
          opponent_clan_id: clanId("Ministry"),
          opponent_deck_archetype: "bleed",
          opponent_deck_name: "Ministry stealth bleed",
          notes: null,
        },
      ],
    },
    {
      ...base,
      id: 3,
      played_at: "2026-10-24T18:00:00Z",
      tournament_id: 1,
      round_number: 3,
      round_type: "preliminary",
      updated_at: "2026-10-24T18:00:00Z",
      participations: [me(1, 10, 2, 4)],
    },
    {
      ...base,
      id: 4,
      played_at: "2026-11-05T19:30:00Z",
      tournament_id: null,
      round_number: null,
      round_type: "casual",
      updated_at: "2026-11-05T19:30:00Z",
      participations: [me(1, 10, 2, 2)],
    },
  );
  return server;
}

async function openPlayed(server: FakeServer, options: AppOptions = {}) {
  const app = await renderApp({ server, hash: "#/parties", ...options });
  await seedClans(app);
  await act(async () => {
    await app.runtime.refresh();
  });
  return app;
}

describe("détail : version jouée, deck adverse et positions", () => {
  it("dit la version, où la liste du tournoi a été figée, et le deck de chaque adversaire", async () => {
    setViewportWidth(390);
    await openPlayed(playedServer());
    await go({ name: "game", key: "id:2" });
    await screen.findByTestId("game-page");

    await waitFor(() => expect(screen.getByTestId("game-fact-deck")).toHaveTextContent("Banu Princes#1234 · v2"));
    expect(screen.getByTestId("game-fact-version-note")).toHaveTextContent("liste du tournoi, figée à cette ronde");

    const seats = screen.getAllByTestId("game-seat");
    await waitFor(() => expect(seats[0]).toHaveTextContent("Léa"));
    expect(within(seats[0]).getByTestId("game-seat-deck")).toHaveTextContent("Brujah · Rush");
    expect(within(seats[0]).getByTestId("game-seat-position")).toHaveTextContent("prédateur");
    expect(seats[1]).toHaveTextContent("Moi");
    expect(within(seats[1]).getByTestId("game-seat-deck")).toHaveTextContent("Banu Princes · v2");
    expect(seats[2]).toHaveTextContent("Joueur non nommé");
    expect(within(seats[2]).getByTestId("game-seat-deck")).toHaveTextContent("Ministry · Bleed · Ministry stealth bleed");
    expect(within(seats[2]).getByTestId("game-seat-position")).toHaveTextContent("proie");
    // Sièges 4 et 5, vides : grande proie et grand prédateur ne s'affichent que sur une ligne saisie.
    expect(within(seats[3]).queryByTestId("game-seat-position")).not.toBeInTheDocument();
  });

  it("nomme la ronde qui a figé la liste, depuis une autre ronde du tournoi", async () => {
    await openPlayed(playedServer());
    await go({ name: "game", key: "id:3" });
    await screen.findByTestId("game-page");
    await waitFor(() =>
      expect(screen.getByTestId("game-fact-version-note")).toHaveTextContent("liste du tournoi, figée à la ronde 2"),
    );
  });

  it("une partie en file attend la synchronisation, sans bouton « Figer »", async () => {
    const app = await renderApp({ online: false, hash: "#/parties" });
    const deck = await app.runtime.actions.createDeck({ name: "Banu Princes" });
    const created = await app.runtime.actions.createGame({
      roundType: "casual",
      playerCount: 4,
      participations: [{ player: "me", deck: deck.key, victoryPoints: 1 }],
    });
    await go({ name: "game", key: created.key });
    await screen.findByTestId("game-page");
    await waitFor(() =>
      expect(screen.getByTestId("game-fact-version-note")).toHaveTextContent("liste figée à la synchronisation"),
    );
    expect(screen.queryByTestId("game-freeze")).not.toBeInTheDocument();
  });
});

describe("figer sur la liste actuelle", () => {
  it("en tournoi : nomme les parties rattachées, annonce la v3, puis met le regel en file", async () => {
    setViewportWidth(390);
    const app = await openPlayed(playedServer());
    await go({ name: "game", key: "id:2" });
    await screen.findByTestId("game-page");
    await waitFor(() => expect(screen.getByTestId("game-fact-deck")).toHaveTextContent("v2"));

    fireEvent.click(screen.getByTestId("game-freeze"));
    const dialog = await screen.findByTestId("game-freeze-dialog");
    expect(await within(dialog).findByTestId("game-freeze-kicker")).toHaveTextContent("Banu Princes · v2");
    expect(within(dialog).getByTestId("game-freeze-body")).toHaveTextContent(
      "Les 2 parties du tournoi « Open de Lyon » jouées avec Banu Princes (rondes 2 et 3) seront rattachées à sa liste actuelle.",
    );
    await waitFor(() =>
      expect(within(dialog).getByTestId("game-freeze-quote")).toHaveTextContent(
        "La liste actuelle diffère de la v2 : elle deviendra la v3.",
      ),
    );
    expect(within(dialog).getByTestId("game-freeze-quote")).toHaveTextContent(
      "La ronde 1, jouée avec Toreador Mass Vote, ne change pas.",
    );
    expect(within(dialog).getByTestId("game-freeze-keep")).toHaveTextContent("Garder la v2");

    // « Garder » ne met rien en file.
    fireEvent.click(within(dialog).getByTestId("game-freeze-keep"));
    expect(screen.queryByTestId("game-freeze-dialog")).not.toBeInTheDocument();
    expect(await app.runtime.outbox.list()).toEqual([]);

    fireEvent.click(screen.getByTestId("game-freeze"));
    fireEvent.click(await within(await screen.findByTestId("game-freeze-dialog")).findByTestId("game-freeze-confirm"));
    await waitFor(() => expect(screen.queryByTestId("game-freeze-dialog")).not.toBeInTheDocument());
    const [op] = (await app.runtime.outbox.list()).map((entry) => entry.operation);
    if (op?.type !== "game.update") throw new Error("game.update attendu");
    expect(op.data).toEqual({ refreeze_decklists: true });
    expect(op).not.toHaveProperty("table");

    // En file, la version de la partie attend le serveur.
    await waitFor(() =>
      expect(screen.getByTestId("game-fact-version-note")).toHaveTextContent("liste figée à la synchronisation"),
    );
    expect(screen.queryByTestId("game-freeze")).not.toBeInTheDocument();
  });

  it("en amicale, au bureau : dialogue de d29, Entrée confirme", async () => {
    const app = await openPlayed(playedServer());
    await go({ name: "game", key: "id:4" });
    await screen.findByTestId("game-page");
    await waitFor(() => expect(screen.getByTestId("game-fact-deck")).toHaveTextContent("v2"));

    fireEvent.click(screen.getByTestId("game-freeze"));
    const dialog = await screen.findByTestId("game-freeze-dialog");
    expect(await within(dialog).findByTestId("game-freeze-kicker")).toHaveTextContent(/^Amicale du \d+ novembre · Banu Princes v2$/);
    expect(within(dialog).getByTestId("game-freeze-body")).toHaveTextContent(
      "La partie sera rattachée à la liste actuelle de Banu Princes. Utile si vous avez saisi la partie après avoir modifié le deck.",
    );
    expect(within(dialog).getByTestId("game-freeze-confirm")).toHaveTextContent("Figer la partie");

    // Le focus est sur le titre : Entrée confirme.
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Enter" });
    await waitFor(() => expect(screen.queryByTestId("game-freeze-dialog")).not.toBeInTheDocument());
    const [op] = (await app.runtime.outbox.list()).map((entry) => entry.operation);
    expect(op).toMatchObject({ type: "game.update", data: { refreeze_decklists: true } });
  });
});
