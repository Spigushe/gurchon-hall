import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { hrefFor } from "../../../src/app/routes";
import { gameWinAdvice, vpOverTable } from "../../../src/features/games/gameFormModel";
import { dayHeading, formatVp, fromLocalInput, roundLabel, toLocalInput } from "../../../src/features/games/gameFormat";
import { createFakeServer, type FakeServer } from "../offline/fakeServer";
import { flushEffects, renderApp, type AppOptions } from "./harness";

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

/**
 * Un serveur factice déjà peuplé : deux decks, un lieu, un adversaire connu, un tournoi
 * multi-deck (règle « meilleur deck », deck 1 admis en finale) avec deux rondes, et une
 * partie amicale. Rafraîchi dans le miroir avant l'ouverture de l'écran.
 */
function seededServer(): FakeServer {
  const server = createFakeServer();
  server.state.decks.push(
    { id: 1, name: "Banu Princes", discriminator: "0001", client_ref: null, proxy_allowed: false, archived_at: null },
    { id: 2, name: "Toreador Mass Vote", discriminator: "0002", client_ref: null, proxy_allowed: false, archived_at: null },
  );
  server.state.venues.push({ id: 1, name: "Le Bar à Dés", city: "Lyon", notes: null });
  server.state.players.push({ id: 2, name: "Marc F.", is_me: false });
  server.state.tournaments.push({
    id: 1,
    name: "Open de Lyon",
    start_date: "2026-10-24",
    end_date: null,
    venue_id: 1,
    deck_policy: "multi",
    format: "constructed",
    event_tier: "standard",
    final_deck_rule: "best_performing",
    round_count: 3,
    player_count: null,
    my_ranking: null,
    notes: null,
    updated_at: "2026-10-24T10:00:00Z",
  });
  server.state.admissible.set(1, [1]);
  const me = (deck_id: number, victory_points: number, game_win: boolean) => ({
    player_id: 1,
    is_me: true,
    deck_id,
    seat: 2,
    victory_points,
    game_win,
    notes: null,
  });
  const marc = { player_id: 2, is_me: false, deck_id: 2, seat: 3, victory_points: null, game_win: null, notes: null };
  server.state.games.push(
    {
      id: 1,
      played_at: "2026-10-24T12:00:00Z",
      venue_id: 1,
      tournament_id: 1,
      round_number: 1,
      round_type: "preliminary",
      player_count: 5,
      notes: null,
      updated_at: "2026-10-24T12:00:00Z",
      participations: [me(2, 1.5, false)],
    },
    {
      id: 2,
      played_at: "2026-10-24T15:00:00Z",
      venue_id: 1,
      tournament_id: 1,
      round_number: 2,
      round_type: "preliminary",
      player_count: 5,
      notes: null,
      updated_at: "2026-10-24T15:00:00Z",
      participations: [me(1, 3, true), marc],
    },
    {
      id: 3,
      played_at: "2026-10-22T18:00:00Z",
      venue_id: null,
      tournament_id: null,
      round_number: null,
      round_type: "casual",
      player_count: 4,
      notes: null,
      updated_at: "2026-10-22T18:00:00Z",
      participations: [me(1, 2, false)],
    },
  );
  return server;
}

async function openSeeded(options: AppOptions = {}) {
  const server = seededServer();
  const app = await renderApp({ server, hash: "#/parties", ...options });
  await act(async () => {
    await app.runtime.refresh();
  });
  return app;
}

/** Choisit une valeur dans un `ChoicePanel` ouvert. */
function pick(panelTestId: string, label: string | RegExp) {
  fireEvent.click(within(screen.getByTestId(`${panelTestId}-options`)).getByText(label));
}

describe("règles de la saisie (fonctions pures)", () => {
  it("le GW certain est verrouillé, l'incertain se déclare, moins de 2 VP l'interdit", () => {
    expect(gameWinAdvice(5, 3, false)).toMatchObject({
      locked: true,
      checked: true,
      help: "Coché d'office : 3 VP à 5 joueurs, vous êtes seul en tête.",
      error: null,
    });
    expect(gameWinAdvice(5, 3, false, true).help).toBe(
      "Victoire certaine : le serveur refusera une partie sans Game Win.",
    );
    expect(gameWinAdvice(4, 2.5, false).locked).toBe(true);
    // Correction du 2026-11-02 : 2,5 VP à cinq rendent le GW certain, pas à six.
    expect(gameWinAdvice(5, 2.5, false)).toMatchObject({
      locked: true,
      checked: true,
      help: "Coché d'office : 2,5 VP à 5 joueurs, vous êtes seul en tête.",
    });
    expect(gameWinAdvice(6, 2.5, false).locked).toBe(false);
    expect(gameWinAdvice(5, 2, false)).toMatchObject({
      locked: false,
      checked: false,
      help: "À vous de le dire : 2 VP à 5 ne suffisent pas à le savoir.",
    });
    expect(gameWinAdvice(5, 1, false).help).toBe("Possible à partir de 2 VP.");
    expect(gameWinAdvice(5, 1, true).error).toBe("Un Game Win demande au moins 2 VP.");
  });

  it("signale des VP au-delà de la table, avec le nombre en lettres", () => {
    expect(vpOverTable(4, 4)).toBeNull();
    expect(vpOverTable(4, 4.5)).toBe("Au plus 4 VP à quatre joueurs.");
    expect(vpOverTable(5, 6)).toBe("Au plus 5 VP à cinq joueurs.");
  });

  it("met en forme VP, rondes et dates locales", () => {
    expect(formatVp(2.5)).toBe("2,5");
    expect(formatVp(3)).toBe("3");
    expect(roundLabel({ roundType: "final", roundNumber: null })).toBe("finale");
    expect(roundLabel({ roundType: "preliminary", roundNumber: 2 })).toBe("ronde 2");
    expect(roundLabel({ roundType: "casual", roundNumber: null })).toBeNull();
    const local = toLocalInput(new Date(2026, 9, 24, 21, 42));
    expect(local).toBe("2026-10-24T21:42");
    expect(fromLocalInput(local)).toBe(new Date(2026, 9, 24, 21, 42).toISOString());
    expect(fromLocalInput("")).toBeNull();
    expect(dayHeading(new Date(2026, 9, 24, 12).toISOString())).toBe("Samedi 24 octobre");
  });
});

