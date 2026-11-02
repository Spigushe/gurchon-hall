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

/** Pratique de jeu (Lot 7) : état du serveur factice, en snake_case comme le contrat. */
export interface FakePlayer {
  id: number;
  name: string;
  is_me: boolean;
}
export interface FakeVenue {
  id: number;
  name: string;
  city: string | null;
  notes: string | null;
}
export interface FakeTournament {
  id: number;
  name: string;
  start_date: string;
  end_date: string | null;
  venue_id: number | null;
  deck_policy: string;
  format: string;
  event_tier: string;
  final_deck_rule: string | null;
  round_count: number | null;
  player_count: number | null;
  my_ranking: number | null;
  notes: string | null;
  updated_at: string;
}
export interface FakeParticipation {
  player_id: number;
  is_me: boolean;
  deck_id: number | null;
  seat: number | null;
  victory_points: number | null;
  game_win: boolean | null;
  notes: string | null;
}
export interface FakeGame {
  id: number;
  played_at: string;
  venue_id: number | null;
  tournament_id: number | null;
  round_number: number | null;
  round_type: string;
  player_count: number;
  notes: string | null;
  updated_at: string;
  participations: FakeParticipation[];
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
      archetype?: string | null;
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
    players: FakePlayer[];
    venues: FakeVenue[];
    tournaments: FakeTournament[];
    games: FakeGame[];
    /** Decks admis en finale rendus par `GET /tournois/{id}` (par identifiant de tournoi). */
    admissible: Map<number, number[]>;
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
    players: [{ id: 1, name: "Moi", is_me: true }],
    venues: [],
    tournaments: [],
    games: [],
    admissible: new Map(),
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
  let nextPlayerId = 2;
  let nextVenueId = 1;
  let nextTournamentId = 1;
  let nextGameId = 1;
  let clockTick = 0;
  /** Horodatage croissant : `updated_at` change à chaque écriture, comme au serveur. */
  const tick = () => `2026-09-20T12:${String(Math.floor(clockTick / 60)).padStart(2, "0")}:${String(clockTick++ % 60).padStart(2, "0")}Z`;
  /** Références client liées, par genre (le journal du serveur). */
  const bound = new Map<string, { kind: string; id: number }>();
  const fold = (text: string) =>
    text
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .trim()
      .toLowerCase();

  const fingerprint = (op: Json) => JSON.stringify(op, Object.keys(op).sort());
  const stockKey = (cardId: unknown, language: unknown, cardSetId: unknown) =>
    `${cardId}|${language}|${cardSetId}`;

  function resolveDeck(ref: { deck_id?: number | null; client_ref?: string | null }) {
    return ref.deck_id != null
      ? state.decks.find((deck) => deck.id === ref.deck_id)
      : state.decks.find((deck) => deck.client_ref === ref.client_ref);
  }

  const resolveRef = (kind: string, ref: Json | null | undefined): number | null => {
    if (!ref) return null;
    const idKey = `${kind}_id`;
    if (typeof ref[idKey] === "number") return ref[idKey] as number;
    const found = bound.get(String(ref.client_ref));
    return found && found.kind === kind ? found.id : null;
  };

