import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { hrefFor } from "../../../src/app/routes";
import { createFakeServer, type FakeParticipation, type FakeServer } from "../offline/fakeServer";
import { crypt, mirrorRows } from "../offline/fixtures/syntheticCatalog";
import { renderApp } from "./harness";

/**
 * Lot 8, étape D2 : bilan (1b-46 à 1b-58, d25), liste d'une version (1b-52,
 * d30), résultats d'un deck (1b-53, d31), decks joués d'un tournoi (1b-54,
 * d32), archétype en puces (1b-55, d33).
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

const CARDS = [
  crypt({ id: 801, name: "Tremere Un", clan: "Tremere" }),
  crypt({ id: 802, name: "Brujah Un", clan: "Brujah" }),
  crypt({ id: 803, name: "Ministry Un", clan: "Ministry" }),
];
const clanId = (name: string) => CARDS.find((card) => card.clan?.name === name)!.clan!.id;

/**
 * Un tournoi multi-deck : ronde 1 avec Toreador (v1), rondes 2 et 3 avec Banu
 * Princes (v2, figée à la ronde 2), puis une amicale avec Banu Princes (v2).
 * À la ronde 2, je suis au siège 2 sur cinq : Léa au siège 1 (Brujah · Rush,
 * mon prédateur), un joueur non nommé au siège 3 (Ministry · Bleed, ma proie).
 */
function playedServer(): FakeServer {
  const server = createFakeServer();
  server.state.decks.push(
    { id: 1, name: "Banu Princes", discriminator: "1234", client_ref: null, proxy_allowed: false, archived_at: null },
    { id: 2, name: "Toreador Mass Vote", discriminator: "0002", client_ref: null, proxy_allowed: true, archived_at: null },
  );
  server.state.deckCards.push({ deck_id: 1, card_id: 801, language_code: "EN", card_set_id: 9, quantity: 3, proxy_quantity: 3 });
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
    {
      id: 10,
      deck_id: 1,
      number: 2,
      created_at: "2026-10-24T10:00:00Z",
      crypt_count: 3,
      library_count: 0,
      cards: [
        { card_id: 801, quantity: 2 },
        { card_id: 803, quantity: 1 },
      ],
    },
    { id: 20, deck_id: 2, number: 1, created_at: "2026-10-24T10:00:00Z", crypt_count: 2, library_count: 0, cards: [{ card_id: 802, quantity: 2 }] },
  );
  server.state.tournamentDeckVersions.set(1, [
    { deck_id: 1, deck_version_id: 10, deck_version_number: 2, frozen_by_game_id: 2 },
    { deck_id: 2, deck_version_id: 20, deck_version_number: 1, frozen_by_game_id: 1 },
  ]);
  const me = (deckId: number, versionId: number, number: number, seat: number, vp: number, gw: boolean): FakeParticipation => ({
    player_id: 1,
    is_me: true,
    deck_id: deckId,
    deck_version_id: versionId,
    deck_version_number: number,
    seat,
    victory_points: vp,
    game_win: gw,
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
      participations: [me(2, 20, 1, 1, 1.5, false)],
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
        me(1, 10, 2, 2, 3, true),
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
      participations: [me(1, 10, 2, 4, 2, true)],
    },
    {
      ...base,
      id: 4,
      played_at: "2026-11-05T19:30:00Z",
      tournament_id: null,
      round_number: null,
      round_type: "casual",
      updated_at: "2026-11-05T19:30:00Z",
      participations: [{ ...me(1, 10, 2, 2, 0.5, false), seat: null }],
    },
  );
  return server;
}

async function openPlayed(hash: string) {
  const app = await renderApp({ server: playedServer(), hash });
  const { cards, details } = mirrorRows(CARDS);
  await act(async () => {
    await app.runtime.db.cards.bulkPut(cards);
    await app.runtime.db.cardDetails.bulkPut(details);
    await app.runtime.refresh();
  });
  return app;
}

