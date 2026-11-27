import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClientContext } from "../../../src/app/apiClientContext";
import { PublicReportPage } from "../../../src/features/report/PublicReportPage";
import type { ApiClient } from "../../../src/offline/vtes";
import type { VtesOfflineRuntime } from "../../../src/offline/vtes/runtime";
import { createFakeServer } from "../offline/fakeServer";
import { crypt, library } from "../offline/fixtures/syntheticCatalog";
import { renderApp, setOnline } from "./harness";

/**
 * Compte-rendu de tournoi (lot Compte-rendu) : l'écran du propriétaire, hors
 * ligne, et la page publique, sans session.
 */

function seededServer() {
  const server = createFakeServer();
  server.state.decks.push({
    id: 1,
    name: "Banu Princes",
    discriminator: "0001",
    client_ref: null,
    proxy_allowed: false,
    archived_at: null,
  });
  server.state.players.push({ id: 2, name: "Marc F.", is_me: false });
  server.state.tournaments.push({
    id: 1,
    name: "Open de Lyon",
    start_date: "2026-10-24",
    end_date: null,
    venue_id: null,
    deck_policy: "mono",
    format: "constructed",
    event_tier: "standard",
    final_deck_rule: null,
    round_count: 2,
    player_count: 18,
    my_ranking: 4,
    notes: "Bonne journée.",
    updated_at: "2026-10-24T10:00:00Z",
  });
  server.state.games.push({
    id: 1,
    played_at: "2026-10-24T12:00:00Z",
    venue_id: null,
    tournament_id: 1,
    round_number: 1,
    round_type: "preliminary",
    player_count: 4,
    notes: "Ronde serrée.",
    updated_at: "2026-10-24T12:00:00Z",
    participations: [
      { player_id: 1, is_me: true, deck_id: 1, seat: 1, victory_points: 2, game_win: true, notes: "Tirage correct." },
      { player_id: 2, is_me: false, deck_id: null, seat: 2, victory_points: null, game_win: null, notes: "Joue vite." },
    ],
  });
  return server;
}

async function openReport() {
  const server = seededServer();
  const app = await renderApp({ server, hash: "#/tournois/id:1/compte-rendu", online: true });
  await act(async () => {
    await app.runtime.refresh();
  });
  await app.settle();
  await act(async () => {
    setOnline(false);
  });
  await screen.findByTestId("report");
  return app;
}

const queuedOps = async (app: { runtime: VtesOfflineRuntime }) =>
  (await app.runtime.outbox.list()).map((entry) => entry.operation);