describe("navigation des parties", () => {
  it("pose l'onglet Parties dans la tab bar et dans la barre haute, actif sur toutes les routes concernées", async () => {
    const app = await openSeeded();
    await screen.findByTestId("games-page");
    expect(screen.getByTestId("nav-games")).toHaveAttribute("aria-current", "page");
    expect(screen.getByTestId("topnav-games")).toHaveAttribute("aria-current", "page");
    expect(screen.getByTestId("nav-decks")).not.toHaveAttribute("aria-current");
    // Entre Decks et Chercher (tab bar), entre Decks et Synchronisation (barre haute).
    const tabs = Array.from(document.querySelectorAll(".tabbar__item")).map((el) => el.textContent);
    expect(tabs).toEqual(["Atelier", "Collection", "Decks", "Parties", "Chercher"]);
    const top = Array.from(document.querySelectorAll(".topbar__tab")).map((el) => el.getAttribute("data-testid"));
    expect(top).toEqual(["topnav-home", "topnav-stock", "topnav-decks", "topnav-games", "topnav-sync"]);

    await go({ name: "tournaments" });
    await screen.findByTestId("tournaments-page");
    expect(screen.getByTestId("nav-games")).toHaveAttribute("aria-current", "page");
    expect(screen.getByTestId("topnav-games")).toHaveAttribute("aria-current", "page");

    const first = (await app.runtime.db.games.toArray())[0];
    await go({ name: "game", key: `id:${first.id}` });
    await screen.findByTestId("game-page");
    expect(screen.getByTestId("topnav-games")).toHaveAttribute("aria-current", "page");
  });

  it("le raccourci G P ouvre les parties", async () => {
    await renderApp({ hash: "#/decks" });
    await screen.findByTestId("decks-page");
    await flushEffects();
    fireEvent.keyDown(document, { key: "g" });
    fireEvent.keyDown(document, { key: "p" });
    await screen.findByTestId("games-page");
    expect(window.location.hash).toBe("#/parties");
  });

  it("consomme l'intention #/parties?action=nouvelle une seule fois", async () => {
    await renderApp({ online: false, hash: "#/parties?action=nouvelle" });
    await screen.findByTestId("game-form");
    await waitFor(() => expect(window.location.hash).toBe("#/parties"));
    fireEvent.click(within(screen.getByTestId("game-form-sheet")).getByRole("button", { name: "Fermer" }));
    await waitFor(() => expect(screen.queryByTestId("game-form")).not.toBeInTheDocument());
    expect(window.location.hash).toBe("#/parties");
  });
});

describe("liste des parties", () => {
  it("affiche l'état vide, puis la pilule ouvre la saisie", async () => {
    setViewportWidth(390);
    await renderApp({ online: false, hash: "#/parties" });
    expect(await screen.findByTestId("games-empty")).toHaveTextContent("Notez votre première partie");
    fireEvent.click(screen.getByTestId("game-add"));
    expect(await screen.findByTestId("game-form")).toBeInTheDocument();
  });

  it("groupe par jour au mobile, avec résultat, GW et méta", async () => {
    setViewportWidth(390);
    await openSeeded();
    await screen.findByTestId("game-list");
    const days = screen.getAllByTestId("game-day");
    expect(days).toHaveLength(2);
    const items = screen.getAllByTestId("game-item");
    expect(items).toHaveLength(3);
    // La plus récente en haut : la ronde 2, 3 VP et GW.
    expect(items[0]).toHaveTextContent("Banu Princes");
    expect(items[0]).toHaveTextContent("Open de Lyon · ronde 2");
    expect(items[0]).toHaveTextContent("Le Bar à Dés");
    expect(within(items[0]).getByTestId("game-result")).toHaveTextContent("3 VP · GW");
    expect(items[1]).toHaveTextContent("1,5 VP");
    expect(items[2]).toHaveTextContent("Amicale");
    expect(screen.getByTestId("games-count")).toHaveTextContent("3 parties");
  });

  it("filtre par type, par deck et par lieu, et dit quand rien ne correspond", async () => {
    setViewportWidth(390);
    await openSeeded();
    await screen.findByTestId("game-list");

    fireEvent.click(within(screen.getByTestId("game-type-tabs")).getByLabelText("Amicale"));
    await waitFor(() => expect(screen.getAllByTestId("game-item")).toHaveLength(1));
    fireEvent.click(within(screen.getByTestId("game-type-tabs")).getByLabelText("Tournoi"));
    await waitFor(() => expect(screen.getAllByTestId("game-item")).toHaveLength(2));

    fireEvent.click(screen.getByTestId("game-filters-open"));
    const sheet = await screen.findByTestId("game-filters-sheet");
    fireEvent.change(within(sheet).getByTestId("game-filter-deck"), { target: { value: "id:2" } });
    await waitFor(() => expect(screen.getAllByTestId("game-item")).toHaveLength(1));
    fireEvent.click(within(sheet).getByTestId("game-filters-done"));

    fireEvent.click(within(screen.getByTestId("game-type-tabs")).getByLabelText("Amicale"));
    expect(await screen.findByTestId("games-no-match")).toHaveTextContent(
      "Aucune partie ne correspond à ces filtres.",
    );
  });

  it("montre la pastille « en attente » d'une partie saisie hors ligne", async () => {
    setViewportWidth(390);
    const app = await renderApp({ online: false, hash: "#/parties" });
    await app.runtime.actions.createGame({
      playedAt: "2026-10-24T20:00:00Z",
      playerCount: 5,
      participations: [{ player: "me", victoryPoints: 2 }],
    });
    const item = await screen.findByTestId("game-item");
    expect(item).toHaveAttribute("data-pending", "true");
    expect(within(item).getByTestId("pending-badge")).toHaveTextContent("En attente de synchronisation");
    expect(item).toHaveTextContent("Sans deck");
  });

  it("au bureau : tableau triable, détail à droite, et la sélection change le détail", async () => {
    await openSeeded();
    await screen.findByTestId("game-table-desktop");
    expect(screen.getByTestId("games-count")).toHaveTextContent("3 parties · 1 tournoi");
    expect(screen.getByTestId("play-switch-games")).toHaveTextContent("Parties · 3");
    expect(screen.getByTestId("play-switch-tournaments")).toHaveTextContent("Tournois · 1");
    const rows = () => screen.getAllByTestId("game-item");
    expect(rows()).toHaveLength(3);
    // Date décroissante par défaut, première ligne sélectionnée.
    expect(rows()[0]).toHaveAttribute("data-selected", "true");
    expect(within(screen.getByTestId("games-detail")).getByTestId("game-detail-title")).toHaveTextContent(
      "3 VP · Game Win",
    );

    fireEvent.click(within(rows()[2]).getByTestId("game-select"));
    await waitFor(() =>
      expect(within(screen.getByTestId("games-detail")).getByTestId("game-detail-kicker")).toHaveTextContent(
        "Amicale",
      ),
    );

    fireEvent.click(screen.getByTestId("game-sort-date"));
    await waitFor(() => expect(rows()[0]).toHaveTextContent("Amicale"));
    fireEvent.click(screen.getByTestId("game-sort-result"));
    await waitFor(() => expect(rows()[0]).toHaveTextContent("3 VP"));

    fireEvent.change(screen.getByTestId("game-filter-type"), { target: { value: "casual" } });
    await waitFor(() => expect(rows()).toHaveLength(1));
  });
});