/** La période par défaut (12 derniers mois) dépend du jour : les tests prennent « Tout ». */
async function showAllPeriodMobile() {
  fireEvent.click(await screen.findByTestId("bilan-filter-open"));
  const sheet = await screen.findByTestId("bilan-filter-sheet");
  fireEvent.click(within(sheet).getByTestId("bilan-period-all"));
  expect(within(sheet).getByTestId("bilan-filter-apply")).toHaveTextContent("Voir 4 parties");
  fireEvent.click(within(sheet).getByTestId("bilan-filter-apply"));
  await waitFor(() => expect(screen.queryByTestId("bilan-filter-sheet")).not.toBeInTheDocument());
}

const rowsOf = (container: HTMLElement) =>
  within(container)
    .getAllByTestId("bilan-row")
    .map((row) => [row.getAttribute("data-group"), row.getAttribute("data-games")]);

describe("bilan au mobile", () => {
  it("résumé sans pourcentage, axes Deck (versions), Position et Adversaires", async () => {
    setViewportWidth(390);
    await openPlayed("#/bilan");
    expect(screen.getByTestId("play-switch-bilan")).toHaveAttribute("aria-current", "page");
    await showAllPeriodMobile();
    expect(screen.getByTestId("bilan-filter-summary")).toHaveTextContent("Tout · Tous types · Tous les decks");

    expect(screen.getByTestId("bilan-summary-games")).toHaveTextContent("2 GW sur 4 parties");
    expect(screen.getByTestId("bilan-summary-points")).toHaveTextContent("7 VP, 1,8 VP par partie");
    expect(screen.getByTestId("bilan-summary-tournaments")).toHaveTextContent("1 tournoi joué · 0 finale atteinte");
    expect(screen.getByTestId("bilan-page").textContent).not.toContain("%");

    const decks = screen.getByTestId("bilan-axis-deck");
    expect(rowsOf(decks)).toEqual([
      ["id:1", "3"],
      ["id:2", "1"],
    ]);
    fireEvent.click(within(decks).getAllByTestId("bilan-deck-toggle")[0]);
    const version = within(decks).getByTestId("bilan-version");
    expect(version).toHaveTextContent("v2");
    expect(version).toHaveTextContent("2 GW sur 3 parties · 5,5 VP");
    expect(within(version).getByTestId("bilan-version-link")).toHaveAttribute("href", "#/decks/id:1/versions/2");

    fireEvent.click(screen.getByTestId("bilan-axis-tab-position"));
    const position = screen.getByTestId("bilan-position-list");
    expect(rowsOf(position)).toEqual([
      ["bleed", "1"],
      ["__unknown", "2"],
    ]);
    expect(screen.getByTestId("bilan-position-unseated")).toHaveTextContent("1 partie sans siège n'est pas comptée ici.");
    fireEvent.click(screen.getByTestId("bilan-position-predator"));
    fireEvent.click(screen.getByTestId("bilan-grouping-clan"));
    expect(rowsOf(screen.getByTestId("bilan-position-list"))).toEqual([
      ["Brujah", "1"],
      ["__unknown", "2"],
    ]);
    // Plus loin à la table : replié par défaut.
    expect(screen.queryByTestId("bilan-far")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("bilan-far-toggle"));
    expect(rowsOf(screen.getByTestId("bilan-far-list"))).toEqual([["__unknown", "3"]]);

    fireEvent.click(screen.getByTestId("bilan-axis-tab-opponents"));
    expect(rowsOf(screen.getByTestId("bilan-axis-opponents"))).toEqual([["id:2", "1"]]);
  });

  it("un filtre sans partie, puis « Effacer les filtres »", async () => {
    setViewportWidth(390);
    await openPlayed("#/bilan");
    await showAllPeriodMobile();
    fireEvent.click(screen.getByTestId("bilan-filter-open"));
    const sheet = await screen.findByTestId("bilan-filter-sheet");
    fireEvent.click(within(sheet).getByTestId("bilan-type-final"));
    expect(within(sheet).getByTestId("bilan-filter-apply")).toHaveTextContent("Aucune partie");
    fireEvent.click(within(sheet).getByTestId("bilan-filter-apply"));
    expect(await screen.findByTestId("bilan-no-match")).toHaveTextContent("Aucune partie ne correspond à ces filtres.");
    fireEvent.click(screen.getByTestId("bilan-no-match-clear"));
    await waitFor(() => expect(screen.queryByTestId("bilan-no-match")).not.toBeInTheDocument());
  });

  it("sans partie : « Rien à analyser pour l'instant »", async () => {
    setViewportWidth(390);
    await renderApp({ online: false, hash: "#/bilan" });
    expect(await screen.findByTestId("bilan-empty")).toHaveTextContent("Rien à analyser pour l'instant");
  });
});

