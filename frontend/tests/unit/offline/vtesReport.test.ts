import { describe, expect, it } from "vitest";
import { CORE_STORES_V1, CORE_STORES_V2, OfflineCoreDb } from "../../../src/offline/core/db";
import {
  VtesOfflineDb,
  VTES_STORES_V1,
  VTES_STORES_V2,
  VTES_STORES_V3,
  VTES_STORES_V4,
  VTES_STORES_V5,
  VTES_STORES_V6,
} from "../../../src/offline/vtes/db";
import { readReportVersions } from "../../../src/offline/vtes/reads";
import { refreshReportVersions, refreshTournaments } from "../../../src/offline/vtes/refresh";
import { createFakeServer } from "./fakeServer";
import { freshDbName } from "./helpers";
import { parseHash, hrefFor } from "../../../src/app/routes";
import * as ops from "../../../src/offline/vtes/operations";
import { reportState } from "../../../src/offline/vtes/overlayPlay";
import type { TournamentReportRow } from "../../../src/offline/vtes";

const clock: ops.OperationClock = { newId: () => "00000000-0000-4000-8000-000000000001", now: () => "2026-11-23T10:00:00Z" };

const report: TournamentReportRow = {
  includeOpponentNotes: false,
  showPreviousVersions: false,
  token: null,
  createdAt: "2026-11-23T09:00:00Z",
  versions: [{ number: 1, createdAt: "2026-11-23T09:00:00Z" }],
};

describe("demande au compte-rendu dans tournament.update (lot Compte-rendu)", () => {
  it("met à jour, avec ou sans le réglage des notes sur les adversaires", () => {
    expect(ops.tournamentUpdate(clock, "id:1", { report: { action: "update" } }).data).toEqual({
      report: { action: "update" },
    });
    expect(
      ops.tournamentUpdate(clock, "id:1", { report: { action: "update", includeOpponentNotes: true } }).data,
    ).toEqual({ report: { action: "update", include_opponent_notes: true } });
  });

  it("porte le réglage de ma note seulement s'il est fourni", () => {
    expect(ops.tournamentUpdate(clock, "id:1", { report: { action: "update", includeMyNotes: false } }).data).toEqual({
      report: { action: "update", include_my_notes: false },
    });
    expect(
      ops.tournamentUpdate(clock, "id:1", { report: { action: "update", includeOpponentNotes: true, includeMyNotes: true } }).data,
    ).toEqual({ report: { action: "update", include_opponent_notes: true, include_my_notes: true } });
  });

  it("supprime, et une modification ordinaire ne porte aucune demande", () => {
    expect(ops.tournamentUpdate(clock, "id:1", { report: { action: "delete" } }).data).toEqual({
      report: { action: "delete" },
    });
    expect(ops.tournamentUpdate(clock, "id:1", { notes: "x" }).data).toEqual({ notes: "x" });
  });
});

describe("demande au compte-rendu vue par la surcouche", () => {
  const base = { report, reportRequest: null };

  it("note une mise à jour en file et applique le réglage des notes", () => {
    expect(reportState(base, { action: "update", include_opponent_notes: true }, true)).toEqual({
      report: { ...report, includeOpponentNotes: true },
      reportRequest: "update",
    });
  });

  it("applique le réglage de ma note, et laisse l'autre intact s'il est omis", () => {
    expect(reportState(base, { action: "update", include_my_notes: false }, false).report).toEqual({
      ...report,
      includeMyNotes: false,
    });
  });

  it("retire le compte-rendu d'une suppression en file", () => {
    expect(reportState(base, { action: "delete" }, true)).toEqual({ report: null, reportRequest: "delete" });
  });

  it("ne note rien pour une opération tranchée, ni sans demande", () => {
    expect(reportState(base, { action: "update" }, false)).toEqual(base);
    expect(reportState(base, undefined, true)).toEqual(base);
  });
});

describe("route du compte-rendu", () => {
  it("se lit et s'écrit, clé comprise", () => {
    expect(parseHash("#/tournois/id:1/compte-rendu")).toEqual({ name: "tournamentReport", key: "id:1" });
    expect(parseHash("#/tournois/ref%3A3f2a-9c/compte-rendu")).toEqual({ name: "tournamentReport", key: "ref:3f2a-9c" });
    expect(hrefFor({ name: "tournamentReport", key: "id:1" })).toBe("#/tournois/id:1/compte-rendu");
    expect(parseHash("#/tournois/id:1")).toEqual({ name: "tournament", key: "id:1" });
  });
});

