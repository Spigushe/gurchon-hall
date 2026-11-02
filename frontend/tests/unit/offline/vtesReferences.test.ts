import { describe, expect, it } from "vitest";
import { groupCascades } from "../../../src/offline/core/references";
import { isDeckOperation, isStockOperation, operationFamily } from "../../../src/offline/vtes/families";
import * as ops from "../../../src/offline/vtes/operations";
import { project } from "../../../src/offline/vtes/overlay";
import {
  CREATION_BINDINGS,
  bindingsOfKind,
  kindOfBinding,
  referencesOf,
} from "../../../src/offline/vtes/references";
import { toVerdict } from "../../../src/offline/vtes/transport";
import { parseResourceKey, resourceKeyOf } from "../../../src/offline/vtes/types";

type Result = Parameters<typeof toVerdict>[0];

/** Résultat de `/sync` pour un type que les types générés ne connaissent pas encore (B3). */
function resultOf(type: string, resource: Record<string, unknown> | null, extra: object = {}): Result {
  return {
    operation_id: "op-1",
    type,
    outcome: "applied",
    client_ref: "ref-1",
    error: null,
    resource,
    ...extra,
  } as unknown as Result;
}

describe("toVerdict : une table type -> genre", () => {
  it("garde le deck sans genre (absent = deck)", () => {
    expect(toVerdict(resultOf("deck.create", { deck_id: 12 })).refs).toEqual([
      { ref: "ref-1", id: 12 },
    ]);
  });

  it.each([
    ["player.create", "player_id", "player"],
    ["venue.create", "venue_id", "venue"],
    ["tournament.create", "tournament_id", "tournament"],
    ["game.create", "game_id", "game"],
  ])("lie %s à l'identifiant %s, genre %s", (type, idField, kind) => {
    expect(toVerdict(resultOf(type, { [idField]: 7 })).refs).toEqual([
      { ref: "ref-1", id: 7, kind },
    ]);
  });

  it("lit l'identifiant du genre, pas celui d'un autre champ de la ressource", () => {
    expect(toVerdict(resultOf("player.create", { deck_id: 3, player_id: null })).refs).toEqual([]);
  });

  it("ne lie rien pour un refus, sans référence, une mise à jour ou un type inconnu", () => {
    expect(
      toVerdict(
        resultOf("player.create", null, {
          outcome: "rejected",
          error: { code: "invalid", message: "x" },
        }),
      ).refs,
    ).toEqual([]);
    expect(toVerdict(resultOf("game.create", { game_id: 5 }, { client_ref: null })).refs).toEqual([]);
    expect(toVerdict(resultOf("game.update", { game_id: 5 })).refs).toEqual([]);
    expect(toVerdict(resultOf("toString", { deck_id: 5 })).refs).toEqual([]);
  });

  it("couvre les cinq créations", () => {
    expect(Object.keys(CREATION_BINDINGS).sort()).toEqual([
      "deck.create",
      "game.create",
      "player.create",
      "tournament.create",
      "venue.create",
    ]);
  });
});

describe("genre d'une correspondance", () => {
  const refs = [
    { ref: "d", id: 12, boundAt: "x" },
    { ref: "p", id: 12, boundAt: "x", kind: "player" },
    { ref: "d2", id: 13, boundAt: "x", kind: "deck" },
  ];
  it("lit absent comme deck", () => {
    expect(kindOfBinding(refs[0])).toBe("deck");
    expect(kindOfBinding(refs[1])).toBe("player");
  });
  it("ne rend que les correspondances du genre demandé", () => {
    expect(bindingsOfKind(refs, "deck").map((b) => b.ref)).toEqual(["d", "d2"]);
    expect(bindingsOfKind(refs, "player").map((b) => b.ref)).toEqual(["p"]);
  });
});

describe("surcouche : un joueur et un deck de même identifiant", () => {
  const clock: ops.OperationClock = {
    newId: () => "op-x",
    now: () => "2026-10-29T10:00:00.000+02:00",
  };
  const deckRow = {
    id: 12,
    name: "Banu",
    foldedName: "banu",
    discriminator: "0001",
    createdOn: null,
    status: "draft" as const,
    archetype: null,
    notes: null,
    proxyAllowed: false,
    archivedAt: null,
  };

  it("ne donne pas au deck 12 la référence du joueur 12", () => {
    const projection = project(
      {
        stock: [],
        decks: [deckRow],
        deckCards: [],
        cards: [],
        // Le joueur 12 a été créé hors ligne ; le deck 12 vient du serveur.
        refs: [{ ref: "joueur-uuid", id: 12, boundAt: "x", kind: "player" }],
      },
      [ops.deckUpdate(clock, "id:12", { notes: "n" })],
    );
    expect(projection.decks[0]).toMatchObject({ key: "id:12", clientRef: null, notes: "n" });
  });

  it("garde la clé ref: d'un deck dont la correspondance n'a pas de genre", () => {
    const projection = project(
      {
        stock: [],
        decks: [deckRow],
        deckCards: [],
        cards: [],
        refs: [{ ref: "deck-uuid", id: 12, boundAt: "x" }],
      },
      [],
    );
    expect(projection.decks[0].key).toBe("ref:deck-uuid");
  });
});

