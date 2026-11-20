import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClientContext } from "../../../../src/app/apiClientContext";
import { PublicDecklistPage } from "../../../../src/features/share/PublicDecklistPage";
import type { ApiClient } from "../../../../src/offline/vtes";
import { crypt, library } from "../../offline/fixtures/syntheticCatalog";

const LIVE = {
  name: "Banu Princes",
  archetype: "bleed",
  kind: "live",
  frozen_at: null,
  author: "alice",
  notes: null,
  cards: [
    { card: crypt({ id: 1, name: "Anson", capacity: 9, group: "G6", disciplines: ["DOM"] }), quantity: 3 },
    { card: library({ id: 2, name: "Vessel", types: ["Master"] }), quantity: 4 },
    { card: library({ id: 3, name: "Deflection", types: ["Reaction"] }), quantity: 2 },
  ],
  reprinted_card_ids: [1],
};

const FROZEN = {
  ...LIVE,
  kind: "frozen",
  frozen_at: "2026-11-20T10:00:00Z",
  notes: "Première ligne.\nSeconde ligne.",
};

function client(data: unknown, status: number, headers: Record<string, string>) {
  const response = { status, headers: new Headers(headers) };
  const GET = vi.fn(() => Promise.resolve(data !== undefined ? { data, response } : { error: {}, response }));
  return { GET, api: { GET } as unknown as ApiClient };
}

function renderPage(data: unknown, status = 200, headers: Record<string, string> = {}) {
  const { GET, api } = client(data, status, headers);
  const view = render(
    <ApiClientContext.Provider value={api}>
      <PublicDecklistPage hash="#/liste/aB3x_9pQ" />
    </ApiClientContext.Provider>,
  );
  return { GET, view };
}

