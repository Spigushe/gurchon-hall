import { describe, expect, it, vi } from "vitest";
import { requestPersistentStorage } from "../../../src/offline/core/storage";

/** Lot Chercher, P14 : `navigator.storage.persist()` au démarrage, sans écran. */
describe("requestPersistentStorage", () => {
  it("ne redemande pas quand le stockage est déjà persistant", async () => {
    const persist = vi.fn(async () => true);
    expect(await requestPersistentStorage({ persisted: async () => true, persist })).toBe("persisted");
    expect(persist).not.toHaveBeenCalled();
  });

  it("rend le verdict du navigateur : accordé ou refusé", async () => {
    expect(await requestPersistentStorage({ persisted: async () => false, persist: async () => true })).toBe(
      "persisted",
    );
    expect(await requestPersistentStorage({ persisted: async () => false, persist: async () => false })).toBe(
      "denied",
    );
  });

  it("ne lève jamais : API absente ou appel en échec", async () => {
    expect(await requestPersistentStorage(undefined)).toBe("unsupported");
    expect(await requestPersistentStorage({} as never)).toBe("unsupported");
    expect(
      await requestPersistentStorage({
        persisted: async () => false,
        persist: async () => {
          throw new DOMException("refus", "SecurityError");
        },
      }),
    ).toBe("error");
  });

  it("lit `navigator.storage` par défaut (absent sous jsdom)", async () => {
    expect(await requestPersistentStorage()).toBe(
      typeof navigator.storage?.persist === "function" ? expect.any(String) : "unsupported",
    );
  });
});
