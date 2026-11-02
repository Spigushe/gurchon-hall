import { assertNever } from "../../offline/core";
import type { VtesOperation } from "../../offline/vtes";
import { formatDayMonth, plural } from "../../labels";

/**
 * Libellé en français d'une opération de la file. Fonction pure : tout ce qu'il
 * faut savoir du monde (noms de cartes, de decks, de joueurs…) passe par le
 * contexte, que `useOperationLabels` construit à partir des lectures locales.
 */

type DeckRef = { deck_id?: number | null; client_ref?: string | null };
type PlayerRef = { player_id?: number | null; client_ref?: string | null };
type VenueRef = { venue_id?: number | null; client_ref?: string | null };
type TournamentRef = { tournament_id?: number | null; client_ref?: string | null };
type GameRef = { game_id?: number | null; client_ref?: string | null };

export interface DescribeContext {
  card(id: number): string;
  set(id: number): string;
  /** Groupe nominal complet, « deck » compris (« deck « Banu » »). */
  deck(ref: DeckRef): string;
  /** Idem : « joueur « Marc » », « lieu « Club » », « tournoi « X » », « partie du 24/10, ronde 2 ». */
  player(ref: PlayerRef): string;
  venue(ref: VenueRef): string;
  tournament(ref: TournamentRef): string;
  game(ref: GameRef): string;
}

export const quote = (name: string) => `« ${name} »`;

const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** « Partie du 24/10, ronde 2 », « …, finale », « Partie du 24/10 » (amicale). */
export function gameLabel(game: {
  played_at: string;
  round_type?: "casual" | "preliminary" | "final";
  round_number?: number | null;
}): string {
  const day = `Partie du ${formatDayMonth(game.played_at)}`;
  if (game.round_type === "final") return `${day}, finale`;
  if (game.round_type === "preliminary") {
    return game.round_number != null ? `${day}, ronde ${game.round_number}` : `${day}, ronde`;
  }
  return day;
}

type OperationOf<T extends VtesOperation["type"]> = Extract<VtesOperation, { type: T }>;
type Describers = { [T in VtesOperation["type"]]: (operation: OperationOf<T>, ctx: DescribeContext) => string };

/** « Deck « Banu » : archivage, renommage en « X » », ou « … : modification » sans détail. */
const changeSummary = (subject: string, changes: string[]) =>
  `${sentence(subject)} : ${changes.join(", ") || "modification"}`;

const proxyNote = (proxyQuantity: number) => (proxyQuantity > 0 ? `, dont ${proxyQuantity} en proxy` : "");

function deckChanges(data: OperationOf<"deck.update">["data"]): string[] {
  const changes: string[] = [];
  if (data.archived === true) changes.push("archivage");
  if (data.archived === false) changes.push("désarchivage");
  if (data.status === "active") changes.push("passage en actif");
  if (data.status === "draft") changes.push("retour en brouillon");
  if (data.name !== undefined) changes.push(`renommage en ${quote(data.name)}`);
  if (data.proxy_allowed === true) changes.push("autorisation des proxies");
  if (data.proxy_allowed === false) changes.push("interdiction des proxies");
  if (data.archetype !== undefined || data.notes !== undefined) changes.push("informations");
  return changes;
}

function venueChanges(data: OperationOf<"venue.update">["data"]): string[] {
  const changes: string[] = [];
  if (data.name !== undefined) changes.push(`renommage en ${quote(data.name)}`);
  if (data.city !== undefined) changes.push("ville");
  if (data.notes !== undefined) changes.push("notes");
  return changes;
}

function tournamentChanges(data: OperationOf<"tournament.update">["data"]): string[] {
  const changes: string[] = [];
  if (data.name !== undefined) changes.push(`renommage en ${quote(data.name)}`);
  if (data.deck_policy === "mono") changes.push("passage en mono-deck");
  if (data.deck_policy === "multi") changes.push("passage en multi-deck");
  if (data.final_deck_rule !== undefined && data.deck_policy === undefined) {
    changes.push("règle du deck de finale");
  }
  if (data.event_tier !== undefined) changes.push("niveau");
  if (data.round_count !== undefined) changes.push("nombre de rondes");
  if (data.player_count !== undefined) changes.push("nombre de joueurs");
  if (data.my_ranking !== undefined) changes.push("classement final");
  if (data.start_date !== undefined || data.end_date !== undefined) changes.push("dates");
  if (data.venue !== undefined) changes.push("lieu");
  if (data.format !== undefined || data.notes !== undefined) changes.push("informations");
  return changes;
}

