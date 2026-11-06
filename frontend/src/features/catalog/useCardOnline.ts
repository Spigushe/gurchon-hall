import { useEffect, useState } from "react";
import type { components } from "../../api-client/schema.d.ts";
import { useApiClient } from "../../app/apiClientContext";
import { useConnectivity } from "../../offline/react";

/**
 * Fiche serveur d'une carte (`GET /cartes/{id}`), lue à la demande et en
 * ligne seulement (lot Chercher, D3, P7) : les images par impression, le
 * texte d'ambiance et l'artiste ne sont pas dans le miroir. Gardée en mémoire
 * par carte pour la session : rouvrir la fiche ne relance rien. Hors ligne,
 * rien n'est lancé et la fiche s'en passe. Le catalogue est public et commun
 * à tous les comptes, d'où un cache de module plutôt que par base.
 */

export type CardRead = components["schemas"]["CardRead"];

const cache = new Map<number, CardRead>();

/** Vide le cache (tests). */
export function clearCardOnlineCache(): void {
  cache.clear();
}

export function useCardOnline(cardId: number | null): CardRead | undefined {
  const client = useApiClient();
  const online = useConnectivity();
  const [loaded, setLoaded] = useState<CardRead | undefined>(undefined);
  const cached = cardId === null ? undefined : cache.get(cardId);

  useEffect(() => {
    if (cardId === null || !online || cache.has(cardId)) return;
    let live = true;
    client
      .GET("/cartes/{card_id}", { params: { path: { card_id: cardId } } })
      .then(({ data }) => {
        if (!data) return;
        cache.set(cardId, data);
        if (live) setLoaded(data);
      })
      .catch(() => {
        // Réseau coupé en cours de route : la fiche reste sur le miroir.
      });
    return () => {
      live = false;
    };
  }, [client, cardId, online]);

  return cached ?? (loaded?.id === cardId ? loaded : undefined);
}

/** Image de l'impression d'une extension, `null` quand elle n'en a pas (676 impressions) ou que la fiche n'est pas lue. */
export function printingImage(card: CardRead | undefined, cardSetId: number | null): string | null {
  if (!card || cardSetId === null) return null;
  return card.printings.find((printing) => printing.card_set.id === cardSetId)?.image_url ?? null;
}
