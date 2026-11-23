import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  bandText,
  cssString,
  deckLines,
  footerText,
  formatFact,
  headerFactsGrid,
  noteParagraphs,
  pageRule,
  printSeats,
  resultCells,
  roundScore,
  roundSub,
  roundsList,
  type PrintState,
} from "../../../../src/features/report/printModel";
import { ReportPrint } from "../../../../src/features/report/ReportPrint";
import type { ReportRound, ReportSeat, ReportSnapshot } from "../../../../src/features/report/reportModel";
import { cardDetailRowOf, cardRowOf } from "../../../../src/offline/vtes/refresh";
import { crypt, library } from "../../offline/fixtures/syntheticCatalog";

/**
 * La page imprimée du compte-rendu (handoff `docs/design-handoff/COMPTE-RENDU.md`) :
 * ce que chaque bloc écrit, d'après la copie du handoff.
 */

const seat = (overrides: Partial<ReportSeat>): ReportSeat => ({
  seat: null,
  is_me: false,
  player_name: null,
  deck_id: null,
  deck_name: null,
  deck_archetype: null,
  clan_name: null,
  victory_points: null,
  game_win: null,
  notes: null,
  ...overrides,
});

const round = (overrides: Partial<ReportRound>): ReportRound => ({
  round_type: "preliminary",
  round_number: 1,
  played_at: "2026-11-14T13:00:00Z",
  player_count: 5,
  notes: null,
  seats: [],
  ...overrides,
});

const me = seat({ seat: 2, is_me: true, deck_id: 7, deck_name: "Guns and shit (mostly guns)", victory_points: 3, game_win: true });

function snapshot(overrides: Partial<ReportSnapshot> = {}): ReportSnapshot {
  return {
    format_version: 1,
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
      notes: "Premier paragraphe.\n\nSecond, avec\nun saut simple.",
    },
    summary: {
      preliminary_game_wins: 2,
      preliminary_victory_points: 6.5,
      rounds_played: 3,
      final_victory_points: 1,
      final_game_win: false,
    },
    decks: [{ deck_id: 7, name: "Guns and shit (mostly guns)", archetype: "rush", version_number: 2, cards: [{ card_id: 1, quantity: 2 }, { card_id: 2, quantity: 7 }] }],
    rounds: [
      round({
        notes: "Belle partie.",
        seats: [
          seat({ seat: 1, player_name: "Marc", clan_name: "Ventrue", deck_archetype: "vote", deck_name: "Princes de Paris" }),
          me,
          seat({ seat: 3, notes: "Joue vite." }),
        ],
      }),
      round({ round_type: "final", round_number: null, seats: [{ ...me, victory_points: 1, game_win: false }] }),
    ],
    ...overrides,
  };
}

describe("en-tête", () => {
  it("écrit les lignes de deck, en multi-deck avec leurs rondes", () => {
    expect(deckLines(snapshot())).toEqual(["Guns and shit (mostly guns) — Rush"]);
    const multi = snapshot({
      tournament: { ...snapshot().tournament, deck_policy: "multi" },
      decks: [
        { deck_id: 7, name: "Guns", archetype: "rush", version_number: 2, cards: [] },
        { deck_id: 8, name: "Brujah Trophy Hunter", archetype: null, version_number: 1, cards: [] },
      ],
      rounds: [
        round({ round_number: 1, seats: [{ ...me, deck_id: 7 }] }),
        round({ round_number: 2, seats: [{ ...me, deck_id: 8 }] }),
        round({ round_number: 3, seats: [{ ...me, deck_id: 7 }] }),
      ],
    });
    expect(deckLines(multi)).toEqual(["Guns — Rush · rondes 1 et 3", "Brujah Trophy Hunter · ronde 2"]);
  });

  it("écrit la liste des rondes comme le handoff", () => {
    expect(roundsList([2], false)).toBe("ronde 2");
    expect(roundsList([3, 1], false)).toBe("rondes 1 et 3");
    expect(roundsList([1, 2, 3], false)).toBe("rondes 1, 2 et 3");
    expect(roundsList([2, 3], true)).toBe("rondes 2 et 3, finale");
    expect(roundsList([], true)).toBe("finale");
  });

  it("donne les faits dans l'ordre, sans ceux qui manquent", () => {
    expect(headerFactsGrid(snapshot(), "spigushe")).toEqual([
      { label: "Date", value: "Samedi 14 novembre 2026" },
      { label: "Lieu", value: "Le Dé Pipé, Paris" },
      { label: "Niveau", value: "Standard" },
      { label: "Format", value: "Construit · mono-deck · 3R+F" },
      { label: "Participation", value: "22 joueuses et joueurs" },
      { label: "Auteur", value: "@spigushe" },
    ]);
    const bare = snapshot({
      tournament: { ...snapshot().tournament, venue: null, player_count: null, end_date: "2026-11-15", deck_policy: "multi", final_deck_rule: "best_performing" },
    });
    expect(headerFactsGrid(bare, null).map((fact) => fact.label)).toEqual(["Dates", "Niveau", "Format", "Finale"]);
    expect(headerFactsGrid(bare, null).at(-1)?.value).toBe("Au meilleur deck");
  });

  it("écrit le format sans « +F » quand aucune finale n'est au compte-rendu", () => {
    expect(formatFact(snapshot({ rounds: [round({})] }))).toBe("Construit · mono-deck · 3R");
  });
});

