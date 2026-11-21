import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClientContext } from "../../../../src/app/apiClientContext";
import { PublicDecklistPage } from "../../../../src/features/share/PublicDecklistPage";
import type { ApiClient } from "../../../../src/offline/vtes";
import { crypt, library } from "../../offline/fixtures/syntheticCatalog";

const VESSEL = library({ id: 2, name: "Vessel", types: ["Master"] });
const DEFLECTION = library({ id: 3, name: "Deflection", types: ["Reaction"] });
const LIVE = {
  name: "Banu Princes",
  archetype: "bleed",
  kind: "live",
  frozen_at: null,
  author: "alice",
  notes: null,
  cards: [
    { card: crypt({ id: 1, name: "Anson", capacity: 9, group: "G6", disciplines: ["DOM"] }), quantity: 3 },
    { card: VESSEL, quantity: 4 },
    { card: DEFLECTION, quantity: 2 },
  ],
  reprinted_card_ids: [],
};
const BLOOD_DOLL = library({ id: 40, name: "Blood Doll", types: ["Master"] });
const CATALOG = [BLOOD_DOLL, library({ id: 41, name: "Blood Bond", types: ["Master"] })];

type Query = { ids?: number[]; q?: string };

function fakeClient(options: { cardsFail?: boolean } = {}) {
  const GET = vi.fn((path: string, init?: { params?: { query?: Query } }) => {
    const response = { status: 200, headers: new Headers() };
    if (path === "/listes/{token}") return Promise.resolve({ data: LIVE, response });
    if (options.cardsFail) return Promise.reject(new Error("réseau"));
    const query = init?.params?.query ?? {};
    const ids = query.ids;
    const data = ids
      ? CATALOG.filter((card) => ids.includes(card.id))
      : CATALOG.filter((card) => card.name.toLowerCase().includes((query.q ?? "").toLowerCase()));
    return Promise.resolve({ data, response });
  });
  return { GET, api: { GET } as unknown as ApiClient };
}

const TOKEN = "aB3x_9pQ";
const addressRevision = () => new URLSearchParams(window.location.hash.split("?")[1] ?? "").get("revision");

function renderPage(hash = `#/liste/${TOKEN}`, options: { cardsFail?: boolean } = {}) {
  window.location.hash = hash;
  const { GET, api } = fakeClient(options);
  render(
    <ApiClientContext.Provider value={api}>
      <PublicDecklistPage hash={hash} />
    </ApiClientContext.Provider>,
  );
  return { GET };
}

const rowOf = (name: string) => screen.getAllByTestId("deck-card").find((row) => row.textContent?.includes(name))!;

