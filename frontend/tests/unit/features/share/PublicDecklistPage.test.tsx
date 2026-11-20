import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClientContext } from "../../../../src/app/apiClientContext";
import { PublicDecklistPage } from "../../../../src/features/share/PublicDecklistPage";
import type { ApiClient } from "../../../../src/offline/vtes";

const LIST = {
  name: "Banu Princes",
  archetype: null,
  kind: "live",
  frozen_at: null,
  author: "alice",
  notes: null,
  cards: [
    { card: { id: 1 }, quantity: 12 },
    { card: { id: 2 }, quantity: 1 },
  ],
  reprinted_card_ids: [],
};

function fakeClient(answer: () => Promise<unknown>) {
  const GET = vi.fn<(path: string, init: unknown) => Promise<unknown>>(() => answer());
  return { client: { GET } as unknown as ApiClient, GET };
}

const answerOf = (data: unknown, status: number) => () =>
  Promise.resolve(data !== undefined ? { data, response: { status } } : { error: {}, response: { status } });

function renderPage(hash: string, client: ApiClient) {
  return render(
    <ApiClientContext.Provider value={client}>
      <PublicDecklistPage hash={hash} />
    </ApiClientContext.Provider>,
  );
}

afterEach(() => vi.restoreAllMocks());

describe("page publique d'une liste partagée", () => {
  it("lit la liste sans cookie et montre le nom, l'auteur et le nombre de cartes", async () => {
    const { client, GET } = fakeClient(answerOf(LIST, 200));
    renderPage("#/liste/aB3x_9pQ", client);
    expect(screen.getByLabelText("Chargement en cours")).toBeTruthy();
    expect((await screen.findByTestId("public-list-name")).textContent).toBe("Banu Princes");
    expect(screen.getByTestId("public-list-meta").textContent).toContain("alice");
    expect(screen.getByTestId("public-list-meta").textContent).toContain("13 cartes");
    expect(GET).toHaveBeenCalledTimes(1);
    expect(GET).toHaveBeenCalledWith("/listes/{token}", {
      params: { path: { token: "aB3x_9pQ" } },
      credentials: "omit",
    });
    expect(screen.getByTestId("public-list-footer")).toBeTruthy();
  });

  it("dit « Liste introuvable. » sur un 404", async () => {
    renderPage("#/liste/aB3x_9pQ", fakeClient(answerOf(undefined, 404)).client);
    expect((await screen.findByTestId("public-list-not-found")).textContent).toBe("Liste introuvable.");
  });

  it("dit qu'elle demande le réseau quand la requête échoue", async () => {
    renderPage("#/liste/aB3x_9pQ", fakeClient(() => Promise.reject(new TypeError("Failed to fetch"))).client);
    expect((await screen.findByTestId("public-list-offline")).textContent).toBe(
      "Cette liste demande une connexion au réseau.",
    );
  });

  it.each([501, 500, 503, 429])("traite un %i comme une erreur générique", async (status) => {
    renderPage("#/liste/aB3x_9pQ", fakeClient(answerOf(undefined, status)).client);
    expect(await screen.findByTestId("public-list-error")).toBeTruthy();
  });

  it("refuse un jeton mal formé sans appel réseau", () => {
    const { client, GET } = fakeClient(answerOf(LIST, 200));
    renderPage("#/liste/trop-court", client);
    expect(screen.getByTestId("public-list-invalid")).toBeTruthy();
    expect(GET).not.toHaveBeenCalled();
  });

  it("n'ouvre aucune base IndexedDB", async () => {
    const open = vi.fn(() => {
      throw new Error("indexedDB.open ne doit pas être appelé");
    });
    vi.stubGlobal("indexedDB", { open, databases: open, deleteDatabase: open });
    try {
      const { client } = fakeClient(answerOf(LIST, 200));
      renderPage("#/liste/aB3x_9pQ", client);
      await screen.findByTestId("public-list-name");
      expect(open).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("relit la liste d'un autre jeton quand le hash change", async () => {
    const { client, GET } = fakeClient(answerOf(LIST, 200));
    const view = renderPage("#/liste/aB3x_9pQ", client);
    await screen.findByTestId("public-list-name");
    view.rerender(
      <ApiClientContext.Provider value={client}>
        <PublicDecklistPage hash="#/liste/Zz9_aaaa" />
      </ApiClientContext.Provider>,
    );
    await waitFor(() => expect(GET).toHaveBeenCalledTimes(2));
    expect(GET.mock.calls[1]?.[1]).toMatchObject({ params: { path: { token: "Zz9_aaaa" } } });
  });
});
