import { describe, expect, it, vi } from "vitest";
import { copyText, exportFileName } from "../../../../../src/features/decks/export/exportFile";

// Lot 9, A5 : nom du fichier exporté et repli de « Copier » hors contexte sécurisé.

describe("exportFileName", () => {
  it.each([
    [["Banu Princes", "1234"], "Banu Princes#1234.txt"],
    [["Banu Princes", "1234", 2], "Banu Princes#1234 v2.txt"],
    [["Banu Princes", null], "Banu Princes.txt"],
    [["Banu Princes", null, 3], "Banu Princes v3.txt"],
    [['Tremere: "Stealth" / Bleed?', "0001"], "Tremere_ _Stealth_ _ Bleed_#0001.txt"],
    [["  ...Bleed...  ", null], "Bleed.txt"],
    [["Ligne\tavec\ncontrôles", null], "Ligne_avec_contrôles.txt"],
    [["...", null], "deck.txt"],
  ] as const)("%j → %s", (args, expected) => {
    const [name, discriminator, version] = args as readonly [string, string | null, number?];
    expect(exportFileName(name, discriminator, version)).toBe(expected);
  });
});

describe("copyText", () => {
  it("copie en contexte sécurisé", async () => {
    const writeText = vi.fn(async () => {});
    await expect(copyText("liste", { isSecureContext: true, clipboard: { writeText } })).resolves.toBe("copied");
    expect(writeText).toHaveBeenCalledWith("liste");
  });

  it("se replie hors contexte sécurisé, sans toucher au presse-papiers", async () => {
    const writeText = vi.fn(async () => {});
    await expect(copyText("liste", { isSecureContext: false, clipboard: { writeText } })).resolves.toBe("fallback");
    expect(writeText).not.toHaveBeenCalled();
  });

  it("se replie sans presse-papiers ou sur refus", async () => {
    await expect(copyText("liste", { isSecureContext: true, clipboard: null })).resolves.toBe("fallback");
    const refused = vi.fn(async () => {
      throw new DOMException("refusé", "NotAllowedError");
    });
    await expect(copyText("liste", { isSecureContext: true, clipboard: { writeText: refused } })).resolves.toBe(
      "fallback",
    );
  });
});
