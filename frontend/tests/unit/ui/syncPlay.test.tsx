import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hrefFor } from "../../../src/app/routes";
import * as ops from "../../../src/offline/vtes/operations";
import { renderApp, setOnline } from "./harness";

/** Mobile (feuille de correction inline), comme `sync.test.tsx`. */
function setViewportWidth(width: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: width });
}
beforeEach(() => setViewportWidth(390));
afterEach(() => setViewportWidth(1024));

async function openSyncPage(rejected: number) {
  await waitFor(() =>
    expect(screen.getByTestId("sync-status")).toHaveAttribute("data-rejected", String(rejected)),
  );
  act(() => {
    window.location.hash = hrefFor({ name: "sync" });
  });
  return screen.findByTestId("rejected-operations");
}

const goOnline = async (app: Awaited<ReturnType<typeof renderApp>>) => {
  act(() => setOnline(true));
  await app.settle();
};

describe("Synchronisation : opérations de la pratique de jeu", () => {
  it("regroupe sous leur racine les refus en cascade, de genres différents", async () => {
    const app = await renderApp({ online: false, catalog: true });
    // Un adversaire au nom du « Moi » : le serveur refuse la création, donc aussi la partie qui le cite.
    const impostor = await app.runtime.actions.createPlayer({ name: "Moi" });
    await app.runtime.actions.createGame({
      playedAt: "2026-10-24T20:00:00+02:00",
      roundType: "preliminary",
      roundNumber: 1,
      playerCount: 4,
      participations: [{ player: "me" }, { player: impostor.key }],
    });
    await goOnline(app);
    const panel = await openSyncPage(2);

    const items = within(panel).getAllByTestId("rejected-operation");
    expect(items.map((item) => item.getAttribute("data-operation-type"))).toEqual(["player.create", "game.create"]);
    expect(within(items[0]).getByTestId("rejected-description")).toHaveTextContent("Création du joueur « Moi »");
    expect(within(items[1]).getByTestId("rejected-description")).toHaveTextContent(/^Partie du \d{2}\/\d{2}, ronde 1$/);
    // Seule la partie est une suite de refus, et elle nomme sa racine.
    expect(within(items[0]).queryByTestId("rejected-cascade")).not.toBeInTheDocument();
    expect(within(items[1]).getByTestId("rejected-cascade")).toHaveTextContent("Création du joueur « Moi »");
    expect(within(items[1]).getByTestId("rejection-reason")).toHaveTextContent("Création d'origine introuvable ou refusée");
  });

  it("corrige le numéro de ronde d'une partie refusée (ronde déjà saisie) et la renvoie", async () => {
    const app = await renderApp({ online: false, catalog: true });
    const tournament = await app.runtime.actions.createTournament({ name: "Locaux", startDate: "2026-10-24" });
    const round = (playedAt: string) =>
      app.runtime.actions.createGame({
        playedAt,
        tournament: tournament.key,
        roundType: "preliminary",
        roundNumber: 1,
        playerCount: 4,
        participations: [{ player: "me", victoryPoints: 1 }],
      });
    await round("2026-10-24T19:00:00+02:00");
    await round("2026-10-24T20:00:00+02:00"); // même ronde : refusée par le serveur
    await goOnline(app);
    await openSyncPage(1);

    const item = screen.getByTestId("rejected-operation");
    expect(within(item).getByTestId("rejection-reason")).toHaveTextContent("La ronde 1 est déjà saisie");
    fireEvent.click(screen.getByTestId("correct-button"));
    const form = await screen.findByTestId("correction-form");
    fireEvent.change(within(form).getByLabelText("Numéro de ronde"), { target: { value: "2" } });
    fireEvent.change(within(form).getByLabelText("Mes Victory Points"), { target: { value: "2.5" } });
    fireEvent.click(within(form).getByTestId("correction-submit"));

    await waitFor(() => expect(screen.queryByTestId("rejected-operation")).not.toBeInTheDocument());
    await app.settle();
    expect(app.server.state.games.map((g) => [g.round_number, g.participations[0].victory_points])).toEqual([
      [1, 1],
      [2, 2.5],
    ]);
    expect(await app.runtime.outbox.list()).toHaveLength(0);
  });

  it("propose d'envoyer final_deck_rule: null avec un passage en mono sans règle, et le fait", async () => {
    const app = await renderApp({ online: false, catalog: true });
    const tournament = await app.runtime.actions.createTournament({
      name: "Locaux",
      startDate: "2026-10-24",
      deckPolicy: "multi",
      finalDeckRule: "free_choice",
    });
    // Saisie « à la main » d'une opération telle qu'une version plus ancienne de l'appli l'aurait écrite.
    await app.runtime.outbox.enqueue({
      type: "tournament.update",
      operation_id: "00000000-0000-4000-8000-0000000000aa",
      recorded_at: "2026-10-24T20:00:00.000+02:00",
      tournament: { client_ref: tournament.clientRef },
      data: { deck_policy: "mono" },
    });
    await goOnline(app);
    // Le rafraîchissement automatique est coupé en test : le tournoi entre dans le miroir (et se nomme).
    await act(async () => {
      await app.runtime.refresh();
    });
    await openSyncPage(1);

    const item = screen.getByTestId("rejected-operation");
    await waitFor(() =>
      expect(within(item).getByTestId("rejected-description")).toHaveTextContent(
        "Tournoi « Locaux » : passage en mono-deck",
      ),
    );
    expect(within(item).getByTestId("rejection-reason")).toHaveTextContent("règle du deck de finale");
    fireEvent.click(screen.getByTestId("correct-button"));
    const form = await screen.findByTestId("correction-form");
    expect(within(form).getByTestId("correction-final-rule-reset")).toBeInTheDocument();
    fireEvent.click(within(form).getByTestId("correction-submit"));

    await waitFor(() => expect(screen.queryByTestId("rejected-operation")).not.toBeInTheDocument());
    await app.settle();
    expect(app.server.state.tournaments[0]).toMatchObject({ deck_policy: "mono", final_deck_rule: null });
  });

  it("un lieu désigné par une référence inconnue se cite sans inventer de nom", async () => {
    const app = await renderApp({ online: false, catalog: true });
    const venue = await app.runtime.actions.createVenue({ name: "Club" });
    await app.runtime.actions.updateVenue(venue.key, { city: "Lyon" });
    // Un lieu supprimé par une référence inconnue : refus, libellé sans nom.
    await app.runtime.outbox.enqueue(ops.venueDelete({ newId: () => "00000000-0000-4000-8000-0000000000bb", now: () => "2026-10-24T20:00:00.000+02:00" }, "ref:fantome"));
    await goOnline(app);
    await openSyncPage(1);
    expect(screen.getByTestId("rejected-description")).toHaveTextContent("Suppression du lieu introuvable localement (supprimé ?)");
  });
});