describe("saisie d'une partie", () => {
  it("entre dans la file hors ligne : lieu créé, deck, siège, VP, GW verrouillé, adversaire avec deck prêté", async () => {
    setViewportWidth(390);
    const app = await renderApp({ online: false, hash: "#/parties" });
    const { actions } = app.runtime;
    const banu = await actions.createDeck({ name: "Banu Princes" });
    await actions.createDeck({ name: "Nosferatu Rush" });
    await screen.findByTestId("games-empty");

    fireEvent.click(screen.getByTestId("game-add"));
    const form = await screen.findByTestId("game-form");

    // Lieu : création au fil de la frappe.
    fireEvent.click(within(form).getByTestId("game-form-venue"));
    fireEvent.change(await screen.findByTestId("game-venue-picker-search"), { target: { value: "Chez Marc" } });
    fireEvent.click(screen.getByTestId("game-venue-picker-create"));
    await waitFor(() => expect(screen.getByTestId("game-form-venue")).toHaveTextContent("Chez Marc"));

    // Mon deck.
    fireEvent.click(screen.getByTestId("game-form-deck-change"));
    pick("game-deck-picker", "Banu Princes");
    expect(await screen.findByTestId("game-form-deck")).toHaveTextContent("Banu Princes");

    // Siège et VP par demi-points : 3 VP à 5 joueurs rendent le GW certain.
    fireEvent.click(screen.getByTestId("game-form-seat-2"));
    for (let i = 0; i < 6; i += 1) fireEvent.click(screen.getByLabelText("Ajouter un demi-point de VP"));
    expect(screen.getByTestId("game-form-vp-value")).toHaveTextContent("3 VP");
    expect(screen.getByTestId("game-form-gw")).toBeChecked();
    expect(screen.getByTestId("game-form-gw-help")).toHaveTextContent(
      "Coché d'office : 3 VP à 5 joueurs, vous êtes seul en tête.",
    );
    expect(screen.getByTestId("game-form-gw-lock")).toBeInTheDocument();

    // Le GW certain ne se décoche pas : l'aide explique pourquoi.
    fireEvent.click(screen.getByTestId("game-form-gw"));
    expect(screen.getByTestId("game-form-gw")).toBeChecked();
    expect(screen.getByTestId("game-form-gw-help")).toHaveTextContent(
      "Victoire certaine : le serveur refusera une partie sans Game Win.",
    );

    // Adversaire nommé, avec un de mes decks prêté.
    fireEvent.click(screen.getByTestId("game-form-opponents-toggle"));
    fireEvent.change(screen.getByTestId("game-form-opponent-input"), { target: { value: "Marc" } });
    fireEvent.click(await screen.findByTestId("game-form-opponent-create"));
    const opponent = await screen.findByTestId("game-form-opponent");
    expect(opponent).toHaveTextContent("Marc");
    fireEvent.change(within(opponent).getByLabelText("Deck prêté à Marc"), {
      target: { value: within(opponent).getByText("Joue mon Nosferatu Rush").getAttribute("value") },
    });
    fireEvent.change(within(opponent).getByLabelText("Siège de Marc"), { target: { value: "4" } });

    fireEvent.change(screen.getByTestId("game-form-notes"), { target: { value: "Table tendue" } });
    fireEvent.click(screen.getByTestId("game-form-submit"));

    await waitFor(() => expect(screen.queryByTestId("game-form")).not.toBeInTheDocument());
    const ops = (await app.runtime.outbox.list()).map((entry) => entry.operation);
    expect(ops.map((op) => op.type)).toEqual([
      "deck.create",
      "deck.create",
      "venue.create",
      "player.create",
      "game.create",
    ]);
    const created = ops[4];
    if (created.type !== "game.create") throw new Error("game.create attendu");
    expect(created.data).toMatchObject({
      player_count: 5,
      round_type: "casual",
      notes: "Table tendue",
    });
    expect(created.data.participations).toHaveLength(2);
    expect(created.data.participations[0]).toMatchObject({ seat: 2, victory_points: 3, game_win: true });
    expect(created.data.participations[0].deck).toEqual({ client_ref: banu.key.replace(/^ref:/, "") });
    expect(created.data.participations[1]).toMatchObject({ seat: 4 });
    expect(created.data.participations[1]).not.toHaveProperty("victory_points");
    expect(created.data.participations[1].deck).toHaveProperty("client_ref");
    expect(app.server.state.requests).toEqual([]);

    // La liste l'affiche aussitôt, en attente.
    const item = await screen.findByTestId("game-item");
    expect(item).toHaveAttribute("data-pending", "true");
    expect(item).toHaveTextContent("Banu Princes");
    expect(within(item).getByTestId("game-result")).toHaveTextContent("3 VP · GW");
  });

  it("un GW incertain se déclare ; moins de 2 VP coché affiche l'erreur", async () => {
    await renderApp({ online: false, hash: "#/parties?action=nouvelle" });
    await screen.findByTestId("game-form");
    const gw = screen.getByTestId("game-form-gw");
    expect(screen.getByTestId("game-form-gw-help")).toHaveTextContent("Possible à partir de 2 VP.");
    fireEvent.click(gw);
    expect(gw).toBeChecked();
    expect(screen.getByTestId("game-form-gw-error")).toHaveTextContent("Un Game Win demande au moins 2 VP.");
    for (let i = 0; i < 4; i += 1) fireEvent.click(screen.getByLabelText("Ajouter un demi-point de VP"));
    expect(screen.getByTestId("game-form-gw-help")).toHaveTextContent(
      "À vous de le dire : 2 VP à 5 ne suffisent pas à le savoir.",
    );
    expect(screen.queryByTestId("game-form-gw-error")).not.toBeInTheDocument();
    fireEvent.click(gw);
    expect(gw).not.toBeChecked();
  });

  it("prévient des VP au-delà de la table après une baisse du nombre de joueurs", async () => {
    await renderApp({ online: false, hash: "#/parties?action=nouvelle" });
    await screen.findByTestId("game-form");
    for (let i = 0; i < 10; i += 1) fireEvent.click(screen.getByLabelText("Ajouter un demi-point de VP"));
    expect(screen.getByTestId("game-form-vp-value")).toHaveTextContent("5 VP");
    expect(screen.queryByTestId("game-form-vp-error")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("game-form-count-4"));
    expect(screen.getByTestId("game-form-vp-error")).toHaveTextContent("Au plus 4 VP à quatre joueurs.");
  });

  it("propose « Autre » de 2 à 6 joueurs", async () => {
    await renderApp({ online: false, hash: "#/parties?action=nouvelle" });
    await screen.findByTestId("game-form");
    fireEvent.click(screen.getByTestId("game-form-count-other"));
    pick("game-count-picker", "6 joueurs");
    expect(await screen.findByTestId("game-form-count-other")).toBeChecked();
    expect(screen.getByTestId("game-form-count-other").closest("label")).toHaveTextContent("6 joueurs");
    expect(screen.getByTestId("game-form-seat-6")).toBeInTheDocument();
  });

  it("choisir un tournoi propose la ronde suivante, le lieu du tournoi, et le deck du dernier joué", async () => {
    const opened = await openSeeded();
    await screen.findByTestId("game-table-desktop");
    fireEvent.click(screen.getByTestId("games-new-desktop"));
    await screen.findByTestId("game-form");
    // Pas de tournoi : amicale, pas de champ ronde, dernier deck joué en tête.
    expect(screen.getByTestId("game-form-tournament")).toHaveTextContent("Amicale");
    expect(screen.queryByTestId("game-form-round")).not.toBeInTheDocument();
    expect(screen.getByTestId("game-form-deck")).toHaveTextContent("Banu Princes");
    expect(screen.getByTestId("game-form-deck-hint")).toHaveTextContent("Dernier joué");

    fireEvent.click(screen.getByTestId("game-form-tournament"));
    pick("game-tournament-picker", "Open de Lyon");
    expect(await screen.findByTestId("game-form-round")).toHaveTextContent("Ronde 3");
    expect(screen.getByTestId("game-form-venue")).toHaveTextContent("Le Bar à Dés");

    fireEvent.click(screen.getByTestId("game-form-submit"));
    await waitFor(() => expect(screen.queryByTestId("game-form")).not.toBeInTheDocument());
    const ops = (await opened.runtime.outbox.list()).map((entry) => entry.operation);
    expect(ops[ops.length - 1]).toMatchObject({
      type: "game.create",
      data: { round_type: "preliminary", round_number: 3, tournament: { tournament_id: 1 } },
    });
  });

  it("en finale multi-deck, ne propose que les decks admis, avec leur meilleure ronde", async () => {
    await openSeeded();
    await screen.findByTestId("game-table-desktop");
    fireEvent.click(screen.getByTestId("games-new-desktop"));
    await screen.findByTestId("game-form");
    fireEvent.click(screen.getByTestId("game-form-tournament"));
    pick("game-tournament-picker", "Open de Lyon");
    fireEvent.click(await screen.findByTestId("game-form-round"));
    pick("game-round-picker", "Finale");

    // Le deck admis s'impose seul (le dernier joué, Banu Princes, l'est déjà).
    expect(await screen.findByTestId("game-form-deck")).toHaveTextContent("Banu Princes");
    expect(screen.getByTestId("game-form-deck-hint")).toHaveTextContent(
      "Seul deck admis par la règle « meilleur deck » de ce tournoi.",
    );
    fireEvent.click(screen.getByTestId("game-form-deck-change"));
    const options = within(screen.getByTestId("game-deck-picker-options"));
    expect(options.getByText("Banu Princes")).toBeInTheDocument();
    expect(options.queryByText("Toreador Mass Vote")).not.toBeInTheDocument();
    expect(options.getByText("Meilleure ronde : ronde 2 · GW · 3 VP")).toBeInTheDocument();
    pick("game-deck-picker", "Banu Princes");
    expect(screen.getByTestId("game-form-submit")).toHaveTextContent("Enregistrer la finale");
    expect(screen.getByTestId("game-form-round")).toHaveTextContent("Finale");
  });

  it("mono-deck : propose le deck déjà joué, prévient d'un autre deck et le fait reprendre", async () => {
    const server = seededServer();
    server.state.tournaments[0].deck_policy = "mono";
    server.state.tournaments[0].final_deck_rule = null;
    server.state.admissible.clear();
    // Les deux rondes du tournoi ont été jouées avec le deck 1.
    server.state.games[0].participations[0].deck_id = 1;
    const app = await renderApp({ server, hash: "#/parties" });
    await act(async () => {
      await app.runtime.refresh();
    });
    await screen.findByTestId("game-table-desktop");
    fireEvent.click(screen.getByTestId("games-new-desktop"));
    await screen.findByTestId("game-form");
    fireEvent.click(screen.getByTestId("game-form-tournament"));
    pick("game-tournament-picker", "Open de Lyon");
    expect(await screen.findByTestId("game-form-deck")).toHaveTextContent("Banu Princes");
    expect(screen.getByTestId("game-form-deck-hint")).toHaveTextContent("Deck du tournoi");
    expect(screen.queryByTestId("game-form-mono-warning")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("game-form-deck-change"));
    pick("game-deck-picker", "Toreador Mass Vote");
    const warning = await screen.findByTestId("game-form-mono-warning");
    expect(warning).toHaveTextContent(
      "Tournoi mono-deck : vos rondes ont été jouées avec Banu Princes. Le serveur refusera un autre deck.",
    );
    fireEvent.click(within(warning).getByTestId("game-form-mono-resume"));
    expect(screen.getByTestId("game-form-deck")).toHaveTextContent("Banu Princes");
    expect(screen.queryByTestId("game-form-mono-warning")).not.toBeInTheDocument();
  });

  it("au bureau, ⌘↵ enregistre, Échap dans un sélecteur revient à la saisie sans fermer la feuille", async () => {
    const app = await renderApp({ online: false, hash: "#/parties" });
    await screen.findByTestId("games-empty");
    await flushEffects();
    fireEvent.keyDown(document, { key: "n" });
    await screen.findByTestId("game-form");

    fireEvent.click(screen.getByTestId("game-form-venue"));
    await screen.findByTestId("game-venue-picker");
    fireEvent.keyDown(document, { key: "Escape" });
    await screen.findByTestId("game-form");
    expect(screen.queryByTestId("game-venue-picker")).not.toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(screen.queryByTestId("game-form")).not.toBeInTheDocument());
    const ops = (await app.runtime.outbox.list()).map((entry) => entry.operation);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ type: "game.create", data: { player_count: 5, round_type: "casual" } });
  });
});

