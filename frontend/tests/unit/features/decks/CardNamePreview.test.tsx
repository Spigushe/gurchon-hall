import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CardNamePreview, PREVIEW_HOVER_DELAY_MS } from "../../../../src/features/decks/CardNamePreview";

const IMAGE = "https://static.krcg.org/card/anson.jpg";

function renderName(imageUrl: string | null = IMAGE) {
  render(
    <div>
      <CardNamePreview name="Anson" imageUrl={imageUrl} />
      <button type="button">Ailleurs</button>
    </div>,
  );
  return screen.getByTestId("deck-card-name");
}

const preview = () => screen.queryByTestId("deck-card-preview");

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("nom d'une carte qui montre son image (issue #71)", () => {
  it("ouvre l'aperçu après 300ms de survol et le referme quand la souris part", () => {
    const name = renderName();
    fireEvent.mouseEnter(name.parentElement!);
    act(() => vi.advanceTimersByTime(PREVIEW_HOVER_DELAY_MS - 1));
    expect(preview()).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(preview()).toBeTruthy();
    expect(screen.getByAltText("Anson").getAttribute("src")).toBe(IMAGE);
    expect(name.getAttribute("aria-expanded")).toBe("true");
    expect(name.getAttribute("aria-controls")).toBe(preview()!.id);
    fireEvent.mouseLeave(name.parentElement!);
    expect(preview()).toBeNull();
  });

  it("n'ouvre rien si la souris part avant l'échéance", () => {
    const name = renderName();
    fireEvent.mouseEnter(name.parentElement!);
    act(() => vi.advanceTimersByTime(100));
    fireEvent.mouseLeave(name.parentElement!);
    act(() => vi.advanceTimersByTime(PREVIEW_HOVER_DELAY_MS));
    expect(preview()).toBeNull();
  });

  it("s'ouvre au focus clavier, sans délai, et se ferme au départ du focus", () => {
    const name = renderName();
    fireEvent.focus(name);
    expect(preview()).toBeTruthy();
    fireEvent.blur(name);
    expect(preview()).toBeNull();
  });

  it("au toucher : un premier toucher ouvre, un second referme", () => {
    const name = renderName();
    fireEvent.pointerDown(name);
    fireEvent.focus(name);
    expect(preview()).toBeNull();
    fireEvent.click(name);
    expect(preview()).toBeTruthy();
    fireEvent.pointerDown(name);
    fireEvent.click(name);
    expect(preview()).toBeNull();
  });

  it("un toucher ailleurs referme l'aperçu épinglé", () => {
    const name = renderName();
    fireEvent.pointerDown(name);
    fireEvent.click(name);
    expect(preview()).toBeTruthy();
    fireEvent.pointerDown(screen.getByText("Ailleurs"));
    expect(preview()).toBeNull();
  });

  it("Échap referme l'aperçu", () => {
    const name = renderName();
    fireEvent.click(name);
    expect(preview()).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(preview()).toBeNull();
  });

  it("dit que l'image est indisponible hors ligne", () => {
    vi.stubGlobal("navigator", { ...navigator, onLine: false });
    const name = renderName();
    fireEvent.click(name);
    expect(screen.queryByAltText("Anson")).toBeNull();
    expect(screen.getByRole("img", { name: "Anson : Image indisponible hors ligne" })).toBeTruthy();
  });

  it("montre le pictogramme quand la carte n'a pas d'image", () => {
    const name = renderName(null);
    fireEvent.click(name);
    expect(screen.getByRole("img", { name: "Anson : Pas d'image pour cette impression" })).toBeTruthy();
  });
});