function gameChanges(operation: OperationOf<"game.update">): string[] {
  const changes: string[] = [];
  if (operation.table) changes.push("table");
  const data = operation.data;
  if (data) {
    if (data.round_number !== undefined || data.round_type !== undefined) changes.push("ronde");
    if (data.tournament !== undefined) changes.push("tournoi");
    if (data.venue !== undefined) changes.push("lieu");
    if (data.played_at !== undefined) changes.push("date");
    if (data.player_count !== undefined) changes.push("nombre de joueurs");
    if (data.notes !== undefined) changes.push("notes");
  }
  return changes;
}

/**
 * Un libellé par type d'opération. Le type `Describers` exige une entrée pour
 * chaque type : un type ajouté à `VtesOperation` sans libellé ne compile pas,
 * comme le faisait l'ancien `switch` avec `assertNever`.
 */
const DESCRIBERS: Describers = {
  "stock.upsert": (op, ctx) => {
    const { card_id, language_code, card_set_id, quantity_owned = 0 } = op.data;
    return `Collection : ${ctx.card(card_id)} (${language_code}, ${ctx.set(card_set_id)}), ${plural(quantity_owned, "exemplaire")}`;
  },
  "stock.delete": (op, ctx) =>
    `Collection : retrait de ${ctx.card(op.card_id)} (${op.language_code}, ${ctx.set(op.card_set_id)})`,
  "deck.create": ({ data }) =>
    `Création du deck ${quote(data.name)}${data.proxy_allowed ? " (proxies autorisés)" : ""}`,
  "deck.update": (op, ctx) => changeSummary(ctx.deck(op.deck), deckChanges(op.data)),
  "deck.delete": (op, ctx) => `Suppression du ${ctx.deck(op.deck)}`,
  "deck_card.upsert": (op, ctx) => {
    const { card_id, language_code, card_set_id, quantity, proxy_quantity = 0 } = op.data;
    return `${sentence(ctx.deck(op.deck))} : ${quantity} × ${ctx.card(card_id)} (${language_code}, ${ctx.set(card_set_id)})${proxyNote(proxy_quantity)}`;
  },
  "deck_card.delete": (op, ctx) =>
    `${sentence(ctx.deck(op.deck))} : retrait de ${ctx.card(op.card_id)} (${op.language_code}, ${ctx.set(op.card_set_id)})`,
  "bundle.deposit": (op) =>
    `Versement du produit n° ${op.bundle_id} (${op.data.language_code}, ${plural(op.data.count ?? 1, "exemplaire")})`,

  "player.create": ({ data }) => `Création du joueur ${quote(data.name)}`,
  "player.update": (op, ctx) =>
    changeSummary(ctx.player(op.player), op.data.name !== undefined ? [`renommage en ${quote(op.data.name)}`] : []),
  "player.delete": (op, ctx) => `Suppression du ${ctx.player(op.player)}`,

  "venue.create": ({ data }) => `Création du lieu ${quote(data.name)}`,
  "venue.update": (op, ctx) => changeSummary(ctx.venue(op.venue), venueChanges(op.data)),
  "venue.delete": (op, ctx) => `Suppression du ${ctx.venue(op.venue)}`,

  "tournament.create": ({ data }) => `Création du tournoi ${quote(data.name)}`,
  "tournament.update": (op, ctx) => changeSummary(ctx.tournament(op.tournament), tournamentChanges(op.data)),
  "tournament.delete": (op, ctx) => `Suppression du ${ctx.tournament(op.tournament)}`,

  "game.create": ({ data }) => gameLabel(data),
  "game.update": (op, ctx) => changeSummary(ctx.game(op.game), gameChanges(op)),
  "game.delete": (op, ctx) => `Suppression de la ${ctx.game(op.game)}`,
};

export function describeOperation(operation: VtesOperation, ctx: DescribeContext): string {
  const describe = DESCRIBERS[operation.type] as ((operation: VtesOperation, ctx: DescribeContext) => string) | undefined;
  // Une opération venue d'une file plus récente que ce code (type inconnu) :
  // même erreur que l'ancien `default` du `switch`.
  if (!describe) return assertNever(operation as never, "Type d'opération sans libellé");
  return describe(operation, ctx);
}
