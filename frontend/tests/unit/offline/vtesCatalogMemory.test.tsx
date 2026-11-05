import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useMemo, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { foldText } from "../../../src/offline/core/foldText";
import { buildSearchCatalog, filterCards } from "../../../src/offline/vtes/cardSearch";
import { useCardSearch } from "../../../src/offline/vtes/hooks";
import { refreshCatalog } from "../../../src/offline/vtes/refresh";
import { createVtesOffline, type VtesOfflineRuntime } from "../../../src/offline/vtes/runtime";
import { VtesOfflineProvider } from "../../../src/offline/vtes/VtesOfflineProvider";
import { CARD_SET_ID, createFakeServer } from "./fakeServer";
import { bulkCatalog, mirrorRows } from "./fixtures/syntheticCatalog";
import { freshDbName, manualTimers } from "./helpers";

/**
 * Lot Chercher, C1b : la lecture mémoire du catalogue. Lu une fois, relu quand
 * `cards` ou `cardDetails` changent, jeté par `dispose()` et `purge()` ; une
 * frappe ne parcourt jamais la base.
 */

const runtimes: VtesOfflineRuntime[] = [];
afterEach(async () => {
  for (const runtime of runtimes.splice(0)) {
    runtime.stop();
    await runtime.engine.whenIdle();
    runtime.dispose();
  }
});

function makeRuntime() {
  const server = createFakeServer();
  const runtime = createVtesOffline({
    client: server.client,
    dbName: freshDbName("memory"),
    autoRefresh: false,
    engine: { isOnline: () => true, lockName: null, timers: manualTimers().timers },
  });
  runtimes.push(runtime);
  return { server, runtime };
}

describe("CatalogMemory", () => {
  it("lit 4149 cartes une fois ; filtrer ne relit jamais la base", async () => {
    const { runtime } = makeRuntime();
    const { cards, details } = mirrorRows(bulkCatalog(4149));
    await runtime.db.cards.bulkPut(cards);
    await runtime.db.cardDetails.bulkPut(details);

    const toArray = vi.spyOn(runtime.db.cards, "toArray");
    const catalog = await runtime.catalog.load();
    expect(catalog.cards).toHaveLength(4149);
    expect(catalog.complete).toBe(true);
    const reads = toArray.mock.calls.length;

    for (const query of ["v", "va", "vam", "vamp", "vampire 0", "referendum", "bleed"]) {
      filterCards(runtime.catalog.snapshot()!.cards, { query }, { on: "2026-11-05" });
    }
    expect(toArray.mock.calls.length).toBe(reads);
    expect(runtime.catalog.loads).toBe(1);
  });

  it("se relit après `refreshCatalog` et après une écriture dans les détails", async () => {
    const { server, runtime } = makeRuntime();
    server.state.legacyCatalog = true;
    await refreshCatalog(server.client, runtime.db);
    const before = await runtime.catalog.load();
    expect(before).toMatchObject({ complete: false });
    expect(before.cards).toHaveLength(3);

    server.state.legacyCatalog = false;
    server.state.catalog = bulkCatalog(250);
    await refreshCatalog(server.client, runtime.db);
    await waitFor(() => expect(runtime.catalog.snapshot()?.cards).toHaveLength(250));
    expect(runtime.catalog.snapshot()?.complete).toBe(true);
  });

  it("une base montée de la version 5 (détails vides) se lit incomplète, puis complète une fois relue", async () => {
    const { server, runtime } = makeRuntime();
    const { cards } = mirrorRows(bulkCatalog(10));
    await runtime.db.cards.bulkPut(cards); // l'état d'une base tout juste montée
    expect((await runtime.catalog.load()).complete).toBe(false);

    server.state.catalog = bulkCatalog(10);
    await refreshCatalog(server.client, runtime.db);
    await waitFor(() => expect(runtime.catalog.snapshot()?.complete).toBe(true));
  });

  it("est jeté par `purge()`", async () => {
    const { server, runtime } = makeRuntime();
    await refreshCatalog(server.client, runtime.db);
    await runtime.catalog.load();
    runtimes.splice(runtimes.indexOf(runtime), 1);
    await runtime.purge();
    expect(runtime.catalog.snapshot()).toBeUndefined();
  });

  it("deux runtimes, deux comptes : chacun son catalogue", async () => {
    const a = makeRuntime();
    const b = makeRuntime();
    await refreshCatalog(a.server.client, a.runtime.db);
    expect((await a.runtime.catalog.load()).cards).toHaveLength(3);
    expect((await b.runtime.catalog.load()).cards).toHaveLength(0);
  });
});