describe("referencesOf", () => {
  it("lit la création et les désignations de deck du contrat actuel", () => {
    expect(referencesOf({ type: "deck.create", client_ref: "d1", data: {} } as never)).toEqual({
      creates: { kind: "deck", clientRef: "d1" },
      uses: [],
    });
    const line = ops.deckCardUpsert({ newId: () => "o", now: () => "t" }, "ref:d1", {
      cardId: 1,
      languageCode: "EN",
      cardSetId: 2,
      quantity: 1,
    });
    expect(referencesOf(line)).toEqual({ creates: null, uses: [{ kind: "deck", clientRef: "d1" }] });
  });

  it("lit la table d'une partie du Lot 7 : joueurs et decks prêtés, pas le « Moi »", () => {
    const game = {
      type: "game.create",
      client_ref: "g1",
      data: {
        venue: { client_ref: "v1" },
        tournament: { tournament_id: 4 },
        participations: [
          { player: { me: true }, deck: { client_ref: "d1" } },
          { player: { client_ref: "p1" }, deck: { deck_id: 9 } },
          { player: { player_id: 2 } },
        ],
      },
    };
    expect(referencesOf(game)).toEqual({
      creates: { kind: "game", clientRef: "g1" },
      uses: [
        { kind: "venue", clientRef: "v1" },
        // Ordre des champs déclarés : les joueurs de la table, puis les decks.
        { kind: "player", clientRef: "p1" },
        { kind: "deck", clientRef: "d1" },
      ],
    });
  });

  it("lit la correction d'une partie : la partie, et la table sous `table`", () => {
    const update = {
      type: "game.update",
      game: { client_ref: "g1" },
      data: {},
      table: { participations: [{ player: { client_ref: "p1" } }] },
    };
    expect(referencesOf(update).uses).toEqual([
      { kind: "game", clientRef: "g1" },
      { kind: "player", clientRef: "p1" },
    ]);
  });

  it("alimente groupCascades : un joueur refusé entraîne la partie qui le nomme", () => {
    const entries = [
      { id: "joueur", operation: { type: "player.create", client_ref: "p1", data: {} } },
      {
        id: "partie",
        operation: {
          type: "game.create",
          client_ref: "g1",
          data: { participations: [{ player: { client_ref: "p1" } }] },
        },
      },
      { id: "autre", operation: { type: "deck.delete", deck: { client_ref: "p1" } } },
    ];
    const groups = groupCascades(entries, (entry) => referencesOf(entry.operation));
    // Le deck « p1 » n'est pas le joueur « p1 » : même référence, deux genres.
    expect(groups.map((g) => [g.root.id, g.dependents.map((d) => d.id)])).toEqual([
      ["joueur", ["partie"]],
      ["autre", []],
    ]);
  });
});

describe("familles d'opérations", () => {
  it("classe les huit types actuels et ceux du Lot 7", () => {
    expect(operationFamily("stock.upsert")).toBe("stock");
    expect(operationFamily("bundle.deposit")).toBe("stock");
    expect(operationFamily("deck_card.upsert")).toBe("deck");
    expect(operationFamily("deck.create")).toBe("deck");
    expect(operationFamily("player.create")).toBe("player");
    expect(operationFamily("venue.delete")).toBe("venue");
    expect(operationFamily("tournament.update")).toBe("tournament");
    expect(operationFamily("game.update")).toBe("game");
    expect(operationFamily("autre.chose")).toBeNull();
  });
  it("n'efface qu'une famille", () => {
    expect(isDeckOperation("game.create")).toBe(false);
    expect(isStockOperation("deck_card.upsert")).toBe(false);
  });
});

describe("clés de surcouche", () => {
  it("vont et viennent entre sélecteur et clé", () => {
    expect(resourceKeyOf({ id: 4 })).toBe("id:4");
    expect(resourceKeyOf({ clientRef: "abc" })).toBe("ref:abc");
    expect(parseResourceKey("id:4")).toEqual({ id: 4 });
    expect(parseResourceKey("ref:abc")).toEqual({ clientRef: "abc" });
  });
});
