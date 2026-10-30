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

export function describeOperation(operation: VtesOperation, ctx: DescribeContext): string {
  switch (operation.type) {
    case "stock.upsert": {
      const { card_id, language_code, card_set_id, quantity_owned = 0 } = operation.data;
      return `Collection : ${ctx.card(card_id)} (${language_code}, ${ctx.set(card_set_id)}), ${plural(quantity_owned, "exemplaire")}`;
    }
    case "stock.delete":
      return `Collection : retrait de ${ctx.card(operation.card_id)} (${operation.language_code}, ${ctx.set(operation.card_set_id)})`;
    case "deck.create":
      return `Création du deck ${quote(operation.data.name)}${operation.data.proxy_allowed ? " (proxies autorisés)" : ""}`;
    case "deck.update": {
      const changes: string[] = [];
      const { data } = operation;
      if (data.archived === true) changes.push("archivage");
      if (data.archived === false) changes.push("désarchivage");
      if (data.status === "active") changes.push("passage en actif");
      if (data.status === "draft") changes.push("retour en brouillon");
      if (data.name !== undefined) changes.push(`renommage en ${quote(data.name)}`);
      if (data.proxy_allowed === true) changes.push("autorisation des proxies");
      if (data.proxy_allowed === false) changes.push("interdiction des proxies");
      if (data.archetype !== undefined || data.notes !== undefined) changes.push("informations");
      return `${sentence(ctx.deck(operation.deck))} : ${changes.join(", ") || "modification"}`;
    }
    case "deck.delete":
      return `Suppression du ${ctx.deck(operation.deck)}`;
    case "deck_card.upsert": {
      const { card_id, language_code, card_set_id, quantity, proxy_quantity = 0 } = operation.data;
      return `${sentence(ctx.deck(operation.deck))} : ${quantity} × ${ctx.card(card_id)} (${language_code}, ${ctx.set(card_set_id)})${proxy_quantity > 0 ? `, dont ${proxy_quantity} en proxy` : ""}`;
    }
    case "deck_card.delete":
      return `${sentence(ctx.deck(operation.deck))} : retrait de ${ctx.card(operation.card_id)} (${operation.language_code}, ${ctx.set(operation.card_set_id)})`;
    case "bundle.deposit":
      return `Versement du produit n° ${operation.bundle_id} (${operation.data.language_code}, ${plural(operation.data.count ?? 1, "exemplaire")})`;

    case "player.create":
      return `Création du joueur ${quote(operation.data.name)}`;
    case "player.update":
      return `${sentence(ctx.player(operation.player))} : ${
        operation.data.name !== undefined ? `renommage en ${quote(operation.data.name)}` : "modification"
      }`;
    case "player.delete":
      return `Suppression du ${ctx.player(operation.player)}`;

    case "venue.create":
      return `Création du lieu ${quote(operation.data.name)}`;
    case "venue.update": {
      const { data } = operation;
      const changes: string[] = [];
      if (data.name !== undefined) changes.push(`renommage en ${quote(data.name)}`);
      if (data.city !== undefined) changes.push("ville");
      if (data.notes !== undefined) changes.push("notes");
      return `${sentence(ctx.venue(operation.venue))} : ${changes.join(", ") || "modification"}`;
    }
    case "venue.delete":
      return `Suppression du ${ctx.venue(operation.venue)}`;

    case "tournament.create":
      return `Création du tournoi ${quote(operation.data.name)}`;
    case "tournament.update": {
      const { data } = operation;
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
      return `${sentence(ctx.tournament(operation.tournament))} : ${changes.join(", ") || "modification"}`;
    }
    case "tournament.delete":
      return `Suppression du ${ctx.tournament(operation.tournament)}`;

    case "game.create":
      return gameLabel(operation.data);
    case "game.update": {
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
      return `${sentence(ctx.game(operation.game))} : ${changes.join(", ") || "modification"}`;
    }
    case "game.delete":
      return `Suppression de la ${ctx.game(operation.game)}`;

    default:
      return assertNever(operation, "Type d'opération sans libellé");
  }
}
