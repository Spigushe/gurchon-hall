import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PREVIEW_HOVER_DELAY_MS } from "../../../../src/features/decks/CardNamePreview";
import { ReportView } from "../../../../src/features/report/ReportView";
import type { ReportSnapshot } from "../../../../src/features/report/reportModel";
import { cardDetailRowOf, cardRowOf } from "../../../../src/offline/vtes/refresh";
import { crypt, library } from "../../offline/fixtures/syntheticCatalog";

/**
 * La liste jouée du compte-rendu montre l'image d'une carte au survol de son
 * nom, comme une liste partagée (issue #71) : l'écran du propriétaire et la
 * page publique passent tous deux par `ReportView`.
 */

const ANSON = "https://static.krcg.org/card/anson.jpg";

const snapshot: ReportSnapshot = {
  format_version: 1,
  my_display_name: null,
  tournament: {
    name: "Coupe de Lutèce",
    start_date: "2026-11-14",
    end_date: null,
    venue: null,
    deck_policy: "mono",
    format: "constructed",
    event_tier: "standard",
    final_deck_rule: null,
    round_count: 3,
    player_count: null,
    my_ranking: null,
    notes: null,
  },
  summary: {
    preliminary_game_wins: 0,
    preliminary_victory_points: 0,
    rounds_played: 0,
    final_victory_points: null,
    final_game_win: null,
  },
  decks: [
    {
      deck_id: 7,
      name: "Guns",
      archetype: null,
      version_number: 1,
      cards: [
        { card_id: 1, quantity: 2 },
        { card_id: 2, quantity: 7 },
      ],
    },
  ],
  rounds: [],
};

const facts = new Map(
  [
    crypt({ id: 1, name: "Anson", capacity: 9, group: "6", imageUrl: ANSON }),
    library({ id: 2, name: "Villein", types: ["Master"] }),
  ].map((card) => [card.id, { card: cardRowOf(card), details: cardDetailRowOf(card) }] as const),
);

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("liste jouée du compte-rendu", () => {
  it("montre l'image d'une carte au survol de son nom", () => {
    render(<ReportView snapshot={snapshot} facts={facts} author="spigushe" versionLabel="Version 1" />);
    const lists = screen.getByTestId("report-lists");
    const name = within(lists).getByRole("button", { name: "Anson" });
    fireEvent.mouseEnter(name.parentElement!);
    act(() => vi.advanceTimersByTime(PREVIEW_HOVER_DELAY_MS));
    expect(screen.getByTestId("deck-card-preview")).toBeTruthy();
    expect(screen.getByAltText("Anson").getAttribute("src")).toBe(ANSON);
    fireEvent.mouseLeave(name.parentElement!);
    expect(screen.queryByTestId("deck-card-preview")).toBeNull();
  });

  it("ouvre l'aperçu au toucher de la ligne", () => {
    render(<ReportView snapshot={snapshot} facts={facts} author="spigushe" versionLabel="Version 1" />);
    const name = within(screen.getByTestId("report-lists")).getByRole("button", { name: "Anson" });
    const row = name.closest<HTMLElement>('[role="row"]')!;
    const cell = row.querySelector<HTMLElement>(".deck-table__qty") ?? row;
    fireEvent.pointerDown(cell, { pointerType: "touch" });
    fireEvent.click(cell);
    expect(screen.getByTestId("deck-card-preview")).toBeTruthy();
  });
});