describe("bilan au bureau", () => {
  it("filtre sur un deck depuis l'adresse, trie au clic d'en-tête et ouvre le panneau des parties", async () => {
    await openPlayed("#/bilan?deck=id:1");
    const bar = await screen.findByTestId("bilan-filterbar");
    fireEvent.click(within(bar).getByTestId("bilan-period-all"));
    expect(within(bar).getAllByTestId("bilan-deck-option").find((input) => (input as HTMLInputElement).checked)).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId("bilan-summary-games")).toHaveTextContent("2 GW sur 3 parties"));

    fireEvent.click(within(bar).getByTestId("bilan-deck-all"));
    const decks = await screen.findByTestId("bilan-axis-deck");
    const order = () => within(decks).getAllByTestId("bilan-table-row").map((row) => row.getAttribute("data-group"));
    expect(order()).toEqual(["id:1", "id:2"]);
    fireEvent.click(within(decks).getByTestId("bilan-sort-games"));
    expect(order()).toEqual(["id:1", "id:2"]);
    fireEvent.click(within(decks).getByTestId("bilan-sort-games"));
    expect(order()).toEqual(["id:2", "id:1"]);

    fireEvent.click(within(decks).getAllByTestId("bilan-table-select")[0]);
    const panel = await screen.findByTestId("bilan-panel");
    expect(within(panel).getByTestId("bilan-panel-title")).toHaveTextContent("Toreador Mass Vote");
    const games = within(panel).getAllByTestId("bilan-panel-game");
    expect(games).toHaveLength(1);
    expect(games[0]).toHaveTextContent("Open de Lyon · ronde 1");
    expect(games[0]).toHaveTextContent("1,5 VP");
  });
});

describe("liste d'une version", () => {
  it("au mobile : titre, première partie, liste en lecture seule puis changements depuis v1", async () => {
    setViewportWidth(390);
    await openPlayed("#/parties");
    await go({ name: "deckVersion", key: "id:1", number: 2 });
    expect(await screen.findByTestId("deck-version-title")).toHaveTextContent("Banu Princes · v2");
    await waitFor(() => expect(screen.getByTestId("deck-version-meta")).toHaveTextContent("Première partie le 24 octobre · 3 parties"));
    expect(await screen.findByTestId("deck-tables")).toHaveAttribute("data-editable", "false");

    fireEvent.click(screen.getByTestId("version-view-changes"));
    const changes = screen.getByTestId("version-changes");
    expect(within(changes).getByTestId("version-changes-in")).toHaveTextContent("Ministry Un+1");
    expect(within(changes).getByTestId("version-changes-qty")).toHaveTextContent("Tremere Un1 → 2");
  });

  it("une version jamais lue sur l'appareil : liste indisponible hors ligne", async () => {
    await openPlayed("#/parties");
    await go({ name: "deckVersion", key: "id:1", number: 7 });
    expect(await screen.findByTestId("version-unavailable")).toHaveTextContent(
      "La v7 de Banu Princes n'a jamais été ouverte sur cet appareil.",
    );
  });

  it("le détail d'une partie mène à sa liste", async () => {
    await openPlayed("#/parties");
    await go({ name: "game", key: "id:2" });
    expect(await screen.findByTestId("game-fact-version-link")).toHaveAttribute("href", "#/decks/id:1/versions/2");
  });
});

