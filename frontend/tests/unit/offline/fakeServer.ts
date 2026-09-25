import createClient from "openapi-fetch";
import type { paths } from "../../../src/api-client/schema.d.ts";
import type { ApiClient } from "../../../src/offline/vtes/types";

/**
 * Serveur factice en mémoire, derrière un `fetch` injecté dans le vrai client
 * `openapi-fetch` : la sérialisation, les chemins et les formes de réponse sont
 * ceux du contrat, seule la logique métier est ici (réduite à ce que les tests
 * exercent). Il reproduit ce qui compte pour l'idempotence : un journal indexé
 * par `operation_id`, une empreinte du corps, et le verdict mémorisé rendu en
 * `replayed`.
 *
 * Lot 4 : chaque carte n'a qu'une impression (`CARD_SET_ID`), et le versement
 * de produit range sous cette même extension — assez pour exercer l'extension
 * dans les clés sans construire un catalogue multi-impressions ici (ce cas est
 * couvert par les tests d'overlay/clés Dexie, sur des données construites à la
 * main).
 */

export const CARD_SET_ID = 9;

export const CARD_SETS = [
  { id: CARD_SET_ID, abbrev: "TEST", full_name: "Extension de test", release_date: "2020-01-01", company: null, is_placeholder: false },
] as const;

export const CARDS = [
  { id: 1, vekn_id: 100001, name: "Élan vital", category: "library" },
  { id: 2, vekn_id: 100002, name: "Œuvre", category: "library" },
  { id: 3, vekn_id: 200001, name: "Theo Bell", category: "crypt" },
] as const;

type Json = Record<string, unknown>;

interface Verdict {
  outcome: "applied" | "rejected";
  type: string;
  client_ref: string | null;
  resource: Json | null;
  error: { code: string; message: string } | null;
  processed_at: string;
}

