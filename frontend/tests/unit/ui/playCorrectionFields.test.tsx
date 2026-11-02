import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { PlayCorrectionFields } from "../../../src/features/sync/PlayCorrectionFields";
import { applyDraft, initialDraft } from "../../../src/features/sync/playCorrection";
import * as ops from "../../../src/offline/vtes/operations";
import { VtesOfflineProvider } from "../../../src/offline/vtes/VtesOfflineProvider";
import { createVtesOffline, type VtesOfflineRuntime } from "../../../src/offline/vtes/runtime";
import type { VtesOperation } from "../../../src/offline/vtes/types";
import { createFakeServer } from "../offline/fakeServer";
import { freshDbName } from "../offline/helpers";

const runtimes: VtesOfflineRuntime[] = [];
afterEach(async () => {
  cleanup();
  for (const runtime of runtimes.splice(0)) {
    runtime.stop();
    await runtime.engine.whenIdle();
    runtime.dispose();
  }
});

const clock: ops.OperationClock = {
  newId: () => "00000000-0000-4000-8000-000000000001",
  now: () => "2026-10-24T20:00:00.000+02:00",
};

let latest: VtesOperation | null = null;

function Form({ operation }: { operation: VtesOperation }) {
  const [draft, setDraft] = useState(() => initialDraft(operation));
  const result = applyDraft(operation, draft);
  latest = "operation" in result ? result.operation : null;
  return <PlayCorrectionFields operation={operation} draft={draft} setDraft={setDraft} rejectionCode="invalid" />;
}

function show(operation: VtesOperation) {
  const runtime = createVtesOffline({
    client: createFakeServer().client,
    dbName: freshDbName("pcf"),
    autoRefresh: false,
  });
  runtimes.push(runtime);
  return render(
    <VtesOfflineProvider runtime={runtime}>
      <Form operation={operation} />
    </VtesOfflineProvider>,
  );
}

describe("correction de la règle de finale seule", () => {
  it("garde le sélecteur visible, sans texte d'effacement, et envoie la règle choisie", () => {
    show(ops.tournamentUpdate(clock, "id:1", { finalDeckRule: "best_performing" }));
    expect(screen.queryByTestId("correction-final-rule-reset")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Deck de la finale"), { target: { value: "free_choice" } });
    expect((latest as unknown as { data: object }).data).toEqual({ final_deck_rule: "free_choice" });
  });

  it("un passage en mono cache le sélecteur et annonce l'effacement", () => {
    show(ops.tournamentUpdate(clock, "id:1", { deckPolicy: "mono" }));
    expect(screen.queryByLabelText("Deck de la finale")).not.toBeInTheDocument();
    expect(screen.getByTestId("correction-final-rule-reset")).toBeInTheDocument();
  });
});