describe("résultats d'un deck et decks d'un tournoi", () => {
  it("au mobile, le détail d'un deck donne son bilan par version et mène au bilan filtré", async () => {
    setViewportWidth(390);
    await openPlayed("#/parties");
    await go({ name: "deck", key: "id:1" });
    const results = await screen.findByTestId("deck-results");
    await waitFor(() => expect(within(results).getByTestId("deck-results-summary")).toHaveTextContent("2 GW sur 3 parties"));
    expect(within(results).getAllByTestId("deck-results-version").map((row) => row.getAttribute("data-version"))).toEqual(["v2"]);
    expect(within(results).getByTestId("deck-results-bilan")).toHaveAttribute("href", "#/bilan?deck=id:1");
  });

  it("au bureau, l'aperçu d'un deck jamais joué dit « Pas encore joué »", async () => {
    const server = playedServer();
    server.state.decks.push({ id: 3, name: "Aaa Neuf", discriminator: "0003", client_ref: null, proxy_allowed: false, archived_at: null });
    const app = await renderApp({ server, hash: "#/decks" });
    await act(async () => {
      await app.runtime.refresh();
    });
    await screen.findByTestId("decks-detail-title");
    expect(await screen.findByTestId("deck-results-none")).toHaveTextContent("Pas encore joué");
  });

  it("le tournoi nomme la version de chaque deck et la ronde qui l'a figée", async () => {
    setViewportWidth(390);
    await openPlayed("#/parties");
    await go({ name: "tournament", key: "id:1" });
    const decks = await screen.findByTestId("tournament-decks");
    const rows = within(decks).getAllByTestId("tournament-deck");
    await waitFor(() => expect(rows[0]).toHaveTextContent("Banu Princes · v2"));
    expect(within(rows[0]).getByTestId("tournament-deck-frozen")).toHaveTextContent("figée à la ronde 2 · rondes 2 et 3");
    expect(rows[1]).toHaveTextContent("Toreador Mass Vote · v1");
    expect(within(rows[1]).getByTestId("tournament-deck-frozen")).toHaveTextContent("figée à la ronde 1 · ronde 1");
    expect(screen.getAllByTestId("tournament-round")[1]).toHaveTextContent("Banu Princes · v2");
  });
});

describe("archétype en six puces", () => {
  it("une seule puce, un second toucher la retire, et l'archétype part dans deck.create", async () => {
    setViewportWidth(390);
    const { runtime } = await renderApp({ online: false, hash: "#/decks" });
    fireEvent.click(await screen.findByTestId("deck-add"));
    const form = await screen.findByTestId("deck-form");
    fireEvent.change(within(form).getByLabelText("Nom du deck"), { target: { value: "Malkavien" } });
    fireEvent.click(within(form).getByTestId("deck-form-archetype-bleed"));
    fireEvent.click(within(form).getByTestId("deck-form-archetype-vote"));
    expect(within(form).getByTestId("deck-form-archetype-bleed")).not.toBeChecked();
    fireEvent.click(within(form).getByTestId("deck-form-archetype-vote"));
    expect(within(form).getByTestId("deck-form-archetype-vote")).not.toBeChecked();
    fireEvent.click(within(form).getByTestId("deck-form-archetype-wall"));
    fireEvent.click(within(form).getByTestId("deck-form-submit"));
    await screen.findByTestId("deck-page");
    const [op] = (await runtime.outbox.list()).map((entry) => entry.operation);
    expect(op).toMatchObject({ type: "deck.create", data: { name: "Malkavien", archetype: "wall" } });
  });
});