beforeEach(() => {
  window.location.hash = "";
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("réviser une liste partagée", () => {
  it("ne montre ni bandeau ni lien de révision tant que rien n'a changé", async () => {
    renderPage();
    await screen.findByTestId("public-list-name");
    expect(screen.queryByTestId("revision-banner")).toBeNull();
    expect(screen.queryByTestId("revision-copy-link")).toBeNull();
    expect(screen.getByTestId("public-list-revise").textContent).toBe("Réviser");
  });

  it("passe en édition, réécrit l'adresse à chaque modification et marque les écarts", async () => {
    renderPage();
    await screen.findByTestId("public-list-name");
    fireEvent.click(screen.getByTestId("public-list-revise"));
    expect(screen.getByTestId("deck-tables").getAttribute("data-editable")).toBe("true");

    fireEvent.click(within(rowOf("Vessel")).getByTestId("revision-plus"));
    expect(addressRevision()).toBe("2=1");
    fireEvent.click(within(rowOf("Deflection")).getByTestId("revision-minus"));
    expect(addressRevision()).toBe("2=1;3=-1");
    expect(screen.getByTestId("revision-banner").textContent).toBe("Révision de la liste de @alice");
    expect(within(rowOf("Vessel")).getByTestId("revision-delta").textContent).toBe("+1");
    expect(screen.getByTestId("public-list-meta").textContent).toContain("3 crypte · 6 bibliothèque");
    // Revenir à la quantité d'origine efface l'écart.
    fireEvent.click(within(rowOf("Vessel")).getByTestId("revision-minus"));
    expect(addressRevision()).toBe("3=-1");
  });

  it("retire une carte à zéro, la range parmi les retraits et la rétablit", async () => {
    renderPage();
    await screen.findByTestId("public-list-name");
    fireEvent.click(screen.getByTestId("public-list-revise"));
    const minus = () => fireEvent.click(within(rowOf("Deflection")).getByTestId("revision-minus"));
    minus();
    minus();
    expect(addressRevision()).toBe("3=-2");
    expect(screen.getAllByTestId("deck-card")).toHaveLength(2);
    expect(screen.getByTestId("revision-removed-row").textContent).toContain("Deflection");
    fireEvent.click(screen.getByTestId("revision-restore"));
    expect(addressRevision()).toBeNull();
    expect(screen.queryByTestId("revision-removed")).toBeNull();
  });

  it("ajoute une carte du catalogue en ligne", async () => {
    const { GET } = renderPage();
    await screen.findByTestId("public-list-name");
    fireEvent.click(screen.getByTestId("public-list-revise"));
    fireEvent.change(screen.getByTestId("revision-search"), { target: { value: "blood d" } });
    const result = await screen.findByTestId("revision-search-result");
    expect(GET).toHaveBeenCalledWith("/cartes", { params: { query: { q: "blood d", limit: 8 } }, credentials: "omit" });
    fireEvent.click(within(result).getByTestId("revision-add"));
    expect(addressRevision()).toBe("40=1");
    expect(within(rowOf("Blood Doll")).getByTestId("revision-delta").textContent).toBe("nouvelle");
  });

  it("rouvre une adresse de révision : écarts appliqués, cartes ajoutées lues par identifiant", async () => {
    const { GET } = renderPage(`#/liste/${TOKEN}?revision=2=-1;3=1;40=2`);
    expect(await screen.findByTestId("revision-banner")).toBeTruthy();
    expect(GET).toHaveBeenCalledWith("/cartes", { params: { query: { ids: [40], limit: 1 } }, credentials: "omit" });
    expect(within(rowOf("Vessel")).getByTestId("revision-quantity").textContent).toContain("3");
    expect(within(rowOf("Blood Doll")).getByTestId("revision-delta").textContent).toBe("nouvelle");
    expect(screen.queryByTestId("revision-notices")).toBeNull();
    expect(screen.getByTestId("deck-tables").getAttribute("data-editable")).toBe("false");
    expect(screen.getByTestId("revision-copy-link")).toBeTruthy();
  });

  it("signale sans deviner : écart illisible, carte inconnue, retrait trop grand", async () => {
    renderPage(`#/liste/${TOKEN}?revision=2=-9;999=1;3=;abc=1`);
    const notices = await screen.findByTestId("revision-notices");
    const texts = within(notices)
      .getAllByTestId("revision-notice")
      .map((item) => item.textContent);
    expect(texts).toEqual([
      "2 modifications illisibles ignorées",
      "1 carte inconnue ignorée",
      "1 retrait supérieur à la quantité ramené à zéro",
    ]);
    expect(screen.getByTestId("revision-removed-row").textContent).toContain("Vessel");
  });

  it("dit que les cartes ajoutées n'ont pas pu être lues quand le réseau manque", async () => {
    renderPage(`#/liste/${TOKEN}?revision=40=1`, { cardsFail: true });
    const notice = await screen.findByTestId("revision-notice");
    expect(notice.textContent).toMatch(/pas pu être lue/);
  });

  it("relit une adresse changée à la main, y compris le retour à l'adresse d'origine", async () => {
    renderPage();
    await screen.findByTestId("public-list-name");
    fireEvent.click(screen.getByTestId("public-list-revise"));
    fireEvent.click(within(rowOf("Vessel")).getByTestId("revision-plus"));
    expect(screen.getByTestId("revision-banner")).toBeTruthy();

    act(() => {
      window.history.replaceState(null, "", `#/liste/${TOKEN}?revision=3=-1`);
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    await waitFor(() => expect(within(rowOf("Deflection")).getByTestId("revision-quantity").textContent).toContain("1"));
    expect(within(rowOf("Vessel")).getByTestId("revision-quantity").textContent).toContain("4");

    act(() => {
      window.history.replaceState(null, "", `#/liste/${TOKEN}`);
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    await waitFor(() => expect(screen.queryByTestId("revision-banner")).toBeNull());
  });

  it("copie le lien de la révision et l'exporte avec la liste retouchée", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal("isSecureContext", true);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderPage(`#/liste/${TOKEN}?revision=2=-1`);
    await screen.findByTestId("revision-banner");
    fireEvent.click(screen.getByTestId("revision-copy-link"));
    await screen.findByTestId("revision-copied");
    expect(writeText).toHaveBeenCalledWith(expect.stringMatching(/#\/liste\/aB3x_9pQ\?revision=2=-1$/));

    fireEvent.click(screen.getByTestId("public-list-export"));
    expect((screen.getByTestId("deck-export-text") as HTMLTextAreaElement).value).toMatch(/3 Vessel|3x Vessel/);
  });
});
