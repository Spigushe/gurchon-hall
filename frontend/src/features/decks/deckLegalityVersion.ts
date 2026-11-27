import type { LocalDeck, LocalDeckCard } from "../../offline/vtes";

/**
 * Empreinte d'un deck pour la relecture de sa légalité (v1.2.2, A1) : état en
 * attente, statut, et la liste carte × quantité totale triée par carte. Langue,
 * extension et proxies n'y entrent pas : la légalité ne regarde que la
 * composition (§5). Deux empreintes égales rendent le même verdict ; une
 * empreinte qui change (saisie locale, fin d'une synchronisation, deck modifié
 * depuis un autre appareil et reflété par le miroir) relance la lecture.
 *
 * `null` tant que les lignes ne sont pas lues : rien à relire encore.
 */
export function deckLegalityVersion(
  deck: Pick<LocalDeck, "pending" | "status">,
  lines: readonly Pick<LocalDeckCard, "cardId" | "quantity">[] | undefined,
): string | null {
  if (lines === undefined) return null;
  const totals = new Map<number, number>();
  for (const line of lines) totals.set(line.cardId, (totals.get(line.cardId) ?? 0) + line.quantity);
  const list = [...totals].sort(([a], [b]) => a - b).map(([cardId, quantity]) => `${cardId}x${quantity}`);
  return `${deck.pending ? "pending" : "synced"}|${deck.status}|${list.join(",")}`;
}
