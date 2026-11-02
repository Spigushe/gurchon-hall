import { describe, expect, it } from "vitest";
import * as ops from "../../../src/offline/vtes/operations";
import {
  CREATION_BINDINGS,
  REFERENCE_FIELDS,
  referencesOf,
} from "../../../src/offline/vtes/references";
import { groupCascades } from "../../../src/offline/core/references";
import {
  toGameRef,
  toParticipantRef,
  toPlayerRef,
  toTournamentRef,
  toVenueRef,
} from "../../../src/offline/vtes/types";

let counter = 0;
const clock: ops.OperationClock = {
  newId: () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`,
  now: () => "2026-10-24T20:00:00.000+02:00",
};

describe("désignations du Lot 7", () => {
  it("une clé ou un sélecteur donnent la même référence du contrat", () => {
    expect(toPlayerRef("id:12")).toEqual({ player_id: 12 });
    expect(toPlayerRef({ id: 12 })).toEqual({ player_id: 12 });
    expect(toPlayerRef("ref:abc")).toEqual({ client_ref: "abc" });
    expect(toVenueRef("id:3")).toEqual({ venue_id: 3 });
    expect(toTournamentRef({ clientRef: "t" })).toEqual({ client_ref: "t" });
    expect(toGameRef("id:9")).toEqual({ game_id: 9 });
  });

  it("« moi » devient {me: true}", () => {
    expect(toParticipantRef("me")).toEqual({ me: true });
    expect(toParticipantRef("ref:p")).toEqual({ client_ref: "p" });
  });
});

describe("constructeurs joueurs et lieux", () => {
  it("joueur : création à plat avec sa référence, mise à jour et suppression par désignation", () => {
    expect(ops.playerCreate(clock, "r1", { name: "Marc" })).toMatchObject({
      type: "player.create",
      client_ref: "r1",
      data: { name: "Marc" },
    });
    const update = ops.playerUpdate(clock, "ref:r1", { name: "Marco" });
    expect(update).toMatchObject({ type: "player.update", player: { client_ref: "r1" }, data: { name: "Marco" } });
    expect("client_ref" in update).toBe(false); // une modification désigne, elle ne porte pas de client_ref
    expect(ops.playerDelete(clock, { id: 4 })).toMatchObject({
      type: "player.delete",
      player: { player_id: 4 },
    });
  });

  it("lieu : champs omis ne partent pas, null explicite part", () => {
    const create = ops.venueCreate(clock, "v1", { name: "Club" });
    expect(create.data).toEqual({ name: "Club" });
    expect("city" in create.data).toBe(false);

    const update = ops.venueUpdate(clock, "id:2", { city: null });
    expect(update.data).toEqual({ city: null });
    expect(ops.venueDelete(clock, "id:2")).toMatchObject({ type: "venue.delete", venue: { venue_id: 2 } });
  });
});

describe("constructeurs de tournoi", () => {
  it("création : snake_case, lieu en référence, champs omis absents", () => {
    const op = ops.tournamentCreate(clock, "t1", {
      name: "Nationaux",
      startDate: "2026-10-24",
      venue: "ref:v1",
      deckPolicy: "multi",
      finalDeckRule: "free_choice",
      eventTier: "national_championship",
    });
    expect(op).toMatchObject({ type: "tournament.create", client_ref: "t1" });
    expect(op.data).toEqual({
      name: "Nationaux",
      start_date: "2026-10-24",
      venue: { client_ref: "v1" },
      deck_policy: "multi",
      final_deck_rule: "free_choice",
      event_tier: "national_championship",
    });
  });

  it("modification : le lieu null part comme null", () => {
    expect(ops.tournamentUpdate(clock, "id:1", { venue: null }).data).toEqual({ venue: null });
  });

  it("le passage en mono envoie final_deck_rule: null avec", () => {
    const op = ops.tournamentUpdate(clock, "id:1", { deckPolicy: "mono" });
    expect(op.data).toEqual({ deck_policy: "mono", final_deck_rule: null });
  });

  it("le passage en multi n'efface rien, et une règle fournie en mono est laissée au serveur", () => {
    expect(ops.tournamentUpdate(clock, "id:1", { deckPolicy: "multi" }).data).toEqual({
      deck_policy: "multi",
    });
    expect(
      ops.tournamentUpdate(clock, "id:1", { deckPolicy: "mono", finalDeckRule: "free_choice" }).data,
    ).toEqual({ deck_policy: "mono", final_deck_rule: "free_choice" });
  });

  it("une modification sans politique ne touche pas à la règle de finale", () => {
    expect(ops.tournamentUpdate(clock, "id:1", { name: "X" }).data).toEqual({ name: "X" });
  });

  it("suppression", () => {
    expect(ops.tournamentDelete(clock, "id:1")).toMatchObject({
      type: "tournament.delete",
      tournament: { tournament_id: 1 },
    });
  });
});

describe("constructeurs de partie", () => {
  const table: ops.ParticipationInput[] = [
    { player: "me", deck: "ref:d1", seat: 2, victoryPoints: 2.5, gameWin: true },
    { player: "ref:p1", seat: 1, deck: { deckId: 7 } },
    { player: "id:5" },
  ];

  it("création : table complète, références par désignation, instant maintenant par défaut", () => {
    const op = ops.gameCreate(clock, "g1", {
      venue: "ref:v1",
      tournament: "ref:t1",
      roundNumber: 2,
      roundType: "preliminary",
      playerCount: 4,
      participations: table,
    });
    expect(op).toMatchObject({ type: "game.create", client_ref: "g1" });
    expect(op.data).toEqual({
      played_at: "2026-10-24T20:00:00.000+02:00",
      venue: { client_ref: "v1" },
      tournament: { client_ref: "t1" },
      round_number: 2,
      round_type: "preliminary",
      player_count: 4,
      participations: [
        { player: { me: true }, deck: { client_ref: "d1" }, seat: 2, victory_points: 2.5, game_win: true },
        { player: { client_ref: "p1" }, seat: 1, deck: { deck_id: 7 } },
        { player: { player_id: 5 } },
      ],
    });
  });

  it("modification : data et table sont omis s'ils ne sont pas fournis (deux empreintes différentes de {})", () => {
    const onlyTable = ops.gameUpdate(clock, "id:3", { table });
    expect("data" in onlyTable).toBe(false);
    expect(onlyTable.table?.participations).toHaveLength(3);

    const onlyFields = ops.gameUpdate(clock, "id:3", { fields: { notes: null } });
    expect(onlyFields.data).toEqual({ notes: null });
    expect("table" in onlyFields).toBe(false);

    const emptyFields = ops.gameUpdate(clock, "id:3", { fields: {} });
    expect(emptyFields.data).toEqual({}); // le corps exact : data: {} est conservé
    expect("data" in ops.gameUpdate(clock, "id:3", {})).toBe(false);
  });

  it("modification : détacher d'un tournoi se dit par null", () => {
    const op = ops.gameUpdate(clock, "ref:g1", {
      fields: { tournament: null, roundType: "casual", roundNumber: null },
    });
    expect(op.game).toEqual({ client_ref: "g1" });
    expect(op.data).toEqual({ tournament: null, round_type: "casual", round_number: null });
  });

  it("suppression", () => {
    expect(ops.gameDelete(clock, "id:8")).toMatchObject({ type: "game.delete", game: { game_id: 8 } });
  });
});

describe("tables de références, typées contre l'union générée", () => {
  it("chaque création a son genre et le champ d'identifiant du verdict", () => {
    expect(CREATION_BINDINGS["deck.create"]).toEqual({ kind: "deck", idField: "deck_id" });
    expect(CREATION_BINDINGS["player.create"]).toEqual({ kind: "player", idField: "player_id" });
    expect(CREATION_BINDINGS["venue.create"]).toEqual({ kind: "venue", idField: "venue_id" });
    expect(CREATION_BINDINGS["tournament.create"]).toEqual({
      kind: "tournament",
      idField: "tournament_id",
    });
    expect(CREATION_BINDINGS["game.create"]).toEqual({ kind: "game", idField: "game_id" });
    expect(Object.keys(CREATION_BINDINGS)).toHaveLength(5);
  });

  it("les chemins de REFERENCE_FIELDS trouvent les références que les constructeurs écrivent", () => {
    const built = [
      ops.tournamentCreate(clock, "t1", { name: "T", startDate: "2026-10-24", venue: "ref:v1" }),
      ops.tournamentUpdate(clock, "ref:t1", { venue: "ref:v2" }),
      ops.gameCreate(clock, "g1", {
        venue: "ref:v1",
        tournament: "ref:t1",
        playerCount: 4,
        participations: [
          { player: "me", deck: "ref:d1" },
          { player: "ref:p1", deck: "ref:d2" },
          { player: "id:3" },
        ],
      }),
      ops.gameUpdate(clock, "ref:g1", {
        fields: { venue: "ref:v3", tournament: "ref:t2" },
        table: [{ player: "ref:p9", deck: "ref:d9" }],
      }),
      ops.gameDelete(clock, "ref:g1"),
      ops.playerUpdate(clock, "ref:p1", { name: "x" }),
      ops.venueDelete(clock, "ref:v1"),
      ops.tournamentDelete(clock, "ref:t1"),
    ];
    const uses = built.map((op) => referencesOf(op).uses.map((use) => `${use.kind}:${use.clientRef}`));
    expect(uses[0]).toEqual(["venue:v1"]);
    expect(uses[1]).toEqual(["tournament:t1", "venue:v2"]);
    expect(uses[2]).toEqual(["venue:v1", "tournament:t1", "player:p1", "deck:d1", "deck:d2"]);
    expect(uses[3]).toEqual(["game:g1", "venue:v3", "tournament:t2", "player:p9", "deck:d9"]);
    expect(uses[4]).toEqual(["game:g1"]);
    expect(uses[5]).toEqual(["player:p1"]);
    expect(uses[6]).toEqual(["venue:v1"]);
    expect(uses[7]).toEqual(["tournament:t1"]);
  });

  it("chaque type désignant une ressource a ses champs", () => {
    for (const type of [
      "player.update",
      "player.delete",
      "venue.update",
      "venue.delete",
      "tournament.update",
      "tournament.delete",
      "game.update",
      "game.delete",
    ] as const) {
      expect(REFERENCE_FIELDS[type]?.length).toBeGreaterThan(0);
    }
  });
});

describe("refus en cascade sous leur racine, de genres mélangés", () => {
  it("une création de lieu refusée entraîne le tournoi, puis la partie, de proche en proche", () => {
    const venue = ops.venueCreate(clock, "v1", { name: "Club" });
    const tournament = ops.tournamentCreate(clock, "t1", { name: "T", startDate: "2026-10-24", venue: "ref:v1" });
    const game = ops.gameCreate(clock, "g1", {
      tournament: "ref:t1",
      playerCount: 4,
      participations: [{ player: "me" }],
    });
    const unrelated = ops.playerCreate(clock, "p1", { name: "Marc" });
    const groups = groupCascades([game, unrelated, tournament, venue], referencesOf);
    // Les groupes suivent l'ordre d'entrée de leur racine.
    expect(groups.map((g) => g.root.type)).toEqual(["player.create", "venue.create"]);
    expect(groups[0].dependents).toEqual([]);
    expect(groups[1].dependents.map((d) => d.type)).toEqual(["game.create", "tournament.create"]);
  });

  it("un joueur 7 et un deck 7 ne se confondent pas : seule la référence client relie", () => {
    const player = ops.playerCreate(clock, "same", { name: "Marc" });
    const wrongKind = ops.deckUpdate(clock, "ref:same", { name: "x" });
    const groups = groupCascades([player, wrongKind], referencesOf);
    // La référence « same » désigne un deck dans la seconde opération : pas la création du joueur.
    expect(groups).toHaveLength(2);
  });
});