describe("détail d'une partie", () => {
  it("affiche résultat, faits et table par siège, deck prêté compris", async () => {
    setViewportWidth(390);
    const opened = await openSeeded();
    await screen.findByTestId("game-list");
    fireEvent.click(within(screen.getAllByTestId("game-item")[0]).getByTestId("game-link"));
    await screen.findByTestId("game-page");

    expect(screen.getByTestId("game-detail-kicker")).toHaveTextContent("Open de Lyon · ronde 2");
    expect(screen.getByTestId("game-detail-title")).toHaveTextContent("3 VP · Game Win");
    // Les noms de deck, de lieu et de joueur viennent de lectures locales indépendantes.
    await waitFor(() => expect(screen.getByTestId("game-fact-deck")).toHaveTextContent("Banu Princes"));
    await waitFor(() => expect(screen.getByTestId("game-facts")).toHaveTextContent("Le Bar à Dés"));
    await waitFor(() => expect(screen.getAllByTestId("game-seat")[2]).toHaveTextContent("Marc F."));
    const seats = screen.getAllByTestId("game-seat");
    expect(seats).toHaveLength(5);
    expect(seats[0]).toHaveAttribute("data-unnamed", "true");
    expect(seats[1]).toHaveTextContent("Moi");
    expect(seats[1]).toHaveTextContent("Banu Princes");
    expect(seats[2]).toHaveTextContent("Marc F.");
    expect(seats[2]).toHaveTextContent("avec mon Toreador Mass Vote, prêté");
    expect(seats[3]).toHaveTextContent("non nommé");
    expect(opened.server.state.requests.filter((r) => r.method === "POST")).toEqual([]);
  });

  it("n'offre « Modifier la table » que si la table est connue", async () => {
    const opened = await openSeeded();
    const first = (await opened.runtime.db.games.toArray())[0];
    await go({ name: "game", key: `id:${first.id}` });
    expect(await screen.findByTestId("game-edit-table")).toBeInTheDocument();

    // Une table inconnue (détail jamais lu) : le bouton disparaît, l'édition de la table avec.
    await opened.runtime.db.games.update(first.id, { table: null });
    await waitFor(() => expect(screen.queryByTestId("game-edit-table")).not.toBeInTheDocument());
    expect(screen.getByTestId("game-edit")).toBeInTheDocument();
    expect(screen.getByTestId("game-table-unknown")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("game-edit"));
    expect(await screen.findByTestId("game-form-table-unknown")).toBeInTheDocument();
    expect(screen.queryByTestId("game-form-seats")).not.toBeInTheDocument();
  });

  it("corrige mes VP : seule la table modifiée part, avec un `game.update`", async () => {
    const opened = await openSeeded();
    const second = (await opened.runtime.db.games.toArray()).find((game) => game.roundNumber === 2)!;
    await go({ name: "game", key: `id:${second.id}` });
    fireEvent.click(await screen.findByTestId("game-edit"));
    await screen.findByTestId("game-form");
    // 3 VP -> 3,5 VP : toujours certain à cinq joueurs.
    fireEvent.click(screen.getByLabelText("Ajouter un demi-point de VP"));
    fireEvent.click(screen.getByTestId("game-form-submit"));
    await waitFor(() => expect(screen.queryByTestId("game-form")).not.toBeInTheDocument());
    const ops = (await opened.runtime.outbox.list()).map((entry) => entry.operation);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ type: "game.update", game: { game_id: 2 } });
    expect(ops[0]).not.toHaveProperty("data");
    const update = ops[0];
    if (update.type !== "game.update") throw new Error("game.update attendu");
    expect(update.table?.participations).toHaveLength(2);
    expect(update.table?.participations[0]).toMatchObject({ victory_points: 3.5, game_win: true });
    // Le titre se met à jour tout de suite (projection locale).
    await waitFor(() => expect(screen.getByTestId("game-detail-title")).toHaveTextContent("3,5 VP"));
  });

  it("« Modifier la table » déplie les adversaires d'emblée", async () => {
    const opened = await openSeeded();
    const second = (await opened.runtime.db.games.toArray()).find((game) => game.roundNumber === 2)!;
    await go({ name: "game", key: `id:${second.id}` });
    fireEvent.click(await screen.findByTestId("game-edit-table"));
    const opponents = await screen.findByTestId("game-form-opponents");
    expect(within(opponents).getAllByTestId("game-form-opponent")).toHaveLength(1);
    expect(within(opponents).getByText("Marc F.")).toBeInTheDocument();
  });

  it("supprime après confirmation, retire la partie et revient à la liste", async () => {
    setViewportWidth(390);
    const opened = await openSeeded();
    const third = (await opened.runtime.db.games.toArray()).find((game) => game.roundType === "casual")!;
    await go({ name: "game", key: `id:${third.id}` });
    fireEvent.click(await screen.findByTestId("game-delete"));
    expect(screen.getByTestId("game-delete-confirmation")).toHaveTextContent(
      "Supprimer cette partie ? Sa table part avec elle.",
    );
    // « Garder » n'écrit rien.
    fireEvent.click(screen.getByTestId("game-delete-keep"));
    expect(screen.queryByTestId("game-delete-confirmation")).not.toBeInTheDocument();
    expect(await opened.runtime.outbox.list()).toHaveLength(0);

    fireEvent.click(screen.getByTestId("game-delete"));
    fireEvent.click(screen.getByTestId("game-delete-confirm"));
    await screen.findByTestId("games-page");
    const ops = (await opened.runtime.outbox.list()).map((entry) => entry.operation);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ type: "game.delete", game: { game_id: 3 } });
    await waitFor(() => expect(screen.getAllByTestId("game-item")).toHaveLength(2));
  });

  it("dit « Partie introuvable » pour une clé inconnue", async () => {
    await renderApp({ online: false, hash: "#/parties/id:999" });
    expect(await screen.findByTestId("game-not-found")).toHaveTextContent("Partie introuvable");
    expect(screen.getByTestId("game-not-found")).toHaveTextContent(
      "Elle a peut-être été supprimée depuis un autre appareil.",
    );
  });

  it("au bureau, E ouvre la modification et T la table, jamais dans un champ", async () => {
    const opened = await openSeeded();
    await screen.findByTestId("game-detail");
    await flushEffects();
    fireEvent.keyDown(document, { key: "t" });
    const opponents = await screen.findByTestId("game-form-opponents");
    expect(opponents).toBeInTheDocument();
    fireEvent.click(within(screen.getByTestId("game-form-sheet")).getByRole("button", { name: "Fermer" }));
    await waitFor(() => expect(screen.queryByTestId("game-form")).not.toBeInTheDocument());

    await flushEffects();
    fireEvent.keyDown(document, { key: "e" });
    await screen.findByTestId("game-form");
    // Dans un champ, `e` ne rouvre rien et n'agit pas derrière la feuille.
    const notes = screen.getByTestId("game-form-notes");
    notes.focus();
    fireEvent.keyDown(notes, { key: "e" });
    expect(screen.getAllByTestId("game-form")).toHaveLength(1);
    expect(opened.server.state.requests.filter((r) => r.method === "POST")).toEqual([]);
  });
});

