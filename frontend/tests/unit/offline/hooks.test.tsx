import { act, render, screen, waitFor } from "@testing-library/react";
import { StrictMode, useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
  useConnectivity,
  useRejectedOperations,
  useSyncStatus,
} from "../../../src/offline/react/hooks";
import { useLocalDeck, useLocalDecks, useLocalStock } from "../../../src/offline/vtes/hooks";
import { VtesOfflineProvider } from "../../../src/offline/vtes/VtesOfflineProvider";
import { createVtesOffline, type VtesOfflineRuntime } from "../../../src/offline/vtes/runtime";
import { createFakeServer } from "./fakeServer";
import { freshDbName, manualTimers } from "./helpers";

const runtimes: VtesOfflineRuntime[] = [];
afterEach(async () => {
  for (const runtime of runtimes.splice(0)) {
    runtime.stop();
    await runtime.engine.whenIdle();
    runtime.dispose();
  }
});

function makeRuntime(online: boolean) {
  const server = createFakeServer();
  const state = { online };
  const runtime = createVtesOffline({
    client: server.client,
    dbName: freshDbName("hooks"),
    autoRefresh: false,
    engine: { isOnline: () => state.online, lockName: null, timers: manualTimers().timers },
  });
  runtimes.push(runtime);
  return { server, runtime, state };
}

function Probe() {
  const status = useSyncStatus();
  const online = useConnectivity();
  const stock = useLocalStock();
  const decks = useLocalDecks();
  const rejected = useRejectedOperations();
  return (
    <div>
      <p data-testid="status">
        {status.pending} en attente / {status.rejected} refusées / {online ? "en ligne" : "hors ligne"}
      </p>
      <p data-testid="stock">{stock === undefined ? "…" : stock.map((s) => `${s.cardId}x${s.quantityOwned}`).join(",")}</p>
      <p data-testid="decks">{decks === undefined ? "…" : decks.map((d) => d.name).join(",")}</p>
      <p data-testid="rejected">{rejected === undefined ? "…" : rejected.map((r) => r.rejection?.code).join(",")}</p>
    </div>
  );
}

describe("hooks de la couche offline", () => {
  it("exposent la file, la connectivité et les lectures locales, hors ligne", async () => {
    const { runtime } = makeRuntime(false);
    render(
      <StrictMode>
        <VtesOfflineProvider runtime={runtime}>
          <Probe />
        </VtesOfflineProvider>
      </StrictMode>,
    );

    await waitFor(() => expect(screen.getByTestId("stock")).toHaveTextContent(""));
    expect(screen.getByTestId("status")).toHaveTextContent("0 en attente / 0 refusées / hors ligne");

    await act(async () => {
      await runtime.actions.saveStock({ cardId: 1, languageCode: "EN", quantityOwned: 2 });
      await runtime.actions.createDeck({ name: "Malkavien" });
    });

    await waitFor(() => expect(screen.getByTestId("stock")).toHaveTextContent("1x2"));
    await waitFor(() => expect(screen.getByTestId("decks")).toHaveTextContent("Malkavien"));
    await waitFor(() =>
      expect(screen.getByTestId("status")).toHaveTextContent("2 en attente / 0 refusées / hors ligne"),
    );
  });

  it("suivent le retour du réseau, le rejeu et les refus", async () => {
    const { runtime, state } = makeRuntime(false);
    render(
      <VtesOfflineProvider runtime={runtime}>
        <Probe />
      </VtesOfflineProvider>,
    );
    await act(async () => {
      await runtime.actions.saveStock({ cardId: 1, languageCode: "EN", quantityOwned: 1 });
      // Sans le stock voulu, ce deck_card sera refusé par le serveur factice.
      const { key } = await runtime.actions.createDeck({ name: "Gangrel" });
      await runtime.actions.saveDeckCard(key, { cardId: 2, languageCode: "EN", quantity: 3 });
    });
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("3 en attente"));

    await act(async () => {
      state.online = true;
      window.dispatchEvent(new Event("online"));
    });

    await waitFor(() =>
      expect(screen.getByTestId("status")).toHaveTextContent("0 en attente / 1 refusées / en ligne"),
    );
    await waitFor(() => expect(screen.getByTestId("rejected")).toHaveTextContent("conflict"));
  });

  it("le provider démarre et arrête le moteur (déclencheurs branchés seulement pendant le montage)", async () => {
    const { runtime, server, state } = makeRuntime(true);
    const view = render(
      <VtesOfflineProvider runtime={runtime}>
        <Probe />
      </VtesOfflineProvider>,
    );
    await act(async () => {
      await runtime.actions.saveStock({ cardId: 1, languageCode: "EN", quantityOwned: 1 });
    });
    await waitFor(() => expect(server.state.stock.size).toBe(1)); // rejeu automatique à la saisie
    await runtime.engine.whenIdle();

    view.unmount();
    state.online = true;
    await runtime.actions.saveStock({ cardId: 2, languageCode: "EN", quantityOwned: 1 });
    await runtime.engine.whenIdle();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(server.state.stock.size).toBe(1); // moteur arrêté : pas de rejeu automatique
  });
});

describe("useLocalDeck", () => {
  function DeckProbe({ initialKey }: { initialKey: string }) {
    const [key, setKey] = useState(initialKey);
    const deck = useLocalDeck(key as `ref:${string}`);
    const label = deck === undefined ? "chargement" : deck === null ? "introuvable" : deck.name;
    return (
      <div>
        <p data-testid="deck">{label}</p>
        <button type="button" onClick={() => setKey("ref:autre")}>
          changer
        </button>
      </div>
    );
  }

  it("distingue « pas encore lu » (undefined), « introuvable » (null) et le deck", async () => {
    const { runtime } = makeRuntime(false);
    const { key } = await runtime.actions.createDeck({ name: "Toréador" });
    const view = render(
      <VtesOfflineProvider runtime={runtime}>
        <DeckProbe initialKey={key} />
      </VtesOfflineProvider>,
    );
    // Premier rendu : la lecture n'a pas abouti.
    expect(screen.getByTestId("deck")).toHaveTextContent("chargement");
    await waitFor(() => expect(screen.getByTestId("deck")).toHaveTextContent("Toréador"));

    // Clé qui change : jamais le deck de la clé précédente, puis « introuvable ».
    await act(async () => {
      screen.getByRole("button", { name: "changer" }).click();
    });
    await waitFor(() => expect(screen.getByTestId("deck")).toHaveTextContent("introuvable"));
    view.unmount();
  });
});
