import createClient from "openapi-fetch";
import { describe, expect, it } from "vitest";
import type { paths } from "../../../src/api-client/schema.d.ts";
import { createVtesSyncTransport, describeErrorBody, parseRetryAfter } from "../../../src/offline/vtes/transport";
import * as ops from "../../../src/offline/vtes/operations";

const clock: ops.OperationClock = {
  newId: () => "22222222-2222-4222-8222-222222222222",
  now: () => "2026-09-20T14:03:11.123+02:00",
};

function transportWith(handler: (request: Request) => Promise<Response> | Response) {
  const seen: Array<{ url: string; method: string; body: unknown }> = [];
  const client = createClient<paths>({
    baseUrl: "http://api.test",
    fetch: async (request: Request) => {
      seen.push({
        url: request.url,
        method: request.method,
        body: await request.clone().json(),
      });
      return handler(request);
    },
  });
  return { transport: createVtesSyncTransport(client), seen };
}

const result = (overrides: Record<string, unknown> = {}) => ({
  operation_id: clock.newId(),
  type: "deck.create",
  outcome: "applied",
  client_ref: "ref-1",
  resource: { kind: "deck", deck_id: 12, card_id: null, language_code: null, bundle_id: null },
  error: null,
  processed_at: "2026-09-20T12:00:00Z",
  ...overrides,
});

const envelope = (results: unknown[]) => ({
  batch_id: "00000000-0000-4000-8000-000000000001",
  synced_at: "2026-09-20T12:00:00Z",
  applied: 1,
  replayed: 0,
  rejected: 0,
  results,
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("createVtesSyncTransport", () => {
  it("envoie POST /sync avec le lot tel quel", async () => {
    const { transport, seen } = transportWith(() => json(envelope([result()])));
    const operation = ops.deckCreate(clock, "ref-1", { name: "Malkavien" });

    await transport.send([operation]);

    expect(seen).toHaveLength(1);
    expect(seen[0].method).toBe("POST");
    expect(new URL(seen[0].url).pathname).toBe("/sync");
    expect(seen[0].body).toEqual({ operations: [operation] });
  });

  it("traduit un 200 en verdicts, avec la correspondance client_ref -> deck_id", async () => {
    const { transport } = transportWith(() => json(envelope([result()])));
    const outcome = await transport.send([ops.deckCreate(clock, "ref-1", { name: "x" })]);
    expect(outcome).toEqual({
      status: "ok",
      verdicts: [
        {
          operationId: clock.newId(),
          outcome: "applied",
          error: null,
          refs: [{ ref: "ref-1", id: 12 }],
        },
      ],
    });
  });

  it("ne retient pas de correspondance pour une création refusée", async () => {
    const { transport } = transportWith(() =>
      json(
        envelope([
          result({
            outcome: "rejected",
            resource: null,
            error: { code: "invalid", message: "nom vide" },
          }),
        ]),
      ),
    );
    const outcome = await transport.send([ops.deckCreate(clock, "ref-1", { name: "x" })]);
    expect(outcome).toMatchObject({
      status: "ok",
      verdicts: [{ outcome: "rejected", error: { code: "invalid", message: "nom vide" }, refs: [] }],
    });
  });

  it("garde la correspondance d'une création rejouée", async () => {
    const { transport } = transportWith(() => json(envelope([result({ outcome: "replayed" })])));
    const outcome = await transport.send([ops.deckCreate(clock, "ref-1", { name: "x" })]);
    expect(outcome).toMatchObject({
      verdicts: [{ outcome: "replayed", refs: [{ ref: "ref-1", id: 12 }] }],
    });
  });

  it("traduit un 422 en lot invalide, message lisible à l'appui", async () => {
    const { transport } = transportWith(() =>
      json(
        {
          detail: [
            { loc: ["body", "operations", 0, "data", "quantity"], msg: "doit être positif", type: "x" },
          ],
        },
        422,
      ),
    );
    const outcome = await transport.send([
      ops.stockUpsert(clock, { cardId: 1, languageCode: "EN", cardSetId: 9 }),
    ]);
    expect(outcome).toEqual({
      status: "invalid",
      message: "body.operations.0.data.quantity : doit être positif",
    });
  });

  it.each([500, 502, 503, 501, 404, 429])("traduit un HTTP %i en indisponibilité", async (status) => {
    const { transport } = transportWith(() => json({ detail: "non disponible" }, status));
    const outcome = await transport.send([ops.stockDelete(clock, 1, "EN", 9)]);
    expect(outcome).toEqual({ status: "unavailable", httpStatus: status, message: "non disponible" });
  });

  it("garde le délai Retry-After d'un 503 transitoire (rien n'a été appliqué, le lot se renvoie à l'identique)", async () => {
    const { transport } = transportWith(
      () =>
        new Response(JSON.stringify({ detail: "écriture en cours" }), {
          status: 503,
          headers: { "content-type": "application/json", "Retry-After": "3" },
        }),
    );
    const outcome = await transport.send([ops.stockDelete(clock, 1, "EN", 9)]);
    expect(outcome).toEqual({
      status: "unavailable",
      httpStatus: 503,
      message: "écriture en cours",
      retryAfterMs: 3000,
    });
  });

  it("ignore un Retry-After qui n'est pas un nombre de secondes", () => {
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter("Wed, 21 Oct 2026 07:28:00 GMT")).toBeUndefined();
    expect(parseRetryAfter("0")).toBe(0);
    expect(parseRetryAfter(" 12 ")).toBe(12000);
  });

  it("traduit une coupure réseau en indisponibilité, sans lever", async () => {
    const { transport } = transportWith(() => {
      throw new TypeError("Failed to fetch");
    });
    const outcome = await transport.send([ops.stockDelete(clock, 1, "EN", 9)]);
    expect(outcome).toEqual({ status: "unavailable", message: "Failed to fetch" });
  });
});

describe("describeErrorBody", () => {
  it("lit les corps d'erreur FastAPI", () => {
    expect(describeErrorBody({ detail: "boom" })).toBe("boom");
    expect(describeErrorBody({ detail: [{ msg: "a" }, { loc: ["x"], msg: "b" }] })).toBe("a ; x : b");
    expect(describeErrorBody(undefined)).toBe("");
    expect(describeErrorBody({})).toBe("");
  });
});