/** Base au schéma du Lot 8 (versions 1 à 7) : l'« ancien code » d'avant le lot. */
class Lot8Db extends OfflineCoreDb {
  constructor(name: string) {
    super(name);
    this.version(1).stores({ ...CORE_STORES_V1, ...VTES_STORES_V1 });
    this.version(2).stores({ ...CORE_STORES_V2 });
    this.version(3).stores({ ...VTES_STORES_V2 });
    this.version(4).stores({ ...VTES_STORES_V3 });
    this.version(5).stores({ ...VTES_STORES_V4 });
    this.version(6).stores({ ...VTES_STORES_V5 });
    this.version(7).stores({ ...VTES_STORES_V6 });
  }
}

describe("version 8 du schéma (lot Compte-rendu)", () => {
  it("ajoute `reportVersions` sans rien vider : tournois, file et versions de deck restent", async () => {
    const name = freshDbName("v8");
    const before = new Lot8Db(name);
    await before.table("deckVersions").put({ id: 1, deckId: 4, number: 1, createdAt: "t", cryptCount: 0, libraryCount: 0, cards: [] });
    await before.table("outbox").put({
      operationId: "op-1",
      rank: 1,
      type: "tournament.update",
      state: "pending",
      operation: ops.tournamentUpdate(clock, "id:1", { notes: "x" }),
      recordedAt: "t",
      attempts: 0,
    });
    before.close();

    const after = new VtesOfflineDb(name);
    try {
      await after.open();
      expect(after.verno).toBe(8);
      expect(await after.reportVersions.count()).toBe(0);
      expect(await after.deckVersions.count()).toBe(1);
      expect(await after.outbox.count()).toBe(1);
    } finally {
      after.close();
    }
  });
});

describe("miroir des comptes-rendus (`refreshTournaments`, `refreshReportVersions`)", () => {
  const snapshot = (notes: string) => ({ format_version: 1, tournament: { name: "Open", notes }, summary: {}, decks: [], rounds: [] });

  function serverWithReport() {
    const server = createFakeServer();
    server.state.tournaments.push({
      id: 1,
      name: "Open",
      start_date: "2026-11-14",
      end_date: null,
      venue_id: null,
      deck_policy: "mono",
      format: "constructed",
      event_tier: "standard",
      final_deck_rule: null,
      round_count: null,
      player_count: null,
      my_ranking: null,
      notes: null,
      updated_at: "2026-11-14T10:00:00Z",
    });
    server.state.reports.set(1, {
      read: {
        tournament_id: 1,
        include_opponent_notes: true,
        include_my_notes: false,
        show_previous_versions: false,
        token: "aB3x_9pQ",
        created_at: "2026-11-14T20:00:00Z",
        versions: [
          { number: 1, created_at: "2026-11-14T20:00:00Z" },
          { number: 2, created_at: "2026-11-15T20:00:00Z" },
        ],
      },
      snapshots: new Map([
        [1, snapshot("v1")],
        [2, snapshot("v2")],
      ]),
    });
    return server;
  }

  it("range le compte-rendu dans la ligne du tournoi et lit chaque version une fois", async () => {
    const server = serverWithReport();
    const db = new VtesOfflineDb(freshDbName("report-refresh"));
    try {
      await refreshTournaments(server.client, db);
      expect((await db.tournaments.get(1))?.report).toEqual({
        includeOpponentNotes: true,
        includeMyNotes: false,
        showPreviousVersions: false,
        token: "aB3x_9pQ",
        createdAt: "2026-11-14T20:00:00Z",
        versions: [
          { number: 1, createdAt: "2026-11-14T20:00:00Z" },
          { number: 2, createdAt: "2026-11-15T20:00:00Z" },
        ],
      });
      expect(await refreshReportVersions(server.client, db)).toBe(2);
      expect((await readReportVersions(db, 1)).map((row) => [row.number, row.snapshot.tournament.notes])).toEqual([
        [1, "v1"],
        [2, "v2"],
      ]);

      // Une version ne change jamais : un second passage ne relit rien.
      server.state.requests.length = 0;
      await refreshReportVersions(server.client, db);
      expect(server.state.requests.filter((request) => request.path.includes("compte-rendu"))).toEqual([]);

      // Compte-rendu supprimé : ses versions sortent du magasin.
      server.state.reports.delete(1);
      await refreshTournaments(server.client, db);
      expect((await db.tournaments.get(1))?.report).toBeNull();
      await refreshReportVersions(server.client, db);
      expect(await db.reportVersions.count()).toBe(0);
    } finally {
      db.close();
    }
  });
});