beforeEach(() => {
  document.title = "avant";
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("page publique : liste", () => {
  it("montre le nom, l'archétype, l'auteur et le nombre de cartes", async () => {
    renderPage(LIVE);
    expect((await screen.findByTestId("public-list-name")).textContent).toBe("Banu Princes");
    expect(screen.getByTestId("public-list-meta").textContent).toBe("par @alice · Bleed · 9 cartes");
    expect(screen.queryByTestId("public-list-frozen")).toBeNull();
    expect(screen.queryByTestId("public-list-notes")).toBeNull();
  });

  it("rend les tableaux en lecture seule, sans proxy", async () => {
    renderPage(LIVE);
    const tables = await screen.findByTestId("deck-tables");
    expect(tables.getAttribute("data-editable")).toBe("false");
    expect(screen.getByTestId("deck-tables-crypt-total").textContent).toBe("3");
    expect(screen.getByTestId("deck-tables-library-total").textContent).toBe("6");
    const rows = screen.getAllByTestId("deck-card");
    expect(rows).toHaveLength(3);
    expect(within(tables).queryByRole("button")).toBeNull();
    expect(rows.every((row) => row.getAttribute("data-proxy-quantity") === "0")).toBe(true);
    expect(tables.textContent).not.toContain("Proxies");
  });

  it("signale par « … » les disciplines d'un vampire au-delà de sa sixième", async () => {
    renderPage({
      ...LIVE,
      cards: [
        {
          card: crypt({
            id: 1,
            name: "Anson",
            capacity: 9,
            group: "G6",
            disciplines: ["DOM", "AUS", "FOR", "PRE", "CEL", "OBT", "POT"],
          }),
          quantity: 2,
        },
        { card: crypt({ id: 4, name: "Lucita", capacity: 8, group: "G5", disciplines: ["THA", "VIC"] }), quantity: 1 },
      ],
    });
    const tables = await screen.findByTestId("deck-tables");
    // Neuf colonnes alignées par vampire ; en section étroite, les cases vides
    // et la septième discipline d'Anson se cachent.
    expect(tables.querySelectorAll(".deck-table__disc-slot")).toHaveLength(18);
    expect(tables.querySelectorAll(".deck-table__disc-slot--empty")).toHaveLength(9);
    expect(tables.querySelectorAll(".deck-table__disc-slot--overflow")).toHaveLength(1);
    const more = within(tables).getAllByTestId("deck-table-disc-more");
    expect(more).toHaveLength(1);
    expect(more[0].getAttribute("aria-label")).toMatch(/^Autres disciplines : \S/);
    expect(more[0].closest("[data-testid='deck-card']")?.getAttribute("data-card-id")).toBe("1");
  });

  it("date une liste figée et garde les sauts de ligne des notes", async () => {
    renderPage(FROZEN);
    expect((await screen.findByTestId("public-list-frozen")).textContent).toBe("Liste du 20 novembre 2026");
    const notes = screen.getByTestId("public-list-notes");
    expect(notes.textContent).toBe("Première ligne.\nSeconde ligne.");
    expect(notes.className).toContain("deck-notes");
  });

  it("pose le titre du document et noindex, puis les retire", async () => {
    const { view } = renderPage(LIVE);
    await screen.findByTestId("public-list-name");
    expect(document.title).toBe("Banu Princes");
    expect(document.querySelector('meta[name="robots"]')?.getAttribute("content")).toBe("noindex");
    view.unmount();
    expect(document.title).toBe("avant");
    expect(document.querySelector('meta[name="robots"]')).toBeNull();
  });

  it("ne lit aucune base et envoie la requête sans cookie", async () => {
    const open = vi.fn(() => {
      throw new Error("indexedDB.open ne doit pas être appelé");
    });
    vi.stubGlobal("indexedDB", { open, databases: open, deleteDatabase: open });
    const { GET } = renderPage(FROZEN);
    await screen.findByTestId("deck-tables");
    expect(open).not.toHaveBeenCalled();
    expect(GET).toHaveBeenCalledWith("/listes/{token}", {
      params: { path: { token: "aB3x_9pQ" } },
      credentials: "omit",
    });
  });
});

describe("page publique : export", () => {
  it("copie le TEXT avec la marque de groupe d'un vampire réimprimé", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal("isSecureContext", true);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderPage(LIVE);
    fireEvent.click(await screen.findByTestId("public-list-export"));
    const text = (await screen.findByTestId("deck-export-text")) as HTMLTextAreaElement;
    expect(text.value).toContain("Anson (G6)");
    expect(text.value).toContain("Vessel");
    expect(screen.getByTestId("deck-export-filename").textContent).toBe("Banu Princes.txt");
    fireEvent.click(screen.getByTestId("deck-export-copy"));
    await screen.findByText("Liste copiée dans le presse-papiers.");
    expect(writeText).toHaveBeenCalledWith(text.value);
  });

  it("change de format : JOL, TWD et LACKEY, avec le suffixe du fichier", async () => {
    renderPage(LIVE);
    fireEvent.click(await screen.findByTestId("public-list-export"));
    fireEvent.click(screen.getByTestId("deck-export-format-jol"));
    expect((screen.getByTestId("deck-export-text") as HTMLTextAreaElement).value).toContain("3xAnson");
    expect(screen.getByTestId("deck-export-filename").textContent).toBe("Banu Princes (JOL).txt");
    fireEvent.click(screen.getByTestId("deck-export-format-twd"));
    expect((screen.getByTestId("deck-export-text") as HTMLTextAreaElement).value).toMatch(/^\[Event Name\]/);
    fireEvent.click(screen.getByTestId("deck-export-format-lackey"));
    expect(screen.getByTestId("deck-export-filename").textContent).toBe("Banu Princes (LACKEY).txt");
  });

  it("télécharge le fichier sous son nom", async () => {
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:x"), revokeObjectURL: vi.fn() }));
    const names: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      names.push(this.download);
    });
    renderPage(LIVE);
    fireEvent.click(await screen.findByTestId("public-list-export"));
    fireEvent.click(screen.getByTestId("deck-export-download"));
    expect(names).toEqual(["Banu Princes.txt"]);
  });
});

describe("page publique : états d'erreur", () => {
  it("annonce l'attente d'un 429 avec Retry-After", async () => {
    renderPage(undefined, 429, { "Retry-After": "42" });
    const title = await screen.findByTestId("public-list-error");
    expect(title.textContent).toBe("Trop de demandes, réessayez dans 42 s");
    expect(title.closest("[data-reason]")?.getAttribute("data-reason")).toBe("rate-limited");
  });

  it("dit « dans un moment » sans Retry-After lisible", async () => {
    renderPage(undefined, 429, { "Retry-After": "Wed, 21 Oct 2026 07:28:00 GMT" });
    expect((await screen.findByTestId("public-list-error")).textContent).toBe(
      "Trop de demandes, réessayez dans un moment.",
    );
  });

  it("garde le pied de page et le lien vers l'application sur un 404", async () => {
    renderPage(undefined, 404);
    await screen.findByTestId("public-list-not-found");
    expect(screen.getByTestId("public-list-app-link").getAttribute("href")).toBe("/");
    expect(document.title).toBe("Liste introuvable.");
  });
});