  function applyPlay(
    op: Json,
    refuse: (code: string, message: string) => Verdict,
    ok: (resource: Json) => Verdict,
  ): Verdict {
    const type = op.type as string;
    const [kind, action] = type.split(".") as [string, string];
    const data = (op.data ?? {}) as Json;
    const tableOf = (rows: Json[]): FakeParticipation[] =>
      rows.map((line) => {
        const player = line.player as Json;
        const playerId = player.me === true ? 1 : resolveRef("player", player);
        const deck = line.deck as Json | null | undefined;
        return {
          player_id: playerId ?? -1,
          is_me: playerId === 1,
          deck_id: deck ? ((deck.deck_id as number | undefined) ?? resolveDeck(deck)?.id ?? null) : null,
          seat: (line.seat as number | null | undefined) ?? null,
          victory_points: (line.victory_points as number | null | undefined) ?? null,
          game_win: (line.game_win as boolean | null | undefined) ?? null,
          notes: (line.notes as string | null | undefined) ?? null,
        };
      });
    const link = (id: number) => {
      if (typeof op.client_ref === "string") bound.set(op.client_ref, { kind, id });
      return ok({ kind, [`${kind}_id`]: id });
    };
    const missing = () => refuse("not_found", `${kind} introuvable.`);

    if (kind === "player" || kind === "venue") {
      const list = (kind === "player" ? state.players : state.venues) as Array<FakePlayer & FakeVenue>;
      if (action === "create") {
        if (state.players.some((p) => p.is_me && fold(p.name) === fold(data.name as string)) && kind === "player") {
          return refuse("conflict", "Ce nom est déjà porté par votre joueur Moi.");
        }
        const existing = list.find((item) => fold(item.name) === fold(data.name as string));
        if (existing) return link(existing.id);
        const id = kind === "player" ? nextPlayerId++ : nextVenueId++;
        list.push(
          kind === "player"
            ? ({ id, name: data.name, is_me: false } as FakePlayer & FakeVenue)
            : ({ id, name: data.name, city: data.city ?? null, notes: data.notes ?? null } as FakePlayer & FakeVenue),
        );
        return link(id);
      }
      const id = resolveRef(kind, op[kind] as Json);
      const found = list.find((item) => item.id === id);
      if (!found) return missing();
      if (action === "delete") {
        list.splice(list.indexOf(found), 1);
        return ok({ kind, [`${kind}_id`]: found.id });
      }
      if (data.name !== undefined) {
        if (list.some((item) => item !== found && fold(item.name) === fold(data.name as string))) {
          return refuse("conflict", `Un ${kind === "player" ? "joueur" : "lieu"} nommé '${String(data.name)}' existe déjà.`);
        }
        found.name = data.name as string;
      }
      if (kind === "venue") {
        if (data.city !== undefined) found.city = data.city as string | null;
        if (data.notes !== undefined) found.notes = data.notes as string | null;
      }
      return ok({ kind, [`${kind}_id`]: found.id });
    }

    if (kind === "tournament") {
      if (action === "create") {
        const venueId = data.venue ? resolveRef("venue", data.venue as Json) : null;
        if (data.venue && venueId === null) {
          return refuse("unresolved_client_ref", "Aucun lieu n'a été créé sous cette référence client.");
        }
        const tournament: FakeTournament = {
          id: nextTournamentId++,
          name: data.name as string,
          start_date: data.start_date as string,
          end_date: (data.end_date as string | null | undefined) ?? null,
          venue_id: venueId,
          deck_policy: (data.deck_policy as string | undefined) ?? "mono",
          format: (data.format as string | undefined) ?? "constructed",
          event_tier: (data.event_tier as string | undefined) ?? "standard",
          final_deck_rule: (data.final_deck_rule as string | null | undefined) ?? null,
          round_count: (data.round_count as number | null | undefined) ?? null,
          player_count: (data.player_count as number | null | undefined) ?? null,
          my_ranking: (data.my_ranking as number | null | undefined) ?? null,
          notes: (data.notes as string | null | undefined) ?? null,
          updated_at: tick(),
        };
        state.tournaments.push(tournament);
        return link(tournament.id);
      }
      const id = resolveRef("tournament", op.tournament as Json);
      const found = state.tournaments.find((item) => item.id === id);
      if (!found) return missing();
      if (action === "delete") {
        if (state.games.some((game) => game.tournament_id === found.id)) {
          return refuse("conflict", "Ce tournoi contient des parties.");
        }
        state.tournaments.splice(state.tournaments.indexOf(found), 1);
        return ok({ kind, tournament_id: found.id });
      }
      if (data.deck_policy === "mono" && found.deck_policy === "multi" && data.final_deck_rule === undefined) {
        return refuse("invalid", "La règle du deck de finale n'a pas de sens en mono-deck.");
      }
      for (const field of [
        "name",
        "start_date",
        "end_date",
        "deck_policy",
        "format",
        "event_tier",
        "final_deck_rule",
        "round_count",
        "player_count",
        "my_ranking",
        "notes",
      ]) {
        if (data[field] !== undefined) (found as unknown as Json)[field] = data[field];
      }
      if (data.venue !== undefined) found.venue_id = data.venue ? resolveRef("venue", data.venue as Json) : null;
      found.updated_at = tick();
      return ok({ kind, tournament_id: found.id });
    }

    // game
    if (action === "create") {
      const tournamentId = data.tournament ? resolveRef("tournament", data.tournament as Json) : null;
      if (data.tournament && tournamentId === null) {
        return refuse("unresolved_client_ref", "Aucun tournoi n'a été créé sous cette référence client.");
      }
      const venueId = data.venue ? resolveRef("venue", data.venue as Json) : null;
      const participations = tableOf((data.participations as Json[]) ?? []);
      if (participations.some((line) => line.player_id === -1)) {
        return refuse("unresolved_client_ref", "Aucun joueur n'a été créé sous cette référence client.");
      }
      const roundType = (data.round_type as string | undefined) ?? "casual";
      const roundNumber = (data.round_number as number | null | undefined) ?? null;
      if (
        tournamentId !== null &&
        roundType === "preliminary" &&
        state.games.some(
          (game) => game.tournament_id === tournamentId && game.round_number === roundNumber && game.round_type === "preliminary",
        )
      ) {
        return refuse("conflict", `La ronde ${roundNumber} est déjà saisie pour ce tournoi (sur un autre appareil ?).`);
      }
      const game: FakeGame = {
        id: nextGameId++,
        played_at: new Date(data.played_at as string).toISOString().replace(".000Z", "Z"),
        venue_id: venueId,
        tournament_id: tournamentId,
        round_number: roundNumber,
        round_type: roundType,
        player_count: data.player_count as number,
        notes: (data.notes as string | null | undefined) ?? null,
        updated_at: tick(),
        participations,
      };
      state.games.push(game);
      return link(game.id);
    }
    const id = resolveRef("game", op.game as Json);
    const found = state.games.find((item) => item.id === id);
    if (!found) return missing();
    if (action === "delete") {
      state.games.splice(state.games.indexOf(found), 1);
      return ok({ kind, game_id: found.id });
    }
    if (op.table) {
      const next = tableOf(((op.table as Json).participations as Json[]) ?? []);
      if (next.some((line) => line.player_id === -1)) {
        return refuse("unresolved_client_ref", "Aucun joueur n'a été créé sous cette référence client.");
      }
      found.participations = next;
    }
    for (const field of ["round_number", "round_type", "player_count", "notes"]) {
      if (data[field] !== undefined) (found as unknown as Json)[field] = data[field];
    }
    if (data.played_at !== undefined) {
      found.played_at = new Date(data.played_at as string).toISOString().replace(".000Z", "Z");
    }
    if (data.venue !== undefined) found.venue_id = data.venue ? resolveRef("venue", data.venue as Json) : null;
    if (data.tournament !== undefined) {
      found.tournament_id = data.tournament ? resolveRef("tournament", data.tournament as Json) : null;
    }
    found.updated_at = tick();
    return ok({ kind, game_id: found.id });
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
          archetype: (data.archetype as string | null | undefined) ?? null,
          archived_at: null,
        };
        state.decks.push(deck);
        return ok({ kind: "deck", deck_id: deck.id });
      }
      case "deck_card.upsert": {
        const deck = resolveDeck(op.deck as Json);
        if (!deck) return refuse("unresolved_client_ref", "deck introuvable");
        const cardSetId = (data.card_set_id as number | undefined) ?? CARD_SET_ID;
        const stockId = stockKey(data.card_id, data.language_code, cardSetId);
        const owned = state.stock.get(stockId);
        const real = (data.quantity as number) - ((data.proxy_quantity as number | undefined) ?? 0);
        // Lot 4b : `acquired_quantity` est un delta borné par les exemplaires
        // réels que l'écriture ajoute à la ligne (ligne neuve : depuis 0).
        const acquired = (data.acquired_quantity as number | undefined) ?? 0;
        const previous = state.deckCards.find(
          (line) =>
            line.deck_id === deck.id &&
            line.card_id === data.card_id &&
            line.language_code === data.language_code &&
            line.card_set_id === cardSetId,
        );
        const added = real - (previous ? previous.quantity - previous.proxy_quantity : 0);
        if (acquired > added) {
          return refuse("invalid", "acquired_quantity au-delà des exemplaires ajoutés à la ligne");
        }
        if (!owned && acquired === 0) {
          return refuse("conflict", "exemplaires insuffisants");
        }
        if ((owned?.quantity_owned ?? 0) + acquired < real) {
          return refuse("conflict", "exemplaires insuffisants");
        }
        if (acquired > 0) {
          state.stock.set(stockId, {
            card_id: data.card_id as number,
            language_code: data.language_code as string,
            card_set_id: cardSetId,
            quantity_owned: (owned?.quantity_owned ?? 0) + acquired,
            notes: owned?.notes ?? null,
          });
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
      case "player.create":
      case "venue.create":
      case "tournament.create":
      case "game.create":
      case "player.update":
      case "player.delete":
      case "venue.update":
      case "venue.delete":
      case "tournament.update":
      case "tournament.delete":
      case "game.update":
      case "game.delete":
        return applyPlay(op, refuse, ok);
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
            player_id: null,
            venue_id: null,
            tournament_id: null,
            game_id: null,
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
      const summaryOf = (game: FakeGame): Json => {
        const line = game.participations.find((p) => p.is_me);
        return {
          deck_id: line?.deck_id ?? null,
          seat: line?.seat ?? null,
          victory_points: line?.victory_points ?? null,
          game_win: line?.game_win ?? null,
        };
      };
      const gameRead = (game: FakeGame): Json => ({
        id: game.id,
        played_at: game.played_at,
        venue_id: game.venue_id,
        tournament_id: game.tournament_id,
        tournament_name: state.tournaments.find((t) => t.id === game.tournament_id)?.name ?? null,
        round_number: game.round_number,
        round_type: game.round_type,
        player_count: game.player_count,
        me: summaryOf(game),
        notes: game.notes,
        created_at: "2026-09-20T12:00:00Z",
        updated_at: game.updated_at,
      });
      const tournamentRead = (tournament: FakeTournament): Json => {
        const own = state.games.filter((g) => g.tournament_id === tournament.id);
        const prelim = own.filter((g) => g.round_type === "preliminary");
        const final = own.find((g) => g.round_type === "final");
        const mine = (g: FakeGame) => g.participations.find((p) => p.is_me);
        return {
          ...tournament,
          my_summary: {
            preliminary_game_wins: prelim.filter((g) => mine(g)?.game_win === true).length,
            preliminary_victory_points: prelim.reduce((sum, g) => sum + (mine(g)?.victory_points ?? 0), 0),
            rounds_played: prelim.length,
            final_victory_points: final ? (mine(final)?.victory_points ?? 0) : null,
            final_game_win: final ? mine(final)?.game_win === true : null,
          },
          created_at: "2026-09-20T12:00:00Z",
        };
      };
      if (url.pathname === "/joueurs") {
        return json(
          state.players.map((p) => ({
            ...p,
            game_count: state.games.filter((g) => g.participations.some((l) => l.player_id === p.id)).length,
          })),
        );
      }
      if (url.pathname === "/lieux") {
        return json(
          state.venues.map((v) => ({
            ...v,
            game_count: state.games.filter((g) => g.venue_id === v.id).length,
            tournament_count: state.tournaments.filter((t) => t.venue_id === v.id).length,
          })),
        );
      }
      if (url.pathname === "/tournois") return json(state.tournaments.map(tournamentRead));
      const tournamentMatch = url.pathname.match(/^\/tournois\/(\d+)$/);
      if (tournamentMatch) {
        const tournament = state.tournaments.find((t) => t.id === Number(tournamentMatch[1]));
        if (!tournament) return json({ detail: "introuvable" }, 404);
        return json({
          ...tournamentRead(tournament),
          games: state.games.filter((g) => g.tournament_id === tournament.id).map(gameRead),
          admissible_final_decks: state.admissible.get(tournament.id) ?? null,
        });
      }
      if (url.pathname === "/parties") return json(state.games.map(gameRead));
      const gameMatch = url.pathname.match(/^\/parties\/(\d+)$/);
      if (gameMatch) {
        const game = state.games.find((g) => g.id === Number(gameMatch[1]));
        if (!game) return json({ detail: "introuvable" }, 404);
        return json({
          ...gameRead(game),
          participations: game.participations.map((line, index) => ({
            id: index + 1,
            game_id: game.id,
            ...line,
          })),
        });
      }
      const deckRead = (deck: FakeServer["state"]["decks"][number]) => ({
        id: deck.id,
        name: deck.name,
        discriminator: deck.discriminator,
        created_on: null,
        status: "draft",
        archetype: deck.archetype ?? null,
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
