import { describe, expect, it } from "vitest";
import { describeOperation, gameLabel, type DescribeContext } from "../../../../src/features/sync/describeOperation";
import { isCorrectable } from "../../../../src/features/sync/correctable";
import {
  applyDraft,
  fieldsOf,
  initialDraft,
  missesFinalRuleReset,
  type PlayDraft,
} from "../../../../src/features/sync/playCorrection";
import * as ops from "../../../../src/offline/vtes/operations";
import type { VtesOperation } from "../../../../src/offline/vtes/types";

let counter = 0;
const clock: ops.OperationClock = {
  newId: () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`,
  now: () => "2026-10-24T20:00:00.000+02:00",
};

const ctx: DescribeContext = {
  card: (id) => `carte ${id}`,
  set: (id) => `ext ${id}`,
  deck: () => "deck « Banu »",
  player: () => "joueur « Marc »",
  venue: () => "lieu « Club »",
  tournament: () => "tournoi « Locaux »",
  game: () => "partie du 24/10, ronde 2",
};

describe("libellés des douze types", () => {
  it("la partie : « Partie du 24/10, ronde 2 », finale, amicale", () => {
    const at = "2026-10-24T12:00:00Z";
    expect(gameLabel({ played_at: at, round_type: "preliminary", round_number: 2 })).toBe("Partie du 24/10, ronde 2");
    expect(gameLabel({ played_at: at, round_type: "final" })).toBe("Partie du 24/10, finale");
    expect(gameLabel({ played_at: at, round_type: "casual" })).toBe("Partie du 24/10");
    expect(gameLabel({ played_at: at })).toBe("Partie du 24/10");
  });

  it.each([
    [ops.playerCreate(clock, "p", { name: "Marc" }), "Création du joueur « Marc »"],
    [ops.playerUpdate(clock, "id:1", { name: "Marco" }), "Joueur « Marc » : renommage en « Marco »"],
    [ops.playerDelete(clock, "id:1"), "Suppression du joueur « Marc »"],
    [ops.venueCreate(clock, "v", { name: "Club" }), "Création du lieu « Club »"],
    [ops.venueUpdate(clock, "id:1", { city: "Lyon", notes: null }), "Lieu « Club » : ville, notes"],
    [ops.venueDelete(clock, "id:1"), "Suppression du lieu « Club »"],
    [ops.tournamentCreate(clock, "t", { name: "Locaux", startDate: "2026-10-24" }), "Création du tournoi « Locaux »"],
    [
      ops.tournamentUpdate(clock, "id:1", { deckPolicy: "mono" }),
      "Tournoi « Locaux » : passage en mono-deck",
    ],
    [
      ops.tournamentUpdate(clock, "id:1", { myRanking: 3, playerCount: 27 }),
      "Tournoi « Locaux » : nombre de joueurs, classement final",
    ],
    [ops.tournamentDelete(clock, "id:1"), "Suppression du tournoi « Locaux »"],
    [
      ops.gameCreate(clock, "g", {
        playedAt: "2026-10-24T12:00:00Z",
        roundType: "preliminary",
        roundNumber: 2,
        playerCount: 4,
        participations: [{ player: "me" }],
      }),
      "Partie du 24/10, ronde 2",
    ],
    [
      ops.gameUpdate(clock, "id:1", { fields: { roundNumber: 3 }, table: [{ player: "me" }] }),
      "Partie du 24/10, ronde 2 : table, ronde",
    ],
    [ops.gameUpdate(clock, "id:1", {}), "Partie du 24/10, ronde 2 : modification"],
    [ops.gameDelete(clock, "id:1"), "Suppression de la partie du 24/10, ronde 2"],
  ] as Array<[VtesOperation, string]>)("%#", (operation, expected) => {
    expect(describeOperation(operation, ctx)).toBe(expected);
  });
});

describe("corrections : quels champs, pour quel refus", () => {
  const game = (overrides: Partial<Parameters<typeof ops.gameCreate>[2]> = {}) =>
    ops.gameCreate(clock, "g", {
      roundType: "preliminary",
      roundNumber: 2,
      playerCount: 4,
      tournament: "id:1",
      participations: [
        { player: "me", seat: 5, victoryPoints: 6, gameWin: true, deck: "id:3" },
        { player: "ref:p1", seat: 1 },
      ],
      ...overrides,
    });

  it("une partie propose ronde, joueurs, ma ligne ; une amicale pas de ronde", () => {
    expect(fieldsOf(game())).toMatchObject({ roundNumber: true, playerCount: true, meLine: true });
    expect(fieldsOf(game({ roundType: "casual", roundNumber: null }))).toMatchObject({ roundNumber: false });
    expect(isCorrectable(game())).toBe(true);
  });

  it("corrige siège, VP, GW et deck de ma ligne, sans toucher aux adversaires", () => {
    const op = game();
    const draft: PlayDraft = { ...initialDraft(op), seat: "2", victoryPoints: "2.5", gameWin: "no", deckKey: "ref:d9", playerCount: 5, roundNumber: "3" };
    const result = applyDraft(op, draft);
    if ("error" in result) throw new Error(result.error);
    const fixed = result.operation as ReturnType<typeof ops.gameCreate>;
    expect(fixed.data.player_count).toBe(5);
    expect(fixed.data.round_number).toBe(3);
    expect(fixed.data.participations[0]).toEqual({
      player: { me: true },
      seat: 2,
      victory_points: 2.5,
      game_win: false,
      deck: { client_ref: "d9" },
    });
    expect(fixed.data.participations[1]).toEqual({ player: { client_ref: "p1" }, seat: 1 }); // intacte
    expect(fixed.data.tournament).toEqual({ tournament_id: 1 }); // le reste de l'opération aussi
    expect(op.data.participations[0].seat).toBe(5); // l'original n'est pas modifié
  });

  it("un champ laissé vide est omis, le deck « garder » est conservé, « aucun » le retire", () => {
    const op = game();
    const base = initialDraft(op);
    expect(base.deckKey).toBe("keep");
    const kept = applyDraft(op, { ...base, seat: "", victoryPoints: "", gameWin: "" });
    if ("error" in kept) throw new Error(kept.error);
    expect((kept.operation as ReturnType<typeof ops.gameCreate>).data.participations[0]).toEqual({
      player: { me: true },
      deck: { deck_id: 3 },
    });
    const none = applyDraft(op, { ...base, deckKey: "" });
    if ("error" in none) throw new Error(none.error);
    expect("deck" in (none.operation as ReturnType<typeof ops.gameCreate>).data.participations[0]).toBe(false);
  });

  it("refuse un nombre illisible sans rien produire", () => {
    const op = game();
    expect(applyDraft(op, { ...initialDraft(op), victoryPoints: "beaucoup" })).toEqual({
      error: "Victory Points : indiquez un nombre.",
    });
  });

  it("game.update : la table corrigée remplace l'ancienne, data reste omis s'il l'était", () => {
    const op = ops.gameUpdate(clock, "id:7", {
      table: [{ player: "me", seat: 9, victoryPoints: 3 }, { player: "id:5", seat: 1 }],
    });
    expect(fieldsOf(op)).toMatchObject({ meLine: true, playerCount: false, roundNumber: false });
    const result = applyDraft(op, { ...initialDraft(op), seat: "2" });
    if ("error" in result) throw new Error(result.error);
    const fixed = result.operation as ReturnType<typeof ops.gameUpdate>;
    expect("data" in fixed).toBe(false);
    expect(fixed.table?.participations[0]).toMatchObject({ seat: 2, victory_points: 3 });
    expect(fixed.table?.participations).toHaveLength(2);
  });

  it("game.update sans table ni champ de ma ligne n'est pas corrigible ici", () => {
    expect(isCorrectable(ops.gameUpdate(clock, "id:7", { fields: { notes: "x" } }))).toBe(false);
    expect(isCorrectable(ops.gameDelete(clock, "id:7"))).toBe(false);
  });

  it("passage en mono sans final_deck_rule: null : détecté, corrigé en l'envoyant", () => {
    const stale = {
      type: "tournament.update",
      operation_id: "00000000-0000-4000-8000-0000000000aa",
      recorded_at: "2026-10-24T20:00:00.000+02:00",
      tournament: { tournament_id: 1 },
      data: { deck_policy: "mono" },
    } as VtesOperation;
    expect(missesFinalRuleReset(stale)).toBe(true);
    expect(missesFinalRuleReset(ops.tournamentUpdate(clock, "id:1", { deckPolicy: "mono" }))).toBe(false);
    const result = applyDraft(stale, initialDraft(stale));
    if ("error" in result) throw new Error(result.error);
    expect((result.operation as ReturnType<typeof ops.tournamentUpdate>).data).toEqual({
      deck_policy: "mono",
      final_deck_rule: null,
    });
  });

  it("tournoi : repasser un multi interdit à un niveau en mono efface la règle de finale", () => {
    const op = ops.tournamentCreate(clock, "t", {
      name: "Nationaux",
      startDate: "2026-10-24",
      deckPolicy: "multi",
      finalDeckRule: "best_performing",
      eventTier: "national_championship",
    });
    const draft = { ...initialDraft(op), policy: "mono" as const };
    const result = applyDraft(op, draft);
    if ("error" in result) throw new Error(result.error);
    expect((result.operation as ReturnType<typeof ops.tournamentCreate>).data).toMatchObject({
      deck_policy: "mono",
      final_deck_rule: null,
      event_tier: "national_championship",
    });
    // En multi, la règle choisie est écrite.
    const multi = applyDraft(op, { ...initialDraft(op), finalRule: "free_choice" });
    if ("error" in multi) throw new Error(multi.error);
    expect((multi.operation as ReturnType<typeof ops.tournamentCreate>).data.final_deck_rule).toBe("free_choice");
  });

  it("tournoi : corriger la seule règle de finale d'une mise à jour ne l'efface pas", () => {
    const op = ops.tournamentUpdate(clock, "id:1", { finalDeckRule: "best_performing" });
    expect(fieldsOf(op)).toMatchObject({ finalRule: true, policy: false });
    const start = initialDraft(op);
    expect(start.policy).toBe(""); // l'opération ne la porte pas : on ne suppose rien
    expect(start.finalRule).toBe("best_performing");
    const result = applyDraft(op, { ...start, finalRule: "free_choice" });
    if ("error" in result) throw new Error(result.error);
    expect((result.operation as ReturnType<typeof ops.tournamentUpdate>).data).toEqual({
      final_deck_rule: "free_choice",
    });
    // « Pas encore annoncé » efface la règle, sans toucher à la politique.
    const cleared = applyDraft(op, { ...start, finalRule: "" });
    if ("error" in cleared) throw new Error(cleared.error);
    expect((cleared.operation as ReturnType<typeof ops.tournamentUpdate>).data).toEqual({ final_deck_rule: null });
  });

  it("tournoi : seule une opération qui porte deck_policy mono force final_deck_rule à null", () => {
    const op = ops.tournamentUpdate(clock, "id:1", { deckPolicy: "mono", finalDeckRule: null });
    expect(initialDraft(op).policy).toBe("mono");
    const result = applyDraft(op, { ...initialDraft(op), finalRule: "free_choice" });
    if ("error" in result) throw new Error(result.error);
    expect((result.operation as ReturnType<typeof ops.tournamentUpdate>).data).toMatchObject({
      deck_policy: "mono",
      final_deck_rule: null,
    });
    const multi = ops.tournamentUpdate(clock, "id:1", { deckPolicy: "multi", finalDeckRule: "free_choice" });
    const kept = applyDraft(multi, { ...initialDraft(multi), finalRule: "best_performing" });
    if ("error" in kept) throw new Error(kept.error);
    expect((kept.operation as ReturnType<typeof ops.tournamentUpdate>).data).toMatchObject({
      deck_policy: "multi",
      final_deck_rule: "best_performing",
    });
  });

  it("joueur et lieu : renommer un nom déjà pris", () => {
    const player = ops.playerCreate(clock, "p", { name: "Marc" });
    expect(fieldsOf(player)).toMatchObject({ name: true });
    const renamed = applyDraft(player, { ...initialDraft(player), name: "  Marc B. " });
    if ("error" in renamed) throw new Error(renamed.error);
    expect((renamed.operation as ReturnType<typeof ops.playerCreate>).data).toEqual({ name: "Marc B." });
    expect(applyDraft(player, { ...initialDraft(player), name: " " })).toEqual({ error: "Le nom est obligatoire." });

    const venue = ops.venueUpdate(clock, "id:2", { city: "Lyon" });
    expect(fieldsOf(venue)).toMatchObject({ name: false, city: true });
    const moved = applyDraft(venue, { ...initialDraft(venue), city: "" });
    if ("error" in moved) throw new Error(moved.error);
    expect((moved.operation as ReturnType<typeof ops.venueUpdate>).data).toEqual({ city: null });
  });

  it("les suppressions et les types du Lot 3 hors corrections de jeu restent comme avant", () => {
    expect(isCorrectable(ops.playerDelete(clock, "id:1"))).toBe(false);
    expect(isCorrectable(ops.venueDelete(clock, "id:1"))).toBe(false);
    expect(isCorrectable(ops.tournamentDelete(clock, "id:1"))).toBe(false);
    expect(isCorrectable(ops.deckCreate(clock, "d", { name: "x" }))).toBe(true);
    expect(isCorrectable(ops.deckDelete(clock, "id:1"))).toBe(false);
  });
});