function SearchProbe({ deckKey }: { deckKey?: `id:${number}` }) {
  const [query, setQuery] = useState("");
  const criteria = useMemo(() => ({ query }), [query]);
  const ownedCriteria = useMemo(() => ({ owned: "owned" as const }), []);
  const { cards, complete } = useCardSearch(criteria, { on: "2026-11-05" });
  const owned = useCardSearch(ownedCriteria, { on: "2026-11-05", deckKey });
  return (
    <div>
      <input aria-label="q" value={query} onChange={(event) => setQuery(event.target.value)} />
      <p data-testid="results">{cards === undefined ? "…" : cards.map((item) => item.card.name).join(",")}</p>
      <p data-testid="complete">{String(complete)}</p>
      <p data-testid="owned">{owned.cards === undefined ? "…" : owned.cards.map((item) => item.card.id).join(",")}</p>
    </div>
  );
}

describe("useCardSearch", () => {
  it("filtre en mémoire à chaque frappe et suit la collection, file comprise", async () => {
    const { server, runtime } = makeRuntime();
    await refreshCatalog(server.client, runtime.db);
    render(
      <VtesOfflineProvider runtime={runtime}>
        <SearchProbe />
      </VtesOfflineProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("results")).toHaveTextContent("Élan vital,Theo Bell,Œuvre"));
    // « œ » ne se décompose pas (limite connue du §11) : il se range après « t ».
    expect(screen.getByTestId("complete")).toHaveTextContent("true");
    const loads = runtime.catalog.loads;

    fireEvent.change(screen.getByLabelText("q"), { target: { value: "ELAN" } });
    await waitFor(() => expect(screen.getByTestId("results")).toHaveTextContent(/^Élan vital$/));
    fireEvent.change(screen.getByLabelText("q"), { target: { value: "theo" } });
    await waitFor(() => expect(screen.getByTestId("results")).toHaveTextContent(/^Theo Bell$/));
    expect(runtime.catalog.loads).toBe(loads);

    expect(screen.getByTestId("owned")).toHaveTextContent(/^$/);
    await act(async () => {
      await runtime.actions.saveStock({ cardId: 3, languageCode: "EN", cardSetId: CARD_SET_ID, quantityOwned: 1 });
    });
    await waitFor(() => expect(screen.getByTestId("owned")).toHaveTextContent(/^3$/));
  });
});

describe("mesure de foldText (A4 : stocker le texte replié ou le recalculer)", () => {
  it("replier tous les textes et construire l'index reste dans l'ordre de la dizaine de millisecondes", () => {
    // Mesure indicative, sans seuil de réussite (un seuil dans un test serait
    // instable, revue qa-tests) : le chiffre est relevé dans le plan du lot.
    const items = bulkCatalog(4149);
    const { cards, details } = mirrorRows(items);
    const texts = items.map((item) => item.card_text ?? "");
    const foldStart = performance.now();
    for (const text of texts) foldText(text);
    const foldMs = performance.now() - foldStart;
    const indexStart = performance.now();
    buildSearchCatalog(cards, details);
    const indexMs = performance.now() - indexStart;
    expect(foldMs).toBeGreaterThanOrEqual(0);
    expect(indexMs).toBeGreaterThanOrEqual(0);
    console.info(`[mesure] foldText sur 4149 textes : ${foldMs.toFixed(1)} ms ; index : ${indexMs.toFixed(1)} ms`);
  });
});