describe("tournois (lecture seule, étape D1)", () => {
  it("affiche l'état vide, sans création de tournoi ni lien vers le carnet", async () => {
    await renderApp({ online: false, hash: "#/tournois" });
    expect(await screen.findByTestId("tournaments-empty")).toHaveTextContent("Aucun tournoi");
    expect(screen.getByTestId("tournaments-empty")).toHaveTextContent(
      "Créez le tournoi en arrivant : les rondes s'y rattachent ensuite.",
    );
    expect(screen.queryByText("Carnet")).not.toBeInTheDocument();
    expect(screen.getByTestId("play-switch-tournaments")).toHaveAttribute("aria-current", "page");
  });

  it("liste les tournois locaux et revient aux parties par le sélecteur", async () => {
    const opened = await openSeeded({ hash: "#/tournois" });
    const list = await screen.findByTestId("tournament-list");
    expect(within(list).getByText("Open de Lyon")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("play-switch-games"));
    await screen.findByTestId("games-page");
    expect(window.location.hash).toBe("#/parties");
    expect(opened.server.state.requests.filter((r) => r.method === "POST")).toEqual([]);
  });
});

// --- Corrections après la relecture QA (2026-11-02) --------------------------------

async function openDesktopForm(options: AppOptions & { server?: FakeServer } = {}) {
  const app = await openSeeded(options);
  await screen.findByTestId("game-table-desktop");
  fireEvent.click(screen.getByTestId("games-new-desktop"));
  await screen.findByTestId("game-form");
  return app;
}

