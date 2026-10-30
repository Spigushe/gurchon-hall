import { useCallback, useMemo } from "react";
import { cardSetLabelById } from "../../labels";
import { useLiveQuery } from "../../offline/react";
import type { OutboxEntry } from "../../offline/core";
import {
  useLocalDecks,
  useLocalGames,
  useLocalPlayers,
  useLocalTournaments,
  useLocalVenues,
  useVtesOffline,
  type VtesOperation,
} from "../../offline/vtes";
import { useCardSetOptions } from "../stock/useCardSetOptions";
import { describeOperation, gameLabel, quote, type DescribeContext } from "./describeOperation";

type Entry = OutboxEntry<VtesOperation>;

/** Désignation par identifiant serveur ou par référence client, quel que soit le genre. */
type AnyRef = { id: number | null | undefined; clientRef: string | null | undefined };

/**
 * Décrit une opération de la file en français, avec les noms de cartes, de
 * decks, de joueurs, de lieux, de tournois et de parties qu'on connaît
 * localement (catalogue, collection, lectures de la surcouche, et créations
 * refusées, qui ne figurent plus dans les lectures).
 */
export function useOperationDescriber(entries: readonly Entry[]) {
  const { db } = useVtesOffline();
  const decks = useLocalDecks({ state: "all" });
  const players = useLocalPlayers();
  const venues = useLocalVenues();
  const tournaments = useLocalTournaments();
  const games = useLocalGames();
  const cardSets = useCardSetOptions();

  const cardIds = useMemo(() => {
    const ids = new Set<number>();
    for (const { operation } of entries) {
      if (operation.type === "stock.upsert" || operation.type === "deck_card.upsert") {
        ids.add(operation.data.card_id);
      } else if (operation.type === "stock.delete" || operation.type === "deck_card.delete") {
        ids.add(operation.card_id);
      }
    }
    return [...ids].sort((a, b) => a - b);
  }, [entries]);

  const namesQuery = useCallback(async () => {
    const names = new Map<number, string>();
    for (const row of await db.stock.where("cardId").anyOf(cardIds).toArray()) {
      if (row.cardName) names.set(row.cardId, row.cardName);
    }
    for (const card of await db.cards.bulkGet(cardIds)) {
      if (card) names.set(card.id, card.name);
    }
    return names;
  }, [db, cardIds]);
  const cardNames = useLiveQuery(namesQuery);

  return useCallback(
    (operation: VtesOperation): string => {
      const card = (id: number) => quote(cardNames?.get(id) ?? `carte n° ${id}`);

      // Une ressource se retrouve par son identifiant, ou par la référence client
      // de sa création (à ne pas confondre avec sa clé : une création appliquée
      // porte encore la référence, le miroir la rattache à l'identifiant).
      const known = <T extends { id: number | null; clientRef: string | null; aliases?: string[] }>(
        items: readonly T[] | undefined,
        { id, clientRef }: AnyRef,
      ) =>
        items?.find((item) =>
          id != null
            ? item.id === id
            : clientRef != null && (item.clientRef === clientRef || item.aliases?.includes(`ref:${clientRef}`)),
        );
      const refused = (type: VtesOperation["type"], clientRef: string | null | undefined) =>
        clientRef == null
          ? undefined
          : entries.find(
              (entry) =>
                entry.operation.type === type &&
                "client_ref" in entry.operation &&
                entry.operation.client_ref === clientRef,
            )?.operation;

      // Groupe nominal complet, « deck » compris : un deck absent des lectures
      // locales (supprimé depuis, sa création appliquée n'étant plus en file) n'a
      // ni nom ni numéro à citer, et « Deck deck inconnu » doublait le mot.
      const deck = (ref: { deck_id?: number | null; client_ref?: string | null }) => {
        const found = decks?.find((item) =>
          ref.deck_id != null ? item.id === ref.deck_id : item.clientRef === ref.client_ref,
        );
        if (found) return `deck ${quote(found.name)}`;
        const op = refused("deck.create", ref.client_ref);
        if (op && op.type === "deck.create") return `deck ${quote(op.data.name)}`;
        return ref.deck_id != null ? `deck n° ${ref.deck_id}` : "deck introuvable localement (supprimé ?)";
      };

      const context: DescribeContext = {
        card,
        set: (id) => cardSetLabelById(id, cardSets.byId),
        deck,
        player: (ref) => {
          const found = known(players, { id: ref.player_id, clientRef: ref.client_ref });
          if (found) return `joueur ${quote(found.name)}`;
          const op = refused("player.create", ref.client_ref);
          if (op && op.type === "player.create") return `joueur ${quote(op.data.name)}`;
          return ref.player_id != null ? `joueur n° ${ref.player_id}` : "joueur introuvable localement (supprimé ?)";
        },
        venue: (ref) => {
          const found = known(venues, { id: ref.venue_id, clientRef: ref.client_ref });
          if (found) return `lieu ${quote(found.name)}`;
          const op = refused("venue.create", ref.client_ref);
          if (op && op.type === "venue.create") return `lieu ${quote(op.data.name)}`;
          return ref.venue_id != null ? `lieu n° ${ref.venue_id}` : "lieu introuvable localement (supprimé ?)";
        },
        tournament: (ref) => {
          const found = known(tournaments, { id: ref.tournament_id, clientRef: ref.client_ref });
          if (found) return `tournoi ${quote(found.name)}`;
          const op = refused("tournament.create", ref.client_ref);
          if (op && op.type === "tournament.create") return `tournoi ${quote(op.data.name)}`;
          return ref.tournament_id != null
            ? `tournoi n° ${ref.tournament_id}`
            : "tournoi introuvable localement (supprimé ?)";
        },
        game: (ref) => {
          const found = known(games, { id: ref.game_id, clientRef: ref.client_ref });
          if (found) {
            return gameLabel({
              played_at: found.playedAt,
              round_type: found.roundType,
              round_number: found.roundNumber,
            }).replace(/^P/, "p");
          }
          const op = refused("game.create", ref.client_ref);
          if (op && op.type === "game.create") return gameLabel(op.data).replace(/^P/, "p");
          return ref.game_id != null ? `partie n° ${ref.game_id}` : "partie introuvable localement (supprimée ?)";
        },
      };
      return describeOperation(operation, context);
    },
    [cardNames, cardSets.byId, decks, entries, games, players, tournaments, venues],
  );
}