describe("résultat et notes", () => {
  it("tasse les cases présentes à gauche", () => {
    expect(resultCells(snapshot())).toEqual([
      { label: "Classement", big: "3e sur 22", small: "classement final" },
      { label: "Préliminaires", big: "2 GW · 6,5 VP", small: "en 3 rondes" },
      { label: "Finale", big: "1 VP", small: null },
    ]);
    const noRanking = snapshot({
      tournament: { ...snapshot().tournament, my_ranking: null },
      summary: { ...snapshot().summary, final_victory_points: null, final_game_win: null },
    });
    expect(resultCells(noRanking).map((cell) => cell.label)).toEqual(["Préliminaires"]);
  });

  it("coupe les notes en paragraphes sur les lignes vides", () => {
    expect(noteParagraphs("Premier.\n\n  \nSecond,\nsuite.")).toEqual(["Premier.", "Second,\nsuite."]);
    expect(noteParagraphs(null)).toEqual([]);
  });
});

describe("rondes", () => {
  it("écrit la tête : deck en multi-deck, table, score sans « pas de GW »", () => {
    const [first, final] = snapshot().rounds;
    expect(roundSub(first, snapshot())).toBe("Table à 5");
    expect(roundScore(first)).toBe("3 VP · GW");
    expect(roundScore(final)).toBe("1 VP");
    expect(roundSub(final, snapshot())).toBeNull();
  });

  it("place proie et prédateur, met les guillemets au nom libre et nomme les notes", () => {
    const rows = printSeats(snapshot().rounds[0]);
    expect(rows.map((row) => [row.number, row.player, row.deck, row.position, row.noteLabel])).toEqual([
      ["1", "Marc", "Ventrue · Vote · « Princes de Paris »", "mon prédateur", null],
      ["2", "Moi", "Guns and shit (mostly guns)", null, null],
      ["3", "Joueur non nommé", null, "ma proie", "Note sur le siège 3 ·"],
    ]);
  });

  it("met ma ligne sans siège en dernier, « – », sans position", () => {
    const rows = printSeats(round({ seats: [{ ...me, seat: null }, seat({ seat: 1, player_name: "Léa" })] }));
    expect(rows.map((row) => [row.number, row.player, row.deck, row.position])).toEqual([
      ["1", "Léa", null, null],
      ["–", "Moi", "Guns and shit (mostly guns) · siège non saisi", null],
    ]);
  });

  it("à deux joueurs, le même siège est proie et prédateur", () => {
    const rows = printSeats(round({ player_count: 2, seats: [{ ...me, seat: 1 }, seat({ seat: 2, player_name: "Léa" })] }));
    expect(rows[1].position).toBe("ma proie et mon prédateur");
  });
});

describe("pied et bandeau", () => {
  const version: PrintState = { kind: "version", number: 2, createdAt: "2026-11-24T10:00:00Z" };
  const older: PrintState = { kind: "older", number: 1, createdAt: "2026-12-07T10:00:00Z", latestNumber: 3, latestCreatedAt: "2026-12-09T10:00:00Z" };
  const preview: PrintState = { kind: "preview", date: "2026-12-06T10:00:00Z" };

  it("écrit le pied d'une version et d'un aperçu", () => {
    expect(footerText("Coupe de Lutèce", version, "gurchon.spigushe.com")).toBe(
      "Compte-rendu de Coupe de Lutèce · version 2 du 24 novembre 2026 · gurchon.spigushe.com",
    );
    expect(footerText("Nuit des Anarchs", preview, "gurchon.spigushe.com")).toBe(
      "Compte-rendu de Nuit des Anarchs · aperçu non synchronisé du 6 décembre 2026 · gurchon.spigushe.com",
    );
  });

  it("n'a de bandeau que pour un aperçu ou une version antérieure", () => {
    expect(bandText(version)).toBeNull();
    expect(bandText(preview)).toBe(
      "APERÇU, NON SYNCHRONISÉ · Cette version n'est pas encore enregistrée sur le serveur ; elle peut encore changer.",
    );
    expect(bandText(older)).toBe("VERSION 1 SUR 3 · Une version plus récente existe : la version 3 du 9 décembre 2026.");
  });

  it("échappe la chaîne de la règle @page", () => {
    expect(cssString('a "b" \\ c\nd')).toBe('"a \\"b\\" \\\\ c d"');
    expect(pageRule("Pied", null)).toBe('@page { @bottom-left { content: "Pied"; } }');
    expect(pageRule("Pied", "Bandeau")).toContain('margin-top: 24mm; @top-left { content: "Bandeau"; }');
  });
});

describe("bloc imprimé", () => {
  it("rend l'en-tête, le résultat, les rondes et la liste, masqué aux lecteurs d'écran", () => {
    const facts = new Map(
      [crypt({ id: 1, name: "Anson", capacity: 9, group: "6" }), library({ id: 2, name: "Villein", types: ["Master"] })].map(
        (card) => [card.id, { card: cardRowOf(card), details: cardDetailRowOf(card) }] as const,
      ),
    );
    const { container } = render(
      <ReportPrint
        snapshot={snapshot()}
        facts={facts}
        author="spigushe"
        state={{ kind: "version", number: 2, createdAt: "2026-11-24T10:00:00Z" }}
        site="gurchon.spigushe.com"
      />,
    );
    const print = screen.getByTestId("cr-print");
    expect(print).toHaveAttribute("aria-hidden", "true");
    expect(within(print).getByText("Coupe de Lutèce")).toBeInTheDocument();
    expect(screen.getAllByTestId("cr-round")).toHaveLength(2);
    expect(screen.getAllByTestId("cr-seat")).toHaveLength(3);
    const list = screen.getByTestId("cr-list");
    expect(list).toHaveTextContent("liste v2");
    expect(list).toHaveTextContent("Crypte 2 cartes · bibliothèque 7 cartes · Rush");
    expect(list).toHaveTextContent("groupe 6");
    expect(container.querySelector("style")?.textContent).toContain("version 2 du 24 novembre 2026");
    expect(print.textContent).not.toContain("pas de GW");
  });
});