/** Nomme un adversaire dans le bloc déplié (le crée au fil de la frappe). */
async function addOpponentNamed(name: string) {
  fireEvent.change(screen.getByTestId("game-form-opponent-input"), { target: { value: name } });
  fireEvent.click(await screen.findByTestId("game-form-opponent-create"));
  await waitFor(() => expect(screen.getAllByTestId("game-form-opponent").some((row) => row.textContent?.includes(name))).toBe(true));
}

const submitButton = () => screen.getByTestId("game-form-submit");
const queued = async (app: Awaited<ReturnType<typeof openSeeded>>) =>
  (await app.runtime.outbox.list()).map((entry) => entry.operation);

describe("focus entre la saisie et ses sélecteurs", () => {
  it("va au titre du panneau, puis revient au bouton qui l'avait ouvert", async () => {
    await renderApp({ online: false, hash: "#/parties?action=nouvelle" });
    await screen.findByTestId("game-form");
    const cases: Array<[string, string, string]> = [
      ["game-form-venue", "Lieu", "game-form-venue"],
      ["game-form-tournament", "Tournoi", "game-form-tournament"],
      ["game-form-deck-change", "Mon deck", "game-form-deck-change"],
      ["game-form-count-other", "Joueurs à la table", "game-form-count-other"],
    ];
    for (const [trigger, title, back] of cases) {
      fireEvent.click(screen.getByTestId(trigger));
      await waitFor(() => expect(document.activeElement).toHaveTextContent(title));
      expect(document.activeElement?.tagName).toBe("H2");
      fireEvent.keyDown(document, { key: "Escape" });
      await screen.findByTestId("game-form");
      await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId(back)));
    }
  });
});

describe("saisies invalides : l'envoi est refusé", () => {
  it("GW coché sous 2 VP : rien ne part, le focus va à l'erreur, puis ça passe une fois corrigé", async () => {
    const app = await renderApp({ online: false, hash: "#/parties?action=nouvelle" });
    await screen.findByTestId("game-form");
    fireEvent.click(screen.getByTestId("game-form-gw"));
    fireEvent.click(submitButton());
    const error = await screen.findByTestId("game-form-gw-error");
    expect(error).toHaveAttribute("role", "alert");
    expect(document.activeElement).toBe(error);
    expect(await app.runtime.outbox.list()).toHaveLength(0);
    expect(screen.getByTestId("game-form")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("game-form-gw"));
    fireEvent.click(submitButton());
    await waitFor(() => expect(screen.queryByTestId("game-form")).not.toBeInTheDocument());
    expect(await app.runtime.outbox.list()).toHaveLength(1);
  });

  it("VP au-delà de la table : refusé, avec l'alerte", async () => {
    const app = await renderApp({ online: false, hash: "#/parties?action=nouvelle" });
    await screen.findByTestId("game-form");
    for (let i = 0; i < 10; i += 1) fireEvent.click(screen.getByLabelText("Ajouter un demi-point de VP"));
    fireEvent.click(screen.getByTestId("game-form-count-4"));
    fireEvent.click(submitButton());
    expect(await screen.findByTestId("game-form-vp-error")).toHaveTextContent("Au plus 4 VP à quatre joueurs.");
    expect(await app.runtime.outbox.list()).toHaveLength(0);
  });

  it("arrondit au demi-point un VP tapé au clavier", async () => {
    await renderApp({ online: false, hash: "#/parties?action=nouvelle" });
    await screen.findByTestId("game-form");
    fireEvent.change(screen.getByRole("spinbutton", { name: "Mes VP" }), { target: { value: "2.3" } });
    expect(screen.getByTestId("game-form-vp-value")).toHaveTextContent("2,5 VP");
  });

  it("table trop pleine : l'alerte est visible bloc replié, bloque l'envoi, et les sièges perdus sont signalés", async () => {
    const app = await renderApp({ online: false, hash: "#/parties?action=nouvelle" });
    await screen.findByTestId("game-form");
    fireEvent.click(screen.getByTestId("game-form-opponents-toggle"));
    for (const name of ["Alice", "Bruno", "Chloé", "David"]) await addOpponentNamed(name);
    const david = screen.getAllByTestId("game-form-opponent")[3];
    fireEvent.change(within(david).getByLabelText("Siège de David"), { target: { value: "5" } });
    fireEvent.click(screen.getByTestId("game-form-opponents-toggle")); // replié

    fireEvent.click(screen.getByTestId("game-form-count-4"));
    expect(screen.queryByTestId("game-form-opponents")).not.toBeInTheDocument();
    expect(screen.getByTestId("game-form-table-error")).toHaveTextContent("La table compte au plus 4 joueurs");
    expect(screen.getByTestId("game-form-seat-notice")).toHaveTextContent("le siège 5 de David");

    fireEvent.click(submitButton());
    expect(document.activeElement).toBe(screen.getByTestId("game-form-table-error"));
    expect(await app.runtime.outbox.list().then((list) => list.filter((e) => e.operation.type === "game.create"))).toHaveLength(0);

    fireEvent.click(screen.getByTestId("game-form-opponents-toggle"));
    fireEvent.click(screen.getByLabelText("Retirer David de la table"));
    expect(screen.queryByTestId("game-form-table-error")).not.toBeInTheDocument();
  });
});