export interface FakeServer {
  client: ApiClient;
  state: {
    stock: Map<
      string,
      {
        card_id: number;
        language_code: string;
        card_set_id: number;
        quantity_owned: number;
        notes: string | null;
      }
    >;
    decks: Array<{
      id: number;
      name: string;
      discriminator: string;
      client_ref: string | null;
      proxy_allowed: boolean;
      archived_at: string | null;
    }>;
    deckCards: Array<{
      deck_id: number;
      card_id: number;
      language_code: string;
      card_set_id: number;
      quantity: number;
      proxy_quantity: number;
    }>;
    languages: string[];
    journal: Map<string, { fingerprint: string; verdict: Verdict }>;
    requests: Array<{ method: string; path: string; body: unknown }>;
    /** Nombre de fois où un versement de produit a réellement été appliqué. */
    depositsApplied: number;
  };
  /** Comportement du prochain appel `POST /sync`. */
  next: {
    /** Coupe avant que le serveur ne voie la requête. */
    networkFailure: boolean;
    /** Le serveur applique le lot, mais la réponse se perd. */
    loseResponse: boolean;
    /** Statut HTTP forcé (500, 503, 422…). */
    status: number | null;
    /** Fait échouer les prochains `GET` (rafraîchissement). */
    getStatus: number | null;
  };
  addBulkStock(count: number): void;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export function createFakeServer(): FakeServer {
  const state: FakeServer["state"] = {
    stock: new Map(),
    decks: [],
    deckCards: [],
    languages: ["EN", "FR", "ES", "XX"],
    journal: new Map(),
    requests: [],
    depositsApplied: 0,
  };
  const next: FakeServer["next"] = {
    networkFailure: false,
    loseResponse: false,
    status: null,
    getStatus: null,
  };
  let nextDeckId = 1;

  const fingerprint = (op: Json) => JSON.stringify(op, Object.keys(op).sort());
  const stockKey = (cardId: unknown, language: unknown, cardSetId: unknown) =>
    `${cardId}|${language}|${cardSetId}`;

  function resolveDeck(ref: { deck_id?: number | null; client_ref?: string | null }) {
    return ref.deck_id != null
      ? state.decks.find((deck) => deck.id === ref.deck_id)
      : state.decks.find((deck) => deck.client_ref === ref.client_ref);
  }

  function apply(op: Json): Verdict {
    const base = {
      type: op.type as string,
      client_ref: (op.client_ref as string | undefined) ?? null,
      processed_at: "2026-09-20T12:00:00Z",
    };
    const refuse = (code: string, message: string): Verdict => ({
      ...base,
      outcome: "rejected",
      resource: null,
      error: { code, message },
    });
    const ok = (resource: Json): Verdict => ({
      ...base,
      outcome: "applied",
      resource,
      error: null,
    });
    const data = (op.data ?? {}) as Json;
    switch (op.type) {
      case "stock.upsert": {
        const language = data.language_code as string;
        const cardSetId = (data.card_set_id as number | undefined) ?? CARD_SET_ID;
        state.stock.set(stockKey(data.card_id, language, cardSetId), {
          card_id: data.card_id as number,
          language_code: language,
          card_set_id: cardSetId,
          quantity_owned: (data.quantity_owned as number | undefined) ?? 0,
          notes: (data.notes as string | null | undefined) ?? null,
        });
        return ok({
          kind: "card_copy",
          card_id: data.card_id,
          language_code: language,
          card_set_id: cardSetId,
        });
      }
      case "deck.create": {
        if (state.decks.some((deck) => deck.client_ref === op.client_ref)) {
          return refuse("conflict", "référence client déjà utilisée");
        }
        const deck = {
          id: nextDeckId++,
          name: data.name as string,
          discriminator: String(1000 + nextDeckId),
          client_ref: op.client_ref as string,
          proxy_allowed: (data.proxy_allowed as boolean | undefined) ?? false,
          archived_at: null,
        };
        state.decks.push(deck);
        return ok({ kind: "deck", deck_id: deck.id });
      }
      case "deck_card.upsert": {
        const deck = resolveDeck(op.deck as Json);
        if (!deck) return refuse("unresolved_client_ref", "deck introuvable");
        const cardSetId = (data.card_set_id as number | undefined) ?? CARD_SET_ID;
        const owned = state.stock.get(stockKey(data.card_id, data.language_code, cardSetId));
        const real = (data.quantity as number) - ((data.proxy_quantity as number | undefined) ?? 0);
        if (!owned || owned.quantity_owned < real) {
          return refuse("conflict", "exemplaires insuffisants");
        }
        state.deckCards = state.deckCards.filter(
          (line) =>
            !(
              line.deck_id === deck.id &&
              line.card_id === data.card_id &&
              line.language_code === data.language_code &&
              line.card_set_id === cardSetId
            ),
        );
        state.deckCards.push({
          deck_id: deck.id,
          card_id: data.card_id as number,
          language_code: data.language_code as string,
          card_set_id: cardSetId,
          quantity: data.quantity as number,
          proxy_quantity: (data.proxy_quantity as number | undefined) ?? 0,
        });
        return ok({
          kind: "deck_card",
          deck_id: deck.id,
          card_id: data.card_id,
          language_code: data.language_code,
          card_set_id: cardSetId,
        });
      }
      case "bundle.deposit": {
        state.depositsApplied += 1;
        const key = stockKey(1, data.language_code, CARD_SET_ID);
        const existing = state.stock.get(key);
        state.stock.set(key, {
          card_id: 1,
          language_code: data.language_code as string,
          card_set_id: CARD_SET_ID,
          quantity_owned: (existing?.quantity_owned ?? 0) + 3 * ((data.count as number | undefined) ?? 1),
          notes: existing?.notes ?? null,
        });
        return ok({ kind: "bundle", bundle_id: op.bundle_id });
      }
      default:
        return refuse("invalid", `type non géré par le serveur factice : ${String(op.type)}`);
    }
  }

  function handleSync(body: { operations: Json[] }): Response {
    const results = body.operations.map((op) => {
      const id = op.operation_id as string;
      const known = state.journal.get(id);
      let verdict: Verdict;
      let outcome: string;
      if (known) {
        if (known.fingerprint !== fingerprint(op)) {
          verdict = {
            ...known.verdict,
            outcome: "rejected",
            resource: null,
            error: { code: "mismatched_replay", message: "même clé, autre corps" },
          };
          outcome = "rejected";
        } else {
          verdict = known.verdict;
          outcome = "replayed";
        }
      } else {
        verdict = apply(op);
        state.journal.set(id, { fingerprint: fingerprint(op), verdict });
        outcome = verdict.outcome;
      }
      const resource = verdict.resource
        ? {
            deck_id: null,
            card_id: null,
            language_code: null,
            card_set_id: null,
            bundle_id: null,
            ...verdict.resource,
          }
        : null;
      return { operation_id: id, ...verdict, outcome, resource };
    });
    const count = (name: string) => results.filter((r) => r.outcome === name).length;
    return json({
      batch_id: "00000000-0000-4000-8000-00000000ba7c",
      synced_at: "2026-09-20T12:00:00Z",
      applied: count("applied"),
      replayed: count("replayed"),
      rejected: count("rejected"),
      results,
    });
  }

  const cardSummary = (id: number) => {
    const card = CARDS.find((item) => item.id === id)!;
    return { ...card, clan: null, capacity: null, group_code: null, advanced: false, image_url: null };
  };

  const cardListItem = (id: number) => ({
    ...cardSummary(id),
    card_set_ids: [CARD_SET_ID],
    latest_card_set_id: CARD_SET_ID,
  });

  async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const method = request.method;
    const body = method === "GET" ? undefined : await request.json();
    state.requests.push({ method, path: url.pathname, body });

    if (method === "POST" && url.pathname === "/sync") {
      if (next.networkFailure) {
        next.networkFailure = false;
        throw new TypeError("Failed to fetch");
      }
      if (next.status) {
        const status = next.status;
        next.status = null;
        return json({ detail: status === 503 ? "écriture en cours" : "erreur" }, status);
      }
      const response = handleSync(body as { operations: Json[] });
      if (next.loseResponse) {
        next.loseResponse = false;
        throw new TypeError("Failed to fetch");
      }
      return response;
    }

    if (method === "GET") {
      if (next.getStatus) return json({ detail: "erreur" }, next.getStatus);
      const limit = Number(url.searchParams.get("limit") ?? 50);
      const offset = Number(url.searchParams.get("offset") ?? 0);
      const page = <T,>(items: T[]) => items.slice(offset, offset + limit);
      if (url.pathname === "/langues") {
        return json(state.languages.map((code, i) => ({ code, label: code, sort_order: i })));
      }
      if (url.pathname === "/extensions") return json(CARD_SETS);
      if (url.pathname === "/cartes") return json(page(CARDS.map((c) => cardListItem(c.id))));
      if (url.pathname === "/stock") {
        return json(
          page([...state.stock.values()].map((entry) => ({ ...entry, card: cardSummary(entry.card_id) }))),
        );
      }
      const deckRead = (deck: FakeServer["state"]["decks"][number]) => ({
        id: deck.id,
        name: deck.name,
        discriminator: deck.discriminator,
        created_on: null,
        status: "draft",
        archetype: null,
        notes: null,
        proxy_allowed: deck.proxy_allowed,
        archived_at: deck.archived_at,
        deleted_at: null,
        created_at: "2026-09-20T12:00:00Z",
        updated_at: "2026-09-20T12:00:00Z",
      });
      if (url.pathname === "/decks") return json(state.decks.map(deckRead));
      const match = url.pathname.match(/^\/decks\/(\d+)$/);
      if (match) {
        const deck = state.decks.find((item) => item.id === Number(match[1]));
        if (!deck) return json({ detail: "introuvable" }, 404);
        return json({
          ...deckRead(deck),
          cards: state.deckCards
            .filter((line) => line.deck_id === deck.id)
            .map((line) => ({ ...line, card: cardSummary(line.card_id) })),
        });
      }
    }
    return json({ detail: `route non prévue : ${method} ${url.pathname}` }, 404);
  }

  const client = createClient<paths>({
    baseUrl: "http://api.test",
    fetch: (request: Request) => handle(request),
  });

  return {
    client,
    state,
    next,
    addBulkStock(count) {
      for (let i = 0; i < count; i++) {
        state.stock.set(stockKey(1, `L${i}`, CARD_SET_ID), {
          card_id: 1,
          language_code: `L${i}`,
          card_set_id: CARD_SET_ID,
          quantity_owned: 1,
          notes: null,
        });
      }
    },
  };
}
