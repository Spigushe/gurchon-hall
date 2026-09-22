import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";

describe("point d'entrée de la couche offline", () => {
  it("s'importe sous vitest, sans le plugin PWA de Vite", async () => {
    const barrel = await import("../../../src/offline");
    expect(barrel.SyncEngine).toBeTypeOf("function");
    expect(barrel.Outbox).toBeTypeOf("function");
    expect(barrel.vtes.createVtesOffline).toBeTypeOf("function");
    expect(barrel.API_ROUTE_PREFIXES.length).toBeGreaterThan(0);
    expect("registerServiceWorker" in barrel).toBe(false); // à importer directement
  });
});
