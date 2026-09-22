import { useCallback, useMemo } from "react";
import { plural } from "../../labels";
import { useLiveQuery } from "../../offline/react";
import { type OutboxEntry } from "../../offline/core";
import { useLocalDecks, useVtesOffline, type VtesOperation } from "../../offline/vtes";

type Entry = OutboxEntry<VtesOperation>;

const quote = (name: string) => `« ${name} »`;

/**
 * Décrit une opération de la file en français, avec les noms de cartes et de
 * decks qu'on connaît localement (catalogue, collection, decks, et créations de
 * deck refusées, qui ne figurent plus dans les lectures).
 */
export function useOperationDescriber(entries: readonly Entry[]) {
  const { db } = useVtesOffline();
  const decks = useLocalDecks({ state: "all" });

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
      const deck = (ref: { deck_id?: number | null; client_ref?: string | null }) => {
        const known = decks?.find((item) =>
          ref.deck_id != null ? item.id === ref.deck_id : item.clientRef === ref.client_ref,
        );
        if (known) return quote(known.name);
        const refused = entries.find(
          (entry) =>
            entry.operation.type === "deck.create" && entry.operation.client_ref === ref.client_ref,
        );
        if (refused && refused.operation.type === "deck.create") {
          return quote(refused.operation.data.name);
        }
        return ref.deck_id != null ? `deck n° ${ref.deck_id}` : "deck inconnu";
      };
      switch (operation.type) {
        case "stock.upsert": {
          const { card_id, language_code, quantity_owned = 0, proxy_allowed = false } =
            operation.data;
          return `Collection : ${card(card_id)} (${language_code}), ${plural(quantity_owned, "exemplaire")}${proxy_allowed ? ", proxy autorisé" : ""}`;
        }
        case "stock.delete":
          return `Collection : retrait de ${card(operation.card_id)} (${operation.language_code})`;
        case "deck.create":
          return `Création du deck ${quote(operation.data.name)}`;
        case "deck.update": {
          const changes: string[] = [];
          const { data } = operation;
          if (data.archived === true) changes.push("archivage");
          if (data.archived === false) changes.push("désarchivage");
          if (data.status === "active") changes.push("passage en actif");
          if (data.status === "draft") changes.push("retour en brouillon");
          if (data.name !== undefined) changes.push(`renommage en ${quote(data.name)}`);
          if (data.archetype !== undefined || data.notes !== undefined) changes.push("informations");
          return `Deck ${deck(operation.deck)} : ${changes.join(", ") || "modification"}`;
        }
        case "deck.delete":
          return `Suppression du deck ${deck(operation.deck)}`;
        case "deck_card.upsert": {
          const { card_id, language_code, quantity, proxy_quantity = 0 } = operation.data;
          return `Deck ${deck(operation.deck)} : ${quantity} × ${card(card_id)} (${language_code})${proxy_quantity > 0 ? `, dont ${proxy_quantity} en proxy` : ""}`;
        }
        case "deck_card.delete":
          return `Deck ${deck(operation.deck)} : retrait de ${card(operation.card_id)} (${operation.language_code})`;
        case "bundle.deposit":
          return `Versement du produit n° ${operation.bundle_id} (${operation.data.language_code}, ${plural(operation.data.count ?? 1, "exemplaire")})`;
      }
    },
    [cardNames, decks, entries],
  );
}