describe("compte-rendu dans l'application, hors ligne", () => {
  it("montre l'aperçu du tournoi : en-tête, résultat, ronde et notes", async () => {
    await openReport();
    expect(screen.getByTestId("report-title")).toHaveTextContent("Open de Lyon");
    expect(screen.getByTestId("report-ranking")).toHaveTextContent("4e sur 18");
    expect(screen.getByTestId("report-decks")).toHaveTextContent("Banu Princes");
    const round = screen.getByTestId("report-round");
    expect(round).toHaveTextContent("Ronde 1");
    expect(round).toHaveTextContent("Marc F.");
    // Notes sur les adversaires exclues par défaut (P4), ma note incluse (A8).
    expect(within(round).queryByText("Joue vite.")).toBeNull();
    expect(within(round).getByText("Tirage correct.")).toBeInTheDocument();
    expect(screen.getByTestId("report-include-my-notes")).toBeChecked();
    expect(screen.getByTestId("report-footer")).toHaveTextContent("Aperçu, non synchronisé");
  });

  it("« Mettre à jour » met une demande en file, sans rien d'autre", async () => {
    const app = await openReport();
    fireEvent.click(screen.getByTestId("report-update"));
    await waitFor(async () => {
      expect(await queuedOps(app)).toEqual([
        expect.objectContaining({
          type: "tournament.update",
          tournament: { tournament_id: 1 },
          data: { report: { action: "update" } },
        }),
      ]);
    });
    expect(await screen.findByTestId("report-pending")).toHaveTextContent("figée à la synchronisation");
  });

  it("l'option des notes sur les adversaires voyage avec la demande et s'affiche dans l'aperçu", async () => {
    const app = await openReport();
    fireEvent.click(screen.getByTestId("report-include-notes"));
    expect(await within(screen.getByTestId("report-round")).findByText("Joue vite.")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("report-update"));
    await waitFor(async () => {
      const [operation] = await queuedOps(app);
      expect(operation).toMatchObject({ data: { report: { action: "update", include_opponent_notes: true } } });
    });
  });

  it("la case de ma note retire ma note de l'aperçu et voyage avec la demande, elle seule", async () => {
    const app = await openReport();
    fireEvent.click(screen.getByTestId("report-include-my-notes"));
    await waitFor(() => expect(within(screen.getByTestId("report-round")).queryByText("Tirage correct.")).toBeNull());
    fireEvent.click(screen.getByTestId("report-update"));
    await waitFor(async () => {
      const [operation] = await queuedOps(app);
      expect(operation).toMatchObject({ data: { report: { action: "update", include_my_notes: false } } });
      expect((operation as { data: { report: object } }).data.report).not.toHaveProperty("include_opponent_notes");
    });
  });

  it("modifie la note d'une partie sur place, par la file", async () => {
    const app = await openReport();
    const editor = screen.getByTestId("report-round-notes-editor");
    fireEvent.click(within(editor).getByTestId("report-round-notes-editor-edit"));
    fireEvent.change(screen.getByTestId("report-round-notes-editor-input"), { target: { value: "Ronde gagnée au temps." } });
    fireEvent.click(screen.getByTestId("report-round-notes-editor-save"));
    await waitFor(async () => {
      expect(await queuedOps(app)).toEqual([
        expect.objectContaining({ type: "game.update", data: { notes: "Ronde gagnée au temps." } }),
      ]);
    });
  });

  it("le partage demande une connexion et une version", async () => {
    await openReport();
    expect(screen.getByTestId("report-link-create")).toBeDisabled();
    expect(screen.getByTestId("report-share")).toHaveTextContent("Le partage demande une connexion.");
  });

  it("au bureau, le panneau de réglages est en place, avec ses interrupteurs et le badge de version", async () => {
    await openReport();
    const panel = screen.getByTestId("report-panel");
    expect(within(panel).getByTestId("report-update")).toHaveTextContent("Mettre à jour le compte-rendu");
    expect(within(panel).getByTestId("report-print")).toBeInTheDocument();
    expect(within(panel).getByTestId("report-status")).toHaveTextContent("Les notes se modifient sur place.");
    const options = within(panel).getByTestId("report-notes-options");
    expect(within(options).getByTestId("report-include-notes")).toHaveAttribute("role", "switch");
    expect(within(options).getByTestId("report-include-my-notes")).toHaveAttribute("role", "switch");
    expect(within(options).getAllByText(/^Prises en compte à la prochaine mise à jour\./)).toHaveLength(2);
    expect(within(options).getByText(/Elles se saisissent dans le formulaire de partie\./)).toBeInTheDocument();
    expect(screen.queryByTestId("report-settings-open")).toBeNull();
    expect(screen.getByTestId("report-version-badge")).toHaveTextContent("Aperçu, non synchronisé");
  });

  describe("au mobile", () => {
    const original = window.innerWidth;
    afterEach(() => {
      window.innerWidth = original;
    });

    it("garde « Mettre à jour » dans la barre et range les réglages dans la feuille", async () => {
      window.innerWidth = 390;
      const app = await openReport();
      expect(screen.queryByTestId("report-panel")).toBeNull();
      expect(screen.getByTestId("report-version-bar")).toContainElement(screen.getByTestId("report-update"));
      expect(screen.queryByTestId("report-include-notes")).toBeNull();
      expect(screen.queryByTestId("report-print")).toBeNull();

      fireEvent.click(screen.getByTestId("report-settings-open"));
      const sheet = await screen.findByTestId("report-settings-sheet");
      expect(within(sheet).getByRole("heading", { name: "Réglages" })).toBeInTheDocument();
      expect(within(sheet).getByTestId("report-include-notes")).toBeInTheDocument();
      expect(within(sheet).getByTestId("report-include-my-notes")).toBeInTheDocument();
      expect(within(sheet).getByTestId("report-print")).toBeInTheDocument();
      expect(within(sheet).getByTestId("report-share")).toBeInTheDocument();

      fireEvent.click(within(sheet).getByTestId("report-include-notes"));
      fireEvent.click(screen.getByLabelText("Fermer"));
      expect(screen.queryByTestId("report-settings-sheet")).toBeNull();
      fireEvent.click(screen.getByTestId("report-update"));
      await waitFor(async () => {
        const [operation] = await queuedOps(app);
        expect(operation).toMatchObject({ data: { report: { action: "update", include_opponent_notes: true } } });
      });
    });

    it("ferme la feuille avant d'imprimer", async () => {
      window.innerWidth = 390;
      const print = vi.spyOn(window, "print").mockImplementation(() => {
        expect(screen.queryByTestId("report-settings-sheet")).toBeNull();
      });
      await openReport();
      fireEvent.click(screen.getByTestId("report-settings-open"));
      fireEvent.click(await screen.findByTestId("report-print"));
      expect(print).toHaveBeenCalledTimes(1);
    });
  });

  it("le détail du tournoi y mène", async () => {
    const server = seededServer();
    const app = await renderApp({ server, hash: "#/tournois/id:1", online: true });
    await act(async () => {
      await app.runtime.refresh();
    });
    await app.settle();
    expect(await screen.findByTestId("tournament-report-status")).toHaveTextContent("Pas encore de version");
    expect(screen.getByTestId("tournament-report-link")).toHaveAttribute("href", "#/tournois/id:1/compte-rendu");
  });

  it("au bureau, le lien est dans la rangée d'actions, après « Modifier »", async () => {
    const original = window.innerWidth;
    window.innerWidth = 1440;
    try {
      const server = seededServer();
      const app = await renderApp({ server, hash: "#/tournois", online: true });
      await act(async () => {
        await app.runtime.refresh();
      });
      await app.settle();
      const detail = await screen.findByTestId("tournaments-detail");
      const group = await within(detail).findByRole("group", { name: "Actions sur le tournoi" });
      const link = within(group).getByTestId("tournament-report-link");
      const edit = within(group).getByTestId("tournament-edit");
      expect(edit.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(within(group).getByTestId("tournament-report-status")).toHaveTextContent("Pas encore de version");
      expect(within(detail).queryByTestId("tournament-report-entry")).toBeNull();
    } finally {
      window.innerWidth = original;
    }
  });
});

// --------------------------------------------------------------------------
// Page publique
// --------------------------------------------------------------------------

const SNAPSHOT = {
  format_version: 1,
  my_display_name: null as string | null,
  tournament: {
    name: "Coupe de Lutèce",
    start_date: "2026-11-14",
    end_date: null,
    venue: { name: "Le Dé Pipé", city: "Paris" },
    deck_policy: "mono",
    format: "constructed",
    event_tier: "standard",
    final_deck_rule: null,
    round_count: 3,
    player_count: 22,
    my_ranking: 3,
    notes: "Premier tournoi.",
  },
  summary: {
    preliminary_game_wins: 1,
    preliminary_victory_points: 3,
    rounds_played: 1,
    final_victory_points: null,
    final_game_win: null,
  },
  decks: [{ deck_id: 7, name: "Guns", archetype: "rush", version_number: 2, cards: [{ card_id: 1, quantity: 12 }, { card_id: 2, quantity: 4 }] }],
  rounds: [
    {
      round_type: "preliminary",
      round_number: 1,
      played_at: "2026-11-14T13:00:00Z",
      player_count: 5,
      notes: "Belle partie.",
      seats: [
        { seat: 1, is_me: false, player_name: "Marc", deck_id: null, deck_name: null, deck_archetype: null, clan_name: "Ventrue", victory_points: null, game_win: null, notes: null },
        { seat: 2, is_me: true, player_name: null, deck_id: 7, deck_name: "Guns", deck_archetype: "rush", clan_name: null, victory_points: 3, game_win: true, notes: null },
      ],
    },
  ],
};

function publicReport(number: number, versions: number[]) {
  return {
    author: "auteur",
    number,
    created_at: "2026-11-23T10:00:00Z",
    latest_number: Math.max(...versions),
    versions: versions.map((n) => ({ number: n, created_at: "2026-11-23T10:00:00Z" })),
    snapshot: { ...SNAPSHOT, tournament: { ...SNAPSHOT.tournament, notes: `Notes v${number}` } },
    cards: [crypt({ id: 1, name: "Anson", capacity: 9 }), library({ id: 2, name: "Vessel" })],
  };
}

function renderPublic(answer: (path: string, init: { params: { path: { number?: number } } }) => Promise<unknown>) {
  const GET = vi.fn(answer);
  render(
    <ApiClientContext.Provider value={{ GET } as unknown as ApiClient}>
      <PublicReportPage hash="#/compte-rendu/aB3x_9pQ" />
    </ApiClientContext.Provider>,
  );
  return GET;
}

const ok = (data: unknown) => Promise.resolve({ data, response: { status: 200, headers: new Headers() } });

afterEach(() => vi.restoreAllMocks());

describe("page publique d'un compte-rendu", () => {
  it("écrit mon nom à afficher avec le badge, et « Moi » sans badge sans pseudo ni nom (A12)", async () => {
    renderPublic(() => ok({ ...publicReport(1, [1]), snapshot: { ...SNAPSHOT, my_display_name: "Spig" } }));
    const round = await screen.findByTestId("report-round");
    expect(round).toHaveTextContent("Spig");
    expect(round).not.toHaveTextContent("@auteur");
    expect(screen.getByTestId("report-seat-me-badge")).toBeInTheDocument();
  });

  it("sans nom ni auteur, ma ligne dit « Moi » sans badge", async () => {
    renderPublic(() => ok({ ...publicReport(1, [1]), author: "" }));
    expect(await screen.findByTestId("report-round")).toHaveTextContent("Moi");
    expect(screen.queryByTestId("report-seat-me-badge")).not.toBeInTheDocument();
  });

  it("lit la dernière version sans cookie et la met en page", async () => {
    const GET = renderPublic(() => ok(publicReport(1, [1])));
    expect(await screen.findByTestId("report-title")).toHaveTextContent("Coupe de Lutèce");
    expect(GET).toHaveBeenCalledWith("/comptes-rendus/{token}", {
      params: { path: { token: "aB3x_9pQ" } },
      credentials: "omit",
    });
    expect(screen.getByText("par @auteur")).toBeInTheDocument();
    expect(screen.getByTestId("report-round")).toHaveTextContent("@auteur");
    expect(screen.getByTestId("report-seat-me-badge")).toHaveTextContent("Moi");
    expect(screen.getByTestId("report-list")).toHaveTextContent("Guns (Rush)");
    expect(screen.queryByTestId("public-report-versions")).toBeNull();
    expect(screen.getByTestId("public-report-print")).toBeInTheDocument();
    // Ni badge de version (écran du propriétaire seulement), ni panneau ; badge « Moi » sur ma ligne.
    expect(screen.queryByTestId("report-version-badge")).toBeNull();
    expect(screen.queryByTestId("report-panel")).toBeNull();
    expect(screen.getByTestId("report-seat-me-badge")).toHaveTextContent("Moi");
  });

  it("choisit une version antérieure dans la page, jamais dans l'adresse (P9)", async () => {
    window.location.hash = "#/compte-rendu/aB3x_9pQ";
    const GET = renderPublic((path, init) =>
      ok(path.endsWith("{number}") ? publicReport(init.params.path.number as number, [1, 2]) : publicReport(2, [1, 2])),
    );
    await screen.findByTestId("public-report-versions");
    fireEvent.click(screen.getAllByTestId("public-report-version")[0]);
    expect(await screen.findByTestId("public-report-older")).toHaveTextContent("la dernière est la version 2");
    expect(GET).toHaveBeenLastCalledWith("/comptes-rendus/{token}/versions/{number}", {
      params: { path: { token: "aB3x_9pQ", number: 1 } },
      credentials: "omit",
    });
    expect(window.location.hash).toBe("#/compte-rendu/aB3x_9pQ");
    expect(screen.getByTestId("report-tournament-notes")).toHaveTextContent("Notes v1");
  });

  it("dit « Compte-rendu introuvable. » sur un 404", async () => {
    renderPublic(() => Promise.resolve({ error: {}, response: { status: 404, headers: new Headers() } }));
    expect(await screen.findByTestId("public-report-not-found")).toHaveTextContent("Compte-rendu introuvable.");
  });

  it("dit qu'il demande le réseau quand la requête échoue", async () => {
    renderPublic(() => Promise.reject(new TypeError("Failed to fetch")));
    expect(await screen.findByTestId("public-report-offline")).toBeInTheDocument();
  });
});
