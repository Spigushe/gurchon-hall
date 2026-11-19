import { describe, expect, it, vi } from "vitest";
import {
  buildLegend,
  displayKeys,
  displayToken,
  screenTitleOf,
  shortcutLegendRegistry,
} from "../../../src/components/shortcutLegend";

// Lot 12, P8 et D2 : la légende `?` se lit dans un registre que tiennent les
// appels de `useKeyboardShortcuts`.

describe("displayToken / displayKeys", () => {
  it.each([
    ["g", "G"],
    ["n", "N"],
    ["/", "/"],
    ["?", "?"],
    ["+", "+"],
    ["-", "−"],
    ["enter", "↵"],
    ["escape", "Échap"],
    ["arrowup", "↑"],
    ["arrowdown", "↓"],
    ["mod+enter", "⌘↵"],
    ["mod+k", "⌘K"],
  ])("%s s'écrit %s", (token, text) => {
    expect(displayToken(token)).toBe(text);
  });

  it("écrit une séquence touche par touche, séparée d'une espace", () => {
    expect(displayKeys(["g", "a"])).toBe("G A");
  });
});

describe("buildLegend", () => {
  it("range les raccourcis par portée, dans l'ordre des inscriptions", () => {
    const legend = buildLegend([
      { scope: "global", entries: [{ label: "Atelier", keys: ["g", "a"] }] },
      { scope: "screen", entries: [{ label: "Nouveau deck", keys: ["n"] }] },
      { scope: "screen", entries: [{ label: "Ouvrir le deck sélectionné", keys: ["enter"] }] },
    ]);
    expect(legend.screen.map((line) => line.label)).toEqual(["Nouveau deck", "Ouvrir le deck sélectionné"]);
    expect(legend.global).toEqual([{ label: "Atelier", keys: [["g", "a"]] }]);
  });

  it("fusionne deux raccourcis de même libellé en une ligne à deux touches, sans doublon", () => {
    const legend = buildLegend([
      {
        scope: "screen",
        entries: [
          { label: "Parcourir les résultats", keys: ["arrowup"] },
          { label: "Parcourir les résultats", keys: ["arrowdown"] },
        ],
      },
      { scope: "screen", entries: [{ label: "Parcourir les résultats", keys: ["arrowup"] }] },
    ]);
    expect(legend.screen).toEqual([{ label: "Parcourir les résultats", keys: [["arrowup"], ["arrowdown"]] }]);
  });

  it("ne mélange pas un libellé de l'écran et le même libellé global", () => {
    const legend = buildLegend([
      { scope: "screen", entries: [{ label: "Filtres", keys: ["f"] }] },
      { scope: "global", entries: [{ label: "Filtres", keys: ["g", "f"] }] },
    ]);
    expect(legend.screen).toEqual([{ label: "Filtres", keys: [["f"]] }]);
    expect(legend.global).toEqual([{ label: "Filtres", keys: [["g", "f"]] }]);
  });
});

describe("shortcutLegendRegistry", () => {
  it("publie, garde l'ordre de première inscription, ignore une publication identique et retire", () => {
    const listener = vi.fn();
    const unsubscribe = shortcutLegendRegistry.subscribe(listener);
    const first = {};
    const second = {};

    shortcutLegendRegistry.publish(first, { scope: "screen", entries: [{ label: "A", keys: ["a"] }] });
    shortcutLegendRegistry.publish(second, { scope: "screen", entries: [{ label: "B", keys: ["b"] }] });
    expect(shortcutLegendRegistry.getSnapshot().screen.map((line) => line.label)).toEqual(["A", "B"]);
    expect(listener).toHaveBeenCalledTimes(2);

    // Même contenu : aucun avis aux abonnés.
    shortcutLegendRegistry.publish(first, { scope: "screen", entries: [{ label: "A", keys: ["a"] }] });
    expect(listener).toHaveBeenCalledTimes(2);

    // Le premier change de contenu : il garde sa place.
    shortcutLegendRegistry.publish(first, { scope: "screen", entries: [{ label: "A2", keys: ["a"] }] });
    expect(shortcutLegendRegistry.getSnapshot().screen.map((line) => line.label)).toEqual(["A2", "B"]);

    // Une liste vide vaut un retrait ; puis le retrait explicite.
    shortcutLegendRegistry.publish(first, { scope: "screen", entries: [] });
    expect(shortcutLegendRegistry.getSnapshot().screen.map((line) => line.label)).toEqual(["B"]);
    shortcutLegendRegistry.publish(second, null);
    expect(shortcutLegendRegistry.getSnapshot().screen).toEqual([]);

    unsubscribe();
  });
});

describe("screenTitleOf", () => {
  it("nomme l'écran courant", () => {
    expect(screenTitleOf({ name: "decks" })).toBe("Decks");
    expect(screenTitleOf({ name: "account" })).toBe("Compte");
    expect(screenTitleOf({ name: "search" })).toBe("Chercher");
  });
});