describe("Game Win mémorisé", () => {
  it("reste coché quand il cesse d'être certain, avec l'aide « À vous de le dire »", async () => {
    await renderApp({ online: false, hash: "#/parties?action=nouvelle" });
    await screen.findByTestId("game-form");
    for (let i = 0; i < 6; i += 1) fireEvent.click(screen.getByLabelText("Ajouter un demi-point de VP"));
    expect(screen.getByTestId("game-form-gw-lock")).toBeInTheDocument();

    // On retire des VP jusqu'à une valeur qui n'est plus certaine : le GW reste coché.
    fireEvent.click(screen.getByLabelText("Retirer un demi-point de VP"));
    fireEvent.click(screen.getByLabelText("Retirer un demi-point de VP"));
    expect(screen.getByTestId("game-form-vp-value")).toHaveTextContent("2 VP");
    expect(screen.getByTestId("game-form-gw")).toBeChecked();
    expect(screen.queryByTestId("game-form-gw-lock")).not.toBeInTheDocument();
    expect(screen.getByTestId("game-form-gw-help")).toHaveTextContent("À vous de le dire : 2 VP à 5");
    // Il se décoche désormais à la main.
    fireEvent.click(screen.getByTestId("game-form-gw"));
    expect(screen.getByTestId("game-form-gw")).not.toBeChecked();
  });
});

describe("deck de la saisie", () => {
  it("propose « Aucun deck » et le choisit", async () => {
    await openDesktopForm();
    expect(screen.getByTestId("game-form-deck")).toHaveTextContent("Banu Princes");
    fireEvent.click(screen.getByTestId("game-form-deck-change"));
    pick("game-deck-picker", "Aucun deck");
    expect(await screen.findByTestId("game-form-deck")).toHaveTextContent("Aucun deck choisi");
  });

  it("dit « Deck inconnu sur cet appareil » pour un deck absent du miroir, sans le dire supprimé", async () => {
    const server = seededServer();
    server.state.games[2].participations[0].deck_id = 99;
    const app = await renderApp({ server, hash: "#/parties" });
    await act(async () => {
      await app.runtime.refresh();
    });
    await go({ name: "game", key: "id:3" });
    await waitFor(() => expect(screen.getByTestId("game-fact-deck")).toHaveTextContent("Deck inconnu sur cet appareil"));
    // La table renvoyée garde ce deck tel quel : le serveur l'accepte quand il ne change pas (A8).
    fireEvent.click(screen.getByTestId("game-edit"));
    await screen.findByTestId("game-form");
    expect(screen.getByTestId("game-form-deck")).toHaveTextContent("Deck inconnu sur cet appareil");
  });
});

describe("corriger sans écraser les vides", () => {
  it("ne renvoie pas la table pour une correction des seules notes, VP et GW non saisis compris", async () => {
    const server = seededServer();
    Object.assign(server.state.games[2].participations[0], { victory_points: null, game_win: null });
    const app = await renderApp({ server, hash: "#/parties" });
    await act(async () => {
      await app.runtime.refresh();
    });
    await go({ name: "game", key: "id:3" });
    fireEvent.click(await screen.findByTestId("game-edit"));
    await screen.findByTestId("game-form");
    expect(screen.getByTestId("game-form-vp-value")).toHaveTextContent("VP non saisis");
    fireEvent.change(screen.getByTestId("game-form-notes"), { target: { value: "À revoir" } });
    fireEvent.click(submitButton());
    await waitFor(() => expect(screen.queryByTestId("game-form")).not.toBeInTheDocument());
    const ops = await queued(app);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ type: "game.update", game: { game_id: 3 }, data: { notes: "À revoir" } });
    expect(ops[0]).not.toHaveProperty("table");
  });

  it("garde les notes d'une ligne d'adversaire quand la table est renvoyée", async () => {
    const server = seededServer();
    server.state.games[1].participations[1].notes = "Prête son deck";
    const app = await renderApp({ server, hash: "#/parties" });
    await act(async () => {
      await app.runtime.refresh();
    });
    await go({ name: "game", key: "id:2" });
    fireEvent.click(await screen.findByTestId("game-edit"));
    await screen.findByTestId("game-form");
    fireEvent.click(screen.getByLabelText("Ajouter un demi-point de VP"));
    fireEvent.click(submitButton());
    await waitFor(() => expect(screen.queryByTestId("game-form")).not.toBeInTheDocument());
    const update = (await queued(app))[0];
    if (update.type !== "game.update") throw new Error("game.update attendu");
    expect(update.table?.participations[1]).toMatchObject({ notes: "Prête son deck", seat: 3 });
  });

  it("sort une partie de son tournoi : tournoi, ronde et type partent ensemble", async () => {
    const app = await openSeeded();
    await go({ name: "game", key: "id:2" });
    fireEvent.click(await screen.findByTestId("game-edit"));
    await screen.findByTestId("game-form");
    fireEvent.click(screen.getByTestId("game-form-tournament"));
    const options = within(screen.getByTestId("game-tournament-picker-options"));
    // La date du tournoi est lisible, pas l'ISO brut.
    expect(options.getByText(/24 oct/)).toBeInTheDocument();
    expect(screen.getByTestId("game-tournament-picker")).not.toHaveTextContent("2026-10-24");
    pick("game-tournament-picker", "Amicale");
    await screen.findByTestId("game-form");
    expect(screen.queryByTestId("game-form-round")).not.toBeInTheDocument();
    fireEvent.click(submitButton());
    await waitFor(() => expect(screen.queryByTestId("game-form")).not.toBeInTheDocument());
    const ops = await queued(app);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({
      type: "game.update",
      game: { game_id: 2 },
      data: { tournament: null, round_type: "casual", round_number: null },
    });
    expect(ops[0]).not.toHaveProperty("table");
  });
});

describe("finale et decks admis", () => {
  it("impose l'unique deck admis quand ce n'est pas celui qui était sélectionné", async () => {
    const server = seededServer();
    server.state.admissible.set(1, [2]);
    await openDesktopForm({ server });
    fireEvent.click(screen.getByTestId("game-form-tournament"));
    pick("game-tournament-picker", "Open de Lyon");
    expect(await screen.findByTestId("game-form-deck")).toHaveTextContent("Banu Princes");
    fireEvent.click(screen.getByTestId("game-form-round"));
    pick("game-round-picker", "Finale");
    await waitFor(() => expect(screen.getByTestId("game-form-deck")).toHaveTextContent("Toreador Mass Vote"));
  });

  it("choix libre : tous les decks joués en préliminaires, sans « Aucun deck »", async () => {
    const server = seededServer();
    server.state.tournaments[0].final_deck_rule = "free_choice";
    server.state.admissible.set(1, [1, 2]);
    await openDesktopForm({ server });
    fireEvent.click(screen.getByTestId("game-form-tournament"));
    pick("game-tournament-picker", "Open de Lyon");
    fireEvent.click(await screen.findByTestId("game-form-round"));
    pick("game-round-picker", "Finale");
    await screen.findByTestId("game-form");
    expect(screen.getByTestId("game-form-deck-hint")).toHaveTextContent("Decks joués en préliminaires.");
    fireEvent.click(screen.getByTestId("game-form-deck-change"));
    const options = within(screen.getByTestId("game-deck-picker-options"));
    expect(options.getByText("Banu Princes")).toBeInTheDocument();
    expect(options.getByText("Toreador Mass Vote")).toBeInTheDocument();
    expect(options.queryByText("Aucun deck")).not.toBeInTheDocument();
  });

  it("meilleur deck à égalité : l'aide passe au pluriel", async () => {
    const server = seededServer();
    server.state.admissible.set(1, [1, 2]);
    await openDesktopForm({ server });
    fireEvent.click(screen.getByTestId("game-form-tournament"));
    pick("game-tournament-picker", "Open de Lyon");
    fireEvent.click(await screen.findByTestId("game-form-round"));
    pick("game-round-picker", "Finale");
    await screen.findByTestId("game-form");
    expect(screen.getByTestId("game-form-deck-hint")).toHaveTextContent("Decks à égalité de meilleure ronde");
    expect(screen.getByTestId("game-form-deck-hint")).not.toHaveTextContent("Seul deck");
  });

  it("mono-deck : la finale garde le deck du tournoi", async () => {
    const server = seededServer();
    server.state.tournaments[0].deck_policy = "mono";
    server.state.tournaments[0].final_deck_rule = null;
    server.state.admissible.clear();
    server.state.games[0].participations[0].deck_id = 1;
    await openDesktopForm({ server });
    fireEvent.click(screen.getByTestId("game-form-tournament"));
    pick("game-tournament-picker", "Open de Lyon");
    fireEvent.click(await screen.findByTestId("game-form-round"));
    pick("game-round-picker", "Finale");
    await screen.findByTestId("game-form");
    expect(screen.getByTestId("game-form-deck")).toHaveTextContent("Banu Princes");
    expect(screen.getByTestId("game-form-deck-hint")).toHaveTextContent("Deck du tournoi · mono-deck");
    expect(screen.getByTestId("game-form-submit")).toHaveTextContent("Enregistrer la finale");
  });
});

describe("page parties au bureau", () => {
  it("N et E restent sans effet dans un champ, feuille fermée", async () => {
    await openSeeded();
    await screen.findByTestId("game-table-desktop");
    await flushEffects();
    const select = screen.getByTestId("game-filter-type");
    select.focus();
    fireEvent.keyDown(select, { key: "n" });
    fireEvent.keyDown(select, { key: "e" });
    fireEvent.keyDown(select, { key: "t" });
    await flushEffects();
    expect(screen.queryByTestId("game-form")).not.toBeInTheDocument();
  });

  it("N n'empile pas une seconde feuille pendant une modification ouverte depuis le détail", async () => {
    await openSeeded();
    await screen.findByTestId("game-detail");
    await flushEffects();
    fireEvent.click(screen.getByTestId("game-edit"));
    await screen.findByTestId("game-form");
    await flushEffects();
    fireEvent.keyDown(document, { key: "n" });
    await flushEffects();
    expect(screen.getAllByTestId("game-form-sheet")).toHaveLength(1);
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("game-form")).not.toBeInTheDocument());
    await flushEffects();
    fireEvent.keyDown(document, { key: "n" });
    await screen.findByTestId("game-form");
  });

  it("la partie qui vient d'être créée devient la ligne sélectionnée", async () => {
    await openSeeded();
    await screen.findByTestId("game-table-desktop");
    // Tri croissant : la nouvelle partie arrive en dernier, et non en tête (sélection par défaut).
    fireEvent.click(screen.getByTestId("game-sort-date"));
    await waitFor(() => expect(screen.getAllByTestId("game-item")[0]).toHaveTextContent("Amicale"));
    fireEvent.click(screen.getByTestId("games-new-desktop"));
    await screen.findByTestId("game-form");
    fireEvent.click(screen.getByTestId("game-form-submit"));
    await waitFor(() => expect(screen.queryByTestId("game-form")).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getAllByTestId("game-item")).toHaveLength(4));
    const rows = screen.getAllByTestId("game-item");
    expect(rows[3]).toHaveAttribute("data-selected", "true");
    expect(rows[3]).toHaveAttribute("data-pending", "true");
    expect(rows[0]).toHaveAttribute("data-selected", "false");
  });
});

describe("clé de partie après synchronisation", () => {
  it("la page ouverte sur #/parties/ref:… reste affichée quand la partie reçoit son identifiant", async () => {
    const server = createFakeServer();
    const app = await renderApp({ server, hash: "#/parties" });
    const created = await app.runtime.actions.createGame({
      playedAt: "2026-10-24T20:00:00Z",
      playerCount: 5,
      participations: [{ player: "me", victoryPoints: 2 }],
    });
    expect(created.key).toMatch(/^ref:/);
    await go({ name: "game", key: created.key });
    expect(await screen.findByTestId("game-detail-title")).toHaveTextContent("2 VP");
    expect(screen.getByTestId("pending-badge")).toBeInTheDocument();

    await act(async () => {
      await app.runtime.engine.flush();
      await app.runtime.refresh();
    });
    await waitFor(() => expect(screen.queryByTestId("pending-badge")).not.toBeInTheDocument());
    expect(screen.queryByTestId("game-not-found")).not.toBeInTheDocument();
    expect(screen.getByTestId("game-detail-title")).toHaveTextContent("2 VP");
    expect(server.state.games).toHaveLength(1);
  });
});

describe("création d'un lieu ou d'un adversaire qui échoue", () => {
  it("affiche l'erreur au lieu de laisser la saisie sans réponse", async () => {
    const app = await renderApp({ online: false, hash: "#/parties?action=nouvelle" });
    await screen.findByTestId("game-form");
    const spy = vi.spyOn(app.runtime.actions, "ensureVenue").mockRejectedValue(new Error("Écriture impossible"));
    fireEvent.click(screen.getByTestId("game-form-venue"));
    fireEvent.change(await screen.findByTestId("game-venue-picker-search"), { target: { value: "Chez Marc" } });
    fireEvent.click(screen.getByTestId("game-venue-picker-create"));
    expect(await screen.findByTestId("game-venue-picker-error")).toHaveTextContent("Écriture impossible");
    spy.mockRestore();
  });
});
